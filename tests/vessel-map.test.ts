import { readFileSync } from "node:fs";
import test from "node:test";
import {
  landBackdropProgress,
  dotRadius,
  dotTile,
  dotTileFeatures,
} from "../src/features/vessels/map-dot-detail.ts";
import { projectStarField } from "../src/features/vessels/globe-stars.ts";
import { shipments } from "../src/domain/operations.ts";
import { voyages } from "../src/data/control-tower.ts";
import assert from "node:assert/strict";
import { decodeCyclones, nearbyCyclones, cycloneAt, windFootprints, weatherAttention } from "../src/features/vessels/vessel-weather-layers.ts";
import { estimateBasicEta } from "../src/features/vessels/vessel-basic-eta.ts";
import { estimateWeatherEta } from "../src/features/vessels/vessel-weather-eta.ts";
import type { VesselForecast } from "../src/features/vessels/vessel-weather.ts";
import { decodeForecast, forecastUsable } from "../src/features/vessels/vessel-weather.ts";
import type { TrackingVessel } from "../src/domain/vessel-workflow.ts";
import { vesselCourse, projectedCourse } from "../src/features/vessels/vessel-symbol.ts";
import { mapFleet, decodeRoute, decodeHistory, vesselNavigationRoutes } from "../src/features/vessels/vessel-navigation.ts";
import {
  unwrapRoute,
  morphProgress,
  validPosition,
  routesForVessels,
  samples,
  destinationCoordinates,
} from "../src/features/vessels/map-data.ts";

const etaAt = Date.parse('2026-10-09T00:00:00Z');
const etaShip: TrackingVessel = { id: 'eta-test', name: 'ETA TEST', mmsi: '440123456', imo: '', source: 'aisstream',
  ais: { updatedAt: new Date(etaAt).toISOString(), shipType: 70, navStatus: 0, destination: '',
    position: { latitude: 0, longitude: 0, observedAt: new Date(etaAt).toISOString(), sogKn: 12, cogDeg: 90 } } };
const etaRoute = decodeRoute({ kind: 'estimated', provider: 'searoute', destinationId: 'dangjin', origin: [0, 0],
  coordinates: [[0, 0], [1, 0], [2, 0]], distanceNm: 120, startOffsetNm: 0, endOffsetNm: 1 });
const etaInput = { vessel: etaShip, route: etaRoute, destination: 'dangjin', now: etaAt, routeCalculatedAt: etaAt };

const weatherFixture = (waves = [1, 4, 4], winds = [10, 10, 10]): VesselForecast => ({
  source: 'aisstream', mmsi: etaShip.mmsi, destinationId: 'dangjin', status: 'ready', reason: '',
  observedAt: new Date(etaAt).toISOString(), fetchedAt: new Date(etaAt).toISOString(), horizonHours: 72, speedKn: 12,
  points: waves.map((waveM, i) => ({ longitude: i, latitude: 0, passageAt: new Date(etaAt + i * 5 * 3600000).toISOString(),
    waveM, windKn: winds[i], gustKn: 20, windFromDeg: 90, waveFromDeg: 90, wavePeriodS: 8,
    airStatus: 'fresh', marineStatus: 'fresh', airFetchedAt: new Date(etaAt).toISOString(), marineFetchedAt: new Date(etaAt).toISOString(),
    airForecastAt: new Date(etaAt + i * 5 * 3600000).toISOString(), marineForecastAt: new Date(etaAt + i * 5 * 3600000).toISOString(), forecastIssuedAt: null })),
});
const weatherInput = () => ({ vessel: etaShip, basic: estimateBasicEta(etaInput), forecast: weatherFixture(), now: etaAt, sensitivity: 1 });

