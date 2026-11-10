import { test, expect } from './auth-fixture';
import type { Page, Route } from '@playwright/test';

// 백엔드 POST /api/berth-plan/recommend 실제 응답 형태(plan.py)를 따른 고정 응답.
// 고정 점유 행은 eta·tonnes·체선 값이 null이다.
type Row = Record<string, unknown>;
const T = (day: number, hour: number) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`;
const fixedRow: Row = { voyage_no: 'F', voyage_number: 'V-F01', vessel_name: '고정호', yard: '1', berth_id: 'BD-1', eta: null, berth_at: T(10, 9), unload_end: T(10, 20), tonnes: null, demurrage_hours: null, demurrage_usd: null, reasons: [], changed: false, fixed: true };
const row = (no: string, yard: string, berth: string, eta: string, at: string, end: string, hours: number, usd: number, extra: Row = {}): Row => ({
  voyage_no: no, voyage_number: `V-${no}`, vessel_name: `선박 ${no}`, yard, berth_id: berth, eta, berth_at: at, unload_end: end,
  tonnes: 80000, demurrage_hours: hours, demurrage_usd: usd, reasons: [], changed: true, fixed: false, ...extra,
});
const kpis = (hours: number, usd: number, minDays: number | null, delta?: number) => ({ demurrage_hours: hours, demurrage_usd: usd, min_days: minDays, caution_days: 2, danger_days: 1, ...(delta === undefined ? {} : { demurrage_usd_delta: delta }) });

const optionA = { id: 'A', rank: 2, label: 'A. 체선 최소', merged: ['A'], status: 'optimal', gap_pct: 0, message: null, kpis: kpis(4, 4000, 6.5, -4000), warnings: [], assignments: [
  fixedRow,
  row('001', '1', 'BD-1', T(10, 12), T(10, 20), T(11, 10), 8, 8000, { reasons: ['berth_busy'] }),
  row('002', '2', 'BD-2', T(11, 6), T(11, 6), T(11, 22), 0, 0),
  row('003', '3', 'BD-3', T(12, 0), T(12, 4), T(12, 22), 4, 4000, { reasons: ['outage'] }),
] };
const optionB = { id: 'B', rank: 1, label: 'B. 균형', merged: ['B'], status: 'optimal', gap_pct: 0, message: null, kpis: kpis(6, 6000, null, -2000), warnings: [], assignments: [
  fixedRow,
  row('001', '1', 'BD-2', T(10, 12), T(10, 12), T(11, 2), 0, 0),
  row('002', '2', 'BD-3', T(11, 6), T(11, 9), T(12, 1), 3, 3000, { reasons: ['stock_priority:V-001'] }),
  row('003', '3', 'BD-3', T(12, 0), T(12, 3), T(12, 21), 3, 3000),
] };
const optionC = { id: 'C', rank: 3, label: 'C. 재고 우선', merged: ['C'], status: 'time_limit', gap_pct: 1.5, message: null, kpis: kpis(9, 9000, 7.25, 1000), warnings: ['위험 기준을 지킬 수 없음'], assignments: optionB.assignments };
const current = { label: '현재 계획', kpis: kpis(8, 8000, 5), assignments: [
  fixedRow,
  { ...row('001', '1', 'BD-1', T(10, 12), T(10, 20), T(11, 10), 8, 8000), changed: false },
  { ...row('002', '2', 'BD-2', T(11, 6), T(11, 6), T(11, 22), 0, 0), changed: false },
  { ...row('003', '3', 'BD-3', T(12, 0), T(12, 0), T(12, 18), 0, 0), changed: false },
] };
const plan = (extra: Row = {}) => ({
  as_of: T(10, 9), horizon_days: 14, source: { berths: 'dummy', voyages: 'registry', stock: 'supply_ledger' },
  assumptions: ['부두 능력: 시연용 가정값', 'ETA 기산 가정', '벌점 단가 20,000 USD/그룹·일(가정값)'],
  gaps: [{ kind: 'no_demurrage', voyage_no: 'V-002', message: '체선료 단가 없음 · 체선료 계산에서 제외' }, { kind: 'no_specs', voyage_no: null, message: '선형 제한 미적용(선박 제원 없음)' }],
  message: null, current, options: [optionA, optionB, optionC],
  berths: [{ id: 'BD-1', yards: ['1', '2'] }, { id: 'BD-2', yards: ['2', '3'] }, { id: 'BD-3', yards: ['3'] }],
  outages: [{ berth: 'BD-2', start: T(13, 8), end: T(14, 20) }],
  ...extra,
});
const stacking = { as_of: T(10, 9), cargo: null, options: [{ rank: 1, placements: [{ yard: 2, target: 'P4', from_m: 0, to_m: 120, tonnes: 80000 }], reasons: [], warnings: [], assumptions: [] }], no_fit: null, gaps: [], blocked: null };

async function mockPlan(page: Page, respond: (route: Route, body: Row) => unknown = route => route.fulfill({ json: plan() })) {
  const bodies: Row[] = [];
  await page.route('**/api/berth-plan/recommend', route => { const body = route.request().postDataJSON(); bodies.push(body); return respond(route, body); });
  return bodies;
}
async function openTab(page: Page) {
  await page.goto('/#simulation');
  await page.getByRole('button', { name: '접안 추천', exact: true }).click();
}
const cards = (page: Page) => page.locator('.gf-bp-card');
const tableRow = (page: Page, voyage: string) => page.locator('.gf-bp-table tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${voyage}$`) }) });

