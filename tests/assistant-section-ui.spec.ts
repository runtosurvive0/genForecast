import { test, expect, type Page } from '@playwright/test';
import { planningFixture } from './planning-fixture';

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

// ---- 과제 7: 5개 화면에 도우미 섹션 배치 ----
const SCREENS = [
  { hash: '#blend', screen: 'blend' },
  { hash: '#forecast', screen: 'forecast' },
  { hash: '#simulation', screen: 'simulation' },
  { hash: '#data', screen: 'planning_input' },
  { hash: '#scenario', screen: 'scenario' },
] as const;

function checksBody(screen: string, title = `${screen} 빠진 자료`) {
  return {
    screen, as_of: '2026-11-10T09:00:00+09:00', errors: [],
    items: [{ id: `${screen}-m`, kind: 'missing', title, detail: '', count: 2, targets: [{ label: '대상 가', reason: '값 없음' }], action: { page: 'data', label: '입력 화면으로' } }],
  };
}

async function mockChecks(page: Page, seen: string[] = []) {
  await page.route('**/api/assistant/checks?**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    await route.fulfill({ json: checksBody(url.searchParams.get('screen')!) });
  });
}

async function mockPlanning(page: Page) {
  await page.route('**/api/runs', r => r.fulfill({ json: [{ id: 'sim-run', name: '월간 전망', period: '2027-01-01 ~ 2027-12-31' }] }));
  await page.route('**/api/planning/runs/sim-run/snapshot?**', r => r.fulfill({ json: planningFixture('sim-run') }));
}

async function gotoScreen(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  if (hash === '#data') await page.getByRole('tab', { name: '전망 입력·계산' }).click();
}

test('section on five screens', async ({ page }) => {
  const seen: string[] = [];
  await mockChecks(page, seen);
  await mockPlanning(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#blend');
  for (const { hash, screen } of SCREENS) {
    await gotoScreen(page, hash);
    await expect(page.getByRole('region', { name: '도우미' })).toBeVisible();
    await expect.poll(() => seen.some(s => new URLSearchParams(s).get('screen') === screen)).toBe(true);
  }
  expect(seen.some(s => new URLSearchParams(s).get('run_id') === 'sim-run')).toBe(true);
});

test('missing item expanded', async ({ page }) => {
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#scenario');
  const section = page.getByRole('region', { name: '도우미' });
  await expect(section.getByText('scenario 빠진 자료')).toBeVisible();
  await section.getByRole('button', { name: '대상 보기' }).click();
  await expect(section.getByText('대상 가')).toBeVisible();
  await section.getByRole('button', { name: '입력 화면으로' }).click();
  await expect(page).toHaveURL(/#data$/);
});

test('question sends context', async ({ page }) => {
  const asked: { question: string; context?: { screen: string; selection?: Record<string, unknown> } }[] = [];
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/ask', async r => {
    asked.push(r.request().postDataJSON());
    await r.fulfill({ json: { answer: '확인했습니다.', partial: false, proposals: [], gaps: [], tool_calls: [], facts: [] } });
  });
  await loginAndOpen(page, '/#blend');
  await page.getByRole('region', { name: '도우미' }).getByRole('button', { name: '지금 저열량탄 재고가 많은 저탄장은?' }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await expect(panel.getByText('확인했습니다.')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0].context?.screen).toBe('blend');
  expect(asked[0].context?.selection?.yard).toBe(1);
  await expect(panel.getByText('상탄·혼탄 · 1계통')).toBeVisible();
});

test('previous yard list is not shown after switching yard', async ({ page }) => {
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/checks?**', async (route) => {
    const url = new URL(route.request().url());
    const yard = url.searchParams.get('yard');
    if (yard === '1') await new Promise(res => setTimeout(res, 1200));
    await route.fulfill({ json: checksBody('blend', `${yard}계통 항목`) }).catch(() => {});
  });
  await loginAndOpen(page, '/#blend');
  await page.getByRole('group', { name: '주 공급 계통 선택' }).getByRole('button').nth(1).click();
  const section = page.getByRole('region', { name: '도우미' });
  await expect(section.getByText('2계통 항목')).toBeVisible();
  await page.waitForTimeout(1600);
  await expect(section.getByText('1계통 항목')).toHaveCount(0);
  await expect(section.getByText('2계통 항목')).toBeVisible();
});

test('llm off disables section questions', async ({ page }) => {
  const asked: unknown[] = [];
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: false } }));
  await page.route('**/api/assistant/ask', async r => { asked.push(r.request().postDataJSON()); await r.abort(); });
  await loginAndOpen(page, '/#blend');
  const section = page.getByRole('region', { name: '도우미' });
  await expect(section.getByText('도우미가 연결되지 않았습니다')).toBeVisible();
  await expect(section.getByRole('button', { name: '지금 저열량탄 재고가 많은 저탄장은?' })).toBeDisabled();
  expect(asked).toHaveLength(0);
});

