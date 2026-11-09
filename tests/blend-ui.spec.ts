import { test, expect, type Page } from '@playwright/test';

// assistant-section-ui.spec.ts와 같은 방식: 격리된 테스트 서버(8097) + test-admin 로그인 + page.route 가로채기.
async function loginAndOpen(page: Page, path: string, width = 1920) {
  await page.context().route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = '8097';
    const response = await route.fetch({ url: url.href });
    await route.fulfill({ response });
  });
  await page.setViewportSize({ width, height: 1080 });
  await page.goto(path);
  await page.getByLabel('아이디', { exact: true }).fill('test-admin');
  await page.getByLabel('비밀번호', { exact: true }).fill('only-for-isolated-ui-tests-2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '운영 질문하기' })).toBeVisible();
}

const BASELINE = {
  revision: 1, as_of: '2026-11-04', total_t: 600,
  lots: [
    { source_id: 'L-A', location: 'P1', coal_name: '검증탄 A', tonnes: 200, voyage_number: 'V-1', grade: '저열량', age_days: 5 },
    { source_id: 'L-B', location: 'P2', coal_name: '검증탄 B', tonnes: 150, voyage_number: 'V-2', grade: '고열량', age_days: 5 },
    { source_id: 'L-C', location: 'A1', coal_name: '검증탄 C', tonnes: 250, voyage_number: 'V-3', grade: '', age_days: 5 },
  ],
};

async function mockBlend(page: Page, lots: Record<string, unknown> | null = null) {
  await page.route('**/api/voyage-registry/inventory/baseline', r => r.fulfill({ json: BASELINE }));
  await page.route('**/api/voyage-registry/inventory', r => r.fulfill({ json: { revision: 0, lots: [] } }));
  await page.route('**/api/voyage-registry/records', r => r.fulfill({ json: { revision: 0, voyages: [], cargo: [] } }));
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/checks?**', r => r.fulfill({
    json: { screen: 'blend', as_of: '2026-11-10T09:00:00+09:00', items: [], errors: [], ...(lots ? { details: { lots } } : {}) },
  }));
}

const PILE_WORDING = /더미(를|\s*선택|\s*목록)|대상 더미/;

test('no pile-dummy wording', async ({ page }) => {
  await mockBlend(page);
  await loginAndOpen(page, '/#blend');
  await expect(page.getByRole('heading', { level: 1, name: '상탄·혼탄' })).toBeVisible();
  await expect(page.getByText('원탄을 선택하세요.')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(PILE_WORDING);
  await page.getByRole('button', { name: '혼탄 분석', exact: true }).click();
  await expect(page.getByText('혼탄 대상 원탄')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(PILE_WORDING);
  await page.goto('/#yard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(PILE_WORDING);
});

for (const width of [1920, 390]) {
  test(`blend checkbox inline ${width}`, async ({ page }) => {
    await mockBlend(page, { 'L-A': { grade: '저', gcv_arb: 4200, sulfur_ar: 0.45, tm_ar: 12, dummy: true, reason: null } });
    await loginAndOpen(page, '/#blend', width);
    await page.getByRole('button', { name: '혼탄 분석', exact: true }).click();
    const row = page.locator('.gf-inventory-row').first();
    await expect(row).toBeVisible();
    const box = await row.locator('input[type=checkbox]').boundingBox();
    await expect(row).toContainText('황분 0.45%');
    const name = await row.getByText('검증탄 A').boundingBox();
    expect(Math.abs(box!.y - name!.y)).toBeLessThanOrEqual(8);
    expect(box!.x).toBeLessThan(name!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('no range bar in blend analysis', async ({ page }) => {
  await mockBlend(page);
  await loginAndOpen(page, '/#blend');
  await page.getByRole('button', { name: '혼탄 분석', exact: true }).click();
  await expect(page.getByText('조회 범위')).toHaveCount(0);
  await page.goto('/#fuel');
  await expect(page.getByText('조회 범위').first()).toBeVisible();
});

test('blend row shows quality', async ({ page }) => {
  await mockBlend(page, {
    'L-A': { grade: '저', gcv_arb: 4200, sulfur_ar: 0.45, tm_ar: 12, dummy: false, reason: null },
    'L-B': { grade: '고', gcv_arb: 5800, sulfur_ar: 0.5, tm_ar: 10, dummy: true, reason: null },
    'L-C': { grade: null, gcv_arb: null, sulfur_ar: null, tm_ar: null, dummy: false, reason: '화물을 하나로 특정할 수 없음' },
  });
  await loginAndOpen(page, '/#blend');
  await page.getByRole('button', { name: '혼탄 분석', exact: true }).click();
  const rows = page.locator('.gf-inventory-row');
  const a = rows.filter({ hasText: '검증탄 A' });
  await expect(a).toContainText('저열량');
  await expect(a).toContainText('4,200 kcal/kg');
  await expect(a).toContainText('황분 0.45%');
  await expect(a.locator('.gf-inventory-dummy')).toHaveCount(0);
  const b = rows.filter({ hasText: '검증탄 B' });
  await expect(b).toContainText('고열량');
  await expect(b.locator('.gf-inventory-dummy')).toHaveText('더미');
  const c = rows.filter({ hasText: '검증탄 C' });
  await expect(c).toContainText('성분 미확인');
});

test('offline notice once', async ({ page }) => {
  await mockBlend(page);
  await loginAndOpen(page, '/#blend');
  await expect(page.getByRole('group', { name: '보일러 선택' })).toBeVisible();
  const count = (await page.locator('main').innerText()).split('운전 미연결').length - 1;
  expect(count).toBeLessThanOrEqual(1);
  const buttons = page.getByRole('group', { name: '보일러 선택' }).getByRole('button');
  await expect(buttons.first()).toHaveText(/^\s*1호기\s*$/);
});