test('cyclone relevance matches passage time, handles dateline and excludes old advisories', () => {
  const storm = { id: 'test', name: 'TEST', source: 'JTWC', advisoryAt: new Date(etaAt).toISOString(), reportUrl: 'https://www.gdacs.org/report.aspx?eventid=1',
    points: [{ longitude: -179.8, latitude: 0, at: new Date(etaAt).toISOString(), forecast: false, radii34Nm: [90, null, 0, 60] }] };
  const route = [{ ...weatherFixture().points[0], longitude: 179.8 }];
  assert.equal(nearbyCyclones([storm], route, etaAt).length, 1);
  assert.equal(cycloneAt(storm, etaAt + 4 * 3600000), undefined);
  assert.equal(nearbyCyclones([storm], [{ ...route[0], passageAt: new Date(etaAt + 24 * 3600000).toISOString() }], etaAt).length, 0);
  assert.equal(nearbyCyclones([storm], route, etaAt + 25 * 3600000).length, 0);
  const shapes = windFootprints(storm.points[0]);
  assert.equal(shapes.length, 2); // Missing/zero quadrants never become invented circles.
  for (const polygon of shapes) {
    const ring = polygon.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    for (let i = 1; i < ring.length; i++) assert.ok(Math.abs(ring[i][0] - ring[i - 1][0]) < 180);
  }
  assert.throws(() => decodeCyclones({ status: 'ready', fetchedAt: 'invalid', reason: '', storms: [storm] }));
});

test('visibility is optional for old servers but zero is valid and missing is never safe', () => {
  const fixture = weatherFixture();
  fixture.points[0].visibilityM = 0;
  assert.equal(decodeForecast(fixture, etaShip, 'dangjin').points[0].visibilityM, 0);
  assert.equal(weatherAttention(fixture.points[0], 'visibility', etaAt), 'attention');
  delete fixture.points[0].visibilityM;
  assert.equal(weatherAttention(fixture.points[0], 'visibility', etaAt), 'unknown');
  fixture.points[0].visibilityM = -1;
  assert.throws(() => decodeForecast(fixture, etaShip, 'dangjin'));
  fixture.points[0].visibilityM = 800; fixture.points[0].airStatus = 'stale';
  assert.equal(weatherAttention(fixture.points[0], 'visibility', etaAt), 'unknown');
});

test('weather ETA integrates extra segment travel time and leaves the baseline untouched', () => {
  const input = weatherInput(), before = structuredClone(input);
  const result = estimateWeatherEta(input);
  // Two 5h legs: mean losses 5%, 10%; added time 5/.95-5 + 5/.9-5 = .81871345h.
  assert.equal(result.state, 'ready');
  assert.ok(Math.abs(result.delayH! - 0.8187134502923977) < 1e-8);
  assert.equal(result.coveredH, 10);
  assert.equal(result.uncoveredH, 0);
  assert.equal(result.eta, '2026-10-09T10:49:07.368Z');
  assert.deepEqual(input, before);
});

test('weather ETA does not double-count current weather or invent a speed-up', () => {
  for (const waves of [[4, 4, 4], [4, 1, 1], [1, 1, 1]]) {
    const result = estimateWeatherEta({ ...weatherInput(), forecast: weatherFixture(waves) });
    assert.equal(result.delayH, 0);
    assert.equal(result.eta, '2026-10-09T10:00:00.000Z');
  }
  const off = estimateWeatherEta({ ...weatherInput(), sensitivity: 0 });
  assert.equal(off.delayH, 0);
  const tail = weatherFixture();
  tail.points.forEach(p => { p.waveFromDeg = 270; });
  assert.ok(estimateWeatherEta({ ...weatherInput(), forecast: tail }).delayH! < estimateWeatherEta(weatherInput()).delayH!);
  assert.ok(estimateWeatherEta({ ...weatherInput(), sensitivity: 1.5 }).delayH! > estimateWeatherEta(weatherInput()).delayH!);
});

test('weather ETA marks uncovered legs and never treats missing or stale forecasts as calm', () => {
  const missing = weatherFixture(); missing.points[2].waveM = null;
  const partial = estimateWeatherEta({ ...weatherInput(), forecast: missing });
  assert.equal(partial.state, 'partial');
  assert.equal(partial.coveredH, 5);
  assert.equal(partial.uncoveredH, 5);
  assert.ok(Math.abs(partial.delayH! - .2631578947368421) < 1e-8);
  const stale = weatherFixture(); stale.points.forEach(p => { p.airStatus = 'stale'; });
  assert.equal(estimateWeatherEta({ ...weatherInput(), forecast: stale }).eta, null);
  const long = weatherInput(); long.basic.eta = new Date(etaAt + 100 * 3600000).toISOString();
  const longResult = estimateWeatherEta(long);
  assert.equal(longResult.state, 'partial');
  assert.equal(longResult.uncoveredH, 90);
});

