import { test, expect, type Page } from '@playwright/test';

// 기존 UI 스펙(voyage-registry-ui.spec.ts)과 같은 방식: 격리된 테스트 서버(8097)로 /api를 보내고 test-admin으로 로그인한다.
async function loginAndOpen(page: Page, path: string) {
  await page.context().route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = '8097';
    const response = await route.fetch({ url: url.href });
    await route.fulfill({ response });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(path);
  await page.getByLabel('아이디', { exact: true }).fill('test-admin');
  await page.getByLabel('비밀번호', { exact: true }).fill('only-for-isolated-ui-tests-2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '운영 질문하기' })).toBeVisible();
}

test('운영 질문 패널은 답·근거·확인 필요를 보여 주고 다른 쓰기 API를 부르지 않는다', async ({ page }) => {
  let writes = 0;
  page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/api/') && !/\/api\/(assistant\/ask|auth\/)/.test(r.url())) writes++; });
  await page.route('**/api/assistant/ask', r => r.fulfill({ json: {
    answer: '5~8호기 최소 재고일수는 4.3일입니다.', partial: false,
    proposals: [{ label: '반입 계획 검토', action: 'open_procurement' }], gaps: ['9~10호기 기준재고 미등록'],
    tool_calls: [{ id: 'c1', name: 'stock_snapshot', arguments: {}, ok: true }],
    facts: [{ label: '5~8호기 최소 재고일수', value: 4.27, unit: '일', as_of: '2026-11-08T21:00:00Z', source: 'simulation', tool_call_id: 'c1' }] } }));
  await loginAndOpen(page, '/#overview');
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  await page.getByLabel('질문', { exact: true }).fill('5~8호기 재고일수는?');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByText('5~8호기 최소 재고일수는 4.3일입니다.')).toBeVisible();
  const row = page.getByRole('row', { name: /5~8호기 최소 재고일수/ });
  await expect(row).toContainText('2026-11-09 06:00');
  await expect(row).toContainText('가정 계산');
  await expect(row).toContainText('4.27');
  await expect(page.getByText('9~10호기 기준재고 미등록')).toBeVisible();
  await expect(page.getByRole('button', { name: '반입 계획 검토' })).toHaveCount(0);
  expect(writes).toBe(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // 패널은 fixed라 문서 폭만으로는 넘침을 알 수 없다. 답(근거 표 포함)이 보이는 상태에서 패널 자체를 검사한다.
  const fits = await page.evaluate(() => {
    const panel = document.querySelector('.gf-asst-panel') as HTMLElement;
    const log = document.querySelector('.gf-asst-log') as HTMLElement;
    return {
      panelScroll: panel.scrollWidth <= panel.clientWidth + 1,
      logScroll: log.scrollWidth <= log.clientWidth + 1,
      inside: panel.getBoundingClientRect().right <= innerWidth + 1,
    };
  });
  expect(fits).toEqual({ panelScroll: true, logScroll: true, inside: true });
});

test('도우미를 쓸 수 없으면 패널에 이유를 보여 준다', async ({ page }) => {
  await page.route('**/api/assistant/ask', r => r.fulfill({ status: 503, json: { detail: '도우미가 설정되지 않았습니다' } }));
  await loginAndOpen(page, '/#overview');
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  await page.getByLabel('질문', { exact: true }).fill('q');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByRole('complementary', { name: '운영 도우미' }).getByRole('alert')).toContainText('도우미가 설정되지 않았습니다');
});

test('패널을 닫았다 열어도 대화가 남고 Escape로 닫으면 버튼으로 포커스가 돌아온다', async ({ page }) => {
  await page.route('**/api/assistant/ask', r => r.fulfill({ json: {
    answer: '확인했습니다.', partial: true, proposals: [], gaps: [], tool_calls: [], facts: [] } }));
  await loginAndOpen(page, '/#overview');
  const opener = page.getByRole('button', { name: '운영 질문하기' });
  await opener.click();
  await expect(page.getByLabel('질문', { exact: true })).toBeFocused();
  await page.getByLabel('질문', { exact: true }).fill('안녕');
  await page.getByLabel('질문', { exact: true }).press('Control+Enter');
  await expect(page.getByText('확인했습니다.')).toBeVisible();
  await expect(page.getByText('일부만 확인됨')).toBeVisible();
  await expect(page.getByText('근거', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(page.getByText('확인했습니다.')).toBeVisible();
});
