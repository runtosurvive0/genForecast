"""Vessel discovery, local tracking registration and estimated routes. No operations ledger writes."""
from contextlib import asynccontextmanager
import asyncio
from contextlib import suppress
from pathlib import Path
import os
import logging
from uuid import UUID
from typing import Literal
from typing import Annotated
from fastapi import APIRouter, Response, HTTPException, Query
from pydantic import BaseModel, Field
from midterm.vessels.ais import AisCatalog
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.digitraffic import DigitrafficCatalog
from midterm.vessels.navigation import TrackStore, SeaRouter
from midterm.vessels.weather import WeatherService
from midterm.vessels.cyclones import CycloneService
from midterm.vessels.port_visits import PortVisitService
from midterm.vessels.destinations import resolve_destination
from midterm.vessels.fleet_map import fleet_map, vessel_detail
from midterm.vessels.ais import utc_now

catalog: AisCatalog | None = None
digitraffic: DigitrafficCatalog | None = None
tracks: TrackStore | None = None
sea_router = SeaRouter()
weather_service = WeatherService(sea_router)
cyclone_service = CycloneService()
port_visit_service = PortVisitService()


async def reconcile_tracking(app):
    from midterm.web.auth_api import store_for_app
    members = await asyncio.to_thread(store_for_app(app).tracking_members)
    try:
        await asyncio.to_thread(tracks.reconcile, members)
        app.state.tracking_capacity_error = False
    except ValueError:
        # Legacy/externally changed databases must not prevent authentication/startup.
        # Fail closed rather than continuing revoked subscriptions. Saved lists stay intact.
        if not getattr(app.state, 'tracking_capacity_error', False):
            logging.getLogger(__name__).error('Account tracking union exceeds capacity; collection paused until saved lists are reduced.')
        app.state.tracking_capacity_error = True
        await asyncio.to_thread(tracks.reconcile, {})
    if any(source == 'aisstream' for source, _ in tracks.active):
        catalog.start()  # Idempotent; also starts collection after account restoration.


async def persist_loop(app):
    tick = 0
    while True:
        await asyncio.sleep(5)
        tick += 1
        try:
            await catalog.flush()
        except Exception:
            logging.getLogger(__name__).error('AIS discovery save failed; pending records will be retried.')
        try:
            await reconcile_tracking(app)
            if tick % 12 == 0 and any(source == "digitraffic" for source, _ in tracks.active):
                snapshot = await digitraffic.snapshot()
                for vessel in snapshot["vessels"]:
                    tracks.record(vessel)
            await asyncio.to_thread(tracks.flush)
        except Exception:
            logging.getLogger(__name__).error('Registered-vessel persistence failed; retrying next cycle.')


@asynccontextmanager
async def lifespan(app):
    global catalog, digitraffic, tracks
    track_path = Path(os.getenv("AIS_TRACK_DB", str(Path(__file__).resolve().parents[3] / "data" / "vessel-tracks.sqlite3")))
    tracks = TrackStore(track_path)
    discovery = DiscoveryStore(os.getenv('AIS_DISCOVERY_DB', str(track_path.with_name('vessel-discovery.sqlite3'))))
    catalog = AisCatalog(store=discovery, on_observation=tracks.record,
                         lookup_observation=lambda mmsi: tracks.active_observation("aisstream", mmsi))
    digitraffic = DigitrafficCatalog()
    worker = None
    try:
        await catalog.restore()
        await reconcile_tracking(app)
        catalog.start()  # Server lifecycle, independent of browser sessions/watchlists.
        worker = asyncio.create_task(persist_loop(app))
        yield
    finally:
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        await catalog.stop()
        try:
            await catalog.flush()
        finally:
            discovery.close()
            tracks.close()
            tracks = None
            catalog = None
            digitraffic = None


router = APIRouter(lifespan=lifespan)


@router.get("/api/vessels/port-visits/{owner}/{source}/{mmsi}")
async def vessel_port_visits(owner: UUID, source: Literal["aisstream", "digitraffic"], mmsi: str,
                            response: Response, days: int = 30):
    response.headers["Cache-Control"] = "no-store"
    if days not in (30, 90):
        raise HTTPException(422, "조회 기간은 30일 또는 90일입니다.")
    if tracks is None:
        raise HTTPException(503, "선박 추적 서버가 준비되지 않았습니다.")
    vessel = tracks.registered_member(str(owner), source, mmsi)
    if vessel is None:
        raise HTTPException(404, "이 브라우저에 등록된 관심 선박이 아닙니다.")
    return await port_visit_service.lookup(vessel, days)