test('weather ETA rejects mismatched identity, stale AIS, invalid time order and extreme weather', () => {
  const base = weatherInput();
  for (const patch of [{ mmsi: 'wrong' }, { destinationId: 'hadong' }, { source: 'digitraffic' }, { observedAt: new Date(etaAt - 3600000).toISOString() }])
    assert.equal(estimateWeatherEta({ ...base, forecast: { ...base.forecast, ...patch } }).eta, null);
  const reversed = weatherFixture(); reversed.points.reverse();
  assert.equal(estimateWeatherEta({ ...base, forecast: reversed }).eta, null);
  const outdated = weatherFixture(); outdated.points.forEach(p => { p.airFetchedAt = new Date(etaAt - 4 * 3600000).toISOString(); });
  assert.equal(estimateWeatherEta({ ...base, forecast: outdated }).eta, null);
  const extreme = weatherFixture([1, 9, 9]);
  assert.equal(estimateWeatherEta({ ...base, forecast: extreme }).eta, null);
  assert.equal(estimateWeatherEta({ ...base, basic: { ...base.basic, eta: null, state: 'blocked' } }).eta, null);
  assert.equal(estimateWeatherEta({ ...base, now: etaAt + 2 * 3600000 }).eta, null);
  assert.equal(estimateWeatherEta({ ...base, sensitivity: NaN }).eta, null);
});

test('weather ETA clips elapsed time and survives wrapped longitude headings', () => {
  const result = estimateWeatherEta({ ...weatherInput(), now: etaAt + 5 * 60000 });
  assert.ok(result.coveredH < 10 && result.coveredH > 9.9);
  const vessel = structuredClone(etaShip); vessel.ais!.position!.longitude = 179;
  const forecast = weatherFixture(); forecast.points.forEach((p, i) => { p.longitude = [179, -180, -179][i]; });
  assert.ok(Math.abs(estimateWeatherEta({ ...weatherInput(), vessel, forecast }).delayH! - .8187134502923977) < 1e-8);
});

test('weather ETA withholds old passage forecasts after a recent speed change', () => {
  const input = weatherInput();
  const faster = structuredClone(etaShip);
  faster.ais!.position!.sogKn = 24;
  faster.ais!.position!.observedAt = new Date(etaAt + 60000).toISOString();
  const basic = estimateBasicEta({ ...etaInput, vessel: faster, now: etaAt + 60000 });
  assert.equal(estimateWeatherEta({ ...input, vessel: faster, basic, now: etaAt + 60000 }).eta, null);
  assert.equal(estimateWeatherEta({ ...input, forecast: { ...input.forecast, speedKn: undefined } }).eta, null);
  const changed = { ...input.forecast, speedKn: 24, observedAt: faster.ais!.position!.observedAt,
    points: input.forecast.points.map((p, i) => ({ ...p, passageAt: new Date(etaAt + 60000 + i * 2.5 * 3600000).toISOString(),
      airForecastAt: new Date(etaAt + 60000 + i * 2.5 * 3600000).toISOString(), marineForecastAt: new Date(etaAt + 60000 + i * 2.5 * 3600000).toISOString() })) };
  assert.equal(estimateWeatherEta({ ...input, forecast: changed, vessel: faster, basic, now: etaAt + 60000 }).state, 'ready');
});

