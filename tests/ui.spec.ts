import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planningFixture } from "./planning-fixture";
import { mapStyleFixture } from "./map-style-fixture";
import { voyages } from "../src/data/control-tower";

async function openEta(page: import("@playwright/test").Page) {
  await page.goto("/?source=synthetic");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
}

test("AIS destination option resolves global ports and clears obsolete routes on destination changes", async ({ page }) => {
  test.setTimeout(65000);
  let raw = "KR PUS";
  const ship = { id: "ais-destination-test", name: "DESTINATION TEST", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: new Date().toISOString(), shipType: 70, navStatus: 0, destination: raw,
      position: { longitude: 125, latitude: 35, observedAt: new Date().toISOString(), sogKn: 12, cogDeg: 120 } } };
  await page.addInitScript(v => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [v], voyages: [], watchlist: [v.id] })), ship);
  await page.route("https://tiles.openfreemap.org/styles/*", r => r.fulfill({ json: mapStyleFixture }));
  await page.route("**/api/vessels/port-visits/**", r => r.fulfill({ status: 503, json: {} }));
  await page.route("**/api/vessels/tracking/**", r => r.fulfill({ json: /\/aisstream\//.test(r.request().url())
    ? { pointCount: 0, segments: [], truncated: false } : { vessels: [{ ...ship, ais: { ...ship.ais, destination: raw } }] } }));
  let release: () => void = () => {};
  let pending = false;
  await page.route("**/api/vessels/destinations/resolve", async r => {
    const raws = r.request().postDataJSON().destinations as string[];
    if (raws.includes("SGSIN") && pending) await new Promise<void>(done => { release = done; });
    await r.fulfill({ json: { destinations: raws.map(value => value === "UNKNOWN"
      ? { raw: value, status: "unresolved" } : { raw: value, status: "resolved", destinationId: value === "KR PUS" ? "port:KRPUS" : "port:SGSIN",
        code: value === "KR PUS" ? "KRPUS" : "SGSIN", name: value === "KR PUS" ? "Busan" : "Singapore", country: value === "KR PUS" ? "South Korea" : "Singapore", matchedBy: "code" }) } });
  });
  const routeDestinations: string[] = [];
  const weatherDestinations: string[] = [];
  await page.route("**/api/vessels/weather/**", r => {
    weatherDestinations.push(new URL(r.request().url()).searchParams.get("destination")!);
    return r.fulfill({ status: 503, json: {} });
  });
  await page.route("**/api/vessels/route?*", r => {
    const destination = new URL(r.request().url()).searchParams.get("destination")!;
    routeDestinations.push(destination);
    return r.fulfill({ json: { kind: "estimated", provider: "searoute", destinationId: destination, origin: [125, 35],
      coordinates: [[125, 35], [126, 34]], distanceNm: destination === "port:KRPUS" ? 345 : 2345, startOffsetNm: 0, endOffsetNm: 0 } });
  });
  await openEta(page);
  const selector = page.getByLabel("예상 항로 목적항");
  await selector.selectOption("ais");
  const controls = page.getByRole("region", { name: "실제 선박 항로 설정" });
  const summary = page.getByRole("region", { name: "항로 정보", exact: true });
  await expect(controls).toContainText("Busan");
  await expect(summary).toContainText("345 nm");
  await expect.poll(() => weatherDestinations).toContain("port:KRPUS");
  await controls.screenshot({ path: ".tooling-tmp/ais-destination-light.png" });
  pending = true;
  raw = "SGSIN";
  await expect(controls).toContainText("AIS 목적항 확인 중", { timeout: 15000 });
  await expect(summary).not.toContainText("345 nm");
  expect(routeDestinations).toEqual(["port:KRPUS"]);
  release();
  await expect(controls).toContainText("Singapore");
  await expect(summary).toContainText("2,345 nm");
  await expect.poll(() => weatherDestinations).toContain("port:SGSIN");
  await page.getByRole("button", { name: "다크 모드로 전환", exact: true }).click();
  await controls.screenshot({ path: ".tooling-tmp/ais-destination-dark.png" });
  raw = "UNKNOWN";
  await expect(controls).toContainText("하나의 항만으로 확인할 수 없습니다", { timeout: 15000 });
  await expect(summary).not.toContainText("2,345 nm");
  expect(routeDestinations).toEqual(["port:KRPUS", "port:SGSIN"]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await controls.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await controls.screenshot({ path: ".tooling-tmp/ais-destination-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  await expect(selector).toHaveValue("ais");
  await expect(controls).toContainText("하나의 항만으로 확인할 수 없습니다");
  await selector.selectOption("dangjin");
  await expect.poll(() => routeDestinations.at(-1)).toBe("dangjin");
});

test("GFW port visits show provenance, missing departure and errors without changing voyage", async ({ page }) => {
  const ship = { id: "gfw-test", name: "GFW TEST SHIP", mmsi: "440123456", imo: "9459101", source: "aisstream" };
  await page.addInitScript(v => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [v], voyages: [], watchlist: [v.id] })), { ...ship, ais: { updatedAt: new Date().toISOString(), shipType: 70, navStatus: 0, destination: "KR PUS", position: null } });
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: /\/aisstream\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: [] } }));
  let status = "ready";
  let finish: () => void = () => {};
  let requests = 0;
  await page.route("**/api/vessels/port-visits/**", async route => {
    requests++;
    if (requests === 1) await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { provider: "gfw", mmsi: ship.mmsi, days: Number(new URL(route.request().url()).searchParams.get("days")), status,
      message: status === "unconfigured" ? "서버에 GFW_API_TOKEN을 설정하면 기항 기록을 조회할 수 있습니다." : "",
      fetchedAt: "2026-10-10T00:00:00Z", windowStart: "2026-09-10", windowEnd: "2026-10-11", delayHours: 72, matchBasis: "mmsi_imo", truncated: false, datasets: ["public-global-port-visits-events:v3.1"],
      visits: status === "ready" ? [{ id: "one", portName: "NEWCASTLE", country: "AUS", arrivalAt: "2026-10-03T00:00:00Z", departureAt: "2026-10-04T12:00:00Z", confidence: 3 },
        { id: "two", portName: "SINGAPORE", country: "SGP", arrivalAt: "2026-10-06T00:00:00Z", departureAt: null, confidence: 2 }] : [] } });
  });
  await openEta(page);
  const panel = page.getByRole("region", { name: "과거 기항 기록" });
  await expect(panel).toContainText("기항 기록 조회 중");
  finish();
  await expect(panel).toContainText("NEWCASTLE");
  await expect(panel).toContainText("출항 미확인");
  await expect(panel).toContainText("약 72시간");
  await expect(panel).toContainText("선적항");
  await expect(panel.getByRole("link", { name: "Global Fishing Watch", exact: true })).toHaveAttribute("href", "https://globalfishingwatch.org/");
  await expect(panel).toContainText("10. 04. 21:00");
  await panel.screenshot({ path: ".tooling-tmp/gfw-port-visits-light.png" });
  await page.getByRole("button", { name: "다크 모드로 전환", exact: true }).click();
  await panel.screenshot({ path: ".tooling-tmp/gfw-port-visits-dark.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: ".tooling-tmp/gfw-port-visits-mobile.png" });
  status = "unconfigured";
  await panel.getByLabel("기항 기록 조회 기간").selectOption("90");
  await expect(panel).toContainText("GFW_API_TOKEN");
  await expect(panel).not.toContainText("NEWCASTLE");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("genforecast.vessel-workspace.v1")!).voyages)).toEqual([]);
});

test("GFW response from another vessel is rejected and switching ships clears old visits", async ({ page }) => {
  const ships = [0, 1].map(i => ({ id: `gfw-${i}`, name: `GFW SHIP ${i}`, mmsi: `44012345${i}`, imo: "", source: "manual" }));
  await page.addInitScript(v => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: v, voyages: [], watchlist: v.map(s => s.id) })), ships);
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: /\/aisstream\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: [] } }));
  await page.route("**/api/vessels/port-visits/**", route => route.fulfill({ json: { provider: "gfw", mmsi: ships[0].mmsi, days: 30, status: "ready", message: "", fetchedAt: "2026-10-10T00:00:00Z", windowStart: "2026-09-10", windowEnd: "2026-10-11", delayHours: 72, matchBasis: "mmsi", truncated: false, datasets: [], visits: [{ id: "one", portName: "NEWCASTLE", country: "AUS", arrivalAt: "2026-10-03T00:00:00Z", departureAt: null, confidence: null }] } }));
  await openEta(page);
  const panel = page.getByRole("region", { name: "과거 기항 기록" });
  await expect(panel).toContainText("NEWCASTLE");
  await page.locator('.vessel-watchlist').getByRole('button').filter({ hasText: "GFW SHIP 1" }).click();
  await expect(panel).not.toContainText("NEWCASTLE");
  await expect(panel).toContainText("응답을 확인");
});

test("map drawing orb waits for all map sources rather than only dots", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  let finish: () => void = () => {};
  await page.route('**/test-delayed-map-land.json', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: mapStyleFixture.sources.land.data });
  });
  await page.goto('/?source=synthetic');
  await captureOnlineMap(page);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.locator('.vessel-map-online')).toHaveAttribute('data-map-ready', 'true');
  const orb = page.locator('.vessel-map-drawing');
  await expect(orb).toHaveCount(0);
  // A real worker-backed geography update, after dots are already cached.
  await page.evaluate(() => { void (window as any).testVesselMap.getSource('land').setData('/test-delayed-map-land.json'); });
  await expect(orb).toBeVisible();
  // Finishing another source must not hide the indicator while land is pending.
  await page.evaluate(() => {
    const map = (window as any).testVesselMap;
    map.getSource('vessel-routes').setData({ type: 'FeatureCollection', features: [] });
  });
  await expect(orb).toBeVisible();
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/map-all-sources-loading.png' });
  finish();
  await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.loaded())).toBe(true);
  await expect(orb).toHaveCount(0);
});

test("map drawing orb follows loading, completion and fallback without blocking controls", async ({ page }) => {
  let finish: (fail?: boolean) => void = () => {};
  await page.route("https://tiles.openfreemap.org/styles/*", async route => {
    const failed = await new Promise<boolean>(resolve => { finish = (fail = false) => resolve(fail); });
    if (failed) await route.abort();
    else await route.fulfill({ json: mapStyleFixture });
  });
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  const orb = page.locator('.vessel-map-drawing');
  await expect(orb).toContainText('지도 그리는 중');
  await expect(orb.locator('canvas')).toHaveCount(1);
  await expect(orb).toHaveCSS('pointer-events', 'none');
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/map-drawing-orb-light.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await orb.boundingBox();
  const frame = await page.locator('.vessel-map-canvas').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(frame!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/map-drawing-orb-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  finish();
  await expect(page.locator('.vessel-map-online')).toHaveAttribute('data-map-ready', 'true');
  await expect(orb).toHaveCount(0);
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.loaded())).toBe(true);
  await expect(orb).toHaveCount(0);
  await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
  await expect(orb).toBeVisible();
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/map-drawing-orb-dark.png' });
  finish(true);
  await expect(orb).toHaveCount(0);
  await expect(page.locator('.vessel-map-status')).toContainText('테마');
  // A fresh map failing during its first load must also remove the animation.
  await page.reload();
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(orb).toBeVisible();
  finish(true);
  await expect(page.locator('.vessel-map-svg')).toBeVisible();
  await expect(orb).toHaveCount(0);
});

for (const online of [false, true]) test(`actual vessel remains attached to route guide and collected track at high zoom (${online ? "online" : "offline"})`, async ({ page }) => {
  const at = new Date(Date.now() - 60000).toISOString();
  const ship = { id: "ais-440123456", name: "ALIGNMENT TEST", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: "DANGJIN", position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 90 } } };
  await page.addInitScript(v => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [v], voyages: [], watchlist: [v.id] })), ship);
  if (online) await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: route.request().url().includes("/aisstream/") ? {
    pointCount: 2, truncated: false, segments: [[{ longitude: 124.999, latitude: 35, observedAt: new Date(Date.parse(at) - 60000).toISOString() },
      { longitude: 125, latitude: 35, observedAt: at }]],
  } : { vessels: [ship] } }));
  await page.route("**/api/vessels/catalog*", route => route.fulfill({ json: { provider: "aisstream", status: "receiving", coverage: "테스트 수신", capacity: 2000, vessels: [ship], fetchedAt: ship.ais.position.observedAt } }));
  let routeRequests = 0;
  await page.route("**/api/vessels/route?*", route => { routeRequests++; return route.fulfill({ json: { kind: "estimated", provider: "searoute", destinationId: "dangjin", origin: [125, 35],
    coordinates: [[125.57373, 34.152727], [126, 36]], distanceNm: 100, startOffsetNm: 58.24, endOffsetNm: 11 } }); });
  await page.goto("/?source=synthetic");
  if (online) await captureOnlineMap(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  if (online) await expect(page.locator('.vessel-map-online')).toHaveAttribute('data-map-ready', 'true');
  await page.getByLabel('예상 항로 목적항').selectOption('dangjin');
  await expect(page.locator('.vessel-route-summary')).toContainText('100 nm');
  await expect(page.locator('.vessel-map-legend')).toContainText('위치 연결선 · 항로 아님');
  ship.ais.position.longitude = 125.002;
  ship.ais.position.observedAt = new Date(Date.parse(at) + 30000).toISOString();
  await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await expect(page.locator('.vessel-eta-detail')).toContainText('125.00200');
  expect(routeRequests).toBe(1);
  if (online) {
    const source = () => page.evaluate(async () => (await (window as any).testVesselMap.getSource('vessel-routes').getData()).features);
    await expect.poll(async () => (await source()).find((f: any) => f.properties.kind === 'connector').geometry.coordinates[0]).toEqual([125.002, 35]);
    expect((await source()).find((f: any) => f.properties.kind === 'observed').geometry.coordinates.at(-1)).toEqual([125.002, 35]);
    for (const view of ['지구본 보기', '평면 보기']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      for (const zoom of [3, 12, 18]) {
        await page.evaluate(zoom => (window as any).testVesselMap.jumpTo({ center: [125.002, 35], zoom }), zoom);
        await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.loaded())).toBe(true);
        const hits = await page.evaluate(() => {
          const map = (window as any).testVesselMap;
          const marker = document.querySelector('[data-vessel-id="ais-440123456"]')!.getBoundingClientRect();
          const frame = map.getContainer().getBoundingClientRect();
          const x = marker.x + marker.width / 2 - frame.x, y = marker.y + marker.height / 2 - frame.y;
          return map.queryRenderedFeatures([[x-2,y-2],[x+2,y+2]], { layers: ['vessel-route-connections','vessel-routes'] }).map((f: any) => f.properties.kind);
        });
        expect(hits, `${view} zoom ${zoom}`).toContain('connector');
        // The 0.003-degree collected segment is subpixel and tile-simplified at overview zoom.
        if (zoom >= 12) expect(hits, `${view} zoom ${zoom}`).toContain('observed');
      }
    }
    await page.evaluate(() => (window as any).testVesselMap.jumpTo({ center: [125.25, 34.65], zoom: 7 }));
    await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/vessel-route-aligned.png' });
  } else {
    const guide = page.locator('[data-route-kind="connector"]');
    await expect(guide).toHaveAttribute('stroke-dasharray', '1 4');
    await expect(page.locator('[data-route-kind="observed"]')).toHaveCount(1);
    const selected = page.locator('.vessel-map-marker[aria-pressed="true"]');
    for (let i=0;i<4;i++) {
      await page.getByRole('button',{name:'지도 확대',exact:true}).click();
      const delta = await guide.evaluate((el) => {
        const path = el as SVGPathElement, start = path.getPointAtLength(0), matrix = path.getScreenCTM()!;
        const point = new DOMPoint(start.x,start.y).matrixTransform(matrix);
        const marker = document.querySelector('.vessel-map-marker[aria-pressed="true"] .vessel-glyph') as SVGGraphicsElement;
        const origin = new DOMPoint(0,0).matrixTransform(marker.getScreenCTM()!);
        return Math.hypot(point.x-origin.x,point.y-origin.y);
      });
      expect(delta).toBeLessThan(1);
      await expect(selected).toHaveAttribute('aria-label', /ALIGNMENT TEST/);
    }
  }
});

