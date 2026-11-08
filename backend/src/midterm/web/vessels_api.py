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
from datetime import datetime, timezone
import time
from fastapi import APIRouter, Response, HTTPException, Query, Request
from fastapi import Path as PathParam
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from midterm.vessels.ais import AisCatalog
from midterm.vessels.discovery_store import DiscoveryStore
from midterm.vessels.digitraffic import DigitrafficCatalog
from midterm.vessels.navigation import TrackStore, SeaRouter, epoch
from midterm.vessels.weather import WeatherService
from midterm.vessels.cyclones import CycloneService
from midterm.vessels.port_visits import PortVisitService
from midterm.vessels.destinations import resolve_destination
from midterm.vessels.fleet_map import fleet_map, vessel_detail
from midterm.vessels.ais import utc_now
from midterm.vessels.waiting import WaitingStore, evidence_for, waiting_candidates

catalog: AisCatalog | None = None
digitraffic: DigitrafficCatalog | None = None
tracks: TrackStore | None = None
waiting: WaitingStore | None = None
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
        try:
            await asyncio.to_thread(waiting.flush)
        except Exception:
            logging.getLogger(__name__).error('Waiting-area persistence failed; retrying next cycle.')


@asynccontextmanager
async def lifespan(app):
    global catalog, digitraffic, tracks, waiting
    track_path = Path(os.getenv("AIS_TRACK_DB", str(Path(__file__).resolve().parents[3] / "data" / "vessel-tracks.sqlite3")))
    tracks = TrackStore(track_path)
    waiting = WaitingStore(track_path, radius_km=float(os.getenv("WAITING_RADIUS_KM", "15")))

    def observe(vessel):
        tracks.record(vessel)
        waiting.record(vessel)
    discovery = DiscoveryStore(os.getenv('AIS_DISCOVERY_DB', str(track_path.with_name('vessel-discovery.sqlite3'))))
    catalog = AisCatalog(store=discovery, on_observation=observe,
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
            with suppress(Exception):
                waiting.flush()
            waiting.db.close()
            tracks = None
            waiting = None
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


# --- 당진 부두 대기(체선) 후보: 규칙으로 찾은 후보를 사용자가 확인한다. ---
waiting_router = APIRouter()
ANSWER_HOLD_S = 7 * 86400  # 답한 배는 7일 동안 다시 묻지 않고, 확인 표시도 7일만 보인다


def _iso(at: float) -> str:
    return datetime.fromtimestamp(at, timezone.utc).isoformat().replace("+00:00", "Z")


def _waiting_view(request: Request, now: float, skip_watchlist: bool = True):
    from midterm.web.auth_api import get_store
    if waiting is None:
        raise HTTPException(503, "선박 수신기가 준비되지 않았습니다.")
    uid = request.state.session["user"]["id"]
    payload = get_store(request).workspace(uid)["workspace"]
    interests = set(payload.get("watchlist", []))
    exclude = {v.get("mmsi") for v in payload.get("vessels", []) if v.get("id") in interests and v.get("mmsi")}         if skip_watchlist else set()
    answers = {m: (answer, at) for m, (answer, at) in waiting.answers(uid).items() if now - at < ANSWER_HOLD_S}
    exclude |= set(answers)
    points, heads = waiting.snapshot(now)
    return uid, answers, heads, waiting_candidates(points, heads, now, exclude)


@waiting_router.get("/api/vessels/waiting-candidates")
def waiting_feed(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    now = time.time()
    _, answers, heads, candidates = _waiting_view(request, now)
    observed = []
    for head in heads.values():
        try:
            observed.append(epoch(head["ais"]["position"]["observedAt"]))
        except (KeyError, TypeError, ValueError):
            continue
    return {
        "updatedAt": _iso(now),
        "lastReceivedAt": _iso(max(observed)) if observed else None,
        "radiusKm": waiting.radius_km,
        "candidates": candidates,
        "confirmed": {m: _iso(at) for m, (answer, at) in answers.items() if answer == "yes"},
    }


class WaitingAnswer(BaseModel):
    answer: Literal["yes", "no"]


@waiting_router.post("/api/vessels/waiting-candidates/{mmsi}/answer")
async def answer_waiting(mmsi: Annotated[str, PathParam(pattern=r"^\d{9}$")], body: WaitingAnswer, request: Request):
    from midterm.web.auth_api import get_store
    session = getattr(request.state, "session", None)
    if session:
        await run_in_threadpool(get_store(request).rate_limit, "waiting:" + session["user"]["id"], 30, 60)
    now = time.time()
    # "네"는 관심 등록을 먼저 저장한 뒤 도착하므로, 답 판정에서는 관심 목록을 빼지 않는다.
    uid, _, _, candidates = await run_in_threadpool(_waiting_view, request, now, False)
    candidate = next((c for c in candidates if c["mmsi"] == mmsi), None)
    if candidate is None:
        raise HTTPException(409, "후보 상태가 바뀌었습니다.")
    await run_in_threadpool(waiting.save_answer, uid, mmsi, body.answer, evidence_for(candidate, now), now)
    return {"ok": True, "answeredAt": _iso(now)}


router.include_router(waiting_router)