test('forecast responses reject wrong vessel destinations and retain explicit missing values', () => {
  const point = { longitude: 125, latitude: 35, passageAt: '2026-10-09T12:00:00Z', waveM: null, windKn: 12, gustKn: null,
    windFromDeg: 90, waveFromDeg: null, wavePeriodS: null, airStatus: 'fresh', marineStatus: 'missing', airFetchedAt: '2026-10-09T12:00:00Z',
    marineFetchedAt: null, airForecastAt: '2026-10-09T12:00:00Z', marineForecastAt: null, forecastIssuedAt: null };
  const response = { source: etaShip.source, mmsi: etaShip.mmsi, destinationId: 'dangjin', status: 'partial', reason: 'missing waves',
    observedAt: '2026-10-09T12:00:00Z', fetchedAt: '2026-10-09T12:00:00Z', horizonHours: 72, points: [point] };
  assert.equal(decodeForecast(response, etaShip, 'dangjin').points[0].waveM, null);
  const decoded = decodeForecast(response, etaShip, 'dangjin');
  assert.equal(forecastUsable(decoded, Date.parse('2026-10-09T17:00:00Z')), true);
  // A new server response timestamp must not extend an old provider forecast's life.
  assert.equal(forecastUsable({ ...decoded, fetchedAt: '2026-10-09T17:00:00Z' }, Date.parse('2026-10-09T19:00:00Z')), false);
  assert.throws(() => decodeForecast(response, etaShip, 'hadong'));
  assert.throws(() => decodeForecast({ ...response, mmsi: '440000000' }, etaShip, 'dangjin'));
  for (const patch of [{ longitude: 181 }, { waveM: -1 }, { windKn: NaN }, { passageAt: 'bad' }, { windFromDeg: 361 }])
    assert.throws(() => decodeForecast({ ...response, points: [{ ...point, ...patch }] }, etaShip, 'dangjin'));
});

test('basic AIS ETA uses the observed time and sea distance without creating a voyage', () => {
  const before = structuredClone(etaInput);
  assert.equal(estimateBasicEta(etaInput).eta, '2026-10-09T10:00:00.000Z');
  assert.equal(estimateBasicEta({ ...etaInput, now: etaAt + 30 * 60000 }).eta, '2026-10-09T10:00:00.000Z');
  assert.deepEqual(etaInput, before);
  assert.match(estimateBasicEta(etaInput).reason, /기상 미반영/);
});

test('basic ETA reduces cached distance along the route and handles the date line', () => {
  const moved = structuredClone(etaShip);
  moved.ais!.position!.longitude = 1;
  moved.ais!.position!.observedAt = '2026-10-09T00:30:00Z';
  const result = estimateBasicEta({ ...etaInput, vessel: moved, now: etaAt + 30 * 60000 });
  assert.ok(Math.abs(result.distanceNm! - 60) < .01);
  assert.equal(result.eta, '2026-10-09T05:30:00.000Z');
  const cross = { ...etaRoute, origin: [179, 0] as [number, number], coordinates: [[179, 0], [-179, 0]] as [number, number][] };
  moved.ais!.position!.longitude = 180;
  assert.ok(Math.abs(estimateBasicEta({ ...etaInput, vessel: moved, route: cross, now: etaAt + 30 * 60000 }).distanceNm! - 60) < .01);
});

test('basic ETA withholds stale, missing, implausible or stopped AIS rather than inventing an arrival', () => {
  for (const patch of [{ sogKn: 0 }, { sogKn: null }, { sogKn: .2 }, { sogKn: 55.8 }, { longitude: 181 },
    { observedAt: 'bad' }, { observedAt: '2026-10-09T01:00:00Z' }]) {
    const vessel = structuredClone(etaShip);
    Object.assign(vessel.ais!.position!, patch);
    assert.equal(estimateBasicEta({ ...etaInput, vessel }).eta, null);
  }
  for (const navStatus of [1, 5, 6]) {
    assert.equal(estimateBasicEta({ ...etaInput, vessel: { ...etaShip, ais: { ...etaShip.ais!, navStatus } } }).eta, null);
  }
  for (const voyageState of ['planned', 'stopped', 'cancelled', 'arrived'] as const) {
    assert.equal(estimateBasicEta({ ...etaInput, voyageState }).eta, null);
  }
  assert.equal(estimateBasicEta({ ...etaInput, now: etaAt + 3600001 }).eta, null);
  assert.equal(estimateBasicEta({ ...etaInput, destination: '' }).state, 'pending');
  assert.equal(estimateBasicEta({ ...etaInput, route: undefined }).eta, null);
  assert.equal(estimateBasicEta({ ...etaInput, destination: 'hadong' }).eta, null);
});