for (const online of [false, true]) test(`directional vessel symbols keep labels level and unknown motion neutral (${online ? "online" : "offline"})`, async ({ page }) => {
  const at = new Date().toISOString();
  const ship = (id: number, name: string, cogDeg: number | null, sogKn: number) => ({ id: `ais-44012345${id}`, name, mmsi: `44012345${id}`, imo: "", source: "aisstream",
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: "", position: { latitude: 30, longitude: 125 + id * 3, observedAt: at, sogKn, cogDeg } } });
  const fleet = [ship(1, "DIRECTION TEST", 90, 12), ship(2, "UNKNOWN COURSE", null, 12), ship(3, "STOPPED TEST", 180, 0)];
  await page.addInitScript(vessels => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels, voyages: [], watchlist: vessels.map(v => v.id) })), fleet);
  if (online) await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  await page.goto("/?source=synthetic");
  if (online) await captureOnlineMap(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  if (online) await expect(page.locator(".vessel-map-online")).toHaveAttribute("data-map-ready", "true");
  const selected = page.locator('.vessel-map-marker[aria-pressed="true"]');
  await expect(selected).toHaveAttribute("aria-label", /90.0° · COG/);
  await expect(selected.locator('.vessel-glyph')).toHaveAttribute("data-direction", "known");
  await expect(page.locator('.vessel-glyph[data-direction="unknown"]')).toHaveCount(2);
  const label = selected.locator(online ? '.vessel-online-label' : '.vessel-map-marker-label');
  await expect(label).toHaveCSS("transform", "none");
  const screenAngle = async () => Number(await selected.locator('.vessel-glyph').getAttribute('data-screen-angle'));
  if (online) {
    const initial = await screenAngle();
    await page.evaluate(() => (window as any).testVesselMap.jumpTo({ center: [70, 15], zoom: 2 }));
    await expect.poll(async () => Math.abs(await screenAngle() - initial)).toBeGreaterThan(1);
    await page.getByRole('button', { name: '평면 보기', exact: true }).click();
    await page.evaluate(() => (window as any).testVesselMap.jumpTo({ center: [132, 30], zoom: 4 }));
    await expect.poll(async () => Math.abs(await screenAngle() - 90)).toBeLessThan(.1);
    expect(await selected.locator('svg').evaluate(el => el.getBoundingClientRect().width)).toBe(36);
  } else {
    const scale = () => selected.locator('.vessel-glyph').evaluate(el => { const t = (el as SVGGraphicsElement).getScreenCTM()!; return Math.hypot(t.a, t.b); });
    const before = await scale();
    await page.getByRole('button', { name: '지도 확대', exact: true }).click();
    await expect.poll(async () => Math.abs(await scale() - before)).toBeLessThan(.01);
  }
  await page.locator('.vessel-map').screenshot({ path: `.tooling-tmp/vessel-symbol-${online ? 'online' : 'offline'}-light.png` });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await expect(selected.locator('.vessel-glyph')).toHaveAttribute('data-direction', 'known');
  await page.locator('.vessel-map').screenshot({ path: `.tooling-tmp/vessel-symbol-${online ? 'online' : 'offline'}-dark.png` });
  await page.locator('.vessel-map-marker').filter({ has: page.locator('.vessel-glyph[data-direction="unknown"]') }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.shipment-card[aria-pressed="true"]')).toContainText('UNKNOWN COURSE');
});

test("real vessel maps confirmed estimated routes and collected gaps without inventing a voyage", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = { id: "ais-440123456", name: "ROUTE TEST BULK", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: "DANGJIN", position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 0 } } };
  await page.addInitScript(value => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] })), ship);
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: route.request().url().includes("/aisstream/") ? {
    pointCount: 4, truncated: false, segments: [
      [{ longitude: 124, latitude: 33, observedAt: at }, { longitude: 124.1, latitude: 33.1, observedAt: at }],
      [{ longitude: 124.9, latitude: 34.9, observedAt: at }, { longitude: 125, latitude: 35, observedAt: at }],
    ],
  } : { vessels: [ship] } }));
  let fail = false;
  let requests = 0;
  await page.route("**/api/vessels/route?*", route => {
    requests++;
    const destinationId = new URL(route.request().url()).searchParams.get("destination");
    return route.fulfill(fail ? { status: 503 } : { json: { kind: "estimated", provider: "searoute", destinationId,
      origin: [125, 35], coordinates: [[125, 35], [125.5, 36], [126.4, 36.9]], distanceNm: 135, startOffsetNm: 0, endOffsetNm: 3 } });
  });
  await openEta(page);
  await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveAttribute("aria-label", /ROUTE TEST BULK/);
  const observed = page.locator('[data-route-kind="observed"]');
  const estimate = page.locator('[data-route-kind="estimated"]');
  await expect(observed).toHaveCount(2);
  await expect(estimate).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByLabel("예상 항로 목적항").selectOption("dangjin");
  await expect(estimate).toHaveCount(1);
  await expect(estimate).toHaveAttribute("stroke-dasharray", "5 5");
  await expect(page.locator(".vessel-route-summary")).toContainText("135 nm");
  const expectedEta = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(at) + 135 / 12 * 3600000));
  await expect(page.locator(".vessel-eta-primary")).toHaveText(expectedEta);
  await expect(page.locator('.shipment-card')).toContainText(expectedEta);
  await expect(page.locator('.vessel-eta-reason')).toContainText('기상 미반영');
  const criteria = page.locator('.vessel-route-explanation');
  await expect(criteria).not.toHaveAttribute('open', '');
  await criteria.locator('summary').click();
  await expect(criteria).toHaveAttribute('open', '');
  await expect(criteria.getByText(/6시간 이상 관측 공백/)).toBeVisible();
  await criteria.locator('summary').click();
  const observations = page.locator('.vessel-observation-details');
  await observations.locator('summary').click();
  await expect(observations.getByText('35.00000, 125.00000', { exact: true })).toBeVisible();
  await observations.locator('summary').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("genforecast.vessel-workspace.v1")!).voyages)).toEqual([]);
  await page.locator(".vessel-route-controls").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".tooling-tmp/real-routes-light.png" });
  fail = true;
  await page.getByRole("button", { name: "항로·항적 갱신" }).click();
  await expect(page.locator(".vessel-route-controls")).toContainText("갱신하지 못했습니다");
  await expect(estimate).toHaveCount(1);
  await expect(page.locator(".vessel-eta-primary")).toHaveText(expectedEta);
  await page.getByLabel("예상 항로 목적항").selectOption("hadong");
  await expect(estimate).toHaveCount(0);
  await expect(page.locator(".vessel-eta-primary")).not.toHaveText(expectedEta);
  fail = false;
  await page.getByRole("button", { name: "항로·항적 갱신" }).click();
  await expect(estimate).toHaveCount(1);
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.locator(".vessel-route-controls").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".tooling-tmp/real-routes-dark.png" });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.locator(".vessel-route-controls").scrollIntoViewIfNeeded();
  expect(await page.locator(".vessel-route-controls").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: ".tooling-tmp/real-routes-mobile.png" });
});

test("automatic ETA follows AIS and cached route progress, and holds stopped or stale fixes", async ({ page }) => {
  const at = Date.now();
  await page.clock.install({ time: at });
  const ship = { id: 'ais-440123456', name: 'ETA TEST BULK', mmsi: '440123456', imo: '', source: 'aisstream',
    ais: { updatedAt: new Date(at).toISOString(), shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 35, longitude: 125, observedAt: new Date(at).toISOString(), sogKn: 12, cogDeg: 90 } } };
  await page.addInitScript(value => localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] })), ship);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: route.request().url().includes('/aisstream/') ? { pointCount: 0, segments: [], truncated: false } : { vessels: [ship] } }));
  let requests = 0;
  await page.route('**/api/vessels/route?*', route => {
    requests++;
    return route.fulfill({ json: { kind: 'estimated', provider: 'searoute', destinationId: 'dangjin', origin: [125, 35], coordinates: [[125, 35], [126, 35]], distanceNm: 60, startOffsetNm: 0, endOffsetNm: 1 } });
  });
  const formatEta = (timestamp: number) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
  await openEta(page);
  const primary = page.locator('.vessel-eta-primary');
  const reason = page.locator('.vessel-eta-reason');
  await expect(primary).toHaveText('ETA 계산 전');
  await page.getByLabel('예상 항로 목적항').selectOption('dangjin');
  await expect(primary).toHaveText(formatEta(at + 5 * 3600000));
  await page.clock.fastForward(5 * 60000);
  await expect(primary).toHaveText(formatEta(at + 5 * 3600000));
  ship.ais.position.observedAt = new Date(at + 10 * 60000).toISOString();
  ship.ais.updatedAt = ship.ais.position.observedAt;
  ship.ais.position.longitude = 125.05;
  ship.ais.position.sogKn = 6;
  await page.clock.fastForward(5 * 60000 + 1000);
  await expect(reason).toContainText('57.0 nm ÷ SOG 6.0 kn');
  await expect(primary).toHaveText(formatEta(at + 10 * 60000 + 57 / 6 * 3600000));
  expect(requests).toBe(1);
  ship.ais.navStatus = 1;
  ship.ais.updatedAt = new Date(at + 10 * 60000 + 10000).toISOString();
  await page.clock.runFor(10100);
  await expect(primary).toHaveText('ETA 계산 보류');
  await expect(reason).toContainText('정박·묘박');
  ship.ais.navStatus = 0;
  ship.ais.updatedAt = new Date(at + 10 * 60000 + 20000).toISOString();
  await page.clock.runFor(10100);
  await expect(primary).not.toHaveText('ETA 계산 보류');
  await page.clock.fastForward(61 * 60000);
  await expect(primary).toHaveText('ETA 계산 보류');
  await expect(reason).toContainText('1시간보다 오래');
  await page.getByLabel('예상 항로 목적항').selectOption('');
  await expect(primary).toHaveText('ETA 계산 전');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('genforecast.vessel-workspace.v1')!).voyages)).toEqual([]);
});

test("online real routes retain dash styling and camera across refresh and theme", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = { id: "ais-440123456", name: "ONLINE ROUTE BULK", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: "DANGJIN", position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 0 } } };
  await page.addInitScript(value => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] })), ship);
  await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: route.request().url().includes("/aisstream/") ? { pointCount: 2, truncated: false,
    segments: [[{ longitude: 124, latitude: 34, observedAt: at }, { longitude: 125, latitude: 35, observedAt: at }]] } : { vessels: [ship] } }));
  await page.route("**/api/vessels/route?*", route => route.fulfill({ json: { kind: "estimated", provider: "searoute", destinationId: "dangjin", origin: [125, 35], coordinates: [[125, 35], [125.5, 36], [126.4, 36.9]], distanceNm: 135, startOffsetNm: 0, endOffsetNm: 3 } }));
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  await expect(page.locator(".vessel-map-online")).toHaveAttribute("data-map-ready", "true");
  await page.getByLabel("예상 항로 목적항").selectOption("dangjin");
  await expect(page.locator(".vessel-route-summary")).toContainText("135 nm");
  await page.evaluate(() => (window as any).testVesselMap.jumpTo({ center: [125, 35], zoom: 5.5 }));
  const camera = () => page.evaluate(() => { const map = (window as any).testVesselMap; return [map.getCenter().lng, map.getCenter().lat, map.getZoom()]; });
  const before = await camera();
  const kinds = () => page.evaluate(async () => (await (window as any).testVesselMap.getSource("vessel-routes").getData()).features.map((f: any) => f.properties.kind).sort());
  await expect.poll(kinds).toEqual(["estimated", "observed"]);
  await page.getByRole("button", { name: "항로·항적 갱신" }).click();
  await expect.poll(kinds).toEqual(["estimated", "observed"]);
  expect(await camera()).toEqual(before);
  await page.locator(".vessel-map-online").screenshot({ path: ".tooling-tmp/real-routes-online-light.png" });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect.poll(kinds).toEqual(["estimated", "observed"]);
  await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.loaded())).toBe(true);
  expect(await camera()).toEqual(before);
  expect(await page.evaluate(() => (window as any).testVesselMap.getPaintProperty("vessel-estimated-routes", "line-dasharray"))).toEqual([3, 3]);
  await page.locator(".vessel-map-online").screenshot({ path: ".tooling-tmp/real-routes-online-dark.png" });
});