test('탭 진입: 현재 계획과 순위순 안 카드, 추천 표시, 가정값 안내', async ({ page }) => {
  const bodies = await mockPlan(page);
  await openTab(page);
  await expect(page.getByRole('button', { name: '접안 추천', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '저장된 발전·수급 계획' })).toHaveAttribute('aria-pressed', 'false');
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).locator('.gf-bp-card-title')).toHaveText(['현재 계획', 'B. 균형', 'A. 체선 최소', 'C. 재고 우선']);
  await expect(cards(page).filter({ hasText: '추천' })).toHaveCount(1);
  await expect(cards(page).nth(1)).toContainText('추천');
  await expect(cards(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  // 모의·시연 문구는 상단 공통 모드 표시 한 곳에만 둔다(AGENTS.md). 벌점 단가 옆 가정값 칩만 남는다.
  await expect(page.getByText('부두 능력 시연용 가정값')).toHaveCount(0);
  await expect(page.locator('.gf-bp-query .gf-bp-tag')).toHaveText('가정값');
  // 빈 값은 0이 아니라 "미확인", 시간 제한 안은 최선해와 차이를 보인다.
  await expect(cards(page).nth(1)).toContainText('미확인');
  await expect(cards(page).nth(3)).toContainText('최선해 · 차이 1.5%');
  await expect(cards(page).nth(3)).toContainText('위험 기준을 지킬 수 없음');
  await expect(cards(page).nth(2)).toContainText('-4,000 USD');
  await expect(page.locator('.gf-bp-asof')).toContainText('11-10 09:00');
  // 개발 모드 StrictMode의 이중 마운트로 첫 요청이 취소될 수 있어 마지막 요청만 본다.
  expect(bodies.at(-1)).toEqual({ horizon_days: 14, penalty_usd: 20000 });
  // 고정 점유 행: "고정" 표시, 적치 추천 버튼 없음, 회색 막대.
  const fixed = tableRow(page, 'V-F01');
  await expect(fixed).toContainText('고정');
  await expect(fixed.getByRole('button', { name: '적치 추천' })).toHaveCount(0);
  await expect(page.locator('.gf-bp-gantt .gf-bp-bar-fixed')).toHaveCount(1);
});