test('basic ETA rejects remote route snaps, expired routes, position jumps and passed arrival times', () => {
  for (const patch of [{ startOffsetNm: 58 }, { endOffsetNm: 21 }, { distanceNm: NaN }]) {
    assert.equal(estimateBasicEta({ ...etaInput, route: { ...etaRoute, ...patch } }).eta, null);
  }
  const offRoute = structuredClone(etaShip);
  offRoute.ais!.position!.latitude = 1;
  assert.equal(estimateBasicEta({ ...etaInput, vessel: offRoute }).eta, null);
  assert.equal(estimateBasicEta({ ...etaInput, routeCalculatedAt: etaAt - 7 * 3600000 }).eta, null);
  assert.equal(estimateBasicEta({ ...etaInput, route: { ...etaRoute, distanceNm: .01 }, now: etaAt + 60000 }).eta, null);
  const history = { pointCount: 1, truncated: false, segments: [[{ longitude: 10, latitude: 0, observedAt: new Date(etaAt - 60000).toISOString() }]] };
  assert.match(estimateBasicEta({ ...etaInput, history }).reason, /위치.*확인/);
  assert.equal(estimateBasicEta({ ...etaInput, history }).eta, null);
});

test("vessel symbol uses measured COG only while moving and rejects unavailable bearings", () => {
  assert.equal(vesselCourse({ cogDeg: 0, sogKn: 12 }), 0);
  assert.equal(vesselCourse({ cogDeg: 359.9, sogKn: 0.5 }), 359.9);
  for (const v of [{ cogDeg: 360, sogKn: 12 }, { cogDeg: -1, sogKn: 12 }, { cogDeg: null, sogKn: 12 },
    { cogDeg: 90, sogKn: null }, { cogDeg: 90, sogKn: 0.4 }, { cogDeg: 90, sogKn: 102.3 },
    { cogDeg: 90, sogKn: 12, navStatus: 1 }, { cogDeg: 90, sogKn: 12, navStatus: 5 }]) assert.equal(vesselCourse(v), null);
});

test("course follows the map projection and crosses the dateline without reversing", () => {
  const p = { longitude: 0, latitude: 0, cogDeg: 0, sogKn: 12 };
  const flat = ([lon, lat]: [number, number]): [number, number] => [lon, -lat];
  for (const course of [0, 90, 180, 270]) assert.ok(Math.abs(projectedCourse({ ...p, cogDeg: course }, flat)! - course) < .01);
  const rotated = ([lon, lat]: [number, number]): [number, number] => [lat, lon];
  assert.ok(Math.abs(projectedCourse(p, rotated)! - 90) < .01);
  const wrapped = ([lon, lat]: [number, number]): [number, number] => [((lon + 180) % 360 + 360) % 360 - 180, -lat];
  assert.ok(Math.abs(projectedCourse({ ...p, longitude: 179.999, cogDeg: 90 }, wrapped)! - 90) < .1);
  assert.equal(projectedCourse(p, () => null), null);
  assert.equal(projectedCourse(p, () => [0, 0]), null);
});

test("real AIS maps without a voyage and never borrows a sample route identity", () => {
  const vessel = { id: "real", legacyId: "ship-dj", name: "REAL BULK", imo: "", mmsi: "440123456", source: "aisstream" as const,
    ais: { updatedAt: "2026-10-09T00:00:00Z", destination: "DANGJIN", shipType: 70, navStatus: 0,
      position: { latitude: 35, longitude: 125, observedAt: "2026-10-09T00:00:00Z", sogKn: 10, cogDeg: 0 } } };
  const fleet = mapFleet([{ vessel }]);
  assert.equal(fleet.items[0].id, "real");
  assert.equal(fleet.items[0].source, "aisstream");
  assert.equal(fleet.positions[0].longitude, 125);
  assert.equal(fleet.positions[0].cogDeg, 0);
  assert.equal(fleet.positions[0].sogKn, 10);
  assert.equal(routesForVessels(fleet.items, fleet.positions).length, 0);
  assert.equal(mapFleet([{ vessel: { ...vessel, ais: { ...vessel.ais, position: null } } }]).items.length, 0);
  const collision = mapFleet([{ vessel: { ...vessel, id: "ship-dj" } }]);
  collision.items[0].plantId = "dangjin";
  assert.deepEqual(routesForVessels(collision.items, collision.positions), [], "imported real IDs cannot inherit demo routes");
});