test("new polled AIS stays fresh after the page mount time", async ({ page }) => {
  const at = Date.now();
  await page.clock.install({ time: at });
  const ship = { id: "ais-440123456", name: "FRESH TEST BULK", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: new Date(at).toISOString(), shipType: 70, navStatus: 0, destination: "", position: { latitude: 35, longitude: 125, observedAt: new Date(at).toISOString(), sogKn: 12, cogDeg: 0 } } };
  await page.addInitScript(value => localStorage.setItem("genforecast.vessel-workspace.v1", JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] })), ship);
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json: route.request().url().includes("/aisstream/") ? { pointCount: 0, segments: [], truncated: false } : { vessels: [ship] } }));
  await openEta(page);
  await expect(page.locator(".shipment-card")).toContainText("LIVE");
  const lights = page.locator('.vessel-live-light');
  await expect(lights).toHaveCount(2);
  await expect(lights.first()).toHaveCSS('animation-name', 'vessel-live-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(lights.first()).toHaveCSS('animation-name', 'none');
  await page.locator('.vessel-selection-header').screenshot({ path: '.tooling-tmp/vessel-live-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await page.locator('.vessel-selection-header').screenshot({ path: '.tooling-tmp/vessel-live-dark.png' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(lights.first()).toHaveCSS('animation-name', 'vessel-live-pulse');
  ship.ais.position.observedAt = new Date(at + 10000).toISOString();
  ship.ais.position.longitude = 125.001;
  await page.clock.runFor(10100);
  await expect(page.locator(".vessel-eta-detail")).toContainText("125.00100");
  await expect(page.locator(".shipment-card")).toContainText("LIVE");
  await page.clock.fastForward(11 * 60000);
  await expect(page.locator('.shipment-card .tower-tag')).toHaveText('RECENT');
  await expect(lights).toHaveCount(0);
});

test("vessel controls match the scope selector and horizon button sizes", async ({ page }) => {
  await page.route("**/api/vessels/catalog*", route => route.fulfill({ json: {
    provider: "aisstream", status: "not_configured", capacity: 20000, vessels: [],
  } }));
  await openEta(page);
  const measure = (locator: import('@playwright/test').Locator) => locator.evaluate(el => {
    const css = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, radius: css.borderRadius, font: css.fontSize };
  });
  const regular = await measure(page.getByRole('combobox', { name: '발전본부 선택' }));
  const segmented = await measure(page.getByRole('button', { name: '30일', exact: true }));
  for (const name of ['업데이트 확인', '관심 선박 구성', '관심 목록 더보기', '항차 수정']) {
    expect(await measure(page.getByRole('button', { name, exact: true })), name).toEqual(regular);
  }
  for (const button of await page.locator('.vessel-workflow-filters button').all()) {
    expect(await measure(button)).toEqual(segmented);
  }
  await page.screenshot({ path: '.tooling-tmp/vessel-controls-light.png' });
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const tab of await dialog.getByRole('tab').all()) expect(await measure(tab)).toEqual(segmented);
  expect(await measure(dialog.getByRole('button', { name: '완료', exact: true }))).toEqual(regular);
  await dialog.getByRole('tab', { name: '실제 AIS 검색' }).click();
  expect(await measure(dialog.getByRole('button', { name: '목록 새로고침' }))).toEqual(regular);
  expect(await measure(dialog.getByRole('combobox', { name: 'AIS 데이터 제공처' }))).toEqual(regular);
  await dialog.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await page.screenshot({ path: '.tooling-tmp/vessel-controls-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tooling-tmp/vessel-controls-mobile.png' });
});

