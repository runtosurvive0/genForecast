import { test, expect, type Page } from '@playwright/test';
import { vesselCatalog, trackingVoyages } from '../src/data/vessel-workflow';

const password = 'crew1234'; // Exercise the minimum length through real signup and login.
async function login(page: Page, username: string, value = password) {
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(value);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('아이디', { exact: true })).toBeVisible();
}
test.beforeEach(async ({ context }) => {
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    url.port = '8097';
    const response = await route.fetch({ url: url.href });
    await route.fulfill({ response });
  });
});

test('real approved signup blocks pending accounts, approves as member and isolates workspaces', async ({ page, context }) => {
  test.setTimeout(90000);
  await page.goto('/?source=synthetic');
  await expect(page.getByRole('heading', { name: '팀의 다음 항해를 함께 준비하세요' })).toBeVisible();
  await page.getByRole('tab', { name: '회원가입', exact: true }).click();
  await page.getByLabel('이름', { exact: true }).fill('Test Crew');
  await page.getByLabel('아이디', { exact: true }).fill('test-crew');
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('different password phrase');
  await page.getByRole('button', { name: '가입 신청' }).click();
  await expect(page.getByRole('alert')).toContainText('일치하지 않습니다');
  await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
  await page.screenshot({ path: '.tooling-tmp/signup-light.png' });
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await page.screenshot({ path: '.tooling-tmp/signup-dark.png' });
  await page.setViewportSize({ width: 360, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tooling-tmp/signup-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '가입 신청' }).click();
  await expect(page.getByRole('status')).toContainText('가입 신청이 완료되었습니다');
  await login(page, 'test-crew');
  await expect(page.getByRole('heading', { name: '관리자 승인 대기 중' })).toBeVisible();
  expect((await page.request.get('http://127.0.0.1:8097/api/me/vessel-workspace')).status()).toBe(403);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await login(page, 'test-admin', 'only-for-isolated-ui-tests-2026');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '데이터/관리자', exact: true }).click();
  const member = page.locator('.gf-member-list article').filter({ hasText: 'Test Crew' });
  await expect(member).toBeVisible();
  await page.screenshot({ path: '.tooling-tmp/members-dark.png' });
  await member.getByRole('button', { name: '승인', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('계정 변경을 반영했습니다');
  await logout(page);
  await login(page, 'test-crew');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.locator('.vessel-watchlist .shipment-card')).toHaveCount(0);
  await page.getByRole('button', { name: '관심 선박 구성', exact: true }).click();
  await page.getByRole('tab', { name: '직접 등록', exact: true }).click();
  await page.getByLabel('선박명', { exact: true }).fill('Crew Private Vessel');
  await page.getByLabel('MMSI', { exact: true }).fill('440123459');
  await page.getByRole('button', { name: '위치 연결 대기로 등록' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.locator('.vessel-watchlist .shipment-card')).toContainText('Crew Private Vessel');
  await expect.poll(async () => {
    const data = await page.evaluate(async () => (await fetch('/api/me/vessel-workspace')).json());
    return data.workspace.vessels.map((v: { name: string }) => v.name);
  }).toContain('Crew Private Vessel');
  await page.getByRole('button', { name: '항로·계산 설정', exact: true }).click();
  await page.getByRole('button', { name: '항차 연결', exact: true }).click();
  await page.getByLabel('출항항', { exact: true }).fill('Test Port');
  await page.getByLabel('예정 출항 (KST)', { exact: true }).fill('2026-10-10T09:00');
  await page.getByLabel('예상 잔여거리 (nm)', { exact: true }).fill('120');
  await page.getByLabel('계획 항해 속도 (kn)', { exact: true }).fill('10');
  await page.getByRole('button', { name: '계정에 항차 저장' }).click();
  await expect.poll(async () => {
    const data = await page.evaluate(async () => (await fetch('/api/me/vessel-workspace')).json());
    return data.workspace.voyages.map((v: { origin: string }) => v.origin);
  }).toContain('Test Port');
  await page.reload();
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.locator('.vessel-watchlist .shipment-card')).toContainText('Crew Private Vessel');
  expect(await page.evaluate(() => localStorage.getItem('genforecast.vessel-workspace.v1'))).toBeNull();
  await logout(page);
  await login(page, 'test-admin', 'only-for-isolated-ui-tests-2026');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '선박 추적', exact: true }).click();
  await expect(page.locator('.vessel-watchlist .shipment-card')).toHaveCount(0);
  await expect(page.getByText('Crew Private Vessel', { exact: true })).toHaveCount(0);
  const stale = await page.evaluate(async () => ({
    user: (await (await fetch('/api/auth/session')).json()).user,
    data: await (await fetch('/api/me/vessel-workspace')).json(),
  }));
  const other = await context.newPage();
  await other.goto('/?source=synthetic');
  await logout(other);
  await expect(page.getByLabel('아이디', { exact: true })).toBeVisible();
  await login(other, 'test-crew');
  await expect(other.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  const token = (await (await page.request.get('http://127.0.0.1:8097/api/auth/csrf')).json()).token;
  const staleSave = await page.request.put('http://127.0.0.1:8097/api/me/vessel-workspace', {
    headers: { Origin: new URL(page.url()).origin, 'X-CSRF-Token': token, 'X-Account-ID': stale.user.id }, data: stale.data,
  });
  expect(staleSave.status()).toBe(403);
  expect((await staleSave.json()).code).toBe('account_changed');
  const preserved = await other.evaluate(async () => (await (await fetch('/api/me/vessel-workspace')).json()).workspace);
  expect(preserved.vessels[0].name).toBe('Crew Private Vessel');
  expect(preserved.voyages[0].origin).toBe('Test Port');
});

test('auth connection failure never falls through to operational screens', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.abort());
  await page.goto('/?source=synthetic');
  await expect(page.getByRole('alert')).toContainText('인증 서버에 연결하지 못했습니다');
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toHaveCount(0);
});

test('legacy browser list imports only by choice and keeps original data and destination preferences', async ({ page }) => {
  const vessel = vesselCatalog[0];
  const legacy = { version: 1, watchlist: [vessel.id], vessels: [vessel], voyages: [trackingVoyages[0]] };
  await page.addInitScript(({ legacy, id }) => {
    localStorage.setItem('genforecast.vessel-workspace.v1', JSON.stringify(legacy));
    localStorage.setItem('genforecast.vessel-route-destinations.v1', JSON.stringify({ [id]: 'ais' }));
  }, { legacy, id: vessel.id });
  await page.goto('/?source=synthetic');
  await login(page, 'test-admin', 'only-for-isolated-ui-tests-2026');
  const migrate = page.getByRole('button', { name: '기존 관심 선박 가져오기', exact: true });
  await expect(migrate).toBeVisible();
  const before = await page.evaluate(async () => (await (await fetch('/api/me/vessel-workspace')).json()));
  expect(before.workspace.watchlist).not.toContain(vessel.id);
  await migrate.click();
  await expect(page.locator('.gf-account-status [role="status"]')).toHaveCount(0);
  const after = await page.evaluate(async () => (await (await fetch('/api/me/vessel-workspace')).json()));
  expect(after.workspace.watchlist).toContain(vessel.id);
  expect(after.workspace.voyages[0].vesselId).toBe(vessel.id);
  expect(after.destinations[vessel.id]).toBe('ais');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('genforecast.vessel-workspace.v1')!))).toEqual(legacy);
});