test("navigation responses reject invalid geometry and preserve observed track gaps", () => {
  assert.throws(() => decodeRoute({ kind: "estimated", coordinates: [[125, 35], [Infinity, 36]] }));
  const history = decodeHistory({ segments: [[{ longitude: 125, latitude: 35, observedAt: "2026-10-09T00:00:00Z" }],
    [{ longitude: 126, latitude: 36, observedAt: "2026-10-09T10:00:00Z" }]], pointCount: 2, truncated: false });
  assert.equal(history.segments.length, 2);
  assert.throws(() => decodeHistory({ segments: [[{ longitude: 181, latitude: 35, observedAt: "2026-10-09T00:00:00Z" }]] }));
});

test("route connection follows actual AIS even when the cached sea route starts elsewhere", () => {
  const current = { longitude: 125, latitude: 35, observedAt: "2026-10-09T00:01:00Z" };
  const route = decodeRoute({ kind: "estimated", provider: "searoute", destinationId: "dangjin", origin: [125, 35],
    coordinates: [[125.57373, 34.152727], [126, 36]], distanceNm: 100, startOffsetNm: 58, endOffsetNm: 11 });
  const original = structuredClone(route);
  const result = vesselNavigationRoutes("real", current, route);
  assert.deepEqual(result.find(r => r.kind === "connector")!.coordinates, [[125, 35], route.coordinates[0]]);
  assert.deepEqual(result.find(r => r.kind === "estimated")!.coordinates, route.coordinates);
  const moved = vesselNavigationRoutes("real", { ...current, longitude: 125.01 }, route);
  assert.deepEqual(moved.find(r => r.kind === "connector")!.coordinates[0], [125.01, 35]);
  assert.deepEqual(route, original, "never move actual coordinates or mutate the calculated route");
  assert.deepEqual(vesselNavigationRoutes("real", current, undefined), []);
});

test("observed track reaches the latest AIS fix but never bridges gaps or impossible jumps", () => {
  const history = { segments: [[{ longitude: 125, latitude: 35, observedAt: "2026-10-09T00:00:00Z" },
    { longitude: 125.001, latitude: 35, observedAt: "2026-10-09T00:01:00Z" }]], pointCount: 2, truncated: false };
  const current = { longitude: 125.002, latitude: 35, observedAt: "2026-10-09T00:01:30Z" };
  const result = vesselNavigationRoutes("real", current, undefined, history);
  assert.deepEqual(result[0].coordinates.at(-1), [125.002, 35]);
  for (const p of [{ ...current, longitude: 130 }, { ...current, observedAt: "2026-10-09T08:00:00Z" },
    { ...current, observedAt: "2026-10-08T23:00:00Z" }]) {
    assert.deepEqual(vesselNavigationRoutes("real", p, undefined, history)[0].coordinates.at(-1), [125.001, 35]);
  }
  assert.equal(history.segments[0].length, 2);
});

test("routes cross the dateline by the short arc without mutating observations", () => {
  const input: [number, number][] = [
    [170, 10],
    [-175, 11],
    [-160, 12],
  ];
  assert.deepEqual(unwrapRoute(input), [
    [170, 10],
    [185, 11],
    [200, 12],
  ]);
  assert.equal(input[1][0], -175);
  assert.deepEqual(
    unwrapRoute([
      [-170, 0],
      [175, 0],
    ]),
    [
      [-170, 0],
      [-185, 0],
    ],
  );
  assert.deepEqual(unwrapRoute([]), []);
});

test("land morph is bounded, reversible and waits for the initial map", () => {
  assert.equal(morphProgress(3, true), 0);
  assert.equal(morphProgress(4.75, true), 0);
  assert.equal(morphProgress(5.5, true), 0.5);
  assert.equal(morphProgress(6.25, true), 1);
  assert.equal(morphProgress(18, true), 1);
  assert.equal(morphProgress(18, false), 0);
});