test("vessel manager keeps a fixed frame and one scroll area across every tab", async ({ page }) => {
  const at = new Date().toISOString();
  await page.route("**/api/vessels/catalog*", route => route.fulfill({ json: {
    provider: "aisstream", status: "receiving", coverage: "전 세계 수신 범위 · 테스트 응답", capacity: 2000, fetchedAt: at, lastReceivedAt: at,
    vessels: Array.from({ length: 20 }, (_, index) => ({ id: `ais-${index}`, name: `TEST VESSEL ${index}`, imo: "", mmsi: String(440123450 + index), source: "aisstream", ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: "DANGJIN", position: null } })),
  } }));
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (const [width, height] of [[1440, 1200], [1440, 900], [320, 844]]) {
    await page.setViewportSize({ width, height });
    const frame = await dialog.boundingBox();
    const tabs = await dialog.getByRole("tablist").boundingBox();
    const done = dialog.getByRole("button", { name: "완료", exact: true });
    const footer = await done.boundingBox();
    for (const name of ["직접 등록", "실제 AIS 검색", "목록에서 찾기", "관심 선박 4"]) {
      await dialog.getByRole("tab", { name, exact: true }).click();
      await expect(dialog.getByRole("tabpanel")).toBeVisible();
      const next = await dialog.boundingBox();
      expect(Math.abs(next!.height - frame!.height)).toBeLessThan(1);
      expect(Math.abs(next!.width - frame!.width)).toBeLessThan(1);
      expect(Math.abs(next!.y - frame!.y)).toBeLessThan(1);
      expect(Math.abs((await dialog.getByRole("tablist").boundingBox())!.y - tabs!.y)).toBeLessThan(1);
      const panel = dialog.getByRole("tabpanel");
      if (name === "실제 AIS 검색") {
        await expect(dialog.locator(".vessel-discovery-table tbody tr")).toHaveCount(20);
      }
      // The tab panel owns scrolling; nested results must never add a second scrollbar.
      const scrollAreas = await panel.evaluate(el => [el, ...el.querySelectorAll('*')]
        .filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1)
        .map(node => node === el ? 'panel' : node.className));
      expect(scrollAreas.every(area => area === 'panel'), JSON.stringify(scrollAreas)).toBe(true);
      if (name === "실제 AIS 검색") expect(scrollAreas).toEqual(['panel']);
      await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
      if (name === "실제 AIS 검색") {
        await expect(dialog.locator('.vessel-discovery-table tbody tr').last()).toBeInViewport();
        await page.screenshot({ path: `.tooling-tmp/vessel-single-scroll-${width}-${height}.png` });
      }
      expect(Math.abs((await done.boundingBox())!.y - footer!.y)).toBeLessThan(1);
      const dimensions = await dialog.evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, width: el.clientWidth, scrollWidth: el.scrollWidth }));
      expect(dimensions.scrollHeight, `${width}px ${name}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.height);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    }
    await page.screenshot({ path: `.tooling-tmp/vessel-manager-fixed-${width}.png` });
  }
});

test("AIS activity aligns with tabs after loading and stops when reception is stale or fails", async ({ page }) => {
  const at = new Date().toISOString();
  let status = "receiving";
  let fail = false;
  await page.clock.install({ time: new Date(at) });
  await page.route("**/api/vessels/catalog*", route => fail
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.fulfill({ json: { provider: "aisstream", status, coverage: "전 세계 수신 범위", capacity: 20000, fetchedAt: at, lastReceivedAt: at, vessels: [] } }));
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "실제 AIS 검색" }).click();
  const activity = dialog.locator(".vessel-connection-status");
  await expect(activity).toContainText("AIS 메시지 수신 중");
  await expect(dialog.getByRole("button", { name: "목록 새로고침" })).toBeEnabled();
  await expect(activity.locator("canvas")).toHaveCount(1);
  const box = await activity.boundingBox();
  const close = await dialog.locator('[data-slot="dialog-close"]').boundingBox();
  const tabs = await dialog.getByRole("tablist").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(close!.y + close!.height);
  const labelBox = await activity.locator('[role="status"]').boundingBox();
  expect(Math.abs(labelBox!.y + labelBox!.height / 2 - tabs!.y - tabs!.height / 2)).toBeLessThan(1);
  expect(box!.x).toBeGreaterThan(tabs!.x + tabs!.width);
  expect(await activity.locator('[role="status"]').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(13);
  await page.screenshot({ path: ".tooling-tmp/ais-header-light.png" });
  await page.clock.fastForward(75000);
  await expect(activity).toContainText("AIS 메시지 수신 지연");
  await expect(activity.locator("canvas")).toHaveCount(0);
  status = "reconnecting";
  await dialog.getByRole("button", { name: "목록 새로고침" }).click();
  await expect(activity).toContainText("재연결 대기");
  await expect(activity.locator("canvas")).toHaveCount(1);
  fail = true;
  await dialog.getByRole("button", { name: "목록 새로고침" }).click();
  await expect(activity).toContainText("수신 상태 확인 실패");
  await expect(activity.locator("canvas")).toHaveCount(0);
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  fail = false;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await dialog.getByRole("tab", { name: "실제 AIS 검색" }).click();
  await expect(activity).toContainText("재연결 대기");
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const mobileTabs = await dialog.getByRole("tablist").boundingBox();
  expect((await activity.boundingBox())!.y).toBeGreaterThanOrEqual(mobileTabs!.y + mobileTabs!.height);
  const canvas = activity.locator("canvas");
  await expect(canvas).toHaveCount(1);
  await page.clock.runFor(100);
  const frame = await canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  await page.clock.runFor(100);
  expect(await canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())).toBe(frame);
  await page.screenshot({ path: ".tooling-tmp/ais-header-mobile-dark.png" });
});

test("watchlist manager opens first, removes reversibly and keeps additions open", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/vessels/catalog*", route => { requests++; return route.fulfill({ json: { provider: "aisstream", status: "not_configured", vessels: [], capacity: 2000 } }); });
  await openEta(page);
  await page.locator(".shipment-card").filter({ hasText: "Ocean Frontier" }).click();
  await page.getByRole("button", { name: "항차 수정", exact: true }).click();
  await page.getByLabel("출항항", { exact: true }).fill("Preserved departure port");
  await page.getByRole("button", { name: "이 브라우저에 항차 저장" }).click();
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab").first()).toHaveText("관심 선박 4");
  await expect(dialog.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  expect(requests).toBe(0);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("genforecast.vessel-workspace.v1") || "null"));
  await dialog.getByRole("option", { name: /Ocean Frontier/ }).click();
  await dialog.getByRole("button", { name: "선택한 선박 관심 해제" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("genforecast.vessel-workspace.v1")!).voyages)).toEqual(before.voyages);
  await expect(dialog).toContainText("Ocean Frontier 관심을 해제했습니다");
  await dialog.getByRole("button", { name: "되돌리기" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(4);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("genforecast.vessel-workspace.v1")!));
  expect(after.voyages).toEqual(before.voyages);
  await dialog.getByRole("button", { name: "관심 선박 추가 검색" }).click();
  await expect(dialog.getByRole("tab", { name: "실제 AIS 검색" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await dialog.getByRole("tab", { name: "목록에서 찾기" }).click();
  await dialog.getByRole("button", { name: "Aurora Bulk 관심 등록" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Aurora Bulk 관심 등록" })).toBeDisabled();
  await dialog.getByRole("tab", { name: "관심 선박 5" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(5);
  await dialog.getByRole("option").first().focus();
  await page.keyboard.press("End");
  await expect(dialog.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("option").last()).toBeFocused();
  await page.screenshot({ path: ".tooling-tmp/watchlist-manager-light.png" });
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.screenshot({ path: ".tooling-tmp/watchlist-manager-dark.png" });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(dialog.getByRole("option")).toHaveCount(5);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: ".tooling-tmp/watchlist-manager-mobile.png" });
  for (let count = 5; count > 0; count--) {
    await dialog.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "선택한 선박 관심 해제" }).click();
    await expect(dialog.getByRole("option")).toHaveCount(count - 1);
  }
  await expect(dialog.getByRole("button", { name: "선택한 선박 관심 해제" })).toBeDisabled();
  await expect(dialog).toContainText("관심 선박이 없습니다");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await expect(dialog.getByRole("tab").first()).toHaveText("관심 선박 0");
  await expect(dialog.getByRole("option")).toHaveCount(0);
});

test("Korean candidates survive outside general discovery and scope changes preserve dialog size", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = (mmsi: string, name: string, destination: string) => ({ id: `ais-${mmsi}`, mmsi, name, imo: '', source: 'aisstream',
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination, position: { latitude: -33, longitude: 152, sogKn: 12, cogDeg: 90, observedAt: at } } });
  const retained = ship('440123451', 'OVERSEAS BULK', 'KR TJI');
  const shared = ship('440123452', 'BUSAN BULK', 'BUSAN');
  let updated = false;
  await page.route('**/api/vessels/catalog*', route => route.fulfill({ json: {
    provider: 'aisstream', status: 'receiving', coverage: '전 세계 수신 범위', capacity: 4000, fetchedAt: at, lastReceivedAt: at,
    vessels: [shared, ship('440123453', 'DANGJIN STAR', 'SGSIN'), ship('440123454', 'UNKNOWN BULK', '')],
    koreaCandidates: { capacity: 1000, retentionHours: 72, entries: updated ? [] : [
      { vessel: retained, portCode: 'KRTJI', portName: '당진', matchedBy: 'code', destinationObservedAt: at },
      { vessel: shared, portCode: 'KRPUS', portName: '부산', matchedBy: 'name', destinationObservedAt: at },
    ] },
  } }));
  await openEta(page);
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '실제 AIS 검색', exact: true }).click();
  const scope = dialog.getByRole('group', { name: 'AIS 검색 범위' });
  const rows = dialog.locator('.vessel-discovery-table tbody tr');
  await expect(scope.getByRole('button', { name: /한국행 후보/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(/한국행 후보/);
  await page.setViewportSize({ width: 1440, height: 1200 });
  const content = await dialog.getByRole('tabpanel').evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight }));
  expect(content.scrollHeight, `Candidate content: ${JSON.stringify(content)}`).toBeLessThanOrEqual(content.height);
  const initial = await dialog.boundingBox();
  await scope.getByRole('button', { name: '전체', exact: true }).click();
  await expect(rows).toHaveCount(4); // Deduplicate shared MMSI; retain overseas candidate.
  await scope.getByRole('button', { name: '목적지 미확인', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('UNKNOWN BULK');
  expect((await dialog.boundingBox())!.height).toBeCloseTo(initial!.height, 0);
  await scope.getByRole('button', { name: /한국행 후보/ }).click();
  await dialog.getByRole('button', { name: 'OVERSEAS BULK 관심 등록' }).click();
  await expect(dialog.getByRole('button', { name: 'OVERSEAS BULK 관심 등록' })).toBeDisabled();
  await dialog.getByRole('tabpanel').evaluate(el => { el.scrollTop = 0; });
  await dialog.screenshot({ path: '.tooling-tmp/korea-candidates-light.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.vessel-eta-primary')).toHaveText('ETA 계산 전');
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  await dialog.getByRole('tab', { name: '실제 AIS 검색', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await dialog.screenshot({ path: '.tooling-tmp/korea-candidates-dark.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.screenshot({ path: '.tooling-tmp/korea-candidates-mobile.png' });
  const mobileAdd = dialog.getByRole('button', { name: 'BUSAN BULK 관심 등록' });
  await mobileAdd.scrollIntoViewIfNeeded();
  const mobileBox = await mobileAdd.boundingBox();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(320);
  updated = true;
  await dialog.getByRole('button', { name: '목록 새로고침' }).click();
  await expect(rows).toHaveCount(0);
  await expect(dialog).toContainText('한국행 후보가 아직 없습니다');
});

test("AIS destinations find overseas arrivals without confusing Korean location or vessel names", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = (id: string, name: string, destination: string, latitude: number, longitude: number) => ({
    id, name, imo: "", mmsi: `44012345${id}`, source: "aisstream",
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination,
      position: { latitude, longitude, observedAt: at, sogKn: 12, cogDeg: 0 } },
  });
  await page.route("**/api/vessels/catalog*", route => route.fulfill({ json: {
    provider: "aisstream", status: "receiving", coverage: "전 세계 수신 범위 · AIS 수신 공백 있음",
    fetchedAt: at, lastReceivedAt: at, capacity: 2000,
    vessels: [ship("1", "AUSTRALIA BULK", "DANGJIN", -33, 152), ship("2", "DANGJIN STAR", "SINGAPORE", 35, 126), ship("3", "UNKNOWN DESTINATION", "", -1, 117)],
  } }));
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("전 세계 수신 범위");
  await page.getByLabel("AIS 목적지 필터", { exact: true }).fill("dangjin");
  const rows = page.locator(".vessel-discovery-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("AUSTRALIA BULK");
  await page.screenshot({ path: ".tooling-tmp/ais-destination-light.png" });
  await page.getByLabel("목적지 수신 상태").selectOption("missing");
  await expect(page.getByLabel("AIS 목적지 필터", { exact: true })).toBeDisabled();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("UNKNOWN DESTINATION");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  await page.getByLabel("AIS 목적지 필터", { exact: true }).fill("DANGJIN");
  await expect(rows).toHaveCount(1);
  await page.screenshot({ path: ".tooling-tmp/ais-destination-dark.png" });
  await page.setViewportSize({ width: 320, height: 844 });
  const box = await page.getByLabel("AIS 목적지 필터", { exact: true }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.getByLabel("AIS 목적지 필터", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".tooling-tmp/ais-destination-mobile.png" });
});

test("AIS discovery filters, sorts, survives errors, and persists provenance without a fake voyage", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = (name: string, mmsi: string, type: number, speed: number, nav = 0) => ({
    id: `ais-${mmsi}`, name, imo: "", mmsi, source: "aisstream",
    ais: { updatedAt: at, shipType: type, navStatus: nav, destination: "TEST PORT",
      position: { latitude: 35, longitude: 125, observedAt: at, sogKn: speed, cogDeg: 90 } },
  });
  let fail = false;
  await page.route("**/api/vessels/catalog*", route => fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: {
    provider: "aisstream", status: "receiving", coverage: "한국 주변 · 테스트 응답", fetchedAt: at, lastReceivedAt: at, capacity: 2000,
    vessels: [ship("ALPHA CARGO", "440123451", 70, 9), ship("BETA TANKER", "440123452", 80, 15), ship("ZETA CARGO", "440123453", 71, 0, 5)],
  } }));
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  const rows = page.locator(".vessel-discovery-table tbody tr");
  await expect(rows).toHaveCount(3);
  await page.getByLabel("선박 정렬", { exact: true }).selectOption("speed");
  await expect(rows.first()).toContainText("BETA TANKER");
  await page.getByLabel("선종 필터").selectOption("7");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("AIS 운항 상태").selectOption("underway");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("위치 관측 필터").selectOption("10");
  await page.getByLabel("실제 선박 검색", { exact: true }).fill("440123451");
  await expect(rows.first()).toContainText("ALPHA CARGO");
  fail = true;
  await page.getByRole("button", { name: "목록 새로고침" }).click();
  await expect(page.getByRole("alert")).toContainText("기존 결과는 유지");
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "ALPHA CARGO 관심 등록" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("AISstream");
  await expect(page.locator(".vessel-eta-detail")).toContainText("35.00000, 125.00000");
  await expect(page.locator(".vessel-eta-primary")).toHaveText("ETA 계산 전");
  await page.reload();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  await page.locator(".shipment-card").filter({ hasText: "ALPHA CARGO" }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("9.0 kn");
  fail = false;
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  await expect(page.getByRole("button", { name: "ALPHA CARGO 관심 등록" })).toBeDisabled();
  await page.screenshot({ path: ".tooling-tmp/ais-search-light.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.screenshot({ path: ".tooling-tmp/ais-search-dark.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByLabel("실제 선박 검색", { exact: true })).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const mobileAdd = await page.getByRole("button", { name: "BETA TANKER 관심 등록" }).boundingBox();
  expect(mobileAdd!.x).toBeGreaterThanOrEqual(0);
  expect(mobileAdd!.x + mobileAdd!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: ".tooling-tmp/ais-search-mobile.png", fullPage: true });
});

test("AIS discovery searches all 20000 cached vessels while rendering one page", async ({ page }) => {
  const at = new Date().toISOString();
  await page.route('**/api/vessels/catalog*', route => route.fulfill({ json: {
    provider: 'aisstream', status: 'receiving', coverage: '전 세계 · 테스트 응답', capacity: 20000, fetchedAt: at, lastReceivedAt: at,
    vessels: Array.from({ length: 20000 }, (_, index) => ({ id: `ais-${440000000 + index}`, name: `CACHE VESSEL ${index}`, mmsi: String(440000000 + index), imo: '', source: 'aisstream',
      ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 90 } } })),
  } }));
  await openEta(page);
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  await page.getByRole('tab', { name: '실제 AIS 검색', exact: true }).click();
  await expect(page.locator('.vessel-discovery-table tbody tr')).toHaveCount(20);
  await expect(page.locator('.vessel-discovery-pagination')).toContainText('1 / 1000');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('.vessel-discovery-pagination')).toContainText('2 / 1000');
  await expect(page.locator('.vessel-discovery-table tbody tr')).toHaveCount(20);
  await page.getByLabel('실제 선박 검색', { exact: true }).fill('440019999');
  await expect(page.locator('.vessel-discovery-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'CACHE VESSEL 19999 관심 등록' })).toBeVisible();
  await expect(page.locator('.vessel-discovery .tower-footnote').last()).toContainText('20,000척');
  await page.getByRole('dialog').screenshot({ path: '.tooling-tmp/ais-search-20000.png' });
});

test("watchlist shows observed speed including zero and missing values within a distinct surface", async ({ page }) => {
  const at = new Date().toISOString();
  const ships = [12.4, 0, null].map((sogKn, i) => ({ id: `speed-${i}`, name: `SPEED BULK ${i}`, source: 'aisstream', mmsi: String(440201100 + i), imo: '',
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: '', position: { latitude: 35, longitude: 125, observedAt: at, sogKn, cogDeg: 90 } } }));
  await page.addInitScript(values => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: values, voyages: [], watchlist: values.map(v => v.id) }));
  }, ships);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: /\/(aisstream|digitraffic)\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: ships } }));
  await openEta(page);
  const cards = page.locator('.vessel-watchlist .shipment-card');
  await expect(cards.nth(0).getByText('관측 속도 12.4 kn', { exact: true })).toBeVisible();
  await expect(cards.nth(1).getByText('관측 속도 0.0 kn', { exact: true })).toBeVisible();
  await expect(cards.nth(2).getByText('속도 미수신', { exact: true })).toBeVisible();
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', { name: '다크 모드로 전환' }).click();
    const appearance = await page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return { listBorder: style('.vessel-watchlist-panel').borderRightWidth, listBackground: style('.vessel-watchlist-panel').backgroundColor,
        pageBackground: style('.tower-page').backgroundColor, routeBorder: style('.vessel-route-overview').borderBottomWidth,
        detailBorder: style('.vessel-eta-detail .tower-section').borderTopWidth };
    });
    expect(appearance.listBorder).toBe('0px');
    expect(appearance.routeBorder).toBe('0px');
    expect(appearance.detailBorder).toBe('0px');
    expect(appearance.listBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(appearance.listBackground).not.toBe(appearance.pageBackground);
    await page.screenshot({ path: `.tooling-tmp/vessel-surfaces-${dark ? 'dark' : 'light'}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 844 });
  await expect(cards.nth(0).getByText('관측 속도 12.4 kn', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tooling-tmp/vessel-surfaces-mobile.png', fullPage: true });
});

test("weather correction compares ETA, adjusts sensitivity and removes an obsolete destination result", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = { id: 'weather-eta', name: 'WEATHER ETA BULK', source: 'aisstream', mmsi: '440200099', imo: '',
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 0, longitude: 0, observedAt: at, sogKn: 12, cogDeg: 90 } } };
  await page.addInitScript(value => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] }));
    localStorage.setItem('genforecast.vessel-route-destinations.v1', JSON.stringify({ [value.id]: 'dangjin' }));
  }, ship);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: /\/(aisstream|digitraffic)\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: [ship] } }));
  await page.route('**/api/vessels/route?*', route => route.fulfill({ json: { kind: 'estimated', provider: 'searoute', destinationId: new URL(route.request().url()).searchParams.get('destination'), origin: [0, 0], coordinates: [[0, 0], [1, 0], [2, 0]], distanceNm: 120, startOffsetNm: 0, endOffsetNm: 1 } }));
  await page.route('**/api/vessels/weather/**', route => {
    const destination = new URL(route.request().url()).searchParams.get('destination');
    if (destination !== 'dangjin') return route.fulfill({ status: 503 });
    return route.fulfill({ json: { source: 'aisstream', mmsi: ship.mmsi, destinationId: destination, status: 'ready', reason: '실제 예보 테스트 응답', observedAt: at, fetchedAt: at, horizonHours: 72, speedKn: 12,
      points: [1, 4, 4].map((waveM, i) => ({ longitude: i, latitude: 0, passageAt: new Date(Date.parse(at) + i * 5 * 3600000).toISOString(), waveM, windKn: 10, gustKn: 20, windFromDeg: 90, waveFromDeg: 90, wavePeriodS: 8,
        airStatus: 'fresh', marineStatus: 'fresh', airFetchedAt: at, marineFetchedAt: at, airForecastAt: new Date(Date.parse(at) + i * 5 * 3600000).toISOString(), marineForecastAt: new Date(Date.parse(at) + i * 5 * 3600000).toISOString(), forecastIssuedAt: null })) } });
  });
  await openEta(page);
  const panel = page.getByRole('region', { name: '기상 보정 ETA 비교' });
  await expect(panel.locator('.vessel-weather-eta-delay')).toHaveText('+0.8 h');
  const baseline = await page.locator('.vessel-eta-primary').innerText();
  await expect(panel).toContainText('시연 모델');
  await panel.getByText('보정 가정 및 구간별 영향', { exact: true }).click();
  await panel.getByLabel('기상 보정 민감도').fill('0');
  await expect(panel.locator('.vessel-weather-eta-delay')).toHaveText('+0.0 h');
  await expect(panel.locator('.vessel-weather-eta-value')).toHaveText(baseline);
  await panel.getByLabel('기상 보정 민감도').fill('1.5');
  await expect(panel.locator('.vessel-weather-eta-delay')).toHaveText('+1.3 h');
  await expect(page.locator('.vessel-eta-primary')).toHaveText(baseline);
  await panel.screenshot({ path: '.tooling-tmp/weather-eta-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await panel.screenshot({ path: '.tooling-tmp/weather-eta-dark.png' });
  await panel.getByText('보정 가정 및 구간별 영향', { exact: true }).click();
  await page.setViewportSize({ width: 375, height: 844 });
  await panel.screenshot({ path: '.tooling-tmp/weather-eta-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('예상 항로 목적항').selectOption('hadong');
  await expect(panel.locator('.vessel-weather-eta-value')).toHaveText('보정 보류');
  await expect(panel.locator('.vessel-weather-eta-delay')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('genforecast.vessel-workspace.v1')!).voyages)).toEqual([]);
});