test('llm off notice and kept question when status turns off after click', async ({ page }) => {
  // 섹션 확인은 켜짐(true)이었다가 창이 다시 확인할 때 꺼짐(false)이 되는 경우: 안내가 보이고 질문이 입력칸에 남는다.
  const asked: unknown[] = [];
  let off = false;
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: !off } }));
  await page.route('**/api/assistant/ask', async r => { asked.push(r.request().postDataJSON()); await r.abort(); });
  await loginAndOpen(page, '/#blend');
  const question = '성분이 빠진 원탄 목록을 정리해 줘';
  await expect(page.getByRole('region', { name: '도우미' }).getByRole('button', { name: question })).toBeEnabled();
  off = true;
  await page.getByRole('region', { name: '도우미' }).getByRole('button', { name: question }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await expect(panel.getByText('도우미가 연결되지 않았습니다 · 관리자에게 오픈AI 설정을 확인해 달라고 요청하세요')).toBeVisible();
  await expect(panel.getByLabel('질문', { exact: true })).toHaveValue(question);
  expect(asked).toHaveLength(0);
});

test('checks error retry', async ({ page }) => {
  let failing = true;
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/checks?**', async (route) => {
    if (failing) return route.fulfill({ status: 500, json: { detail: 'x' } });
    return route.fulfill({ json: checksBody('scenario') });
  });
  await loginAndOpen(page, '/#scenario');
  const section = page.getByRole('region', { name: '도우미' });
  await expect(section.getByText('점검을 불러오지 못했습니다')).toBeVisible();
  failing = false;
  await section.getByRole('button', { name: '다시 시도' }).click();
  await expect(section.getByText('scenario 빠진 자료')).toBeVisible();
});

test('forecast card renamed', async ({ page }) => {
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#forecast');
  await expect(page.getByRole('complementary', { name: '조건 해석' })).toBeVisible();
  await expect(page.getByText('AI 어시스턴트')).toHaveCount(0);
});

test('data page panel examples follow the planning input tab', async ({ page }) => {
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#data');
  await page.getByRole('tab', { name: '전망 입력·계산' }).click();
  await page.getByRole('button', { name: '운영 질문하기' }).click();
  const panel = page.getByRole('complementary', { name: '운영 도우미' });
  await expect(panel.locator('.gf-asst-example').first()).toHaveText('이 입력에서 빠진 값이 뭐야?');
});

test('section 390 dark', async ({ page }) => {
  await mockChecks(page);
  await mockPlanning(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#blend');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate((m) => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
    for (const { hash } of SCREENS) {
      await gotoScreen(page, hash);
      await expect(page.getByRole('region', { name: '도우미' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  }
});

test('blend stage keeps its height when checks are hidden (403)', async ({ page }) => {
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/checks?**', r => r.fulfill({ status: 403, json: { detail: 'x' } }));
  await loginAndOpen(page, '/#blend');
  await expect(page.getByRole('region', { name: '도우미' })).toHaveCount(0);
  const stage = page.getByRole('region', { name: '상탄·분배 계통' });
  await expect(stage).toBeVisible();
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(300);
  await page.setViewportSize({ width: 1000, height: 900 });
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(300);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(300);
});

test('blend stage height holds with the section shown at 390 and 1000', async ({ page }) => {
  await mockChecks(page);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#blend');
  await expect(page.getByRole('region', { name: '도우미' })).toBeVisible();
  const stage = page.getByRole('region', { name: '상탄·분배 계통' });
  for (const width of [1920, 1000, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(300);
  }
});

test('forecast live param follows demo status and planning input sends input_id', async ({ page }) => {
  const seen: string[] = [];
  await mockChecks(page, seen);
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await loginAndOpen(page, '/#forecast');
  await expect(page.getByRole('region', { name: '도우미' })).toBeVisible();
  // 운전 모사가 연결되지 않은 시험 환경에서는 live를 보내지 않는다.
  await expect.poll(() => seen.some(s => new URLSearchParams(s).get('screen') === 'forecast')).toBe(true);
  expect(seen.filter(s => s.includes('screen=forecast')).every(s => !new URLSearchParams(s).has('live'))).toBe(true);

  await page.route('**/api/planning/inputs', r => r.fulfill({ json: [{ id: 5, name: '저장 조건', start: '2027-01-01', end: '2027-12-31', recorded_at: '2026-11-01' }] }));
  await page.route('**/api/planning/inputs/5', r => r.fulfill({ json: { id: 5, payload: { scenario: { name: '저장 조건', start: '2027-01-01', end: '2027-12-31', weather: 'normal', demand_growth_pct: null, solar_growth_pct: null, coal_adjust_pct: Array(12).fill(0), reserve_ratio: 0.12, quality: 'normal', workers: null, coal_oh: [], nuclear_oh: [] }, heat_prices: { 당진1: Array(12).fill(30000) }, fuel: { calorific_kcal_kg: 5500, is_assumption: true } } } }));
  await page.route('**/api/planning/executions', r => r.fulfill({ json: [] }));
  await page.route('**/api/job', r => r.fulfill({ json: { state: 'idle' } }));
  seen.length = 0;
  await gotoScreen(page, '#data');
  await page.getByLabel('기준으로 가져올 입력').selectOption('5');
  await expect.poll(() => seen.some(s => new URLSearchParams(s).get('input_id') === '5')).toBe(true);
});
