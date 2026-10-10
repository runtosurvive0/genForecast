import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest

from midterm.vessels.weather import WeatherService, sample_route, match_hour

NOW = 1791547200.0


def ship():
    return {"source": "aisstream", "mmsi": "440123456", "ais": {"shipType": 70, "navStatus": 0,
        "position": {"longitude": 125.0, "latitude": 35.0, "observedAt": "2026-10-09T12:00:00Z", "sogKn": 12}}}


class Router:
    def route(self, lon, lat, destination):
        return {"coordinates": [[lon, lat], [126, 35]], "origin": [lon, lat], "distanceNm": 1200,
                "startOffsetNm": 0, "endOffsetNm": 1, "destinationId": destination}


def test_sampling_uses_observation_and_limits_horizon_without_wrapping_dateline_wrongly():
    route = Router().route(125, 35, "dangjin")
    points = sample_route(route, [125, 35], 12, NOW)
    assert len(points) == 12
    assert points[0]["passageAt"] == NOW
    assert points[-1]["passageAt"] == NOW + 72 * 3600
    assert points[-1]["longitude"] < 126
    cross = {**route, "origin": [179, 0], "coordinates": [[179, 0], [-179, 0]], "distanceNm": 120}
    assert all(abs(p["longitude"]) >= 179 for p in sample_route(cross, [179, 0], 12, NOW))
    moved = sample_route({**route, "distanceNm": 120}, [125.5, 35], 12, NOW)
    assert moved[-1]["passageAt"] == pytest.approx(NOW + 5 * 3600)


def test_hour_match_preserves_missing_and_does_not_extrapolate():
    series = {"hourly": {"time": [NOW, NOW + 3600], "wave_height": [None, 2.5]}}
    assert match_hour(series, NOW, "wave_height") is None
    assert match_hour(series, NOW + 3600, "wave_height") == 2.5
    assert match_hour(series, NOW + 3601, "wave_height") is None


def test_provider_cache_is_shared_and_failure_marks_stale_then_missing():
    calls = []
    fail = False
    async def fetch(kind, coordinates):
        calls.append((kind, coordinates))
        if fail:
            raise OSError("upstream")
        variables = {"wave_height": 2, "wave_direction": 270, "wave_period": 8} if kind == "marine" else {
            "wind_speed_10m": 15, "wind_gusts_10m": 22, "wind_direction_10m": 90, "visibility": 800}
        return [{"latitude": lat, "longitude": lon, "hourly_units": {
            "wave_height": "m", "wave_direction": "°", "wave_period": "s", "wind_speed_10m": "kn", "wind_gusts_10m": "kn", "wind_direction_10m": "°", "visibility": "m"},
            "hourly": {"time": [NOW + h * 3600 for h in range(80)], **{v: [x] * 80 for v, x in variables.items()}}} for lon, lat in coordinates]
    async def check():
        nonlocal fail
        clock = [NOW]
        service = WeatherService(Router(), fetch=fetch, clock=lambda: clock[0])
        vessel = ship()
        result = await service.forecast(vessel, "dangjin")
        assert result["status"] == "ready"
        assert result["speedKn"] == 12
        assert result["points"][0]["windKn"] == 15
        assert result["points"][0]["visibilityM"] == 800
        assert result["points"][0]["forecastIssuedAt"] is None
        await service.forecast(vessel, "dangjin")
        assert len(calls) == 2
        faster = deepcopy(vessel)
        faster["ais"]["position"]["sogKn"] = 24
        updated = await service.forecast(faster, "dangjin")
        assert updated["speedKn"] == 24
        assert updated["points"][-1]["passageAt"] == "2026-10-11T14:00:00Z"
        fail = True
        clock[0] += 3 * 3600 + 1
        vessel["ais"]["position"]["observedAt"] = "2026-10-09T15:00:01Z"
        result = await service.forecast(vessel, "dangjin")
        assert result["status"] == "partial"
        assert result["points"][0]["marineStatus"] == "stale"
        clock[0] += 4 * 3600
        vessel["ais"]["position"]["observedAt"] = "2026-10-09T19:00:01Z"
        assert (await service.forecast(vessel, "dangjin"))["status"] == "unavailable"
    asyncio.run(check())