test("route weather layers show visibility and timed cyclone radii without moving the camera", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  const at = new Date().toISOString();
  const ship = { id: 'layer-test', name: 'LAYER TEST', source: 'aisstream', mmsi: '440200123', imo: '', ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 90 } } };
  await page.addInitScript(v => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [v], voyages: [], watchlist: [v.id] }));
    localStorage.setItem('genforecast.vessel-route-destinations.v1', JSON.stringify({ [v.id]: 'dangjin' }));
  }, ship);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: /\/(aisstream|digitraffic)\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: [ship] } }));
  await page.route('**/api/vessels/route?*', route => route.fulfill({ json: { kind: 'estimated', provider: 'searoute', destinationId: 'dangjin', origin: [125, 35], coordinates: [[125, 35], [126, 35]], distanceNm: 120, startOffsetNm: 0, endOffsetNm: 1 } }));
  await page.route('**/api/vessels/weather/**', route => route.fulfill({ json: { source: 'aisstream', mmsi: ship.mmsi, destinationId: 'dangjin', status: 'partial', reason: '시정 예보 테스트', observedAt: at, fetchedAt: at, horizonHours: 72, speedKn: 12,
    points: [0, 1].map(i => ({ longitude: 125 + i, latitude: 35, passageAt: new Date(Date.parse(at) + i * 6 * 3600000).toISOString(), waveM: 2, windKn: 15, gustKn: 20, visibilityM: i ? null : 800, windFromDeg: 90, waveFromDeg: 270, wavePeriodS: 8, airStatus: 'fresh', marineStatus: 'fresh', airFetchedAt: at, marineFetchedAt: at, airForecastAt: new Date(Date.parse(at) + i * 6 * 3600000).toISOString(), marineForecastAt: new Date(Date.parse(at) + i * 6 * 3600000).toISOString(), forecastIssuedAt: null })) } }));
  await page.route('**/api/vessels/cyclones', route => route.fulfill({ json: { status: 'ready', fetchedAt: at, reason: 'GDACS 모의 응답', storms: [{ id: '1', name: 'TEST CYCLONE', source: 'TEST ONLY', advisoryAt: at, reportUrl: 'https://www.gdacs.org/report.aspx?eventid=1', points: [0, 1].map(i => ({ longitude: 126 + i, latitude: 35, at: new Date(Date.parse(at) + i * 12 * 3600000).toISOString(), forecast: !!i, radii34Nm: [90, 80, null, 60] })) }] } }));
  await page.goto('/?source=synthetic');
  await captureOnlineMap(page);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  const map = page.locator('.vessel-map-online');
  await expect(map).toHaveAttribute('data-map-ready', 'true');
  await page.evaluate(() => (window as any).testVesselMap.jumpTo({ center: [126, 35], zoom: 4 }));
  const toggle = page.getByRole('button', { name: '지도 기상 레이어', exact: true });
  await toggle.click();
  const layers = page.getByRole('region', { name: '지도 기상 레이어 설정' });
  await layers.getByRole('button', { name: '시정', exact: true }).click();
  await expect(page.locator('.vessel-weather-marker').first()).toContainText('800 m');
  await expect(page.locator('.vessel-weather-marker').last()).toContainText('자료 없음');
  await expect(page.locator('.vessel-cyclone-marker')).toHaveCount(1);
  await expect(map).toHaveAttribute('data-weather-polygons', '3');
  await page.locator('.vessel-weather-marker').last().focus();
  await page.locator('.vessel-weather-marker').last().press('Enter');
  await expect(page.locator('.vessel-weather-marker').last()).toBeFocused();
  const zoom = await map.getAttribute('data-zoom');
  await layers.getByLabel('지도 통과 시각').fill('1');
  await expect(layers).toContainText('±3시간 내 태풍 위치 예보 없음');
  await expect(page.locator('.vessel-cyclone-marker')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-weather-polygons', '0');
  await expect(map).toHaveAttribute('data-zoom', zoom!);
  expect(await page.evaluate(() => (window as any).testVesselMap.getCenter().toArray())).toEqual([126, 35]);
  await page.getByRole('button', { name: '평면 보기', exact: true }).click();
  await layers.getByLabel('지도 통과 시각').fill('0');
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/weather-layers-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await expect(page.locator('.vessel-cyclone-marker')).toHaveCount(1);
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/weather-layers-dark.png' });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/weather-layers-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await layers.getByRole('button', { name: '태풍', exact: true }).click();
  await expect(page.locator('.vessel-cyclone-marker')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('.vessel-weather-marker')).toHaveCount(0);
  // The basic SVG fallback keeps the same layer data and controls.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.abort());
  await openEta(page);
  await expect(page.locator('.vessel-map-svg')).toBeVisible();
  await page.getByRole('button', { name: '지도 기상 레이어', exact: true }).click();
  await expect(page.locator('.vessel-cyclone-marker')).toHaveCount(1);
  await expect(page.locator('.vessel-weather-marker')).toHaveCount(2);
});

test("watchlist weather loads unselected interests, maps passage forecasts and isolates destinations", async ({ page }) => {
  const at = new Date().toISOString();
  const ships = [0, 1].map(i => ({ id: `weather-${i}`, name: `WEATHER BULK ${i}`, source: 'aisstream', mmsi: String(440200000 + i), imo: '',
    ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 20 } } }));
  await page.addInitScript(values => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: values, voyages: [], watchlist: values.map(v => v.id) }));
    localStorage.setItem('genforecast.vessel-route-destinations.v1', JSON.stringify({ 'weather-0': 'dangjin', 'weather-1': 'boryeong' }));
  }, ships);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: /\/(aisstream|digitraffic)\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: ships } }));
  await page.route('**/api/vessels/route?*', route => route.fulfill({ json: { kind: 'estimated', provider: 'searoute', destinationId: new URL(route.request().url()).searchParams.get('destination'), origin: [125, 35], coordinates: [[125, 35], [126, 35]], distanceNm: 120, startOffsetNm: 0, endOffsetNm: 1 } }));
  const requests: string[] = [];
  await page.route('**/api/vessels/weather/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.searchParams.get('destination') === 'hadong') return route.fulfill({ status: 503 });
    return route.fulfill({ json: { source: 'aisstream', mmsi: url.pathname.split('/').at(-1), destinationId: url.searchParams.get('destination'), status: 'partial', reason: '일부 예보 없음 · ETA 감속 보정 미적용', observedAt: at, fetchedAt: at, horizonHours: 72,
      points: [0, 1].map(i => ({ longitude: 125 + i * .1, latitude: 35, passageAt: new Date(Date.parse(at) + i * 3600000).toISOString(),
        waveM: i ? null : 2.5, windKn: 15, gustKn: 22, windFromDeg: 90, waveFromDeg: 270, wavePeriodS: 8,
        airStatus: 'fresh', marineStatus: 'fresh', airFetchedAt: at, marineFetchedAt: at, airForecastAt: at, marineForecastAt: at, forecastIssuedAt: null })) } });
  });
  await openEta(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.some(v => v.includes('440200001'))).toBe(true);
  await expect(page.locator('.shipment-card').last()).toContainText('기상 일부 확인');
  const panel = page.locator('.vessel-forecast-panel');
  await expect(panel).toContainText('2.5');
  await expect(panel).toContainText('Open-Meteo');
  await panel.getByRole('button', { name: '항로 예보 지도 표시', exact: true }).click();
  await expect(page.locator('.vessel-weather-marker')).toHaveCount(2);
  await expect(page.locator('.vessel-weather-marker').first()).toContainText('2.5');
  await panel.getByLabel('항로 예보 지점').fill('1');
  await expect(panel.locator('.vessel-forecast-values')).toContainText('자료 없음');
  await panel.screenshot({ path: '.tooling-tmp/watchlist-weather-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await panel.screenshot({ path: '.tooling-tmp/watchlist-weather-dark.png' });
  await page.setViewportSize({ width: 375, height: 844 });
  await panel.screenshot({ path: '.tooling-tmp/watchlist-weather-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('예상 항로 목적항').selectOption('hadong');
  await expect(panel).toContainText('기상 조회 실패');
  await expect(page.locator('.vessel-weather-marker')).toHaveCount(0);
  await expect(page.locator('.vessel-eta-primary')).not.toHaveText('ETA 계산 전');
  await page.locator('.vessel-eta-detail').getByRole('button', { name: '관심 해제', exact: true }).click();
  await expect(page.locator('.shipment-card')).toHaveCount(1);
  await expect(panel).toContainText('2.5');
});

test("watchlist weather cancels obsolete destinations and stops polling after removal", async ({ page }) => {
  const at = new Date().toISOString();
  const ship = { id: 'weather-race', name: 'WEATHER RACE', mmsi: '440200010', imo: '', source: 'aisstream', ais: { updatedAt: at, shipType: 70, navStatus: 0, destination: 'DANGJIN', position: { latitude: 35, longitude: 125, observedAt: at, sogKn: 12, cogDeg: 0 } } };
  await page.addInitScript(value => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [value], voyages: [], watchlist: [value.id] }));
    localStorage.setItem('genforecast.vessel-route-destinations.v1', JSON.stringify({ [value.id]: 'dangjin' }));
  }, ship);
  await page.route('**/api/vessels/tracking/**', route => route.fulfill({ json: /\/(aisstream|digitraffic)\//.test(route.request().url()) ? { pointCount: 0, segments: [], truncated: false } : { vessels: [ship] } }));
  let finish = () => {};
  const calls: string[] = [];
  await page.route('**/api/vessels/weather/**', async route => {
    const destination = new URL(route.request().url()).searchParams.get('destination');
    calls.push(destination!);
    if (destination === 'dangjin') await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { source: 'aisstream', mmsi: ship.mmsi, destinationId: destination, fetchedAt: at, observedAt: at, horizonHours: 72, status: 'unavailable', points: [], reason: destination === 'dangjin' ? 'OLD DESTINATION' : 'NEW DESTINATION' } }).catch(() => {});
  });
  await openEta(page);
  await expect(page.locator('.vessel-forecast-panel')).toContainText('관심 선박 예보 조회 중');
  await page.getByLabel('예상 항로 목적항').selectOption('boryeong');
  await expect(page.locator('.vessel-forecast-panel')).toContainText('NEW DESTINATION');
  finish();
  await expect(page.locator('.vessel-forecast-panel')).not.toContainText('OLD DESTINATION');
  await page.locator('.vessel-eta-detail').getByRole('button', { name: '관심 해제', exact: true }).click();
  await expect(page.locator('.vessel-forecast-panel')).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(6 * 60000);
  expect(calls).toEqual(['dangjin', 'boryeong']);
});

