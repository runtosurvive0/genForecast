import { test, expect } from './auth-fixture';
import type { Page } from '@playwright/test';
import { planningFixture, suppliedPlanningFixture } from './planning-fixture';

// 과제 9(수급 예측·통합 시뮬레이션·전망 입력·시나리오 화면 정리 7~12번).
// auth-fixture가 모든 /api를 503으로 막고 로그인 응답만 준다. 필요한 응답은 page.route로 가로챈다.

const scenario = { name: '2026년 11월+90', start: '2026-11-10', end: '2027-02-07', weather: 'normal', demand_growth_pct: null, solar_growth_pct: null, coal_adjust_pct: Array(12).fill(0), reserve_ratio: .12, quality: 'normal', workers: null, coal_oh: [], nuclear_oh: [] };
const detail = { id: 4, payload: { scenario, heat_prices: { 당진1: Array(12).fill(30000) }, fuel: { calorific_kcal_kg: 5500, is_assumption: true } } };
// 같은 이름 두 건(번호·기록 시각만 다름)
const twinInputs = [
  { id: 4, name: scenario.name, start: scenario.start, end: scenario.end, recorded_at: '2026-11-09T18:09:30+00:00' },
  { id: 3, name: scenario.name, start: scenario.start, end: scenario.end, recorded_at: '2026-11-08T03:00:00+00:00' },
];
const RUN_A = '20261110-031444-322005-2026년11월90';
const RUN_B = '20261109-101010-111111-2026년11월90';

async function mockInputs(page: Page, executions: unknown[] = []) {
  await page.route('**/api/planning/inputs', r => r.fulfill({ json: twinInputs }));
  await page.route('**/api/planning/inputs/4', r => r.fulfill({ json: detail }));
  await page.route('**/api/planning/inputs/3', r => r.fulfill({ json: { ...detail, id: 3 } }));
  await page.route('**/api/planning/executions', r => r.fulfill({ json: executions }));
  await page.route('**/api/job', r => r.fulfill({ json: { state: 'idle' } }));
}
async function mockRuns(page: Page, issues?: string[]) {
  await page.route('**/api/runs', r => r.fulfill({ json: [
    { id: RUN_A, name: scenario.name, period: `${scenario.start} ~ ${scenario.end}` },
    { id: RUN_B, name: scenario.name, period: `${scenario.start} ~ ${scenario.end}` },
  ] }));
  await page.route('**/api/planning/runs/*/snapshot?**', r => {
    const url = new URL(r.request().url());
    const run = decodeURIComponent(url.pathname.split('/')[4]);
    const snapshot = planningFixture(run, url.searchParams.get('start') ?? undefined, Number(url.searchParams.get('horizon') ?? 30));
    if (issues) snapshot.issues = issues;
    return r.fulfill({ json: snapshot });
  });
}
const optionTexts = (page: Page, name: string) => page.getByLabel(name, { exact: true }).locator('option').allInnerTexts();

test('7. 수급 예측 차트 제목은 한 줄이고 차트 위 표시가 겹치지 않는다', async ({ page }) => {
  for (const width of [1100, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#forecast');
    const title = page.locator('.dfc-panel h2', { hasText: '저탄장별 재고일수' });
    await expect(title).toBeVisible();
    await expect(page.locator('.dfc-ref-label').first()).toBeVisible();
    const lines = await title.evaluate(el => el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight));
    expect(lines, `${width}px 제목 줄 수`).toBeLessThanOrEqual(1.5);
    const overlaps = await page.locator('.dfc-chart').evaluateAll(charts => charts.flatMap(chart => {
      const boxes = [...chart.querySelectorAll('.dfc-ref-label')].map(el => ({ text: el.textContent, box: el.getBoundingClientRect() }));
      const found: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box, b = boxes[j].box;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) found.push(`${boxes[i].text} / ${boxes[j].text}`);
      }
      return found;
    }));
    expect(overlaps, `${width}px 겹친 표시`).toEqual([]);
  }
});