def test_bad_ais_does_not_call_provider():
    async def fetch(*args):
        pytest.fail("invalid vessel must not call weather provider")
    async def check():
        service = WeatherService(Router(), fetch=fetch, clock=lambda: NOW)
        for patch in [{"sogKn": 0}, {"sogKn": 55}, {"longitude": 181}, {"observedAt": "bad"}, {"observedAt": "2026-10-09T10:00:00Z"}]:
            value = deepcopy(ship())
            value["ais"]["position"].update(patch)
            assert (await service.forecast(value, "dangjin"))["status"] == "blocked"
        value = ship()
        value["ais"]["navStatus"] = 1
        assert (await service.forecast(value, "dangjin"))["status"] == "blocked"
    asyncio.run(check())


def test_endpoint_checks_interest_before_weather(monkeypatch):
    from fastapi import HTTPException, Response
    from midterm.web import vessels_api
    class Store:
        def latest(self, owner):
            return []
    monkeypatch.setattr(vessels_api, "tracks", Store())
    with pytest.raises(HTTPException) as error:
        asyncio.run(vessels_api.vessel_weather(uuid4(), "aisstream", "440123456", Response(), "dangjin"))
    assert error.value.status_code == 404


def test_budget_counts_coordinates_and_cooldown_does_not_retry_each_ship():
    calls = []
    async def fetch(kind, grids):
        calls.append(kind)
        raise OSError("unavailable")
    async def check():
        service = WeatherService(Router(), fetch=fetch, clock=lambda: NOW)
        assert service._reserve(300, NOW)
        assert not service._reserve(1, NOW)
        assert service._reserve(1, NOW+61)
        service.calls.clear()
        await service.forecast(ship(), "dangjin")
        await service.forecast(ship(), "boryeong")
        assert calls == ["air", "marine"]
    asyncio.run(check())


def test_wrong_units_and_partial_provider_failure_never_become_zero_wave():
    async def fetch(kind, grids):
        return [{"hourly_units": {"wind_speed_10m": "km/h"}, "hourly": {"time": [NOW], "wind_speed_10m": [10]}} for _ in grids]
    async def check():
        result = await WeatherService(Router(), fetch=fetch, clock=lambda: NOW).forecast(ship(), "dangjin")
        assert result["status"] == "unavailable"
        assert all(p["waveM"] is None and p["windKn"] is None for p in result["points"])
    asyncio.run(check())


def test_cached_route_is_recomputed_after_cross_track_movement():
    class CountingRouter(Router):
        calls = 0
        def route(self, *args):
            self.calls += 1
            return super().route(*args)
    async def fetch(kind, grids):
        raise OSError("no weather")
    async def check():
        clock = [NOW]
        router = CountingRouter()
        service = WeatherService(router, fetch=fetch, clock=lambda: clock[0])
        await service.forecast(ship(), "dangjin")
        moved = ship()
        moved["ais"]["position"].update(latitude=35.11, observedAt="2026-10-09T12:40:00Z")
        clock[0] += 40*60
        result = await service.forecast(moved, "dangjin")
        assert router.calls == 2
        assert result["status"] != "blocked"
    asyncio.run(check())


def test_missing_or_wrong_visibility_units_preserve_valid_wind_and_zero_visibility():
    async def check():
        for mode in ("missing", "wrong", "zero"):
            async def fetch(kind, grids):
                fields = {"wave_height": (2, "m"), "wave_direction": (90, "°"), "wave_period": (8, "s")} if kind == "marine" else {
                    "wind_speed_10m": (15, "kn"), "wind_gusts_10m": (20, "kn"), "wind_direction_10m": (90, "°")}
                if kind == "air" and mode != "missing":
                    fields["visibility"] = (0, "km" if mode == "wrong" else "m")
                return [{"hourly_units": {k: unit for k, (_, unit) in fields.items()},
                         "hourly": {"time": [NOW+h*3600 for h in range(80)], **{k: [v]*80 for k, (v, _) in fields.items()}}} for _ in grids]
            data = await WeatherService(Router(), fetch=fetch, clock=lambda: NOW).forecast(ship(), "dangjin")
            assert data["points"][0]["windKn"] == 15
            assert data["points"][0]["visibilityM"] == (0 if mode == "zero" else None)
            assert data["status"] == ("ready" if mode == "zero" else "partial")
    asyncio.run(check())
