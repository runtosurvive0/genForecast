import { test, expect } from './auth-fixture';
import { planningFixture, suppliedPlanningFixture } from './planning-fixture';
import { mapStyleFixture } from './map-style-fixture';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngine } = require('../scripts/fuel-demo/demo-engine.cjs');
const { loadCatalog } = require('../scripts/fuel-demo/demo-catalog.cjs');

test('전망 메인에서 DB 조건을 자동으로 불러와 기간만 바꾸고 실행 결과를 연다', async ({page}) => {
  const scenario={name:'저장 조건',start:'2027-01-01',end:'2027-12-31',weather:'normal',demand_growth_pct:null,solar_growth_pct:null,coal_adjust_pct:Array(12).fill(0),reserve_ratio:.12,quality:'normal',workers:null,coal_oh:[{unit:'당진1',start:'2027-02-01',end:'2027-02-03'}],nuclear_oh:[]};
  const detail={id:5,payload:{scenario,heat_prices:{'당진1':Array(12).fill(30000)},fuel:{calorific_kcal_kg:5500,is_assumption:true}}};
  let started=false;
  await page.route('**/api/runs', r=>r.fulfill({json:started?[{id:'new-run',name:'저장 조건',period:'2027-01-01 ~ 2027-02-28'}]:[]}));
  await page.route('**/api/planning/inputs',r=>r.fulfill({json:[{id:5,name:'저장 조건',start:scenario.start,end:scenario.end}]}));
  await page.route('**/api/planning/inputs/5',r=>r.fulfill({json:detail}));
  await page.route('**/api/planning/inputs/upload',r=>{
    const body=r.request().postDataBuffer()!.toString();
    expect(body).toContain('2027-02-28'); expect(body).toContain('2027-02-03'); expect(body).toContain('30000');
    return r.fulfill({json:{...detail,id:6,payload:{...detail.payload,scenario:{...scenario,end:'2027-02-28'}}}});
  });
  await page.route('**/api/job',r=>r.fulfill({json:{state:started?'done':'idle',run_id:started?'new-run':undefined}}));
  await page.route('**/api/planning/executions',r=>r.fulfill({json:started?[{id:'new-run',input_id:6,state:'done',summary:{scenario:{...scenario,end:'2027-02-28'}}}]:[]}));
  await page.route('**/api/run',r=>{expect(r.request().postDataJSON()).toEqual({input_id:6});started=true;return r.fulfill({json:{run_id:'new-run'}})});
  await page.route('**/api/planning/runs/new-run/snapshot?**',r=>r.fulfill({json:suppliedPlanningFixture('new-run','2027-01-01',30)}));
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정',exact:true}).click();
  await expect(page.getByLabel('시작일', {exact:true})).toHaveValue('2027-01-01');
  await expect(page.getByLabel('연료 환산 발열량 (kcal/kg)')).not.toBeVisible();
  await page.getByLabel('종료일',{exact:true}).fill('2027-02-28');
  await page.getByRole('tab',{name:'전망 결과',exact:true}).click();
  await page.getByRole('tab',{name:'조건 설정',exact:true}).click();
  await expect(page.getByLabel('종료일',{exact:true})).toHaveValue('2027-02-28');
  await page.getByRole('button',{name:'저장 후 전망 실행'}).click();
  await expect(page.getByRole('button',{name:'이번 계산 결과 보기'})).toBeVisible();
  await page.getByRole('button',{name:'이번 계산 결과 보기'}).click();
  await expect(page).toHaveURL(/#simulation$/);
  await expect(page.getByRole('tab',{name:'전망 결과',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.gf-forecast-focus')).toContainText('저탄장 재고 전망');
});

test('저장된 입력을 화면에서 수정해 검증 저장하고 전망을 실행한다', async ({page}) => {
  const scenario={name:'기준 계획',start:'2027-01-01',end:'2027-12-31',weather:'normal',demand_growth_pct:null,solar_growth_pct:null,coal_adjust_pct:Array(12).fill(0),reserve_ratio:.12,quality:'normal',workers:null,coal_oh:[{unit:'당진1',start:'2027-02-01',end:'2027-02-03',note:'정비'}],nuclear_oh:[]};
  const detail={id:1,payload:{scenario,heat_prices:{'당진1':Array(12).fill(30000),'당진2':Array(12).fill(31000)},fuel:{calorific_kcal_kg:5500,is_assumption:true}}};
  let started=false;
  await page.route('**/api/planning/inputs',r=>r.fulfill({json:[{id:1,name:'기준 계획',start:scenario.start,end:scenario.end,recorded_at:'2026-11-01'}]}));
  await page.route('**/api/planning/inputs/1',r=>r.fulfill({json:detail}));
  await page.route('**/api/planning/inputs/upload',r=>{const body=r.request().postDataBuffer()!.toString();expect(body).toContain('새 전망');expect(body).toContain('2027-02-03');expect(body).toContain('33000');expect(body).toContain('당진2');return r.fulfill({json:{...detail,id:2}})});
  await page.route('**/api/planning/executions',r=>r.fulfill({json:[]}));
  await page.route('**/api/job',r=>r.fulfill({json:{state:started?'running':'idle'}}));
  await page.route('**/api/run',r=>{expect(r.request().postDataJSON()).toEqual({input_id:2});started=true;return r.fulfill({json:{run_id:'new-run'}})});
  await page.goto('/#data');
  await page.getByRole('tab',{name:'전망 입력·계산'}).click();
  await page.getByLabel('기준으로 가져올 입력').selectOption('1');
  await page.getByLabel('전망 이름').fill('새 전망');
  await page.getByText('호기별 월 열량단가', {exact:false}).click();
  await page.locator('.planning-input-months').last().getByLabel('1월', {exact:true}).fill('33000');
  await page.getByRole('button',{name:'저장 후 전망 실행'}).click();
  await expect(page.getByText(/입력 세트 #2 저장 · 계산 시작/)).toBeVisible();
  expect(started).toBe(true);
});

test('저장된 입력이 없어도 기준 조건으로 화면에서 전망을 작성한다', async ({page}) => {
  const scenario={name:'기본',start:'2027-01-01',end:'2027-12-31',weather:'normal',demand_growth_pct:null,solar_growth_pct:null,coal_adjust_pct:Array(12).fill(0),reserve_ratio:.12,quality:'normal',workers:null,coal_oh:[],nuclear_oh:[]};
  await page.route('**/api/planning/inputs',r=>r.fulfill({json:[]}));
  await page.route('**/api/planning/executions',r=>r.fulfill({json:[]}));
  await page.route('**/api/job',r=>r.fulfill({json:{state:'idle'}}));
  await page.route('**/api/meta',r=>r.fulfill({json:{default_scenario:scenario}}));
  await page.route('**/api/settings',r=>r.fulfill({json:{fuel:{calorific_kcal_kg:5500,is_assumption:true}}}));
  await page.goto('/#data');
  await page.getByRole('tab',{name:'전망 입력·계산'}).click();
  await page.getByLabel('기준으로 가져올 입력').selectOption('0');
  await expect(page.getByLabel('전망 이름')).toHaveValue('기본');
  await expect(page.getByText(/2026년 10월 자료를 12개월에 적용/)).toBeVisible();
  await expect(page.getByRole('button',{name:'저장 후 전망 실행'})).toBeVisible();
});

test('전망에서 계산 흐름을 이해하고 입력 화면과 구매 검토로 이동한다', async ({page}) => {
  const snapshot = suppliedPlanningFixture('검토 계획', '2027-01-01', 30);
  await page.route('**/api/runs', route => route.fulfill({json:[{id:'검토 계획',name:'검토 계획',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**', route => route.fulfill({json:snapshot}));
  await page.route('**/api/planning/inputs', route => route.fulfill({json:[]}));
  await page.route('**/api/planning/executions', route => route.fulfill({json:[]}));
  await page.route('**/api/job', route => route.fulfill({json:{state:'idle'}}));
  await page.goto('/#simulation');
  const flow = page.getByRole('region', {name:'전망이 만들어지는 과정'});
  await expect(flow).toContainText('발전계획 계산');
  await expect(flow).toContainText('연료 사용량·저탄장 재고 전망');
  await expect(page.locator('.gf-forecast-focus')).toContainText('저탄장 재고 전망');
  await page.getByText('저탄장별 수급 상세', {exact:true}).click();
  await expect(page.locator('.fuel-groups')).toContainText('1저탄장');
  await expect(page.locator('main')).not.toContainText('MILP 백엔드');
  await flow.getByRole('tab', {name:'조건 설정'}).click();
  await expect(page).toHaveURL(/#simulation$/);
  await expect(page.getByRole('heading',{name:'저장된 전망 조건이 없습니다'})).toBeVisible();
  await expect(page.getByRole('button',{name:'기준 조건 등록'})).toBeVisible();
  await flow.getByRole('tab', {name:'전망 결과'}).click();
  await page.getByRole('button',{name:'부족 시점·반입 가능 여부 검토'}).click();
  await expect(page).toHaveURL(/#procurement$/);
});

test('수급 원장은 기준재고 DB를 보여주고 이전 표본 선박과 더미를 표시하지 않는다', async ({page}) => {
  await page.route('**/api/voyage-registry/inventory/baseline', route => route.fulfill({json:{revision:1, as_of:'2026-11-04', total_t:300, lots:[
    {source_id:'P1-G1', location:'P1', coal_name:'TEST A', tonnes:100},
    {source_id:'p5-a', location:'P5', coal_name:'TEST B', tonnes:200},
  ]}}));
  await page.goto('/#fuel-ledger');
  await expect(page.getByLabel('저탄장 기준재고')).toContainText('300 t');
  await expect(page.getByLabel('저탄장 기준재고')).toContainText('2026-11-04');
  await expect(page.getByLabel('저탄장 기준재고')).toContainText('1저탄장');
  await expect(page.locator('main')).not.toContainText('Pacific Horizon');
  await expect(page.locator('main')).not.toContainText('운영 원탄');
  expect(await page.locator('main').innerText()).not.toMatch(/더미(를|\s*선택|\s*목록)|대상 더미/);
  await expect(page.getByRole('button', {name:/총 저탄 재고/})).toContainText('0.03');
});

test('운영 화면에서는 시연 자료를 업무 용어로 구분하고 출처 설명이 화면을 가리지 않는다', async ({ page }) => {
  for (const route of ['overview', 'voyages', 'berth', 'yard', 'blend', 'demo-control']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('body')).not.toContainText('사진');
    await expect(page.locator('body')).not.toContainText(/(?<!정)합성/);
  }
  await page.goto('/?source=synthetic#overview');
  await expect(page.locator('body')).toContainText('시연 데이터');
  await expect(page.locator('body')).not.toContainText(/SYNTHETIC|사진|(?<![가-힣])합성/);
});

test('발전 수급 전망은 선택한 날짜의 완전한 자료만 합산한다', async ({ page }) => {
  const snapshot = suppliedPlanningFixture('검증 계산', '2027-01-01', 30);
  snapshot.classification = 'operational';
  snapshot.inventory.daily[2].groups.g14.receipts = 500;
  snapshot.inventory.daily[2].groups.g58.receipts = 0;
  snapshot.inventory.daily[2].groups.g910.receipts = 0;
  await page.route('**/api/runs', route => route.fulfill({ json: [{ id: '검증 계산', name: '검증 계산', period: '2027-01-01 ~ 2027-12-31' }] }));
  await page.route('**/api/planning/**', route => route.fulfill({ json: snapshot }));
  await page.goto('/#simulation');
  const slider = page.getByLabel('날짜 선택');
  await expect(slider).toBeVisible();
  await slider.fill('2');
  await expect(slider).toHaveAttribute('aria-valuetext', '2027-01-03');
  await expect(page.locator('.gf-forecast-day-values')).toContainText('284,000 t');
  await expect(page.locator('.gf-forecast-day-values')).toContainText('500 t');
  await expect(page.locator('.gf-forecast-day-values')).toContainText('3,000 t');
  await expect(page.locator('.gf-forecast-day-values')).toContainText('24,000 MWh');
  await expect(page.getByRole('region', { name: '호기별 발전계획' })).toContainText('1호기');
  await expect(page.getByRole('region', { name: '호기별 발전계획' })).toContainText('100 MW');
  await page.locator('#main-content').getByRole('button', { name: '수급 원장', exact: true }).click();
  await expect(page.getByRole('region', { name: '선택 날짜 수급' })).toContainText('2027-01-03');
  await expect(page.getByRole('region', { name: '선택 날짜 수급' })).toContainText('284,000');
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: '통합 시뮬레이션', exact: true }).click();
  await page.getByRole('button', { name: '통합 시뮬레이션 열기' }).click();
  await expect(page).toHaveURL(/#simulation$/);
  await expect(page.getByLabel('저장된 MILP 계산')).toHaveValue('검증 계산');
});

test('통합 시뮬레이션은 머리를 줄이고 1920 첫 화면에 KPI·shadcn 주 차트·호기 막대·고정 확인 열을 담는다', async ({ page }) => {
  const snapshot = suppliedPlanningFixture('검증 계산', '2027-01-01', 30);
  snapshot.classification = 'operational';
  await page.route('**/api/runs', route => route.fulfill({ json: [{ id: '검증 계산', name: '검증 계산', period: '2027-01-01 ~ 2027-12-31' }] }));
  await page.route('**/api/planning/**', route => route.fulfill({ json: snapshot }));
  // 도우미 섹션은 빠진 자료가 없어 접힌 상태로 둔다(오른쪽 열 맨 위에 한 줄을 차지한다).
  await page.route('**/api/assistant/checks?**', route => route.fulfill({ json: { screen: 'simulation', as_of: '2027-01-01T09:00:00+09:00', items: [], errors: [] } }));
  await page.route('**/api/assistant/status', route => route.fulfill({ json: { llm: true } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#simulation');
  const focus = page.locator('.gf-forecast-focus');
  await expect(focus.locator('[data-slot="chart"]')).toHaveCount(1);
  await expect(page.getByRole('region', { name: '도우미' })).toBeVisible();
  // 조회 조건·저장 범위·시작재고는 패널 하나에 있다.
  const query = page.getByRole('region', { name: '조회 조건', exact: true });
  await expect(query.getByLabel('저장된 MILP 계산')).toBeVisible();
  await expect(query.getByRole('region', { name: '전망 시작재고' })).toBeVisible();
  // 주 차트와 호기 막대는 ECharts가 아니고 이전 색을 쓰지 않는다.
  await expect(focus.locator('[_echarts_instance_]')).toHaveCount(0);
  const units = page.getByRole('region', { name: '호기별 발전계획' });
  await expect(units.locator('.gf-unit-bar')).toHaveCount(snapshot.units.length);
  const html = (await focus.innerHTML()).toLowerCase();
  for (const old of ['#3f6ae0', '#c08e52', '#49a28f']) expect(html).not.toContain(old);
  // KPI·주 차트·호기 막대·확인할 변화가 첫 화면 안에 있다.
  for (const target of [page.getByRole('region', { name: '발전·수급 전망 요약' }), focus.locator('[data-slot="chart"]'), units, page.getByRole('complementary', { name: '확인할 변화' })]) {
    const box = (await target.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(1080);
  }
  const watch = page.getByRole('complementary', { name: '확인할 변화' });
  await expect(watch).toHaveCSS('position', 'sticky');
  expect(Math.round((await watch.boundingBox())!.width)).toBe(320);
  await expect(watch.getByRole('button', { name: '부족 시점·반입 가능 여부 검토' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/simulation/light-1920.png', animations: 'disabled' });
  await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
  await page.screenshot({ path: 'artifacts/simulation/dark-1920.png', animations: 'disabled' });
  // 차트에서 날짜를 누르면 선택 날짜가 바뀐다.
  const chart = focus.locator('[data-slot="chart"] .recharts-surface');
  const cbox = (await chart.boundingBox())!;
  await page.mouse.move(cbox.x + cbox.width * 0.7, cbox.y + cbox.height / 2);
  await page.mouse.move(cbox.x + cbox.width * 0.75, cbox.y + cbox.height / 2, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByLabel('날짜 선택')).not.toHaveAttribute('aria-valuetext', '2027-01-01');
  await page.setViewportSize({ width: 1131, height: 900 });
  await expect(watch).toHaveCSS('position', 'static');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('운영 개요는 현황판으로 호기 출력·금일 순수요·저탄 현황·접안·체선·입항 예정을 첫 화면에 나누어 보여준다', async ({ page }) => {
  const catalog = loadCatalog(), engine = createEngine(catalog);
  const timers = new Set<ReturnType<typeof setInterval>>();
  await page.routeWebSocket(/\/demo-stream\?/, socket => {
    let seq = 0;
    socket.send(JSON.stringify({ type: 'hello', serverId: 'status-board', catalog }));
    const tick = () => socket.send(JSON.stringify({ type: 'snapshot', serverId: 'status-board', seq: ++seq, state: engine.snapshot() }));
    tick(); const timer = setInterval(tick, 200); timers.add(timer); socket.onClose(() => { clearInterval(timer); timers.delete(timer); });
  });
  await page.clock.setFixedTime(new Date('2027-01-05T03:30:00Z')); // KST 2027-01-05 12:30
  const net = Array.from({ length: 24 }, (_, h) => 50000 + (h >= 9 && h <= 19 ? 10000 : 0) + h * 10);
  const hourly: string[] = [];
  await page.route('**/api/runs', route => route.fulfill({ json: [{ id: '연간 계획', name: '연간 계획', period: '2027-01-01 ~ 2027-12-31' }] }));
  await page.route(/\/api\/runs\/[^/]+\/hourly/, route => { hourly.push(route.request().url()); return route.fulfill({ json: { day: '2027-01-05', units: [], output: [], coal_target: [], net, nuclear: [] } }); });
  await page.route('**/api/vessels/waiting-candidates', route => route.fulfill({ json: { updatedAt: '2027-01-05T03:29:00Z', lastReceivedAt: '2027-01-05T03:29:00Z', radiusKm: 15, confirmed: {}, candidates: [
    { mmsi: '440000001', name: 'WAIT ONE', shipType: 70, navStatus: 1, sogKn: 0, destination: 'KR TSN', position: { latitude: 37.1, longitude: 126.4, observedAt: '2027-01-05T03:27:00Z' }, dwellHours: 5.2, distanceKm: 8.4, stale: false, reasons: [] },
  ] } }));
  await page.route('**/api/voyage-registry/records', route => route.fulfill({ json: {
    ships: [{ ship_code: 'S1', name: 'ARRIVE ONE' }, { ship_code: 'S2', name: 'DONE SHIP' }],
    voyages: [
      { voyage_no: 'V1', ship_code: 'S1', status: 'underway', planned_arrival: '2027-01-07T09:00', destination_port: '당진', classification: 'actual' },
      { voyage_no: 'V2', ship_code: 'S2', status: 'completed', planned_arrival: '2027-01-02T09:00', destination_port: '당진', classification: 'actual' },
    ],
    cargo: [],
  } }));
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/?demo=1#overview');
    await expect(page.getByRole('heading', { level: 1, name: '운영 현황', exact: true })).toBeVisible();
    // 전망 계산 탭과 조회 막대는 운영 개요에 없다.
    await expect(page.getByRole('tab', { name: '조건 설정' })).toHaveCount(0);
    await expect(page.getByLabel('저장된 MILP 계산')).toHaveCount(0);
    // 현황판에는 표본 화면으로 가는 모드 토글·설명 문구가 없다.
    await expect(page.getByRole('group', { name: '발전소 종합 데이터 모드' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '별도 조건 전망' })).toHaveCount(0);

    const units = page.getByRole('region', { name: '발전소 출력', exact: true });
    await expect(units.locator('.gf-os-unit')).toHaveCount(10);
    await expect(units).toContainText('5,370');
    await expect(units).toContainText('운전 10기');
    await expect(units.locator('.gf-os-unit').first()).toContainText('460');
    // 막대 높이는 정격에 비례한다: 1,020MW 호기 760MW 채움이 600MW 호기 460MW보다 높다.
    const fill = (i: number) => units.locator('.gf-os-unit').nth(i).locator('.gf-os-unit-track i').boundingBox();
    expect((await fill(8))!.height).toBeGreaterThan((await fill(0))!.height);
    const track = (i: number) => units.locator('.gf-os-unit').nth(i).locator('.gf-os-unit-track').boundingBox();
    expect(Math.abs((await track(0))!.height / (await track(9))!.height - 600 / 1020)).toBeLessThan(0.03);
    // 운전 중인 호기 막대는 한 가지 색이다(묶음별 색은 뜻이 없다).
    expect(new Set(await units.locator('.gf-os-unit[data-status="running"] .gf-os-unit-track i').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))).size).toBe(1);

    const demand = page.getByRole('region', { name: '금일 수요전망', exact: true });
    await expect(demand.locator('[data-slot="chart"]')).toHaveCount(1);
    await expect(demand).toContainText('2027-01-05');
    await expect(demand).toContainText('60,190');
    await expect(demand).toContainText('19시');
    await expect(demand).toContainText('60,120');
    expect(hourly.some(url => url.includes('day=2027-01-05'))).toBe(true);

    const yard = page.getByRole('region', { name: '저탄 현황', exact: true });
    await expect(yard).toContainText('고열량탄');
    await expect(yard).toContainText('저열량탄');
    await expect(yard).toContainText('363,432');
    await expect(yard.locator('.gf-os-yard')).toHaveCount(3);
    // 비중은 자기 탄종 숫자 바로 옆에 있다(다른 탄종 숫자 쪽으로 밀려나지 않는다).
    for (const grade of ['high', 'low']) {
      const num = (await yard.locator(`.gf-os-grade [data-grade="${grade}"] strong`).boundingBox())!;
      const pct = (await yard.locator(`.gf-os-grade [data-grade="${grade}"] small`).boundingBox())!;
      expect(pct.x - (num.x + num.width)).toBeGreaterThanOrEqual(0);
      expect(pct.x - (num.x + num.width)).toBeLessThan(24);
    }

    const ships = page.getByRole('region', { name: '선박 현황', exact: true });
    await expect(ships.getByRole('region', { name: '접안 중' })).toContainText('GN-A');
    // 모의 표시는 상단 공통 모드 표시 한 곳만: 카드 안에 시연·모의 문구를 반복하지 않는다.
    await expect(page.locator('.gf-os-page')).not.toContainText(/시연|모의|데모|운전 정보 하역선/);
    // 11px 미만 글자가 없다.
    expect(await page.locator('.gf-os-page').evaluate(root => [...root.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).map(e => e.textContent))).toEqual([]);
    await expect(ships.getByRole('region', { name: '체선 대기' })).toContainText('WAIT ONE');
    await expect(ships.getByRole('region', { name: '체선 대기' })).toContainText('5시간');
    await expect(ships.getByRole('region', { name: '입항 예정' })).toContainText('ARRIVE ONE');
    await expect(ships.getByRole('region', { name: '입항 예정' })).not.toContainText('DONE SHIP');

    for (const target of [units, demand, yard, ships]) {
      const box = (await target.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(1080);
    }
    await expect(page.locator('#main-content [_echarts_instance_]')).toHaveCount(0);
    mkdirSync('artifacts/overview', { recursive: true });
    await page.screenshot({ path: 'artifacts/overview/status-light-1920.png', animations: 'disabled' });
    await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
    await page.screenshot({ path: 'artifacts/overview/status-dark-1920.png', animations: 'disabled' });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole('button', { name: '재고 전망·구매 검토는 통합 시뮬레이션에서' }).click();
    await expect(page).toHaveURL(/#simulation$/);
    await expect(page.getByRole('tab', { name: '조건 설정', exact: true })).toBeVisible();
  } finally { for (const timer of timers) clearInterval(timer); }
});

test('운전 데모가 꺼져 있으면 현재 출력과 저탄 현황을 계획값으로 채우지 않는다', async ({ page }) => {
  await page.route('**/api/runs', route => route.fulfill({ json: [] }));
  await page.route('**/api/vessels/waiting-candidates', route => route.fulfill({ status: 503, json: { detail: '대기 후보 서버 확인' } }));
  await page.goto('/#overview');
  await expect(page.getByRole('region', { name: '발전소 출력', exact: true })).toContainText('운전 정보 미연계');
  await expect(page.getByRole('region', { name: '발전소 출력', exact: true }).locator('.gf-os-unit')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '저탄 현황', exact: true })).toContainText('운전 정보 미연계');
  await expect(page.getByRole('region', { name: '금일 수요전망', exact: true })).toContainText('오늘을 포함한 저장 계획이 없습니다');
  await expect(page.getByRole('region', { name: '체선 대기' })).toContainText('대기 후보 서버 확인');
  mkdirSync('artifacts/overview', { recursive: true });
  await page.screenshot({ path: 'artifacts/overview/status-disconnected.png', animations: 'disabled', timeout: 10000 });
});

test('가정 입력 기반 계산도 전망 화면에 표시하고 실제 운전정보와 구분한다', async ({page}) => {
  const snapshot=suppliedPlanningFixture('가정 계산','2027-01-01',30);
  snapshot.classification='functional_demo';
  await page.route('**/api/runs',route=>route.fulfill({json:[{id:'가정 계산',name:'가정 계산',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**',route=>route.fulfill({json:snapshot}));
  for(const screen of ['simulation']) {
    await page.goto(`/#${screen}`);
    await expect(page.getByText('가정 입력 기반 계산 · 실제 발전계획 및 운전 실적과 구분해 확인하세요.')).toBeVisible();
    await expect(page.getByRole('region',{name:'호기별 발전계획'})).toBeVisible();
    await expect(page.getByLabel('날짜 선택')).toBeVisible();
    await expect(page.locator('.gf-forecast-day-values')).toContainText('24,000 MWh');
    if (!await page.locator('.fuel-supply-kpis').isVisible()) {
      await page.getByText('저탄장별 수급 상세', {exact:true}).click();
    }
    await expect(page.locator('.fuel-supply-kpis')).not.toContainText('DB 수급 원장');
    await expect(page.locator('.fuel-flow')).not.toContainText('DB 기준');
    await expect(page.locator('.fuel-flow')).toContainText('계산상 하역');
    await expect(page.getByText('가정 입력 기반 계산 · 실제 발전계획 및 운전 실적과 구분해 확인하세요.')).toBeVisible();
  }
});

test('수급 원장에서 호기군별 일별 발전·연료 계획을 확인한다', async ({page}) => {
  const snapshot=suppliedPlanningFixture('계획','2027-01-01',30);
  snapshot.classification='operational';
  snapshot.daily[0].unit_generation_mwh=Object.fromEntries(Array.from({length:10},(_,i)=>[`dj-${i+1}`,(i+1)*1000]));
  snapshot.inventory.daily[0].groups.g14.burn=2400;
  snapshot.inventory.daily[0].groups.g58.burn=4800;
  snapshot.inventory.daily[0].groups.g910.burn=7200;
  await page.route('**/api/runs',route=>route.fulfill({json:[{id:'계획',name:'계획',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**',route=>route.fulfill({json:snapshot}));
  await page.goto('/#fuel-ledger');
  const feed=page.getByRole('region',{name:'호기군별 발전과 연료 계획'});
  await expect(feed).toContainText('10,000 MWh');
  await expect(feed).toContainText('26,000 MWh');
  await expect(feed).toContainText('300 t/h');
});

test('구매 검토는 리드타임과 전망에 맞는 첫 빈 공간 날짜를 표시한다', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  const snapshot=suppliedPlanningFixture('검토 계획','2027-01-01',30); snapshot.classification='operational';
  await page.route('**/api/runs',route=>route.fulfill({json:[{id:'검토 계획',name:'검토 계획',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**',route=>route.fulfill({json:snapshot}));
  await page.goto('/#procurement');
  await page.getByLabel('검토 물량 · t').fill('22000');
  await page.getByLabel('가정 저장한도 · t').fill('150000');
  await page.getByLabel('조달 리드타임 · 일').fill('1');
  await expect(page.locator('.gf-ow-facts div').filter({hasText:'처음 공간 확보 · 일말 기준'})).toContainText('2027-01-03');
  await expect(page.getByText(/발전처 합계 기준.*소진 순서/)).toBeVisible();
  await page.getByText('반입 조건 검토',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'.tooling-tmp/procurement-space-1920.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'.tooling-tmp/procurement-space-mobile.png',animations:'disabled'});
});

test('Pile 검토는 계통 연결과 입력 계획을 구분해 공간 및 저장기한 내 사용을 비교한다', async ({page}) => {
  const snapshot=suppliedPlanningFixture('Pile 계획','2027-01-01',30); snapshot.classification='operational';
  await page.route('**/api/runs',route=>route.fulfill({json:[{id:'Pile 계획',name:'Pile 계획',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**',route=>route.fulfill({json:snapshot}));
  await page.route('**/api/voyage-registry/inventory/baseline',route=>route.fulfill({json:{revision:1,as_of:'2026-11-04',total_t:250,lots:[{location:'P7',coal_name:'검증탄',tonnes:200},{location:'A1',coal_name:'검증탄',tonnes:50}]}}));
  await page.goto('/#procurement');
  await page.getByLabel('검토 물량 · t').fill('1000');
  await page.getByLabel('적정 저장기간 · 일').fill('3');
  await page.getByLabel('반입 부두').selectOption('1');
  await page.getByLabel('반입 구역').selectOption('pile-7');
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Pile별 반입·소진 검토'})});
  await expect(panel).toContainText('연결 불가');
  await expect(panel).toContainText('기준재고 200 t · 2026-11-04 기준');
  await expect(panel).toContainText('계획값 필요');
  await page.getByLabel('반입 부두').selectOption('2');
  await page.getByLabel('구역 사용 한도 · t').fill('5000');
  await page.getByLabel('반입일 예상 잔량 · t').fill('4000');
  await page.getByLabel('이 화물 사용 시작일 · KST').fill('2027-01-01');
  await page.getByLabel('이 화물 사용 계획 · t/일').fill('200');
  await expect(panel).toContainText('계통 연결');
  await expect(panel).toContainText('입력 한도 이내');
  await expect(panel).toContainText('잔량 예상');
  await expect(panel).toContainText('400 t');
  await page.getByLabel('이 화물 사용 계획 · t/일').fill('400');
  await expect(panel).toContainText('전량 사용 계획');
  await expect(panel).toContainText('설비 신호와 인접 원탄 상부 이격거리');
  await page.setViewportSize({width:1920,height:1080});
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.tooling-tmp/pile-review-1920.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.tooling-tmp/pile-review-mobile.png',animations:'disabled'});
  await page.getByLabel('반입 구역').selectOption('shed-a');
  await expect(panel).toContainText('기준재고 50 t · 2026-11-04 기준');
  await page.getByLabel('반입 검토일 · KST').fill('2027-05-01');
  await expect(page.getByLabel('반입 검토일 · KST')).toHaveValue('2027-05-01');
});

test('반입 계획을 공용 저장 후 다시 열고 선택 경로의 모의 운전 신호만 표시한다', async ({page}) => {
  const snapshot=suppliedPlanningFixture('계획 연결','2027-01-01',30); snapshot.classification='operational';
  await page.route('**/api/runs',route=>route.fulfill({json:[{id:'계획 연결',name:'계획 연결',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/**',route=>route.fulfill({json:snapshot}));
  let saved:any = null; let conflict=false;
  await page.route('**/api/voyage-registry/receipt-plans',route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{plans:saved ? [saved] : []}});
    if(conflict) return route.fulfill({status:409,json:{detail:'다른 사용자가 계획을 변경했습니다. 다시 불러와 확인하세요.'}});
    const body=route.request().postDataJSON();
    saved={id:'0123456789abcdef0123456789abcdef',revision:(body.revision || 0)+1,plan:body.plan,updated_at:'2027-01-01T00:00:00Z',actor:'test'};
    return route.fulfill({json:saved});
  });
  const catalog=loadCatalog(),engine=createEngine(catalog); let seq=0; const timers=new Set<ReturnType<typeof setInterval>>();
  await page.routeWebSocket(/\/demo-stream\?/,socket=>{
    socket.send(JSON.stringify({type:'hello',serverId:'receipt-ui',catalog}));
    const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'receipt-ui',seq:++seq,state:engine.snapshot()}));
    tick();const timer=setInterval(tick,100);timers.add(timer);socket.onClose(()=>{clearInterval(timer);timers.delete(timer);});
  });
  try {
    await page.goto('/#data'); await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
    await page.evaluate(()=>{location.hash='#procurement';});
    await page.getByLabel('계획명').fill('11월 반입 검토');
    await page.getByLabel('검토 물량 · t').fill('12000');
    await page.getByLabel('반입 부두').selectOption('2');
    await page.getByLabel('반입 구역').selectOption('pile-7');
    await page.getByLabel('구역 사용 한도 · t').fill('36000');
    await page.getByLabel('반입일 예상 잔량 · t').fill('8000');
    await page.getByLabel('적정 저장기간 · 일').fill('20');
    await page.getByLabel('이 화물 사용 시작일 · KST').fill('2027-01-03');
    await page.getByLabel('이 화물 사용 계획 · t/일').fill('500');
    await expect(page.getByText('실제 설비 운전 신호: 미연결')).toBeVisible();
    await expect(page.getByText(/운전 정보 (수신 중|일시정지) · 설비 1번 (운전|정지|고장|미확인)/)).toBeVisible();
    await page.getByRole('button',{name:'새 계획 저장'}).click();
    await expect(page.getByRole('status')).toContainText('계획을 공용으로 저장했습니다.');
    expect(saved.plan.runId).toBe('계획 연결');
    await page.setViewportSize({width:1920,height:1080});
    await page.getByRole('heading',{name:'저장된 반입 검토'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'.tooling-tmp/receipt-plan-1920.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:900});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.getByRole('heading',{name:'저장된 반입 검토'}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'.tooling-tmp/receipt-plan-mobile.png',animations:'disabled'});
    await page.reload();
    await expect(page.getByLabel('계획명')).toHaveValue('11월 반입 검토');
    await expect(page.getByLabel('반입 구역')).toHaveValue('pile-7');
    await expect(page.getByLabel('반입일 예상 잔량 · t')).toHaveValue('8000');
    await expect(page.getByLabel('이 화물 사용 계획 · t/일')).toHaveValue('500');
    conflict=true;
    await page.getByLabel('이 화물 사용 계획 · t/일').fill('600');
    await page.getByRole('button',{name:'계획 저장',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('다른 사용자가 계획을 변경했습니다');
    await expect(page.getByLabel('이 화물 사용 계획 · t/일')).toHaveValue('600');
  } finally { for(const timer of timers)clearInterval(timer); }
});

test('재고 원장 links open the shared pile ledger while the supply ledger remains available', async ({page}) => {
  await page.goto('/#yard');
  await page.locator('.gf-oy-inventory').getByRole('button', {name:'재고 원장', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Pile 재고 원장'})).toBeVisible();
  await expect(page).toHaveURL(/#inventory$/);
  await page.getByRole('button', {name:'돌아가기'}).click();
  await page.getByRole('navigation', {name:'주 메뉴'}).getByRole('button', {name:'재고 원장', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Pile 재고 원장'})).toBeVisible();
  await page.getByRole('navigation', {name:'주 메뉴'}).getByRole('button', {name:'수급 원장', exact:true}).click();
  await expect(page).toHaveURL(/#fuel-ledger$/);
});


test('yard displays manual inventory separately from the photographic scene', async ({page}) => {
  await page.route('**/api/voyage-registry/inventory', route => route.fulfill({json:{revision:1, lots:[
    {location:'P1', remaining_t:120, needs_review:false},
    {location:'P1', remaining_t:30, needs_review:true},
    {location:'A3', remaining_t:50, needs_review:false},
  ]}}));
  await page.goto('/#yard');
  const manual = page.getByLabel('수기 원장 구역별 잔량');
  await expect(manual).toContainText('Pile 1 150 t · 재확인');
  await expect(manual).toContainText('적치 위치 미확인');
  await expect(page.locator('.gf-oy-map-caption')).toContainText('참고 배치');
  await page.getByRole('tab', {name:'3저탄장옥내'}).click();
  await expect(manual).toContainText('A3 셀 50 t');
  await expect(manual).not.toContainText('Pile 1');
  await manual.getByRole('button', {name:'A3 셀 50 t'}).click();
  await expect(page.getByRole('heading', {name:'Pile 재고 원장'})).toBeVisible();
});

test('도면 위치가 없는 기준재고도 실제 구역과 물량으로 확인하며 센서 상태를 꾸며내지 않는다', async ({page}) => {
  await page.route('**/api/voyage-registry/inventory/baseline', route => route.fulfill({json:{revision:1,as_of:'2026-11-04',total_t:1250,lots:[
    {source_id:'unmapped-receipt',location:'P5',coal_name:'검증탄',tonnes:1250,voyage_number:'26-2-019',grade:'고',age_days:2}
  ]}}));
  await page.goto('/#yard');
  await page.getByRole('tab',{name:/^2저탄장/}).click();
  const table=page.getByRole('region',{name:'구역별 재고 표'});
  await expect(table).toContainText('검증탄');
  await expect(table).toContainText('1,250');
  await expect(table).toContainText('26-2-019');
  await expect(table).toContainText('위치 미확인');
  await expect(page.getByLabel('2저탄장 3D 참고 장면')).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'위치 미확인'})).toBeVisible();
  await expect(page.getByLabel('선택 저탄장 요약')).toContainText('1,250');
  await expect(page.getByRole('region',{name:'선택 구간 상세'})).toContainText('센서 미연결');
  await expect(page.locator('.gf-oy-quality-values')).toContainText('1,250');
  await expect(page.getByTestId('operations-yard')).not.toContainText('고위험');
});

test('기준재고를 항차와 탄종으로 검색하고 선택한 구간의 센서 미연결을 확인한다', async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#yard');
  const search=page.getByRole('searchbox',{name:'구역별 재고 검색'});
  const table=page.getByRole('region',{name:'구역별 재고 표'});
  await search.fill('26-1-039');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('KCH(Kaltim)');
  await table.getByRole('button',{name:/Pile 2/}).click();
  const detail=page.getByRole('region',{name:'선택 구간 상세'});
  await expect(detail).toContainText('26-1-039');
  await expect(detail).toContainText('센서 미연결');
  await search.fill('없는탄종');
  await expect(table).toContainText('검색 결과가 없습니다');
  await search.fill('');
  await expect(table.locator('tbody tr')).not.toHaveCount(1);
  await page.screenshot({path:'.tooling-tmp/yard-inventory-search.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'.tooling-tmp/yard-inventory-search-mobile.png',animations:'disabled'});
});

test('berth satellite layout supports plan comparison, roof inspection and close equipment views',async({page})=>{
  test.setTimeout(60000);mkdirSync('artifacts/berth',{recursive:true});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1920,height:1080});await page.goto('/#berth');
  const viewport=page.locator('.fuel-scene__viewport');await expect(viewport).toHaveAttribute('data-renderer','webgl');
  const local=page.getByRole('button',{name:'선택 부두',exact:true}), site=page.getByRole('button',{name:'전체 배치',exact:true});
  await expect(local).toHaveAttribute('aria-pressed','true');
  await expect(viewport.locator('.fuel-scene__labels')).toContainText('5번');
  await page.locator('.gf-ob-dock').nth(1).click();
  await expect(viewport.locator('.fuel-scene__labels')).toContainText('9A번');
  await page.getByLabel('원탄 선택',{exact:true}).selectOption('p5-b');
  await expect(viewport.locator('.fuel-scene__labels')).toContainText('Pile 5');
  await page.screenshot({path:'artifacts/berth/receiving-route.png',fullPage:true,animations:'disabled'});
  await page.getByLabel('원탄 선택',{exact:true}).selectOption('');
  await site.click();
  await expect(viewport.locator('.fuel-scene__labels')).toContainText('3부두');
  await page.screenshot({path:'artifacts/berth/site-1920.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'평면',exact:true}).click();await expect(viewport).toHaveAttribute('data-projection','plan');
  await page.screenshot({path:'artifacts/berth/site-plan.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'지붕 투시',exact:true}).click();
  await expect(page.getByRole('button',{name:'지붕 투시',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:'artifacts/berth/site-cutaway.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'평면',exact:true}).click();
  await page.getByRole('button',{name:'확대',exact:true}).click();await page.getByRole('button',{name:'확대',exact:true}).click();
  for(let i=0;i<10;i++)await viewport.press('ArrowDown');
  await page.screenshot({path:'artifacts/berth/jetty-close.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'장면 원위치',exact:true}).click();await expect(page.getByLabel('장면 배율')).toHaveText('100%');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
  const detail=page.locator('#gf-berth-detail');
  await expect.poll(()=>detail.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  expect(errors).toEqual([]);
});

test('blend supplies retain three yard models, boiler selection, analysis and responsive scene controls',async({page})=>{
  test.setTimeout(120000);mkdirSync('artifacts/blend',{recursive:true});
  await page.route('**/api/voyage-registry/inventory', route => route.fulfill({json:{revision:0,lots:[]}}));
  await page.route('**/api/voyage-registry/records', route => route.fulfill({json:{revision:0,voyages:[],cargo:[]}}));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1920,height:1080});await page.goto('/#blend');
  await expect(page.getByRole('heading',{level:1,name:'상탄·혼탄',exact:true})).toBeVisible();
  for(const [label,yard,unit] of [['1–4호기',1,4],['5–8호기',2,8],['9–10호기',3,10]] as const){
    await page.getByRole('group',{name:'주 공급 계통 선택'}).getByRole('button',{name:new RegExp(label)}).click();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-renderer','webgl');
    await page.getByRole('group',{name:'보일러 선택'}).getByRole('button',{name:new RegExp(`^${unit}호기`)}).click();
    await expect(page.getByRole('heading',{name:`${unit}호기 공급`,exact:true})).toBeVisible();
    await expect(page.locator('.gf-bl-boiler')).toContainText('사일로 잔량');
    await expect(page.locator('.gf-bl-chain')).toContainText('사일로 6기');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
    await page.screenshot({path:`artifacts/blend/line-${yard}-1920.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'평면',exact:true}).click();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-projection','plan');
    await page.screenshot({path:`artifacts/blend/line-${yard}-plan.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'평면',exact:true}).click();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-projection','perspective');
    await page.getByRole('button',{name:'발전동 투시',exact:true}).click();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-plant-inspection','true');
    if(yard>1){
      await page.getByRole('button',{name:'지붕 투시',exact:true}).click();
      await expect(page.getByRole('button',{name:'발전동 투시',exact:true})).toHaveAttribute('aria-pressed','true');
      await page.getByRole('button',{name:'지붕 투시',exact:true}).click();
    }
    await page.screenshot({path:`artifacts/blend/line-${yard}-cutaway.png`,fullPage:true,animations:'disabled'});
    if(yard===1){
      for(let n=0;n<2;n++)await page.getByRole('button',{name:'확대',exact:true}).click();
      for(let n=0;n<3;n++)await page.getByRole('group',{name:'3D 장면 이동·확대',exact:true}).press('ArrowDown');
      await page.screenshot({path:'artifacts/blend/silos-close.png',fullPage:true,animations:'disabled'});
      await page.getByRole('button',{name:'장면 원위치'}).click();
    }
    await page.getByRole('button',{name:'발전동 투시',exact:true}).click();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-plant-inspection','false');
  }
  await page.getByRole('button',{name:'확대',exact:true}).click();await expect(page.getByLabel('장면 배율')).toHaveText('125%');
  await page.getByRole('button',{name:'장면 원위치'}).click();await expect(page.getByLabel('장면 배율')).toHaveText('100%');
  await page.getByRole('button',{name:'혼탄 분석',exact:true}).click();
  await expect(page.getByRole('region',{name:'조건별 혼탄 검토'})).toBeVisible();
  await expect(page.getByLabel('목표 발열량 ARB', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'공급 계통',exact:true}).click();
  await page.getByRole('group',{name:'주 공급 계통 선택'}).getByRole('button',{name:/1–4호기/}).click();
  await page.getByLabel('원탄 선택',{exact:true}).selectOption('P2-K1');
  await expect(page.locator('.gf-bl-coal')).toContainText('KCH(Kaltim)');
  await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).click();
  await expect(page.getByRole('button',{name:'라이트 모드로 전환',exact:true})).toHaveCSS('color','rgb(238, 240, 244)');
  await page.screenshot({path:'artifacts/blend/dark-1920.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'라이트 모드로 전환',exact:true}).click();
  await expect(page.getByRole('button',{name:'다크 모드로 전환',exact:true})).toHaveCSS('color','rgb(23, 35, 51)');
  for(const width of [1131,390,320]){
    await page.setViewportSize({width,height:884});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    for(const button of await page.locator('.gf-bl-line-tabs button').all()){
      await expect(button).toBeVisible();const rect=await button.boundingBox();expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
    }
    for(const name of ['발전동 투시','평면']){
      const control=page.getByRole('button',{name,exact:true});await expect(control).toBeVisible();
      const rect=await control.boundingBox();expect(rect!.x+rect!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({path:`artifacts/blend/blend-${width}.png`,fullPage:true,animations:'disabled'});
  }
  expect(errors).toEqual([]);
});

test('blend animates only received reclaim work and freezes after websocket loss',async({page})=>{
  const catalog=loadCatalog(),engine=createEngine(catalog);let socket:any;let seq=0;
  await page.routeWebSocket(/\/demo-stream\?/,ws=>{socket=ws;ws.send(JSON.stringify({type:'hello',serverId:'blend-test',catalog}));});
  await page.goto('/#data');await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
  await page.evaluate(()=>{location.hash='#blend';});
  await expect.poll(()=>!!socket).toBe(true);
  const state=engine.snapshot();state.playing=true;state.material.jobs.reclaim={lotId:'P2-K1',actualRate:900,moved:12,route:['re01','cv05a','cv08ab'],kind:'reclaim',running:true,machine:'re01',pose:catalog.materialLots.find((l:any)=>l.id==='P2-K1').poses.reclaim};
  for(const id of state.material.jobs.reclaim.route)state.equipment[id]={status:'running',flow:900,position:0};
  const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'blend-test',seq:++seq,state}));
  tick();const timer=setInterval(tick,300);
  try{
    await expect(page.locator('.gf-bl-route')).toContainText('900');
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-animating','true');
    await expect(page.locator('.gf-bl-boiler')).toContainText('3,000 t');
    await expect(page.getByLabel('1호기 사일로 현황')).toContainText('500 t');
    clearInterval(timer);socket.close();
    await expect(page.locator('.fuel-scene__viewport')).toHaveAttribute('data-animating','false');
    await expect(page.locator('.gf-bl-signal')).toContainText('마지막 값');
  }finally{clearInterval(timer);}
});

test('control panel changes a feeder and blend reads the same silo values',async({page})=>{
  const catalog=loadCatalog(),engine=createEngine(catalog);let seq=0;const timers=new Set<ReturnType<typeof setInterval>>();
  await page.setViewportSize({width:1920,height:1080});
  await page.routeWebSocket(/\/demo-stream\?/,socket=>{
    socket.send(JSON.stringify({type:'hello',serverId:'silo-ui',catalog}));
    const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'silo-ui',seq:++seq,state:engine.snapshot()}));
    socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='command'){try{engine.command(m.command);tick();socket.send(JSON.stringify({type:'ack',id:m.id,ok:true,seq}));}catch(error){socket.send(JSON.stringify({type:'ack',id:m.id,ok:false,error:String(error)}));}}});
    tick();const timer=setInterval(tick,100);timers.add(timer);socket.onClose(()=>{clearInterval(timer);timers.delete(timer);});
  });
  try {
    await page.goto('/#demo-control');
    await expect(page.getByLabel('사일로와 급탄기 조작')).toContainText('500');
    await page.getByLabel('급탄 설정').fill('125');
    await page.getByRole('button',{name:'급탄 시작',exact:true}).click();
    await expect.poll(()=>engine.snapshot().silos['5-1'].setRate).toBe(125);
    await page.getByRole('button',{name:'재생',exact:true}).click();
    await expect(page.getByLabel('사일로와 급탄기 조작')).toContainText('125 t/h');
    await page.goto('/#data');await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
    await page.evaluate(()=>{location.hash='#blend';});
    await page.getByRole('button',{name:/5–8호기/}).first().click();
    await expect(page.getByLabel('5호기 사일로 현황')).toContainText('급탄 중');
    const panel=await page.locator('.gf-bl-boiler').boundingBox(), footer=await page.locator('.gf-bl-caption').boundingBox();
    expect(footer!.y).toBeGreaterThanOrEqual(panel!.y+panel!.height-1);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
    await page.screenshot({path:'.tooling-tmp/silo-operation-ui.png',animations:'disabled'});
  } finally {for(const timer of timers)clearInterval(timer);}
});

test.beforeEach(async ({page})=>{
  const snapshot=planningFixture();
  await page.route('**/api/runs',r=>r.fulfill({json:[{id:snapshot.run_id,name:snapshot.name,period:`${snapshot.run_start} ~ ${snapshot.run_end}`}]}));
  await page.route('**/api/planning/runs/**/snapshot?*',r=>r.fulfill({json:snapshot}));
});

test('operating stream is explicit and controller opens with its own active connection',async({page})=>{
  let connections=0;
  const timers=new Set<ReturnType<typeof setInterval>>();
  const catalog=loadCatalog(),engine=createEngine(catalog);
  await page.routeWebSocket(/\/demo-stream\?/,socket=>{
    connections++;let seq=0;
    socket.send(JSON.stringify({type:'hello',serverId:'isolated-ui-stream',catalog}));
    const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'isolated-ui-stream',seq:++seq,state:engine.snapshot()}));
    tick();const timer=setInterval(tick,100);timers.add(timer);
    socket.onClose(()=>{clearInterval(timer);timers.delete(timer);});
  });
  try{
    await page.goto('/#yard');await expect(page.getByTestId('operations-yard')).toBeVisible();
    expect(connections).toBe(0);
    await expect(page.locator('header.top-bar').getByRole('checkbox',{name:'운전 데모 연결'})).toHaveCount(0);
    await page.evaluate(()=>{location.hash='#data';});
    await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
    await expect(page.locator('.gf-stream-state')).toHaveText('수신 중');
    await expect(page.locator('.gf-output')).toContainText('5,370');
    await page.getByRole('checkbox',{name:'운전 데모 연결'}).uncheck();
    await expect(page.locator('.gf-output')).toContainText('실시간 운전 정보 미연계');
    await page.goto('/#demo-control');
    await expect(page.getByRole('heading',{level:1,name:'운전 데모 조작반'})).toBeVisible();
    await expect.poll(()=>connections).toBeGreaterThan(0);
    await expect(page.getByRole('button',{name:'재생',exact:true})).toBeEnabled();
  }finally{for(const timer of timers)clearInterval(timer);}
});

test('조작반에서 재생하면 열린 업무 화면에 운전 출력이 연결되고 해제도 동기화된다', async ({page}) => {
  const catalog=loadCatalog(), engine=createEngine(catalog);
  const timers=new Set<ReturnType<typeof setInterval>>();
  const mock=async (target: typeof page) => target.routeWebSocket(/\/demo-stream\?/, socket => {
    let seq=0;
    socket.send(JSON.stringify({type:'hello',serverId:'play-sync',catalog}));
    const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'play-sync',seq:++seq,state:engine.snapshot()}));
    socket.onMessage(raw=>{const message=JSON.parse(String(raw));if(message.type==='command'){engine.command(message.command);tick();socket.send(JSON.stringify({type:'ack',id:message.id,ok:true,seq}));}});
    tick();const timer=setInterval(tick,100);timers.add(timer);socket.onClose(()=>{clearInterval(timer);timers.delete(timer);});
  });
  const control=await page.context().newPage();
  try {
    await mock(page); await mock(control);
    await control.route('**/api/**', route => route.fulfill({status:503,json:{detail:'No fixture for this API'}}));
    await control.route('**/api/me/vessel-workspace', route => route.fulfill({json:{revision:0,workspace:{version:1,watchlist:[],vessels:[],voyages:[]},destinations:{}}}));
    await control.route('**/api/auth/**', route => {
      const path=new URL(route.request().url()).pathname;
      return route.fulfill({json:path.endsWith('/csrf')?{token:'fixture-csrf'}:path.endsWith('/bootstrap-status')?{setupRequired:false}:{user:{id:'00000000-0000-4000-8000-000000000001',username:'fixture-admin',displayName:'Fixture Admin',role:'admin',status:'active',version:1,createdAt:0,reviewedAt:null,mustChangePassword:0},scope:'full'}});
    });
    await page.goto('/#overview');
    await expect(page.locator('.gf-output')).toContainText('실시간 운전 정보 미연계');
    await control.goto('/#demo-control');
    await control.getByRole('button',{name:'재생',exact:true}).click();
    await expect(page.locator('.gf-output')).toContainText('5,370');
    await page.goto('/#data');
    await expect(page.locator('.gf-stream-state')).toHaveText('수신 중');
    await expect(page.getByRole('checkbox',{name:'운전 데모 연결'})).toBeChecked();
    await page.getByRole('checkbox',{name:'운전 데모 연결'}).uncheck();
    await expect(page.locator('.gf-output')).toContainText('실시간 운전 정보 미연계');
  } finally { await control.close(); for(const timer of timers) clearInterval(timer); }
});

test('integrated menus keep deep links, native pages and purchase context',async({page})=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  mkdirSync('artifacts/integration',{recursive:true});
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#yard');
  await expect(page.getByRole('heading',{level:1,name:'저탄·재고',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'접안·하역',exact:true}).click();
  await expect(page).toHaveURL(/#berth$/);
  await page.goBack();await expect(page.getByTestId('operations-yard')).toBeVisible();
  await page.reload();await expect(page.getByTestId('operations-yard')).toBeVisible();
  for(const [hash,title] of [['units','호기·연소'],['costs','계획·실적 분석'],['connections','연결·수집'],['blend','상탄·혼탄'],['members','사용자·권한'],['simulation','통합 시뮬레이션']]){
    await page.goto('/#'+hash);await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toHaveCount(1);
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    await page.screenshot({path:`artifacts/integration/${hash}-1920.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'이 결과로 구매 검토',exact:true}).click();
  await expect(page).toHaveURL(/#procurement$/);
  await expect(page.getByRole('heading',{level:1,name:'구매 검토',exact:true})).toBeVisible();
  await page.screenshot({path:'artifacts/integration/procurement-1920.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('missing operational receipts stay unknown before the first stream snapshot',async({page})=>{
  let connections=0;
  await page.routeWebSocket(/\/demo-stream\?/,()=>{connections++;});
  await page.goto('/#connections');
  await expect(page.getByText('수신 기록 없음',{exact:true})).toBeVisible();
  await page.goto('/#data');
  await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
  await expect.poll(()=>connections).toBeGreaterThan(0);
  await expect(page.locator('.gf-stream-state')).toHaveText('연결 중');
  await page.evaluate(()=>{location.hash='#berth';});
  await expect(page.locator('.gf-rail-pair button').last().locator('strong')).toContainText('—');
  await page.screenshot({path:'artifacts/integration/berth-connecting-1920.png',fullPage:true,animations:'disabled'});
});

test('retained operational features use the same shell and source labels',async({page})=>{
  test.setTimeout(60000);mkdirSync('artifacts/integration',{recursive:true});
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({json:mapStyleFixture}));
  await page.setViewportSize({width:1920,height:1080});
  for(const [route,title] of [['overview','운영 현황'],['simulation','통합 시뮬레이션'],['voyages','항차·화물'],['data','데이터 워크스페이스'],['models','예측·모델'],['schedule','발전기 정지계획'],['scenario','시나리오 분석']]){
    await page.goto('/#'+route);await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    if(route==='voyages'){
      await expect(page.locator('.vessel-map-online')).toHaveAttribute('data-map-ready','true');
      await expect(page.locator('.vessel-map-drawing')).toHaveCount(0);
    }
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:`artifacts/integration/${route}-1920.png`,fullPage:true});
  }
});

test('yard and berth share selection and reachable destinations',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await page.goto('/#yard');
  await expect(page.getByLabel('선택 저탄장 요약')).toContainText('전체');
  await expect(page.locator('.gf-operations-yard')).not.toContainText('오른쪽 절반 사용 제한');
  await page.getByRole('tab',{name:/^2저탄장/}).click();
  await expect(page.getByRole('region',{name:'구역별 재고 표'})).toContainText('Pile 5');
  await page.getByRole('region',{name:'구역별 재고 표'}).getByRole('button',{name:/Pile 6/}).first().click();
  await expect(page.getByRole('region',{name:'선택 구간 상세'})).toContainText('Pile 6');
  await page.getByRole('tab',{name:/^3저탄장/}).click();
  await expect(page.locator('.fuel-scene canvas')).toBeVisible();
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'접안·하역',exact:true}).click();
  await expect(page.getByRole('region',{name:'반입 가능 구역'}).getByRole('button',{name:'Pile 7',exact:true})).toBeDisabled();
  await page.getByRole('region',{name:'반입 가능 구역'}).getByRole('button',{name:'Pile 2',exact:true}).click();
  const lot=await page.getByLabel('원탄 선택',{exact:true}).inputValue();
  await page.getByRole('button',{name:/Pile 2 재고 보기/}).click();
  await expect(page.getByLabel('원탄 선택',{exact:true})).toHaveValue(lot);
  await page.getByRole('button',{name:'상탄 경로 보기'}).click();
  await expect(page.getByLabel('원탄 선택',{exact:true})).toHaveValue(lot);
  await expect(page.getByRole('heading',{level:1,name:'상탄·혼탄'})).toBeVisible();
});

test('yard orbit and pan move the projected pile labels without changing the selected lot',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#yard');
  const viewport=page.locator('.fuel-scene__viewport');
  const position=()=>viewport.locator('.fuel-scene__labels span').first().evaluate(el=>el.getAttribute('style'));
  await expect(viewport).toHaveAttribute('data-renderer','webgl');
  const initial=await position(), lot=await page.getByLabel('원탄 선택',{exact:true}).inputValue();
  const box=(await viewport.boundingBox())!;
  const x=box.x+box.width/2, y=box.y+box.height/2;
  for(const orbit of [false,true]){
    if(orbit) await page.getByRole('button',{name:'드래그 회전'}).click();
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+75,y+20,{steps:5});await page.mouse.up();
    await expect.poll(position).not.toBe(initial);
    await expect(page.getByLabel('원탄 선택',{exact:true})).toHaveValue(lot);
    if(orbit){
      const turned=await position();
      await viewport.press('Shift+ArrowRight');
      await expect.poll(position).not.toBe(turned);
    }
    await viewport.press('Home');
    await expect.poll(position).toBe(initial);
  }
  await page.getByRole('button',{name:'선택 원탄 확대'}).click();
  await expect(page.getByLabel('장면 배율')).toHaveText('300%');
  const bounds=await viewport.boundingBox();
  await page.mouse.click(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);
  await expect(page.getByLabel('원탄 선택',{exact:true})).toHaveValue(lot);
  await viewport.press('Shift+ArrowLeft');
  await page.mouse.move(bounds!.x+bounds!.width/2+25,bounds!.y+bounds!.height/2);
  await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);
  await expect(viewport).toHaveCSS('cursor','pointer');
  await page.mouse.click(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);
  await expect(page.getByLabel('원탄 선택',{exact:true})).toHaveValue(lot);
});

for(const width of [1920,1131,390,320])test(`native operations layout remains usable at ${width}px`,async({page})=>{
  test.setTimeout(60000);mkdirSync('artifacts/integration',{recursive:true});
  await page.setViewportSize({width,height:width===1920?1080:884});
  for(const route of ['yard','berth']){
    await page.goto('/#'+route);await expect(page.locator('.fuel-scene canvas')).toBeVisible();
    await expect(page.locator('.top-bar .gf-stream-toggle')).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(width===1920){
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
      const panelBlue=await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor);
      await expect(page.locator('.gf-brand')).toHaveCSS('color',panelBlue);
      await expect(page.locator('.gf-stage-nav>button.is-active')).toHaveCSS('color',panelBlue);
    }
    await page.screenshot({path:`artifacts/integration/${route}-${width}.png`,fullPage:true});
  }
  if(width===1920){await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).click();await expect(page.getByRole('button',{name:'라이트 모드로 전환',exact:true})).toHaveCSS('color','rgb(238, 240, 244)');await expect(page.locator('.gen4cast-app')).toHaveCSS('background-color','rgb(23, 24, 27)');await expect(page.locator('.gf-brand')).toHaveCSS('color','rgb(238, 240, 244)');await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(36, 71, 197)');await page.screenshot({path:'artifacts/integration/berth-dark-1920.png',fullPage:true,animations:'disabled'});}
});

test('AIS automatically places an unlisted vessel on the berth and joins its active cargo without opening tracking', async({page})=>{
  const mmsi='440000011', stamp=new Date().toISOString(), lon=126.507,lat=37.06624;
  await page.route('**/api/vessels/map?**',route=>route.fulfill({json:{type:'FeatureCollection',visibleCount:1,fetchedAt:stamp,lastReceivedAt:stamp,
    features:[{type:'Feature',id:mmsi,geometry:{type:'Point',coordinates:[lon,lat]},properties:{kind:'vessel',mmsi,name:'TEST BULKER',fresh:true,count:1}}]}}));
  await page.route('**/api/vessels/map/'+mmsi,route=>route.fulfill({json:{id:mmsi,name:'TEST BULKER',mmsi,imo:'',source:'aisstream',
    ais:{updatedAt:stamp,shipType:70,navStatus:5,destination:'',position:{longitude:lon,latitude:lat,observedAt:stamp,sogKn:0,cogDeg:null}}}}));
  await page.route('**/api/voyage-registry/records',route=>route.fulfill({json:{ships:[{ship_code:'s',mmsi}],voyages:[{voyage_no:'v',ship_code:'s',voyage_number:'26-2-001',status:'unloading'}],cargo:[{voyage_no:'v',destination_plant_id:'dangjin',coal_name:'Test cargo',received_t:1234}]}}));
  await page.goto('/#berth');
  await expect(page.locator('.gf-ob-dock').nth(1)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#gf-berth-detail')).toContainText('TEST BULKER');
  await expect(page.locator('#gf-berth-detail')).toContainText('26-2-001');
  await expect(page.locator('#gf-berth-detail')).toContainText('1,234 t');
  await expect(page.locator('.gf-rail-pair')).toContainText('1/ 3');
  await expect(page.locator('.gf-operations-berth')).not.toContainText('GEN4CAST HORIZON');
  await page.locator('.gf-ob-dock').first().click();
  const viewport=page.locator('.fuel-scene__viewport');
  await expect(viewport).toHaveAttribute('data-renderer','webgl');
  await page.getByRole('button',{name:'확대',exact:true}).click();
  for(let n=0;n<19;n++) await viewport.press('ArrowRight');
  await expect(page.locator('#gf-berth-detail')).toContainText('TEST BULKER');
  await expect(page.getByLabel('장면 배율')).toHaveText('125%');
  await page.locator('.gf-ob-dock').nth(1).click();
  await expect(page.getByLabel('장면 배율')).toHaveText('100%');
});

test('a berth releases a departing AIS vessel on refresh and distinguishes a failed feed from no detections',async({page})=>{
  await page.clock.install();
  const mmsi='440000012', stamp=new Date().toISOString();
  let movement=0,available=true;
  await page.route('**/api/vessels/map?**',route=>available?route.fulfill({json:{type:'FeatureCollection',visibleCount:1,fetchedAt:stamp,lastReceivedAt:stamp,
    features:[{type:'Feature',geometry:{type:'Point',coordinates:[126.5113,37.0649]},properties:{kind:'vessel',mmsi,name:'TEST CALL',fresh:true,count:1}}]}}):route.fulfill({status:503,json:{}}));
  await page.route('**/api/vessels/map/'+mmsi,route=>route.fulfill({json:{id:mmsi,name:'TEST CALL',mmsi,imo:'',source:'aisstream',
    ais:{updatedAt:stamp,shipType:70,navStatus:0,destination:'',position:{longitude:126.5113,latitude:37.0649,observedAt:stamp,sogKn:movement,cogDeg:null}}}}));
  await page.route('**/api/voyage-registry/records',route=>route.fulfill({json:{ships:[],voyages:[],cargo:[]}}));
  await page.goto('/#berth');
  await expect(page.locator('#gf-berth-detail')).toContainText('일치 항차 미확인');
  movement=5;
  await page.clock.fastForward(31000);
  await expect(page.locator('.gf-ob-observations')).toContainText('접안 후보가 없습니다');
  await expect(page.locator('.gf-rail-pair')).toContainText('0/ 3');
  available=false;
  await page.clock.fastForward(31000);
  await expect(page.locator('.gf-ob-observations')).toContainText('조회 불가');
  await expect(page.locator('.gf-rail-pair')).toContainText('—/ 3');
});

test('older AIS at a berth remains visible as an unconfirmed last position',async({page})=>{
  const mmsi='477165300', now=new Date(), stamp=new Date(now.getTime()-76*60000).toISOString();
  const lon=126.50632,lat=37.06657;
  await page.route('**/api/vessels/map?**',route=>route.fulfill({json:{type:'FeatureCollection',visibleCount:1,fetchedAt:now.toISOString(),lastReceivedAt:stamp,
    features:[{type:'Feature',id:mmsi,geometry:{type:'Point',coordinates:[lon,lat]},properties:{kind:'vessel',mmsi,name:'ES GRAND SEA',fresh:false,count:1}}]}}));
  await page.route('**/api/vessels/map/'+mmsi,route=>route.fulfill({json:{id:mmsi,name:'ES GRAND SEA',mmsi,imo:'',source:'aisstream',
    ais:{updatedAt:stamp,shipType:70,navStatus:5,destination:'',position:{longitude:lon,latitude:lat,observedAt:stamp,sogKn:0,cogDeg:null}}}}));
  await page.route('**/api/voyage-registry/records',route=>route.fulfill({json:{ships:[],voyages:[],cargo:[]}}));
  await page.goto('/#berth');
  const dock=page.locator('.gf-ob-dock').nth(1);
  await expect(dock).toContainText('ES GRAND SEA');
  await expect(dock).toContainText('마지막 저속 관측 · 확인 필요');
  await dock.click();
  await expect(page.locator('#gf-berth-detail')).toContainText('현재 접안 여부 미확인');
  await expect(page.locator('.gf-rail-pair')).toContainText('0/ 3');
});

test('수급 예측의 날짜는 KST 자정이 지나면 열린 화면에서도 오늘로 바뀐다', async ({page}) => {
  await page.clock.install({time:new Date('2026-11-08T14:59:50Z')});
  await page.goto('/#forecast');
  await expect(page.locator('.dfc-basis')).toContainText('2026-11-08 00:00');
  await page.clock.fastForward(61_000);
  await expect(page.locator('.dfc-basis')).toContainText('2026-11-09 00:00');
  // 가상 시계 테스트에서는 위치 안정화 대기 대신 키보드로 같은 기간 변경을 검증한다.
  const shortPeriod = page.getByRole('group',{name:'예측 기간',exact:true}).getByRole('button',{name:'7일',exact:true});
  await shortPeriod.focus();
  await shortPeriod.press('Enter');
  await expect(page.locator('.dfc-basis')).toContainText('7일');
});

test('수급 예측은 운영 화면과 같은 머리글·조회 막대를 쓰고, 상황 반영·기준 복귀·규칙 해석 대체가 동작한다',async({page})=>{
  await page.route('**/api/demo-forecast/interpret',r=>r.fulfill({status:503,json:{detail:'LLM 해석이 설정되지 않았습니다.'}}));
  await page.goto('/#forecast');
  await expect(page.getByRole('heading',{level:1,name:'수급 예측',exact:true})).toHaveCount(1);
  const period=page.getByRole('group',{name:'예측 기간',exact:true});
  await period.getByRole('button',{name:'30일',exact:true}).click();
  await expect(period.getByRole('button',{name:'30일',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.dfc-basis')).toContainText('30일');
  const reset=page.getByRole('button',{name:'기준 계획으로',exact:true});
  await expect(reset).toBeDisabled();
  await page.getByRole('group',{name:'상황 가정',exact:true}).getByRole('button',{name:'입항 지연',exact:true}).click();
  await expect(page.getByRole('list',{name:'반영한 조건',exact:true})).toContainText('지연');
  await reset.click();
  await expect(page.locator('.dfc-strip')).toContainText('변경한 조건 없음');
  await page.getByRole('textbox',{name:'지시 입력',exact:true}).fill('2부두 CV가 내일 오전 정비야');
  await page.getByRole('button',{name:'해석',exact:true}).click();
  await expect(page.locator('.dfc-source')).toContainText('규칙 해석');
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('수급 예측은 1920 기본 화면을 스크롤 없이 담고, shadcn 차트와 포인트색 테마, 7열 선박 목록·고정 어시스턴트를 쓴다',async({page})=>{
  // 도우미 섹션이 빠진 자료 여러 건으로 펼쳐진 상태에서도 한 화면에 담긴다(섹션 응답 후에 잰다).
  const manyItems=Array.from({length:6},(_,i)=>({id:`m${i}`,kind:'missing',title:`빠진 자료 ${i+1}`,detail:'확인 필요',count:3,targets:[],action:null}));
  await page.route('**/api/assistant/checks?**',r=>r.fulfill({json:{screen:'forecast',as_of:'2026-11-10T09:00:00+09:00',items:manyItems,errors:[]}}));
  await page.route('**/api/assistant/status',r=>r.fulfill({json:{llm:true}}));
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#forecast');
  const root=page.locator('.dfc-page');
  await expect(root.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByRole('region',{name:'도우미'}).getByText('빠진 자료 1')).toBeVisible();
  // 기본 상태는 페이지 스크롤 없이 한 화면에 담는다.
  expect(await page.evaluate(()=>document.scrollingElement!.scrollHeight<=innerHeight+2)).toBe(true);
  // 차트는 ECharts가 아니라 shadcn(Recharts) 차트이고, 두 차트를 나란히 둔다.
  await expect(root.locator('[_echarts_instance_]')).toHaveCount(0);
  const charts=root.locator('[data-slot="chart"]');
  await expect(charts).toHaveCount(2);
  const [a,b]=await Promise.all([charts.nth(0).boundingBox(),charts.nth(1).boundingBox()]);
  expect(Math.abs(a!.y-b!.y)).toBeLessThan(4);
  // 이전의 튀는 저탄장·탄종 색을 쓰지 않는다.
  const html=(await root.innerHTML()).toLowerCase();
  for(const old of ['#c08e52','#49a28f','#3f6ae0','#85919e']) expect(html).not.toContain(old);
  // 접안 계획과 선박 목록은 탭 하나에 있고, 선박 목록은 7열로 패널 폭을 넘지 않는다.
  const tabs=page.getByRole('tablist',{name:'접안·선박 보기',exact:true});
  await tabs.getByRole('tab',{name:'선박 목록',exact:true}).click();
  const table=page.getByRole('region',{name:'선박별 예측 표',exact:true});
  await expect(table.locator('thead th')).toHaveCount(7);
  expect(await table.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  // 어시스턴트 열은 320px로 화면에 붙어 따라온다.
  const assist=page.getByRole('complementary',{name:'조건 해석',exact:true});
  await expect(assist).toHaveCSS('position','sticky');
  expect(Math.round((await assist.boundingBox())!.width)).toBe(320);
  await page.screenshot({path:'artifacts/forecast/light-1920.png',animations:'disabled'});
  await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).click();
  await expect(page.locator('.gen4cast-app')).toHaveCSS('background-color','rgb(23, 24, 27)');
  await page.screenshot({path:'artifacts/forecast/dark-1920.png',animations:'disabled'});
  // 좁은 화면은 어시스턴트를 아래로 내리고 가로 넘침이 없다.
  await page.setViewportSize({width:1131,height:900});
  await expect(assist).toHaveCSS('position','static');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('수급 예측은 운전 데모의 현재 재고·선박 잔량을 시작값으로 쓰고, 기준 표본으로 돌아갈 수 있다',async({page})=>{
  const catalog=loadCatalog(),engine=createEngine(catalog);let socket:any;let seq=0;
  engine.command({op:'preset'});engine.command({op:'play'});engine.advance(600);
  const state=engine.snapshot();
  await page.routeWebSocket(/\/demo-stream\?/,ws=>{socket=ws;ws.send(JSON.stringify({type:'hello',serverId:'forecast-live',catalog}));});
  await page.goto('/#data');await page.getByRole('checkbox',{name:'운전 데모 연결'}).check();
  await page.evaluate(()=>{location.hash='#forecast';});
  await expect.poll(()=>!!socket).toBe(true);
  const tick=()=>socket.send(JSON.stringify({type:'snapshot',serverId:'forecast-live',seq:++seq,state}));
  tick();const timer=setInterval(tick,300);
  try{
    const origin=page.getByLabel('시작값 출처');
    const remaining=(state.material.ships['1'].remaining+state.material.ships['2'].remaining)/10000;
    await expect(origin).toContainText('현재 운전 상태');
    await expect(origin).toContainText(`하역 잔량 ${remaining.toFixed(1)}만 t`);
    const group=page.getByRole('group',{name:'시작값',exact:true});
    await expect(group.getByRole('button',{name:'현재 운전 상태',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.screenshot({path:'.tooling-tmp/forecast-live.png'});
    await group.getByRole('button',{name:'기준 표본',exact:true}).click();
    await expect(origin).toHaveText('시작값 기준 표본');
  }finally{clearInterval(timer);}
});

test('통합 시뮬레이션은 도우미 섹션이 빠진 자료 여러 건으로 펼쳐져도 확인할 변화 머리와 검토 버튼이 첫 화면 안에 있다', async ({ page }) => {
  const snapshot = suppliedPlanningFixture('검증 계산', '2027-01-01', 30);
  snapshot.classification = 'operational';
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, kind: 'missing', title: `빠진 자료 ${i + 1}`, detail: '확인 필요', count: 3, targets: [], action: null }));
  await page.route('**/api/runs', route => route.fulfill({ json: [{ id: '검증 계산', name: '검증 계산', period: '2027-01-01 ~ 2027-12-31' }] }));
  await page.route('**/api/planning/**', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/assistant/checks?**', route => route.fulfill({ json: { screen: 'simulation', as_of: '2027-01-01T09:00:00+09:00', items, errors: [] } }));
  await page.route('**/api/assistant/status', route => route.fulfill({ json: { llm: true } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#simulation');
  await expect(page.getByRole('region', { name: '도우미' }).getByText('빠진 자료 1')).toBeVisible();
  const watch = page.getByRole('complementary', { name: '확인할 변화' });
  await expect(watch.getByRole('heading', { name: '확인할 변화' })).toBeVisible();
  const head = (await watch.getByRole('heading', { name: '확인할 변화' }).boundingBox())!;
  expect(head.y + head.height).toBeLessThanOrEqual(1080);
  const button = (await watch.getByRole('button', { name: '부족 시점·반입 가능 여부 검토' }).boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(1080);
});