test('카드 전환: A 카드를 누르면 표와 간트가 A안으로 바뀐다', async ({ page }) => {
  await mockPlan(page);
  await openTab(page);
  await expect(tableRow(page, 'V-001')).toContainText('BD-2');
  await expect(tableRow(page, 'V-001')).toContainText('11-10 12:00');
  await cards(page).filter({ hasText: 'A. 체선 최소' }).click();
  await expect(cards(page).filter({ hasText: 'A. 체선 최소' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tableRow(page, 'V-001')).toContainText('BD-1');
  await expect(tableRow(page, 'V-001')).toContainText('11-10 20:00');
  await expect(tableRow(page, 'V-001')).toContainText('부두 모두 사용 중');
  await expect(page.locator('.gf-bp-gantt .gf-bp-bar')).toHaveCount(optionA.assignments.length);
  // 현재 계획 막대는 겹쳐 그린다.
  await expect(page.locator('.gf-bp-gantt .gf-bp-ghost')).toHaveCount(current.assignments.length);
  await cards(page).filter({ hasText: '현재 계획' }).click();
  await expect(tableRow(page, 'V-003')).toContainText('11-12 00:00');
  await expect(page.locator('.gf-bp-gantt .gf-bp-ghost')).toHaveCount(0);
});

test('간트: 안이 부두 2개만 써도 부두 3줄과 정비 빗금을 그린다', async ({ page }) => {
  const twoBerths = { ...optionB, assignments: optionB.assignments.filter(a => a.berth_id !== 'BD-2') };
  await mockPlan(page, route => route.fulfill({ json: plan({ current: null, options: [twoBerths] }) }));
  await openTab(page);
  const gantt = page.locator('.gf-bp-gantt');
  await expect(gantt.locator('[data-berth]')).toHaveCount(3);
  await expect(gantt.locator('[data-berth]')).toHaveText(['BD-1', 'BD-2', 'BD-3']);
  await expect(gantt.locator('.gf-bp-bar[data-on="BD-2"]')).toHaveCount(0);
  await expect(gantt.locator('.gf-bp-outage')).toHaveCount(1);
  await expect(gantt.locator('.gf-bp-outage')).toHaveAttribute('data-on', 'BD-2');
  await expect(page.locator('.gf-bp-legend')).toContainText('정비');
});

test('합친 안: 세 안이 같으면 한 장의 카드로 보인다', async ({ page }) => {
  await mockPlan(page, route => route.fulfill({ json: plan({ options: [{ ...optionB, label: '세 안 같음 · 체선·재고 차이 없음', merged: ['B', 'A', 'C'] }] }) }));
  await openTab(page);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(1).getByText('세 안 같음 · 체선·재고 차이 없음')).toBeVisible();
});

test('해 없음 안은 숫자 없이 이유를 보인다', async ({ page }) => {
  await mockPlan(page, route => route.fulfill({ json: plan({ options: [optionB, { ...optionA, status: 'infeasible', kpis: null, message: '고정 조건과 부두 일정이 겹칩니다', assignments: [fixedRow] }] }) }));
  await openTab(page);
  const card = cards(page).filter({ hasText: 'A. 체선 최소' });
  await expect(card).toContainText('해 없음');
  await expect(card).toContainText('고정 조건과 부두 일정이 겹칩니다');
  await expect(card).not.toContainText('USD');
});

test('적치 추천 열기: 항차번호로 호출해 적치 추천을 행 아래에 보인다', async ({ page }) => {
  await mockPlan(page);
  const stackBodies: Row[] = [];
  await page.route('**/api/stacking/recommend', route => { stackBodies.push(route.request().postDataJSON()); return route.fulfill({ json: stacking }); });
  await openTab(page);
  await tableRow(page, 'V-002').getByRole('button', { name: '적치 추천' }).click();
  await expect(page.locator('.gf-bp-table')).toContainText('2저탄장 P4 · 0~120 m');
  expect(stackBodies).toEqual([{ voyage_no: '002' }]);
});

test('적치 추천 실패 시 오류 문구를 보인다', async ({ page }) => {
  await mockPlan(page);
  await page.route('**/api/stacking/recommend', route => route.fulfill({ status: 422, json: { detail: '항차 화물 정보 없음' } }));
  await openTab(page);
  await tableRow(page, 'V-002').getByRole('button', { name: '적치 추천' }).click();
  await expect(page.locator('.gf-bp-table')).toContainText('항차 화물 정보 없음');
});

test('가정·빠진 자료: 접힘 칸을 열면 가정과 gaps 문구가 보인다', async ({ page }) => {
  await mockPlan(page);
  await openTab(page);
  const details = page.locator('details.gf-bp-notes');
  await expect(details.getByText('체선료 단가 없음 · 체선료 계산에서 제외')).toBeHidden();
  await details.locator('summary').click();
  await expect(details.getByText('V-002: 체선료 단가 없음 · 체선료 계산에서 제외')).toBeVisible();
  await expect(details.getByText('선형 제한 미적용(선박 제원 없음)')).toBeVisible();
  await expect(details.getByText('ETA 기산 가정')).toBeVisible();
});

test('오류 시 카드 없음: 500 응답이면 오류 문구만 보이고 숫자 0을 그리지 않는다', async ({ page }) => {
  await mockPlan(page, route => route.fulfill({ status: 500, json: { detail: '내부 오류(서버 로그 확인)' } }));
  await openTab(page);
  await expect(page.getByRole('alert')).toContainText('내부 오류(서버 로그 확인)');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.gf-bp-gantt')).toHaveCount(0);
  await expect(page.locator('.gf-bp-table')).toHaveCount(0);
  const text = await page.locator('.gf-bp-page').innerText();
  expect(text).not.toMatch(/(^|[^\d.,])0([^\d.,]|$)/);
});

test('빈 결과: 대상 항차가 없으면 안내 문구만 보인다', async ({ page }) => {
  await mockPlan(page, route => route.fulfill({ json: plan({ current: null, options: [], message: '기간 안 입항 예정 선박 없음' }) }));
  await openTab(page);
  await expect(page.getByText('기간 안 입항 예정 선박 없음')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('.gf-bp-gantt')).toHaveCount(0);
});

test('다시 계산: 기간 7일로 다시 계산하면 요청 본문이 바뀐다', async ({ page }) => {
  const bodies = await mockPlan(page);
  await openTab(page);
  await expect(cards(page)).toHaveCount(4);
  await page.getByLabel('기간', { exact: true }).selectOption('7');
  await page.getByLabel('벌점 단가 (USD/그룹·일)').fill('30000');
  await page.getByRole('button', { name: '다시 계산' }).click();
  await expect.poll(() => bodies.at(-1)).toEqual({ horizon_days: 7, penalty_usd: 30000 });
  await expect(cards(page)).toHaveCount(4);
  const sent = bodies.length;
  await page.getByLabel('벌점 단가 (USD/그룹·일)').fill('-1');
  await page.getByRole('button', { name: '다시 계산' }).click();
  await expect(page.getByText('벌점 단가는 0 이상의 숫자로 입력하세요')).toBeVisible();
  expect(bodies.length).toBe(sent);
});

test('계산 중에는 진행 표시를 보인다', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await mockPlan(page, async route => { await gate; return route.fulfill({ json: plan() }); });
  await openTab(page);
  await expect(page.locator('.gf-bp-page').getByRole('status')).toContainText('접안 계획 계산 중');
  release();
  await expect(cards(page)).toHaveCount(4);
});

test('레이아웃: 다크 테마, 390px 폭, 1920×1080 첫 화면', async ({ page }) => {
  await mockPlan(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('ewp-theme', 'dark'));
  await openTab(page);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(cards(page).first()).toBeVisible();
  const bg = await cards(page).first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const scroll = page.locator('.gf-bp-gantt-scroll');
  expect(await scroll.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');

  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const target of [cards(page).last(), page.locator('.gf-bp-gantt')]) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
  }
});