test("AIS missing key can explicitly switch to Finnish public data", async ({ page }) => {
  const at = new Date().toISOString();
  await page.route("**/api/vessels/catalog*", route => {
    const finnish = route.request().url().includes("digitraffic");
    return route.fulfill({ json: { provider: finnish ? "digitraffic" : "aisstream",
      status: finnish ? "snapshot" : "not_configured", fetchedAt: at, lastReceivedAt: null, capacity: 2000,
      coverage: finnish ? "핀란드 해역 · 공개 AIS (한국 해역 아님)" : "한국 주변",
      vessels: finnish ? [{ id: "digitraffic-230123456", name: "FINNISH TEST", mmsi: "230123456", imo: "", source: "digitraffic",
        ais: { updatedAt: at, shipType: 70, navStatus: null, destination: "", position: null } }] : [] } });
  });
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "실제 AIS 검색", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("서버 API 키 설정 필요");
  await page.getByLabel("AIS 데이터 제공처").selectOption("digitraffic");
  await expect(page.getByRole("dialog")).toContainText("한국 해역 아님");
  await expect(page.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
  await page.getByRole("button", { name: "FINNISH TEST 관심 등록" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("Digitraffic · 핀란드");
  await expect(page.locator(".vessel-eta-detail")).toContainText("실시간 위치 미수신");
});
for (const renderer of ["offline", "online"]) {
  test(`ETA unlocated selection keeps the fleet and never selects another vessel (${renderer})`, async ({ page }) => {
    if (renderer === "online") {
      await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
    }
    await openEta(page);
    await expect(page.locator(".vessel-map-marker")).toHaveCount(4);
    const zoom = renderer === "online" ? await page.locator(".vessel-map-online").getAttribute("data-zoom") : null;
    await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
    await page.getByRole("tab", { name: "목록에서 찾기", exact: true }).click();
    await page.getByLabel("선박 검색", { exact: true }).fill("Aurora");
    await page.getByRole("button", { name: "Aurora Bulk 관심 등록", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
    await expect(page.locator(".vessel-map-marker")).toHaveCount(4);
    await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator(".vessel-map-empty")).toHaveCount(0);
    await expect(page.locator(".vessel-map-selection-note")).toContainText("Aurora Bulk · 출항 예정 · 현재 위치 미수신");
    await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Aurora Bulk · 도착 전망");
    if (zoom) await expect(page.locator(".vessel-map-online")).toHaveAttribute("data-zoom", zoom);
    await page.getByRole("button", { name: "출항 예정", exact: true }).click();
    await expect(page.locator(".vessel-map-marker")).toHaveCount(0);
    await expect(page.locator(".vessel-map-empty")).toHaveText("현재 범위에 위치가 확인된 선박이 없습니다.");
    await page.getByRole("button", { name: "전체 관심", exact: true }).click();
    await expect(page.locator(".vessel-map-marker")).toHaveCount(4);
    await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveCount(0);
    await page.locator(".shipment-card").filter({ hasText: "Ocean Frontier" }).click();
    await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveAttribute("aria-label", /Ocean Frontier/);
    await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Ocean Frontier · 도착 전망");
    await expect(page.locator(".vessel-map-selection-note")).toHaveCount(0);
    await page.locator(".shipment-card").filter({ hasText: "Aurora Bulk" }).click();
    await page.screenshot({ path: `.tooling-tmp/unlocated-${renderer}-light.png`, fullPage: true });
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".vessel-map-selection-note")).toContainText("Aurora Bulk");
    await page.screenshot({ path: `.tooling-tmp/unlocated-${renderer}-mobile.png`, fullPage: true });
  });
}

test("ETA workspace has one vessel list and synchronizes it with map and arrival analysis", async ({ page }) => {
  await openEta(page);
  await expect(page.getByLabel("지도에서 선박 선택")).toHaveCount(0);
  await expect(page.locator(".vessel-selected-glance")).toHaveCount(0);
  await expect(page.locator(".vessel-map-detail")).toHaveCount(0);
  await expect(page.locator(".vessel-map-legend")).toBeVisible();
  const ocean = page.locator(".shipment-card").filter({ hasText: "Ocean Frontier" });
  await ocean.click();
  await expect(ocean).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toContainText("Ocean Frontier");
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Ocean Frontier · 도착 전망");
  const southern = page.locator(".vessel-map-marker").filter({ hasText: "Southern Star" });
  await southern.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('.shipment-card[aria-pressed="true"]')).toContainText("Southern Star");
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Southern Star · 도착 전망");
  await page.screenshot({ path: ".tooling-tmp/vessel-single-selection-light.png", fullPage: true });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.screenshot({ path: ".tooling-tmp/vessel-single-selection-dark.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator(".vessel-map-legend")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ocean.click();
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Ocean Frontier · 도착 전망");
  await page.screenshot({ path: ".tooling-tmp/vessel-single-selection-mobile.png", fullPage: true });
});

test("ETA workspace aligns list and map, groups actions and collapses the mobile list", async ({ page }) => {
  await openEta(page);
  const add = page.getByRole("button", { name: "관심 선박 구성", exact: true });
  const context = await page.locator(".context-bar").last().boundingBox();
  const addBox = await add.boundingBox();
  expect(addBox!.y - (context!.y + context!.height)).toBeGreaterThanOrEqual(16);
  const headingBox = await page.getByRole("heading", { name: "관심 선박", exact: true }).boundingBox();
  expect(Math.abs(headingBox!.y - addBox!.y)).toBeLessThan(16);
  await expect(page.locator('.vessel-watchlist-panel').getByLabel('관심 선박 상태 필터')).toBeVisible();
  const listBox = await page.locator('.vessel-watchlist-panel').boundingBox();
  const mapColumn = await page.locator('.vessel-eta-map-column').boundingBox();
  expect(Math.abs(listBox!.y - mapColumn!.y)).toBeLessThan(2);
  await expect(page.locator('.vessel-selection-header')).toContainText('Pacific Horizon');
  await expect(page.locator('.vessel-map-header')).toHaveCount(0);
  const etaBox = await page.locator('.vessel-eta-detail').boundingBox();
  const mapBox = await page.locator('.vessel-map').boundingBox();
  expect(etaBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height);
  expect(Math.abs(etaBox!.x - mapBox!.x)).toBeLessThan(2);
  await page.getByRole('button', { name: '관심 목록 더보기' }).click();
  await expect(page.getByRole('menuitem', { name: '내보내기' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '가져오기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({ path: ".tooling-tmp/vessel-header-light.png", fullPage: true });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.screenshot({ path: ".tooling-tmp/vessel-header-dark.png", fullPage: true });
  for (const width of [1100, 650, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(add).toBeVisible();
    const buttons = await page.locator(".vessel-workspace-header button").evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(buttons.length).toBe(3);
    for (let i = 0; i < buttons.length; i++) {
      const a = buttons[i];
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(width);
      for (const b of buttons.slice(i + 1)) {
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
    }
  }
  const listToggle = page.getByRole('button', { name: '선박 목록 접기' });
  await listToggle.click();
  await expect(page.locator('.vessel-watchlist')).toBeHidden();
  await expect(page.locator('.vessel-map')).toBeVisible();
  await page.getByRole('button', { name: '선박 목록 펼치기' }).click();
  await expect(page.locator('.vessel-watchlist')).toBeVisible();
  await page.screenshot({ path: ".tooling-tmp/vessel-header-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "출항 예정", exact: true }).click();
  await expect(page.getByRole("button", { name: "출항 예정", exact: true })).toHaveAttribute("aria-pressed", "true");
  await add.click();
  await expect(page.getByRole("tab", { name: "관심 선박 4" })).toHaveAttribute("aria-selected", "true");
});

test("ETA workflow persists searched interests and removes only the personal interest", async ({ page }) => {
  await openEta(page);
  const vesselName = await page.locator(".shipment-card strong").first().boundingBox();
  expect(vesselName!.width).toBeGreaterThan(80);
  expect(vesselName!.height).toBeLessThan(40);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "목록에서 찾기", exact: true }).click();
  await page.getByLabel("선박 검색", { exact: true }).fill("999000005");
  await page.getByRole("button", { name: "Aurora Bulk 관심 등록", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".shipment-card")).toHaveCount(5);
  await expect(page.locator(".vessel-eta-detail")).toContainText("계획 속도");
  await openEta(page);
  await expect(page.locator(".shipment-card")).toHaveCount(5);
  await page.locator(".shipment-card").filter({ hasText: "Aurora Bulk" }).click();
  await page.getByRole("button", { name: "관심 해제", exact: true }).click();
  await expect(page.locator(".shipment-card")).toHaveCount(4);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "목록에서 찾기", exact: true }).click();
  await page.getByLabel("선박 검색", { exact: true }).fill("Aurora");
  await page.getByRole("button", { name: "Aurora Bulk 관심 등록", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("Newcastle");
  await page.getByRole('button', { name: '관심 목록 더보기' }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "내보내기", exact: true }).click()]);
  const exported = await download.path();
  await page.getByRole("button", { name: "관심 해제", exact: true }).click();
  await page.getByLabel("관심 목록 가져오기").setInputFiles(exported!);
  await expect(page.locator(".shipment-card")).toHaveCount(5);
});
test("ETA workflow keeps an empty watchlist empty after reload", async ({ page }) => {
  await openEta(page);
  for (let count = 4; count > 0; count--) {
    await expect(page.locator(".shipment-card")).toHaveCount(count);
    await page.getByRole("button", { name: "관심 해제", exact: true }).click();
  }
  await openEta(page);
  await expect(page.locator(".shipment-card")).toHaveCount(0);
  await expect(page.locator(".vessel-map-empty")).toBeVisible();
});
test("ETA workflow selects the canonical vessel on duplicate manual registration", async ({ page }) => {
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "직접 등록", exact: true }).click();
  await page.getByLabel("선박명", { exact: true }).fill("Duplicate name");
  await page.getByLabel("MMSI", { exact: true }).fill("999000002");
  await page.getByRole("button", { name: "위치 연결 대기로 등록" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".shipment-card")).toHaveCount(4);
  await expect(page.locator(".vessel-eta-detail h2")).toContainText("Ocean Frontier");
});
test("ETA workflow registers an unlocated vessel and links a planned voyage without inventing positions", async ({ page }) => {
  await openEta(page);
  await page.getByRole("button", { name: "관심 선박 구성", exact: true }).click();
  await page.getByRole("tab", { name: "직접 등록", exact: true }).click();
  await page.getByLabel("선박명", { exact: true }).fill("My Test Bulk");
  await page.getByLabel("IMO", { exact: true }).fill("1234567");
  await page.getByRole("button", { name: "위치 연결 대기로 등록" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("항차 미연결");
  await expect(page.locator(".vessel-map-marker")).toHaveCount(4);
  await expect(page.locator('.vessel-map-marker[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(".vessel-map-selection-note")).toContainText("My Test Bulk · 항차 미연결 · 현재 위치 미수신");
  await page.getByRole("button", { name: "항차 연결", exact: true }).click();
  await page.getByLabel("출항항", { exact: true }).fill("Test Port");
  await page.getByLabel("예정 출항 (KST)", { exact: true }).fill("2026-10-10T09:00");
  await page.getByLabel("예상 잔여거리 (nm)", { exact: true }).fill("120");
  await page.getByLabel("계획 항해 속도 (kn)", { exact: true }).fill("10");
  await page.getByRole("button", { name: "이 브라우저에 항차 저장" }).click();
  await expect(page.locator(".vessel-eta-primary")).toContainText("21:00");
  await expect(page.locator(".vessel-eta-detail")).toContainText("실시간 위치 미수신");
  await page.getByRole("button", { name: "항차 수정", exact: true }).click();
  await page.getByLabel("항차 상태").selectOption("cancelled");
  await page.getByRole("button", { name: "이 브라우저에 항차 저장" }).click();
  await expect(page.locator(".vessel-eta-primary")).toContainText("ETA 계산 전");
});
test("ETA workflow rejects malformed imports without destroying the saved list", async ({ page }) => {
  await openEta(page);
  await page.getByLabel("관심 목록 가져오기").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') });
  await expect(page.getByRole("alert")).toContainText("가져오기 실패");
  await expect(page.locator(".shipment-card")).toHaveCount(4);
});
test("ETA workflow never shows the old example route after destination editing", async ({ page }) => {
  await openEta(page);
  await page.locator(".shipment-card").filter({ hasText: voyages[1].vessel_name }).click();
  await page.getByRole("button", { name: "항차 수정", exact: true }).click();
  await page.getByLabel("목적 발전소").selectOption("dangjin");
  await page.getByRole("button", { name: "이 브라우저에 항차 저장" }).click();
  await expect(page.locator(".vessel-eta-detail")).toContainText("당진 연료부두");
  await expect(page.locator(".vessel-map-marker")).toHaveCount(3);
  await expect(page.locator('.vessel-map-marker[aria-label*="Ocean Frontier"]')).toHaveCount(0);
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveCount(0);
  await expect(page.locator(".vessel-map-selection-note")).toContainText("현재 항차에 맞는 지도 연결 정보가 없습니다.");
});
test("ETA workflow hides the example route after departure port editing", async ({ page }) => {
  await openEta(page);
  await page.locator(".shipment-card").filter({ hasText: voyages[1].vessel_name }).click();
  await page.getByRole("button", { name: "항차 수정", exact: true }).click();
  await page.getByLabel("출항항", { exact: true }).fill("New departure port");
  await page.getByRole("button", { name: "이 브라우저에 항차 저장" }).click();
  await expect(page.locator(".vessel-map-marker")).toHaveCount(3);
  await expect(page.locator('.vessel-map-marker[aria-label*="Ocean Frontier"]')).toHaveCount(0);
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveCount(0);
  await expect(page.locator(".vessel-map-selection-note")).toContainText("현재 항차에 맞는 지도 연결 정보가 없습니다.");
});
test("ETA weather timeline preserves the camera and marks missing synthetic forecasts", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  await page.goto('/?source=synthetic');
  await captureOnlineMap(page);
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await page.locator(".shipment-card").filter({ hasText: voyages[1].vessel_name }).click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const initialZoom = Number(await map.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "지도 확대", exact: true }).click();
  await expect.poll(async () => Number(await map.getAttribute("data-zoom"))).toBeCloseTo(initialZoom + 1, 1);
  await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.isMoving())).toBe(false);
  const zoom = await map.getAttribute("data-zoom");
  await page.getByRole("button", { name: "기상 표본 표시", exact: true }).click();
  await expect(page.locator(".vessel-weather-marker")).toHaveCount(3);
  await page.getByLabel("기상 예보 시각").fill("72");
  await expect(page.locator(".vessel-weather-panel")).toContainText("예보 범위 밖");
  await expect(page.locator(".vessel-weather-marker")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-zoom", zoom!);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: ".tooling-tmp/eta-light.png", fullPage: true });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.screenshot({ path: ".tooling-tmp/eta-dark.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".vessel-eta-primary")).toBeVisible();
  await page.screenshot({ path: ".tooling-tmp/eta-mobile.png", fullPage: true });
});

// Existing SVG regressions explicitly exercise the offline fallback.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/vessels/cyclones', route => route.fulfill({ json: { status: 'unavailable', fetchedAt: null, reason: '태풍 자료 조회 불가', storms: [] } }));
  await page.route('**/api/vessels/weather/**', route => route.fulfill({ status: 503 }));
  // UI fixtures must never register test MMSIs in the user's running collector.
  // Tests of navigation override this handler with their own response fixtures.
  await page.route("**/api/vessels/tracking/**", route => route.fulfill({ json:
    /\/(aisstream|digitraffic)\//.test(route.request().url())
      ? { segments: [], pointCount: 0, truncated: false }
      : { vessels: [] },
  }));
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
});

test("online map morphs into land, keeps compact attribution and preserves selection", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(map.locator(".maplibregl-canvas")).toBeVisible();
  const zoom = page.getByRole("button", { name: "지도 확대", exact: true });
  for (let i = 0; i < 7; i++) {
    await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.isMoving())).toBe(false);
    const next = await page.evaluate(() => (window as any).testVesselMap.getZoom() + 1);
    await zoom.click();
    await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.isMoving())).toBe(false);
    await expect
      .poll(async () => Number(await map.getAttribute("data-zoom")))
      .toBeCloseTo(next, 1);
  }
  await expect(map).toHaveAttribute("data-map-mode", "detail");
  const credit = page.locator(".maplibregl-ctrl-attrib");
  await expect(
    credit.getByRole("link", { name: "© OpenStreetMap", exact: true }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect(credit).toHaveCSS("font-size", "10px");
  await expect(credit).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator(".shipment-card").last().click();
  const selected = await page.locator(".vessel-eta-detail h2").innerText();
  const previousZoom = await map.getAttribute("data-zoom");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(map).toHaveAttribute("data-zoom", previousZoom!);
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText(selected);
  await page
    .getByRole("button", { name: "전체 세계지도 보기", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-map-mode", "dots");
  await page.setViewportSize({ width: 320, height: 844 });
  // This synthetic provider is used from zoom 4; show its full credits on mobile.
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 6 }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  await expect(
    credit.getByRole("link", { name: "© OpenStreetMap", exact: true }),
  ).toBeVisible();
  await expect(credit).toBeVisible();
  const creditBox = (await credit.boundingBox())!;
  const mapBox = (await map.boundingBox())!;
  expect(creditBox.x - mapBox.x).toBeGreaterThanOrEqual(0);
  expect(creditBox.x - mapBox.x).toBeLessThanOrEqual(12);
  expect(creditBox.y - mapBox.y).toBeGreaterThanOrEqual(0);
  expect(creditBox.y - mapBox.y).toBeLessThanOrEqual(12);
  const toolbarBox = (await page.locator(".vessel-map-toolbar").boundingBox())!;
  expect(creditBox.y + creditBox.height).toBeLessThanOrEqual(toolbarBox.y - 4);
  await expect(credit).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await credit
    .getByRole("link", { name: "© OpenStreetMap", exact: true })
    .click({ trial: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// Capture the real engine only inside the browser test; no app debug globals.
async function captureOnlineMap(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/deps/maplibre-gl.js"))!;
    const module = await import(/* @vite-ignore */ url);
    const original = module.Map.prototype.jumpTo;
    module.Map.prototype.jumpTo = function (...args: unknown[]) {
      (window as any).testVesselMap = this;
      module.Map.prototype.jumpTo = original;
      return original.apply(this, args);
    };
  });
}

test("mobile overview renders dots and later tile requests retain geography", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  await page.getByRole("button", { name: "평면 보기", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).testVesselMap.getZoom()),
  ).toBeLessThan(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).testVesselMap.queryRenderedFeatures({
          layers: ["vessel-dot-detail"],
        }).length,
    ),
  ).toBeGreaterThan(1000);
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 7 }),
  );
  await expect(map).toHaveAttribute("data-map-mode", "detail");
  // New tiles must keep the current detail map instead of flashing back to dots.
  await page.evaluate(() => {
    const map = (window as any).testVesselMap;
    (window as any).sourceLoaded = map.isSourceLoaded;
    map.isSourceLoaded = (id: string) =>
      id === "land" ? false : (window as any).sourceLoaded.call(map, id);
    map.fire("sourcedataloading", { dataType: "source", sourceId: "land" });
  });
  await expect(map).toHaveAttribute("data-map-mode", "detail");
  await page.evaluate(() => {
    const map = (window as any).testVesselMap;
    map.isSourceLoaded = (window as any).sourceLoaded;
    map.fire("idle");
  });
  await expect(map).toHaveAttribute("data-map-mode", "detail");
  await page.evaluate(
    () =>
      void (window as any).testVesselMap.fire("error", {
        sourceId: "land",
        error: new Error("tile unavailable"),
      }),
  );
  await expect(map).toHaveAttribute("data-map-mode", "detail");
  await expect(map.getByRole("status")).toContainText("일부");
  await expect(
    map.getByRole("button", { name: "지도 타일 다시 시도" }),
  ).toBeVisible();
});