@router.get("/api/vessels/cyclones")
async def vessel_cyclones(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await cyclone_service.snapshot()


@router.get("/api/vessels/catalog")
async def vessel_catalog(response: Response, provider: Literal["aisstream", "digitraffic"] = "aisstream"):
    response.headers["Cache-Control"] = "no-store"
    if catalog is None:
        response.status_code = 503
        return {"detail": "선박 수신기가 준비되지 않았습니다."}
    if provider == "digitraffic":
        snapshot = await digitraffic.snapshot()
        for vessel in snapshot["vessels"]:
            tracks.record(vessel)
        return snapshot
    return await catalog.committed_snapshot()


@router.get("/api/vessels/map")
async def map_catalog(response: Response, west: float = Query(ge=-180, le=180), east: float = Query(ge=-180, le=180),
                      south: float = Query(ge=-85, le=85), north: float = Query(ge=-85, le=85),
                      zoom: float = Query(ge=-2, le=18)):
    response.headers['Cache-Control'] = 'no-store'
    if south > north:
        raise HTTPException(422, 'Invalid latitude bounds')
    if catalog is None or catalog.store is None:
        raise HTTPException(503, 'AIS catalog not ready')
    return await asyncio.to_thread(fleet_map, catalog.store, west, east, south, north, zoom, utc_now())


@router.get("/api/vessels/map/{mmsi}")
async def map_vessel(response: Response, mmsi: str):
    import re
    response.headers['Cache-Control'] = 'no-store'
    if not re.fullmatch(r'[1-9][0-9]{8}', mmsi):
        raise HTTPException(422, 'Invalid MMSI')
    if catalog is None or catalog.store is None:
        raise HTTPException(503, 'AIS catalog not ready')
    value = await asyncio.to_thread(vessel_detail, catalog.store, mmsi, utc_now())
    if value is None:
        raise HTTPException(404, 'Vessel no longer in received catalog')
    return value


class TrackedMember(BaseModel):
    mmsi: str = Field(pattern=r"^[1-9][0-9]{8}$")
    source: Literal["aisstream", "digitraffic"]


class TrackingRequest(BaseModel):
    vessels: list[TrackedMember] = Field(max_length=200)


@router.put("/api/vessels/tracking/{owner}")
async def sync_tracking(owner: UUID, body: TrackingRequest, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if tracks is None:
        raise HTTPException(503, "항적 저장기가 준비되지 않았습니다.")
    try:
        tracks.sync(str(owner), [v.model_dump() for v in body.vessels])
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    if any(v.source == "aisstream" for v in body.vessels):
        catalog.start()
    for vessel in catalog.known_vessels():
        tracks.record(vessel)
    return {"vessels": tracks.latest(str(owner))}


@router.get("/api/vessels/tracking/{owner}")
def tracking_snapshot(owner: UUID, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if tracks is None:
        raise HTTPException(503, "항적 저장기가 준비되지 않았습니다.")
    return {"vessels": tracks.latest(str(owner)), "status": catalog.status}


@router.get("/api/vessels/tracking/{owner}/{source}/{mmsi}")
def vessel_history(owner: UUID, source: Literal["aisstream", "digitraffic"], mmsi: str,
                   response: Response, hours: int = 24):
    response.headers["Cache-Control"] = "no-store"
    if hours not in (24, 168, 720):
        raise HTTPException(422, "조회 기간은 24시간, 7일, 30일 중 선택해 주세요.")
    if tracks is None:
        raise HTTPException(503, "항적 저장기가 준비되지 않았습니다.")
    try:
        return tracks.history(str(owner), source, mmsi, hours)
    except KeyError:
        raise HTTPException(404, "이 브라우저에 등록된 관심 선박이 아닙니다.") from None


class DestinationRequest(BaseModel):
    destinations: list[Annotated[str, Field(max_length=100)]] = Field(max_length=200)


@router.post("/api/vessels/destinations/resolve")
def resolve_destinations(body: DestinationRequest):
    return {"destinations": [resolve_destination(raw) for raw in body.destinations]}


@router.get("/api/vessels/route")
def estimated_route(longitude: float = Query(ge=-180, le=180), latitude: float = Query(ge=-85, le=85),
                    destination: str = Query(max_length=32)):
    try:
        return sea_router.route(longitude, latitude, destination)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except Exception:
        raise HTTPException(503, "예상 항로 계산을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.") from None


@router.get("/api/vessels/weather/{owner}/{source}/{mmsi}")
async def vessel_weather(owner: UUID, source: Literal["aisstream", "digitraffic"], mmsi: str,
                         response: Response, destination: str = Query(max_length=32)):
    response.headers["Cache-Control"] = "no-store"
    try:
        sea_router.destination_coordinates(destination)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    if tracks is None:
        raise HTTPException(503, "관심 선박 수신기가 준비되지 않았습니다.")
    vessel = next((v for v in tracks.latest(str(owner)) if v["source"] == source and v["mmsi"] == mmsi), None)
    if vessel is None:
        raise HTTPException(404, "이 브라우저에 등록되어 관측된 관심 선박이 아닙니다.")
    return await weather_service.forecast(vessel, destination)