test("invalid AIS coordinates do not enter either map renderer", () => {
  assert.equal(validPosition({ longitude: 126.45, latitude: 36.98 }), true);
  for (const p of [
    { longitude: 181, latitude: 0 },
    { longitude: 0, latitude: 91 },
    { longitude: NaN, latitude: 0 },
  ]) {
    assert.equal(validPosition(p), false);
  }
});

test("flat map dot rows keep uniform projected spacing at northern latitudes", () => {
  const points = JSON.parse(
    readFileSync(
      new URL("../src/data/world-dots-flat.json", import.meta.url),
      "utf8",
    ),
  ) as [number, number][];
  const latitudes = [...new Set(points.map((p) => p[1]))].sort((a, b) => a - b);
  const mercatorY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  function rowSpacing(min: number, max: number) {
    const rows = latitudes
      .filter((lat) => lat >= min && lat <= max)
      .map(mercatorY);
    assert.ok(rows.length > 5);
    const gaps = rows
      .slice(1)
      .map((y, i) => y - rows[i])
      .sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }
  const ratio = rowSpacing(65, 80) / rowSpacing(-10, 10);
  assert.ok(
    ratio > 0.98 && ratio < 1.02,
    "north/equator screen spacing: " + ratio,
  );
});

test("sample routes share the current vessel positions and keep the port endpoints", () => {
  const routes = routesForVessels(
    shipments,
    voyages.map((v) => ({ ...v, vessel_id: v.voyage_id })),
    "ship-br",
  );
  assert.equal(routes.length, 4);
  for (const route of routes) {
    const voyage = voyages.find((v) => v.voyage_id === route.id)!;
    assert.ok(
      route.coordinates.some(
        (p) => p[0] === voyage.longitude && p[1] === voyage.latitude,
      ),
      route.id,
    );
    assert.deepEqual(route.coordinates[0], samples[route.id].origin);
    assert.deepEqual(
      route.coordinates.at(-1),
      destinationCoordinates[voyage.destination_plant_id],
    );
    assert.equal(route.selected, route.id === "ship-br");
  }
  const updated = { vessel_id: "ship-br", longitude: 123.9, latitude: 25.6 };
  const moved = routesForVessels(shipments, [updated]);
  assert.equal(moved.length, 1);
  assert.ok(
    moved[0].coordinates.some(
      (p) => p[0] === updated.longitude && p[1] === updated.latitude,
    ),
  );
  assert.equal(
    routesForVessels(
      [{ id: "unknown", plantId: "dangjin" }],
      [{ ...updated, vessel_id: "unknown" }],
    ).length,
    0,
  );
  assert.equal(
    routesForVessels(shipments, [{ ...updated, latitude: NaN }]).length,
    0,
  );
});

test("arrived sample vessels share a single endpoint with the destination", () => {
  const [longitude, latitude] = destinationCoordinates.dangjin;
  const input = [{ vessel_id: "ship-dj", longitude, latitude }];
  const snapshot = structuredClone(input);
  const [route] = routesForVessels(shipments, input);
  assert.deepEqual(route.coordinates.at(-1), [longitude, latitude]);
  assert.equal(
    route.coordinates.filter((p) => p[0] === longitude && p[1] === latitude)
      .length,
    1,
  );
  assert.deepEqual(input, snapshot);
});

const skyView = {
  width: 900,
  height: 450,
  centerX: 450,
  centerY: 225,
  longitude: 125,
  latitude: 15,
  zoom: 1.5,
  bearing: 0,
  fov: 36.87,
};

test("square stars stay tiny and outside the globe silhouette", () => {
  const sky = projectStarField(skyView);
  assert.ok(sky.points.length > 8 && sky.points.length < 100);
  for (const p of sky.points) {
    assert.ok(p.size >= 1 && p.size <= 1.4);
    assert.ok(
      Math.hypot(p.x - skyView.centerX, p.y - skyView.centerY) > sky.radius + 2,
    );
    assert.ok(
      p.x >= 0 && p.x <= skyView.width && p.y >= 0 && p.y <= skyView.height,
    );
  }
  assert.equal(projectStarField({ ...skyView, zoom: 8 }).points.length, 0);
});