test("online overview uses one nested dot grid without overlapping crossfade patterns", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/*", route => route.fulfill({ json: mapStyleFixture }));
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "선박 추적", exact: true }).click();
  await expect(page.locator(".vessel-map-online")).toHaveAttribute("data-map-ready", "true");
  let previousRadius = 0;
  for (const zoom of [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3.5, 5.5]) {
    await page.evaluate(zoom => (window as any).testVesselMap.jumpTo({ zoom }), zoom);
    await expect.poll(() => page.evaluate(() => (window as any).testVesselMap.loaded())).toBe(true);
    const dots = await page.evaluate(() => (window as any).testVesselMap.getStyle().layers.filter((layer: any) => layer.type === "circle" && layer.id.startsWith("vessel-dot")));
    expect(dots).toHaveLength(1);
    expect(dots[0].source).toBe("vessel-dot-detail");
    const radius = await page.evaluate(() => (window as any).testVesselMap.style.getLayer("vessel-dot-detail").paint.get("circle-radius").value.value);
    expect(radius).toBeGreaterThan(previousRadius);
    if (zoom <= 2) expect(radius * 2).toBeLessThan((512 * 2 ** zoom) / 256);
    previousRadius = radius;
    expect(await page.evaluate(() => (window as any).testVesselMap.getGlobalState().landBackdrop)).toBeGreaterThanOrEqual(0.5);
    expect(await page.evaluate(() => (window as any).testVesselMap.queryRenderedFeatures({ layers: ["vessel-dot-detail"] }).length)).toBeGreaterThan(0);
  }
});

test("globe view switches projection and dense dots retain gaps through the land blend", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(
    page.getByRole("button", { name: "지구본 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => (window as any).testVesselMap.getProjection().type,
    ),
  ).toBe("globe");
  await page.getByRole("button", { name: "평면 보기", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as any).testVesselMap.getProjection().type,
    ),
  ).toBe("mercator");
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 3.5 }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as any).testVesselMap.queryRenderedFeatures({
          layers: ["vessel-dot-detail"],
        }).length,
    ),
  ).toBeGreaterThan(1000);
  let previous = 0;
  // The single nested grid keeps growing through fractional zoom and tile boundaries.
  for (const zoom of [
    1.75, 2.49, 2.5, 2.51, 2.99, 3, 3.01, 3.5, 3.99, 4, 4.01, 4.75, 5.5, 6.2,
  ]) {
    await page.evaluate(
      (zoom) => void (window as any).testVesselMap.jumpTo({ zoom }),
      zoom,
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
      .toBe(true);
    const radii = await page.evaluate(() => {
      const m = (window as any).testVesselMap;
      return [
        "vessel-dot-detail",
      ].map(
        (id) => m.style.getLayer(id).paint.get("circle-radius").value.value,
      );
    });
    expect(radii.every((radius) => radius === radii[0])).toBe(true);
    expect(radii[0]).toBeGreaterThan(previous);
    expect(radii[0] * 2).toBeLessThan(8);
    previous = radii[0];
    await expect(map).toHaveAttribute(
      "data-map-mode",
      zoom <= 4.75 ? "dots" : "morph",
    );
  }
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 3.7 }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  const frames = await page.evaluate(
    () =>
      new Promise<{ zoom: number; radius: number; detail: number }[]>(
        (resolve) => {
          const m = (window as any).testVesselMap;
          const frames: { zoom: number; radius: number; detail: number }[] = [];
          const sample = () =>
            frames.push({
              zoom: m.getZoom(),
              radius: m.style
                .getLayer("vessel-dot-detail")
                .paint.get("circle-radius").value.value,
              detail: m.getGlobalState().dotsReady,
            });
          m.on("render", sample);
          m.once("moveend", () => {
            m.off("render", sample);
            resolve(frames);
          });
          m.easeTo({ zoom: 4.3, duration: 900 });
        },
      ),
  );
  expect(frames.length).toBeGreaterThan(2);
  frames.forEach((frame, i) => {
    expect(frame.detail).toBe(1);
    if (i) expect(frame.radius).toBeGreaterThanOrEqual(frames[i - 1].radius);
    expect(frame.radius).toBeCloseTo(1.05 + 0.37 * frame.zoom, 5);
  });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).testVesselMap.getStyle().sky["sky-color"],
      ),
    )
    .toBe("#0c0c10");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).testVesselMap.getProjection().type),
    )
    .toBe("mercator");
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as any).testVesselMap.queryRenderedFeatures({
          layers: ["vessel-dot-detail"],
        }).length,
    ),
  ).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "지구본 보기", exact: true }).click();
  await page
    .getByRole("button", { name: "전체 세계지도 보기", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-map-mode", "dots");
  expect(
    await page.evaluate(
      () => (window as any).testVesselMap.getProjection().type,
    ),
  ).toBe("globe");
  const desktopZoom = Number(await map.getAttribute("data-zoom"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeLessThan(desktopZoom - 0.5);
});

test("vessel markers stay on their own routes at every zoom and projection", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-online")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  for (const view of ["지구본 보기", "평면 보기"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    for (const zoom of [3, 6, 12, 18]) {
      for (const vessel of voyages) {
        await page.evaluate(
          ({ longitude, latitude, zoom }) => {
            (window as any).testVesselMap.jumpTo({
              center: [longitude, latitude],
              zoom,
            });
          },
          { ...vessel, zoom },
        );
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).testVesselMap.loaded()),
          )
          .toBe(true);
        const hits = await page.evaluate((id) => {
          const map = (window as any).testVesselMap;
          const marker = document
            .querySelector('[data-vessel-id="' + id + '"]')!
            .getBoundingClientRect();
          const container = map.getContainer().getBoundingClientRect();
          const x = marker.x + marker.width / 2 - container.x;
          const y = marker.y + marker.height / 2 - container.y;
          return map
            .queryRenderedFeatures(
              [
                [x - 2, y - 2],
                [x + 2, y + 2],
              ],
              { layers: ["vessel-routes"] },
            )
            .map((f: any) => f.properties.id);
        }, vessel.voyage_id);
        expect(hits, view + " zoom " + zoom + " " + vessel.voyage_id).toContain(
          vessel.voyage_id,
        );
      }
    }
  }
});

test("map toolbar stays together and the scale follows zoom without bottom padding", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  const scale = page.locator(".maplibregl-ctrl-scale");
  await expect(scale).toBeVisible();
  const before = await scale.innerText();
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 10 }),
  );
  await expect.poll(() => scale.innerText()).not.toBe(before);
  await expect(scale).toHaveText(/[0-9].*(km|m)/);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = (await map.boundingBox())!;
    const controls = (await page
      .locator(".vessel-map-controls")
      .boundingBox())!;
    const view = (await page.locator(".vessel-map-view-switch").boundingBox())!;
    expect(controls.x + controls.width).toBeLessThanOrEqual(view.x);
    expect(
      Math.abs(controls.y + controls.height / 2 - view.y - view.height / 2),
    ).toBeLessThanOrEqual(1);
    expect(controls.x).toBeGreaterThanOrEqual(box.x + 7);
    expect(view.x + view.width).toBeLessThanOrEqual(box.x + box.width - 7);
    for (const element of [page.locator(".vessel-map-pan-hint"), scale]) {
      const edge = (await element.boundingBox())!;
      expect(box.y + box.height - edge.y - edge.height).toBeGreaterThanOrEqual(
        7,
      );
      expect(box.y + box.height - edge.y - edge.height).toBeLessThanOrEqual(10);
    }
  }
});

test("dark globe stars follow dragging, return to the same sky and hide in flat or light mode", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-online")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).testVesselMap.getStyle().sky["sky-color"],
      ),
    )
    .toBe("#0c0c10");
  await page.evaluate(
    () =>
      void (window as any).testVesselMap.jumpTo({
        center: [125, 15],
        zoom: 1.5,
      }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  const stars = page.locator(".vessel-map-stars");
  await expect(stars).toBeVisible();
  const pixels = await stars.evaluate((canvas: HTMLCanvasElement) => {
    const map = (window as any).testVesselMap;
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const ratio = canvas.width / map.getContainer().clientWidth;
    let lit = 0,
      inside = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (!data[i]) continue;
      lit++;
      const pixel = (i - 3) / 4;
      const x = ((pixel % canvas.width) + 0.5) / ratio,
        y = (Math.floor(pixel / canvas.width) + 0.5) / ratio;
      const roundtrip = map.project(map.unproject([x, y]));
      if (Math.hypot(roundtrip.x - x, roundtrip.y - y) < 0.5) inside++;
    }
    return { lit, inside };
  });
  expect(pixels.lit).toBeGreaterThan(0);
  expect(pixels.inside).toBe(0);
  const before = await stars.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const box = (await page.locator(".vessel-map-webgl").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height * 0.35 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(() => stars.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(before);
  await page.evaluate(
    () =>
      void (window as any).testVesselMap.jumpTo({
        center: [125, 15],
        zoom: 1.5,
      }),
  );
  await expect
    .poll(() => stars.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .toBe(before);
  await page.getByRole("button", { name: "평면 보기", exact: true }).click();
  await expect(stars).toBeHidden();
  await page.getByRole("button", { name: "지구본 보기", exact: true }).click();
  await expect(stars).toBeVisible();
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect(stars).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
});

test("failed vector tiles retry without replacing the map or camera", async ({
  page,
}) => {
  const fixture = structuredClone(mapStyleFixture) as any;
  fixture.sources.provider = {
    type: "vector",
    url: "https://tiles.openfreemap.org/test-tiles.json",
  };
  fixture.layers.push({
    id: "test-water",
    type: "fill",
    source: "provider",
    "source-layer": "water",
    paint: { "fill-color": "#eee" },
  });
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("https://tiles.openfreemap.org/test-tiles.json", (route) =>
    route.fulfill({
      json: {
        tiles: ["https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
      },
    }),
  );
  let tiles = 0;
  await page.route("https://tiles.openfreemap.org/test/**", (route) => {
    tiles++;
    return route.fulfill({
      body: Buffer.alloc(0),
      contentType: "application/x-protobuf",
    });
  });
  await page.goto("/?source=synthetic");
  await captureOnlineMap(page);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const map = page.locator(".vessel-map-online");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await page.evaluate(
    () => void (window as any).testVesselMap.jumpTo({ zoom: 7 }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).testVesselMap.loaded()))
    .toBe(true);
  const previousTiles = tiles;
  const previousZoom = await map.getAttribute("data-zoom");
  await page.evaluate(
    () =>
      void (window as any).testVesselMap.fire("error", {
        sourceId: "provider",
        error: new Error("tile unavailable"),
      }),
  );
  await map.getByRole("button", { name: "지도 타일 다시 시도" }).click();
  await expect.poll(() => tiles).toBeGreaterThan(previousTiles);
  await expect(map.getByRole("status")).not.toBeVisible();
  await expect(map).toHaveAttribute("data-zoom", previousZoom!);
  await expect(map).toHaveAttribute("data-map-mode", "detail");
});

test("online map recovers from unavailable service and supports keyboard vessel selection", async ({
  page,
}) => {
  await page.goto("/tests/map-harness.html");
  await expect(page.locator(".vessel-map-dots")).toBeVisible();
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.getByRole("button", { name: "상세 지도 다시 연결" }).click();
  await expect(page.locator(".vessel-map-online")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  await expect(page.locator(".vessel-online-marker")).toHaveCount(200);
  const marker = page.locator(
    '.vessel-online-marker[data-vessel-id="test-199"]',
  );
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(
    "Test vessel 199",
  );
  await expect(marker).toBeFocused();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.dispatchEvent("webglcontextlost");
  await expect(page.locator(".vessel-map-dots")).toBeVisible();
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(
    "Test vessel 199",
  );
});

test("unavailable WebGL keeps the offline vessel map usable", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/*", (route) =>
    route.fulfill({ json: mapStyleFixture }),
  );
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof getContext>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto("/tests/map-harness.html");
  await expect(page.locator(".vessel-map-dots")).toBeVisible();
  await expect(page.locator(".vessel-map-marker")).toHaveCount(200);
  await expect(
    page.getByRole("button", { name: "지도 확대", exact: true }),
  ).toBeEnabled();
});

test("MILP backend shows ten units, date-bound plans and missing inventory explicitly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/vessels/")) return route.fallback();
    const body =
      url.pathname === "/api/runs"
        ? [
            {
              id: "검증 계산",
              name: "검증 계산",
              period: "2027-01-01 ~ 2027-12-31",
            },
          ]
        : planningFixture(
            "검증 계산",
            url.searchParams.get("start")!,
            Number(url.searchParams.get("horizon")),
          );
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.locator("[data-unit-id]")).toHaveCount(10);
  await expect(
    page.getByRole("heading", { name: "월별 석탄 사용 예정량" }),
  ).toBeVisible();
  await expect(page.locator(".fuel-supply-kpis")).toContainText("미등록");
  await expect(page.locator(".fuel-supply-kpis")).toContainText("미확정");
  await expect(
    page.getByText("동작 확인용 MILP", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(1);
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("288,000");
  await expect(
    page.locator('[data-fuel-metric="일평균 사용 예정량"]'),
  ).toContainText("9,600");
  await expect(page.getByText("실적 미연계", { exact: true })).toBeVisible();
  await page
    .getByText("월별 예정량·계획 확보일수 보기", { exact: true })
    .click();
  await expect(page.locator(".fuel-monthly tbody tr")).toHaveCount(12);
  await expect(page.locator(".fuel-monthly tbody tr").first()).toContainText(
    "297,600",
  );
  await page.getByRole("button", { name: "7일", exact: true }).click();
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("67,200");
  await expect(page.locator(".fuel-monthly tbody tr").first()).toContainText(
    "297,600",
  );
  await page.getByRole("button", { name: "90일", exact: true }).click();
  await expect(page.locator(".midterm-source")).toContainText("2027-03-31");
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("864,000");
  await expect(page.locator(".fuel-monthly .fuel-selected-month")).toHaveCount(
    3,
  );
  await page.getByLabel("MILP 조회 시작일").fill("2027-02-01");
  await expect(page.locator(".midterm-source")).toContainText("2027-05-01");
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(0);
  await expect(page.locator(".fuel-monthly .fuel-selected-month")).toHaveCount(
    4,
  );
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  await expect(page.locator(".yard-pile")).toHaveCount(16);
  await expect(page.locator(".midterm-page")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "발전소 종합 데이터 모드" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  await expect(page.locator(".shipment-card")).toHaveCount(4);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "예측/모델 상세", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "재학습 · 전망에 적용" }),
  ).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "발전소 종합", exact: true })
    .click();
  await expect(page.locator("[data-unit-id]")).toHaveCount(10);
  await page.setViewportSize({ width: 320, height: 900 });
  // ECharts resizes on ResizeObserver, after the viewport change returns.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("incomplete fuel plans remain unknown and DB inventory forecasts render separately", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/runs") {
      await route.fulfill({
        json: [
          {
            id: "연료 검증",
            name: "연료 검증",
            period: "2027-01-01 ~ 2027-12-31",
          },
        ],
      });
      return;
    }
    const snapshot = planningFixture(
      "연료 검증",
      url.searchParams.get("start")!,
      Number(url.searchParams.get("horizon")),
    );
    snapshot.daily[2].fuel_tonnes = null;
    snapshot.units[0].fuel_tonnes = null;
    snapshot.monthly.forEach((month) => {
      month.fuel_tonnes = null;
    });
    snapshot.inventory.kpis = {
      stock: 100000,
      min_days: 8.5,
      risk: "caution",
      arrivals: 40000,
      arrival_count: 1,
      unloading_remaining: 6000,
      active_vessels: 1,
      incoming_cv: 5800,
    };
    snapshot.inventory.thresholds = { danger_days: 7, normal_days: 15 };
    Object.assign(snapshot.inventory.groups[0], {
      stock: 100000,
      days: 12,
      min_days: 8.5,
      expected_receipts: 25000,
      risk: "caution",
    });
    snapshot.inventory.daily.forEach((day, i) => {
      day.groups.g14.stock = 100000 - 960 * (i + 1);
    });
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(
    page.locator('[data-fuel-metric="일평균 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(
    page.locator('[data-fuel-metric="최대 일 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(page.locator('[data-fuel-metric="총 재고"]')).toContainText(
    "100,000",
  );
  await expect(
    page.locator('[data-fuel-metric="입항 예정 (30일)"]'),
  ).toContainText("40,000");
  await expect(page.locator(".fuel-flow")).toContainText("25,000");
  await expect(
    page.getByText("온전한 월별 연료계획이 없습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "처별 일말 예상 석탄 재고 톤" }),
  ).toBeVisible();
  await expect(page.locator('[data-unit-id="dj-1"]')).toContainText("미확정");
  await page.getByText("일별 계획 수치 보기", { exact: true }).click();
  await expect(page.locator(".fuel-daily tbody tr").nth(2)).toContainText(
    "미확정",
  );
  await expect(
    page.getByRole("heading", { name: "예측·최적화 핵심 지표" }),
  ).toBeVisible();
});

test("failed backend stays an error and synthetic demo requires explicit selection", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 503, json: { detail: "서버 연결 확인" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("서버 연결 확인");
  await expect(page.locator(".tower-kpis")).toHaveCount(0);
  await page.getByRole("button", { name: "합성 데모", exact: true }).click();
  await expect(page.locator(".tower-metric").first()).toContainText("538,000");
  await expect(page.getByText("샘플 데이터", { exact: true })).toBeVisible();
});

test("world map accepts 200 normalized vessel positions without hard-coded shipment IDs", async ({
  page,
}) => {
  await page.goto("/tests/map-harness.html");
  await expect(page.locator(".vessel-map-marker")).toHaveCount(200);
  await page.locator(".vessel-map-vessels button").last().click();
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(
    "Test vessel 199",
  );
});

test("pile drilldown, stale AIS and model training update the operational forecast", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  const before = await page.locator(".tower-metric").nth(7).innerText();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  await page.locator(".yard-pile").nth(3).click();
  await expect(page.locator(".yard-pile").nth(3)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "DA-04 · 인니 저열량탄" }),
  ).toBeVisible();
  await expect(page.locator(".tower-details")).toContainText("미연결");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".shipment-card .tower-tag").first()).toHaveText(
    "STALE",
  );
  await page.locator('.vessel-observation-details summary').click();
  await expect(page.getByText("SOG / COG", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "예측/모델 상세", exact: true })
    .click();
  await page.getByLabel("학습 반복").selectOption("300");
  await page.getByRole("button", { name: "재학습 · 전망에 적용" }).click();
  await expect(page.locator(".tower-page")).toContainText(
    "local-linear-v1/300",
  );
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "발전소 종합", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".tower-metric").nth(7).innerText())
    .not.toBe(before);
  await page.getByRole("button", { name: "90일", exact: true }).click();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "월별 수급 집계" }),
  ).toBeVisible();
});

test("theme persists, scope recalculates, and planned stop details remain explicit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?source=synthetic");
  await expect(
    page.getByRole("heading", { name: "발전소 종합", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tower-metric").first()).toContainText("538,000");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "하동", exact: true }).click();
  await expect(page.locator(".tower-metric").first()).toContainText("108,000");
  await expect(
    page.locator(".tower-table").first().locator("tbody tr"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "정지계획", exact: true }).click();
  await page.locator(".schedule-row").first().click();
  await expect(page.getByRole("dialog")).toContainText("샘플 운영 및 정비계획");
  await expect(page.getByRole("dialog")).toContainText(
    "계획정지는 서로 독립된 정보",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("scenario is applied explicitly, shows actual orb canvas and updates forecast", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("button", { name: "시나리오 분석", exact: true })
    .click();
  const before = await page.locator(".comparison-card").nth(1).innerText();
  await page.getByRole("button", { name: "수급 지연", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "발전 부하 변화", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "입항·하역 지연", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".scenario-save-state")).toContainText(
    "아직 결과에 반영되지 않았습니다",
  );
  expect(await page.locator(".comparison-card").nth(1).innerText()).toBe(
    before,
  );
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".processing-strip canvas")).toBeVisible();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  await expect(page.locator(".applied-conditions")).toContainText("부하 +15%");
  await expect(page.locator(".applied-conditions")).toContainText("지연 +3일");
  expect(await page.locator(".comparison-card").nth(1).innerText()).not.toBe(
    before,
  );
  await page.getByRole("button", { name: "기준 조건", exact: true }).click();
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".comparison-card").nth(1)).toHaveText(before, {
    useInnerText: true,
  });
});

test("mobile navigation, all views, and dark mode stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?source=synthetic");
  await page.getByRole("button", { name: "60일", exact: true }).click();
  await expect(page.locator('.processing-strip [role="status"]')).toBeVisible();
  await expect(page.locator(".processing-strip canvas")).toBeVisible();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  for (const label of [
    "저탄장 현황",
    "선박 추적",
    "예측/모델 상세",
    "데이터/관리자",
    "발전소 종합",
  ]) {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await page
      .getByRole("navigation", { name: "모바일 메뉴" })
      .getByRole("button", { name: label, exact: label !== "발전기 정지계획" })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("offline single HTML supports calculation without network", async ({
  browser,
}) => {
  const context = await browser.newContext({
    offline: true,
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve("발전운영_대시보드.html")).href);
  await expect(
    page.getByRole("heading", { name: "발전소 종합", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "시나리오 분석", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "입항 예정 연료 포함" }).uncheck();
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".applied-conditions")).toContainText("입항 제외");
  await expect(page.locator(".comparison-card").nth(1)).toContainText("10.");
  expect(errors).toEqual([]);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  await context.close();
});

test("world map selection, zoom and scoped shipment details stay synchronized", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  const selector = page.locator(".shipment-card").last();
  const name = (await selector.locator("strong").innerText()).trim();
  await selector.click();
  await expect(selector).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText(`${name} · 도착 전망`);
  await page.getByRole("button", { name: "지도 확대", exact: true }).click();
  await page
    .getByRole("button", { name: "전체 세계지도 보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "지도 축소", exact: true }),
  ).toBeDisabled();
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "하동", exact: true }).click();
  await expect(page.locator(".vessel-map-marker")).toHaveCount(1);
  await expect(page.locator(".vessel-eta-detail")).toContainText("하동");
  await expect(page.locator(".shipment-card")).toHaveCount(1);
});

test("map zoom adds land detail while dots retain their screen size", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const dots = page.locator(".vessel-map-dots");
  const countDots = async () =>
    ((await dots.getAttribute("d"))?.match(/M/g) ?? []).length;
  const baseCount = await countDots();
  expect(baseCount).toBeGreaterThan(1000);
  const basePath = await dots.getAttribute("d");
  const zoomIn = page.getByRole("button", { name: "지도 확대", exact: true });
  await zoomIn.click();
  await zoomIn.click();
  await expect.poll(countDots).toBeGreaterThan(baseCount * 2);
  const mediumCount = await countDots();
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomIn).toBeDisabled();
  await expect.poll(countDots).toBeGreaterThan(mediumCount * 2);
  // A non-scaling round stroke keeps each dot small even at maximum zoom.
  await expect(dots).toHaveAttribute("vector-effect", "non-scaling-stroke");
  await page.getByRole("button", { name: "지도 축소", exact: true }).click();
  await page.getByRole("button", { name: "지도 축소", exact: true }).click();
  await expect.poll(countDots).toBe(mediumCount);
  await page
    .getByRole("button", { name: "전체 세계지도 보기", exact: true })
    .click();
  await expect(dots).toHaveAttribute("d", basePath!);
  const canvas = page.locator(".vessel-map-svg");
  await canvas.hover();
  await page.mouse.wheel(0, -650);
  await expect.poll(countDots).toBeGreaterThan(baseCount * 2);
});

test("inventory chart exposes interval boundary and scopes cargo", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await expect(page.getByText(/가로축: 다음날 09:00 KST/)).toBeVisible();
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "보령", exact: true }).click();
  await expect(page.locator(".tower-metric").nth(2)).toContainText("65,000");
  await expect(
    page.locator(".tower-chart").first().locator("svg"),
  ).toBeVisible();
});

test("tablet and narrow phone retain all navigation views without page overflow", async ({
  page,
}) => {
  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?source=synthetic");
    for (const name of [
      "저탄장 현황",
      "선박 추적",
      "예측/모델 상세",
      "데이터/관리자",
    ]) {
      if (width <= 760) {
        await page.getByRole("button", { name: "메뉴 열기" }).click();
        await page
          .getByRole("navigation", { name: "모바일 메뉴" })
          .getByRole("button", { name, exact: true })
          .click();
      } else {
        await page
          .getByRole("navigation", { name: "주 메뉴" })
          .getByRole("button", { name, exact: true })
          .click();
      }
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("dotted map supports keyboard selection, theme changes and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const marker = page
    .locator(".vessel-map-marker")
    .filter({ hasText: "Southern Star" });
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".vessel-eta-detail h2")).toHaveText("Southern Star · 도착 전망");
  await expect(page.locator('.shipment-card[aria-pressed="true"]')).toContainText("Southern Star");
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".aceternity-world-map")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveAttribute(
    "stroke-dashoffset",
    /^0(?:px)?$/,
  );
  const route = await page
    .locator(".vessel-map-route.is-selected")
    .getAttribute("d");
  const lightFill = await page
    .locator(".vessel-map-dots")
    .evaluate((el) => getComputedStyle(el).fill);
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect
    .poll(() =>
      page
        .locator(".vessel-map-dots")
        .evaluate((el) => getComputedStyle(el).fill),
    )
    .not.toBe(lightFill);
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveAttribute(
    "d",
    route!,
  );
  await page.getByRole("button", { name: "발전 영향 보기" }).click();
  await expect(page.getByRole("dialog")).toContainText("하동");
});