test('8. 같은 이름의 계획·입력도 선택 목록에서 서로 다르게 보인다', async ({ page }) => {
  await mockRuns(page);
  await mockInputs(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#simulation');
  await expect(page.getByLabel('저장된 MILP 계산')).toBeVisible();
  await expect(page.getByLabel('저장된 MILP 계산').locator('option')).toHaveCount(2);
  const runs = await optionTexts(page, '저장된 MILP 계산');
  expect(new Set(runs).size).toBe(2);
  expect(runs.join('|')).not.toContain('undefined');
  expect(runs[0]).toContain('11-10 03:14 KST');
  await page.getByRole('tab', { name: '조건 설정', exact: true }).click();
  await expect(page.getByLabel('기준으로 가져올 입력').locator('option')).toHaveCount(3);
  const inputs = (await optionTexts(page, '기준으로 가져올 입력')).filter(t => t.startsWith('#'));
  expect(new Set(inputs).size).toBe(2);
  expect(inputs[0]).toBe('#4 2026년 11월+90 · 2026-11-10 ~ 2027-02-07 · 11-10 03:09 KST');
  // 전망 입력·계산(데이터 화면)의 DB 입력 세트 목록
  await page.goto('/#data');
  await page.getByRole('tab', { name: '전망 입력·계산' }).click();
  await expect(page.getByLabel('DB 입력 세트').locator('option')).toHaveCount(3);
  const sets = (await optionTexts(page, 'DB 입력 세트')).filter(t => t.startsWith('#'));
  expect(new Set(sets).size).toBe(2);
  expect(sets[0]).toContain('11-10 03:09 KST');
});

test('9. 실행 이력 제목은 입력 이름과 실행 시각이고 식별자는 보조 글자다', async ({ page }) => {
  const execution = (id: string) => ({ id, input_id: 4, state: 'done', summary: { scenario, annual: { dangjin_mwh: 1000 }, solve: { window_status: {} } } });
  await mockRuns(page);
  await mockInputs(page, [execution(RUN_A), execution(RUN_B)]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#simulation');
  await page.getByRole('tab', { name: '조건 설정', exact: true }).click();
  const history = page.locator('.forecast-history');
  await history.locator('summary').click();
  const first = history.locator('li').first();
  await expect(first.locator('strong')).toHaveText('2026년 11월+90 · 11-10 03:14 KST');
  await expect(first.locator('strong')).not.toContainText(RUN_A);
  await expect(first.locator('small')).toContainText(RUN_A);
  // 데이터 화면의 실행 이력 표도 같은 규칙
  await page.goto('/#data');
  await page.getByRole('tab', { name: '전망 입력·계산' }).click();
  const row = page.locator('.tower-table tbody tr', { hasText: RUN_A }).first();
  await expect(row.locator('td').first()).toContainText('2026년 11월+90 · 11-10 03:14 KST');
  await expect(row.locator('td').first().locator('small')).toContainText(RUN_A);
});

test('10. 통합 시뮬레이션 문구: 당일 마감 재고, 자기 화면 링크 없음, 하이픈 두 개 없음', async ({ page }) => {
  await mockRuns(page, ['2025-10~12 표본외 검증에서 +15~+40% 과대예측했습니다 -- 월별 석탄목표 보정을 검토하세요.']);
  await mockInputs(page);
  // 재고 값이 있는 계획(값이 없으면 문구가 가려진다)
  await page.route('**/api/planning/runs/*/snapshot?**', r => {
    const url = new URL(r.request().url());
    const snapshot = suppliedPlanningFixture(decodeURIComponent(url.pathname.split('/')[4]), url.searchParams.get('start') ?? undefined, Number(url.searchParams.get('horizon') ?? 30));
    snapshot.issues = ['2025-10~12 표본외 검증에서 +15~+40% 과대예측했습니다 -- 월별 석탄목표 보정을 검토하세요.'];
    return r.fulfill({ json: snapshot });
  });
  await page.route('**/api/assistant/status', r => r.fulfill({ json: { llm: true } }));
  await page.route('**/api/assistant/checks?**', r => r.fulfill({ json: { screen: 'simulation', as_of: '2026-11-10T09:00:00+09:00', errors: [], items: [
    { id: 'sim-s', kind: 'stale', title: '재고 기준 오래됨 -- 갱신 필요', detail: '기준재고가 3일 이상 지났습니다 -- 확인하세요.', count: 1, targets: [], action: null },
  ] } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#simulation');
  await expect(page.getByText('당일 마감 재고', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: '도우미' }).getByRole('button', { name: '도우미', exact: true }).click();
  await expect(page.getByRole('region', { name: '도우미' }).getByText('재고 기준 오래됨. 갱신 필요')).toBeVisible();
  // 접힌 영역의 글자와 접근성 이름까지 포함해 확인한다
  const text = await page.locator('#main-content').evaluate(el => { const copy = el.cloneNode(true) as HTMLElement; copy.querySelectorAll('style, script').forEach(n => n.remove()); return copy.textContent ?? ''; });
  expect(text).not.toContain('일말');
  expect(text).not.toContain('--');
  expect(text).toContain('과대예측했습니다. 월별 석탄목표 보정을 검토하세요.');
  expect(text).toContain('당일 마감 계획 기준');
  await expect(page.locator('#main-content [aria-label*="일말"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /통합 시뮬레이션 열기/ })).toHaveCount(0);
});

// 연도를 넘는 날짜(1~2월)는 다음 해로 보고 순서를 비교한다.
const order = (text: string) => { const m = /(\d{1,2})\. (\d{1,2})\./.exec(text); return m ? (Number(m[1]) <= 2 ? Number(m[1]) + 12 : Number(m[1])) * 100 + Number(m[2]) : 0; };
const TODAY = 1110; // 2026-11-10

test('11. 시나리오 분석 날짜는 오늘(KST) 이후로 옮겨 표시하고 대화상자와 표가 같다', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T01:00:00Z')); // KST 2026-11-10 10:00
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#scenario');
  const card = page.locator('.comparison-card').nth(1);
  await expect(card).toContainText('최초 연료부족 예상');
  expect(order(await card.locator('strong').innerText())).toBeGreaterThan(TODAY);
  expect(order(await card.locator('p b').innerText())).toBeGreaterThan(TODAY);
  const firstTick = await page.locator('.inventory-chart text.chart-axis-label', { hasText: /\d+\. \d+\./ }).first().textContent() ?? '';
  expect(order(firstTick)).toBeGreaterThan(TODAY);
  await expect(page.locator('#main-content')).not.toContainText('10. 22.');
  // 반복 안내 문구는 두지 않는다(모의 표시는 상단 공통 표시 한 곳)
  await expect(page.locator('#main-content')).not.toContainText('시연 표본 ·');
  // 발전본부 상세 대화상자의 연료부족 예측 날짜도 표와 같은 옮긴 날짜다
  const row = page.locator('.operations-table tbody tr').filter({ has: page.locator('.warning-text') }).first();
  const tableDate = (await row.locator('.warning-text').innerText()).trim();
  expect(order(tableDate)).toBeGreaterThan(TODAY);
  await row.locator('.plant-link').click();
  const dialogDate = (await page.getByRole('dialog').locator('.detail-date').innerText()).trim();
  expect(dialogDate).toBe(tableDate);
  expect(order(dialogDate)).toBeGreaterThan(TODAY);
});

test('12. 시나리오 분석은 제목이 하나이고 항상 맨 위에서 열린다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#forecast');
  await expect(page.locator('.dfc-heading h1')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  // 화면 이동 함수를 거치지 않는 해시 변경(뒤로 가기·링크)에서도 맨 위로 열린다
  await page.evaluate(() => { location.hash = '#scenario'; });
  await expect(page.locator('.scenario-layout')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: '시나리오 분석', exact: true })).toHaveCount(1);
  await expect(main.locator('h1, h2').filter({ hasText: /^시나리오 분석$/ })).toHaveCount(1);
  // 자기 화면을 다시 여는 단추도 없다
  await expect(main.getByRole('button', { name: '시나리오 분석', exact: true })).toHaveCount(0);
});

test('시나리오·수급 예측 변경은 390px 다크 모드에서도 가로로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const hash of ['#scenario', '#forecast']) {
    await page.goto('/' + hash);
    await expect(page.locator('#main-content h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