test("stars follow the camera without rerandomizing or scaling their square size", () => {
  const initial = projectStarField(skyView);
  const moved = projectStarField({ ...skyView, longitude: 135, latitude: 25 });
  const common = initial.points.find((p) =>
    moved.points.some((q) => q.id === p.id),
  );
  assert.ok(common);
  const next = moved.points.find((p) => p.id === common.id)!;
  assert.ok(Math.hypot(common.x - next.x, common.y - next.y) > 1);
  assert.equal(next.size, common.size);
  assert.deepEqual(projectStarField(skyView), initial);
});

test("star camera orientation remains continuous across the dateline", () => {
  const east = projectStarField({ ...skyView, longitude: 180 });
  const west = projectStarField({ ...skyView, longitude: -180 });
  assert.deepEqual(
    east.points.map((p) => p.id),
    west.points.map((p) => p.id),
  );
  east.points.forEach((p, i) =>
    assert.ok(
      Math.hypot(p.x - west.points[i].x, p.y - west.points[i].y) < 1e-8,
    ),
  );
});

test("overview retains enough land samples and a visible coastline before morphing", () => {
  assert.ok(dotTileFeatures(0).length >= 65536);
  assert.ok(dotTileFeatures(1).length >= 16384);
  for (const zoom of [-2, 0, 1, 1.5, 2]) {
    assert.ok(landBackdropProgress(zoom, true) >= 0.5);
  }
  for (let zoom = -2; zoom <= 2; zoom += 0.025) {
    const projectedSpacing = (512 * 2 ** zoom) / 256;
    assert.ok(dotRadius(zoom) * 2 < projectedSpacing, "dense overview dots still retain gaps in flat view");
  }
});

test("dot detail and land silhouette grow continuously without losing geography", () => {
  for (const zoom of [-2, 1, 2.5, 3.5, 6.25, 18]) {
    assert.equal(landBackdropProgress(zoom, false), 0);
  }
  assert.ok(landBackdropProgress(2.5, true) > 0.1);
  assert.equal(landBackdropProgress(6.25, true), 1);
  for (let zoom = 1.5; zoom < 7; zoom += 0.025) {
    for (const progress of [landBackdropProgress]) {
      const before = progress(zoom, true);
      const after = progress(zoom + 0.025, true);
      assert.ok(after >= before && after <= 1);
      assert.ok(
        after - before < 0.025,
        "no sudden change at density boundaries",
      );
    }
  }
});

test("dot radius increases continuously through fractional zoom and density boundaries", () => {
  let previous = dotRadius(0);
  for (let zoom = 0.01; zoom <= 6.25; zoom += 0.01) {
    const next = dotRadius(zoom);
    assert.ok(next > previous && next - previous < 0.007);
    assert.ok(next * 2 < 8, "diameter stays below the nearest dot spacing");
    previous = next;
  }
  assert.ok(dotRadius(4.75) > 1.85 * 1.45);
});

test("detail tiles retain parent dots and introduce only new points at each zoom", () => {
  for (let zoom = 1; zoom <= 6; zoom++) {
    const parent = dotTileFeatures(zoom - 1);
    const child = dotTileFeatures(zoom);
    assert.equal(child.length, zoom === 1 ? 16384 : 4096);
    const index = new Map(
      child.map((p) => [p.geometry[0].join(","), p.tags!.birthZoom]),
    );
    for (const p of parent) {
      const [x, y] = p.geometry[0] as [number, number];
      if (x < 2048 && y < 2048)
        assert.equal(index.get([x * 2, y * 2].join(",")), p.tags!.birthZoom);
    }
    assert.equal(child.filter((p) => p.tags!.birthZoom === zoom).length, zoom <= 2 ? 0 : 3072);
    const tile = dotTile(zoom);
    assert.ok(tile.byteLength > 4096 && tile.byteLength < 600000);
    const expected = new Uint8Array(tile).slice();
    structuredClone(tile, { transfer: [tile] });
    assert.deepEqual(
      new Uint8Array(dotTile(zoom)),
      expected,
      "worker transfer cannot detach the cached tile",
    );
  }
  assert.throws(() => dotTile(7));
});
