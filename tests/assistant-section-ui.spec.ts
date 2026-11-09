import { test, expect, type Page } from '@playwright/test';

// assistant-ui.spec.ts와 같은 방식: 격리된 테스트 서버(8097)로 /api를 보내고 test-admin으로 로그인한다.
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

const COMMON_EXAMPLES = [
  '지금 당진 부두 앞에서 기다리는 배는?',
  '재고일수가 가장 낮은 저탄장은?',
  '다음 주 입항 예정 항차를 알려 줘',
];

test('empty panel shows status and examples', async ({ page }) => {
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#overview');
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await expect(panel.getByText('연결됨', { exact: true })).toBeVisible();
  const examples = panel.locator('.gf-asst-example');
  await expect(examples).toHaveCount(3);
  await expect(examples).toHaveText(COMMON_EXAMPLES);
});

test('llm off', async ({ page }) => {
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: false } }));
  await loginAndOpen(page, '/#overview');
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await expect(panel.getByText('도우미가 연결되지 않았습니다 · 관리자에게 오픈AI 설정을 확인해 달라고 요청하세요')).toBeVisible();
  await expect(panel.getByLabel('질문', { exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '보내기' })).toBeDisabled();
  await expect(panel.locator('.gf-asst-example').first()).toBeDisabled();
});

test('example question sends', async ({ page }) => {
  const asked: { question: string }[] = [];
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/ask', async r => {
    asked.push(r.request().postDataJSON());
    await r.fulfill({ json: { answer: '확인했습니다.', partial: false, proposals: [], gaps: [], tool_calls: [], facts: [] } });
  });
  await loginAndOpen(page, '/#overview');
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await panel.getByRole('button', { name: COMMON_EXAMPLES[1] }).click();
  await expect(panel.getByText('확인했습니다.')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0].question).toBe(COMMON_EXAMPLES[1]);
  await expect(panel.locator('.gf-asst-example')).toHaveCount(0);
});
