import { test, expect, readSavedWorkspace } from './auth-fixture';
import { mapStyleFixture } from './map-style-fixture';

test('fleet map queries viewport, opens clicked ship, registers interest and survives theme and request errors', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [], watchlist: [], voyages: [] })));
  await page.route('https://tiles.openfreemap.org/styles/*', r => r.fulfill({ json: mapStyleFixture }));
  const now = new Date().toISOString();
  const ship = { id: 'ais-440000001', mmsi: '440000001', imo: '', name: 'MAP TEST SHIP', source: 'aisstream',
    ais: { updatedAt: now, destination: 'KR PUS', shipType: 70, navStatus: 0,
      position: { longitude: 125, latitude: 15, observedAt: now, sogKn: 12, cogDeg: 45 } } };
  let fail = false, calls = 0;
  await page.route('**/api/vessels/map?*', r => {
    calls++; const q = new URL(r.request().url()).searchParams; expect(q.has('west')).toBe(true);
    return fail ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: { type: 'FeatureCollection', visibleCount: 1, fetchedAt: now, lastReceivedAt: now,
      features: [{ type: 'Feature', id: ship.mmsi, geometry: { type: 'Point', coordinates: [125, 15] },
        properties: { kind: 'vessel', count: 1, fresh: true, mmsi: ship.mmsi, name: ship.name, course: 45 } }] } });
  });
  await page.route('**/api/vessels/map/440000001', r => r.fulfill({ json: ship }));
  await page.goto('/?source=synthetic');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.getByText('화면 범위 1척', { exact: true })).toBeVisible();
  const canvas = page.getByLabel('전 세계 선박 지도 · 방향키 이동, + 및 - 확대 축소');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  const panel = page.getByRole('region', { name: '지도 선박 정보' });
  await expect(panel).toContainText('MAP TEST SHIP');
  await expect(panel).toContainText('12.0 kn');
  await expect(panel).toContainText('KR PUS');
  await expect(page.locator('.vessel-fleet-freshness')).toContainText('마지막 관측 위치');
  const assertNoticeAboveMap = async () => {
    const notice = await page.locator('.vessel-fleet-freshness').boundingBox();
    const map = await page.locator('.vessel-map-canvas').boundingBox();
    expect(notice!.y + notice!.height).toBeLessThanOrEqual(map!.y + 1);
    await expect(page.locator('.vessel-map-canvas .vessel-fleet-freshness')).toHaveCount(0);
  };
  await assertNoticeAboveMap();
  await expect(page.getByLabel('지도 선박 선택')).toHaveCount(0);
  const assertToolbar = async () => {
    const toolbar = page.getByRole('toolbar', { name: '지도 도구' });
    await expect(toolbar.getByRole('button', { name: '전체 수신 선박', exact: true })).toBeVisible();
    const buttons = await toolbar.getByRole('button').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height, text:node.textContent?.trim(), label:node.getAttribute('aria-label') };
    }));
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) {
      expect(b.text).toBe(''); expect(b.label).toBeTruthy();
      expect(b.width).toBe(28); expect(b.height).toBe(28);
      expect(Math.abs(b.y - buttons[0].y)).toBeLessThanOrEqual(1);
    }
    const box = await toolbar.boundingBox(); const mapBox = await page.locator('.vessel-map-canvas').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(mapBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width);
  };
  await assertToolbar();
  const fleetToggle = page.getByRole('button', { name: '전체 수신 선박', exact: true });
  await page.keyboard.press('Tab');
  await fleetToggle.focus();
  await expect(page.getByRole('tooltip', { name: '전체 수신 선박', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '평면 보기', exact: true }).hover();
  await expect(page.getByRole('tooltip', { name: '평면 보기', exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await panel.screenshot({ path: '.tooling-tmp/fleet-detail-light.png' });
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/fleet-map-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
  await expect(panel).toContainText('MAP TEST SHIP');
  await panel.getByRole('button', { name: '관심 선박에 추가', exact: true }).click();
  await expect(panel.getByRole('button', { name: '관심 등록됨' })).toBeDisabled();
  expect((await readSavedWorkspace(page)).watchlist).toContain(ship.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await assertNoticeAboveMap();
  await assertToolbar();
  await panel.screenshot({ path: '.tooling-tmp/fleet-detail-mobile.png' });
  await page.locator('.vessel-map').screenshot({ path: '.tooling-tmp/fleet-map-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '지도 선박 정보 닫기' }).click();
  fail = true;
  await page.getByRole('button', { name: '지도 확대', exact: true }).click();
  await expect(page.locator('.vessel-fleet-error')).toContainText('503');
  await expect(page.getByText('화면 범위 1척', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '전체 수신 선박', exact: true }).click();
  await expect(page.getByLabel('지도 선박 선택')).toHaveCount(0);
  await expect(fleetToggle).toHaveAttribute('aria-pressed', 'false');
  expect(calls).toBeGreaterThan(1);
});

test('cluster selection zooms to the group rather than registering a fictitious vessel', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify({ version: 1, vessels: [], watchlist: [], voyages: [] })));
  await page.route('https://tiles.openfreemap.org/styles/*', r => r.fulfill({ json: mapStyleFixture }));
  let zoom = -2;
  await page.route('**/api/vessels/map?*', r => {
    zoom = Number(new URL(r.request().url()).searchParams.get('zoom'));
    return r.fulfill({ json: { type: 'FeatureCollection', visibleCount: 100, fetchedAt: new Date().toISOString(), lastReceivedAt: null,
      features: [{ type: 'Feature', id: 'cluster-1', geometry: { type: 'Point', coordinates: [125, 15] }, properties: { kind: 'cluster', count: 100, fresh: false, cellDegrees: 10 } }] } });
  });
  await page.goto('/?source=synthetic');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/deps/maplibre-gl.js'))!;
    const module = await import(/* @vite-ignore */ url); const original = module.Map.prototype.jumpTo;
    module.Map.prototype.jumpTo = function (...args: unknown[]) { (window as any).fleetTestMap = this; module.Map.prototype.jumpTo = original; return original.apply(this, args); };
  });
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.getByText('화면 범위 100척', { exact: true })).toBeVisible();
  const before = zoom;
  const clickCluster = async () => {
    const canvas = page.getByLabel('전 세계 선박 지도 · 방향키 이동, + 및 - 확대 축소');
    const box = await canvas.boundingBox();
    await expect.poll(() => page.evaluate(() => (window as any).fleetTestMap.isSourceLoaded('vessel-fleet-discovery'))).toBe(true);
    await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  };
  await clickCluster();
  await expect.poll(() => zoom).toBeGreaterThan(before + 1);
  await expect(page.getByRole('region', { name: '지도 선박 정보' })).toHaveCount(0);
  for (let i = 0; i < 10 && zoom < 17.99; i++) {
    const previous = zoom;
    await clickCluster();
    await expect.poll(() => zoom).toBeGreaterThanOrEqual(Math.min(18, previous + 1));
  }
  await clickCluster();
  await expect(page.locator('.vessel-fleet-error')).toContainText('최대 확대에서도');
});
