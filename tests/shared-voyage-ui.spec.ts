import { test, expect } from '@playwright/test';

test('관심 선박의 공용 배선에서 해당 원장 상세로 이동한다', async ({ page, context }) => {
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    url.port = '8097';
    await route.fulfill({ response: await route.fetch({ url: url.href }) });
  });
  await page.goto('/?source=synthetic#voyages');
  await page.getByLabel('아이디', { exact: true }).fill('test-admin');
  await page.getByLabel('비밀번호', { exact: true }).fill('only-for-isolated-ui-tests-2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '항차·화물 원장', exact: true })).toBeVisible();
  const suffix = Date.now().toString();
  const name = `연결 확인 ${suffix}`;
  const result = await page.evaluate(async ({ suffix, name }) => {
    const current = await (await fetch('/api/voyage-registry/records')).json();
    const changes = {
      ships: [{ ship_code: `S-${suffix}`, name: 'LINK TEST', mmsi: '440123459' }],
      voyages: [{ voyage_no: `V-${suffix}`, ship_code: `S-${suffix}`, notes: name, status: 'planned' }],
      cargo: [{ cargo_no: `C-${suffix}`, voyage_no: `V-${suffix}`, coal_name: 'LINK COAL', destination_plant_id: 'dangjin', planned_t: 100 }],
    };
    const saved = await fetch('/api/voyage-registry/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes, revision: current.revision }) });
    const state = await (await fetch('/api/me/vessel-workspace')).json();
    state.workspace = { version: 1, watchlist: ['link-test'], voyages: [], vessels: [{ id: 'link-test', name: 'LINK TEST', mmsi: '440123459', imo: '', source: 'manual' }] };
    const workspace = await fetch('/api/me/vessel-workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    return saved.ok && workspace.ok;
  }, { suffix, name });
  expect(result).toBeTruthy();
  await page.reload();
  const summary = page.getByRole('region', { name: '공용 배선 및 화물' });
  await expect(summary).toContainText('LINK COAL');
  await expect(summary).toContainText('항차번호 미부여');
  await summary.getByRole('button', { name: /항차번호 미부여/ }).click();
  await expect(page.locator('.vr-detail')).toContainText(name);
  await expect(page.locator('.vr-related')).toContainText('LINK COAL');
});
