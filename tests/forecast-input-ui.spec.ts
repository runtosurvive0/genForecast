import {test, expect} from './auth-fixture';
import { planningFixture, suppliedPlanningFixture } from './planning-fixture';

test('전망에서 시작재고를 저장하고 실패 시 입력을 보존하며 같은 계획의 수급을 갱신한다',async({page},testInfo)=>{
  let saved=false, attempts=0;
  await page.route('**/api/runs',r=>r.fulfill({json:[{id:'stock-run',name:'월간 전망',period:'2027-01-01 ~ 2027-12-31'}]}));
  await page.route('**/api/planning/runs/stock-run/snapshot?**',r=>{
    const s=saved?suppliedPlanningFixture('stock-run'):planningFixture('stock-run');
    if(saved) s.inventory.initial_lots=['g14','g58','g910'].flatMap(group_id=>[
      {group_id,grade:'high' as const,tonnes:40000,cv:6100,is_assumption:1},
      {group_id,grade:'low' as const,tonnes:60000,cv:4800,is_assumption:1},
    ]);
    return r.fulfill({json:s});
  });
  await page.route('**/api/supply/simulation-stock',r=>{
    expect(r.request().postDataJSON()).toEqual({run_id:'stock-run',high_cv:6100,low_cv:4800,high_tonnes:{g14:40000,g58:40000,g910:40000},low_tonnes:{g14:60000,g58:60000,g910:60000}});
    if(++attempts===1) return r.fulfill({status:503,json:{detail:'재고 저장 연결 실패'}});
    saved=true; return r.fulfill({json:{run_id:'stock-run',at:'2027-01-01T00:00:00+09:00',total_tonnes:300000,classification:'simulation'}});
  });
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#simulation');
  const stock=page.getByRole('region',{name:'전망 시작재고'});
  await stock.getByRole('button',{name:'시작재고 설정',exact:true}).click();
  await expect(stock).toContainText('2027-01-01 00:00 KST');
  await expect(stock.getByLabel('고열량탄 발열량')).toBeEmpty();
  for(const n of [1,2,3]){
    await stock.getByLabel(`${n}저탄장 고열량탄`).fill('40000');
    await stock.getByLabel(`${n}저탄장 저열량탄`).fill('60000');
  }
  await stock.getByLabel('고열량탄 발열량').fill('6100');
  await stock.getByLabel('저열량탄 발열량').fill('4800');
  await page.screenshot({path:testInfo.outputPath('forecast-stock-light.png'),fullPage:true});
  await stock.getByRole('button',{name:'저장하고 수급 갱신'}).click();
  await expect(stock.getByRole('alert')).toContainText('재고 저장 연결 실패');
  await expect(stock.getByLabel('1저탄장 고열량탄')).toHaveValue('40000');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:testInfo.outputPath('forecast-stock-dark.png'),fullPage:true});
  await page.setViewportSize({width:1024,height:768});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await stock.getByRole('button',{name:'저장하고 수급 갱신'}).click();
  await expect(stock).toContainText('300,000');
  await expect(stock.getByRole('button',{name:'시작재고 확인'})).toBeVisible();
  await expect(page.locator('.gf-forecast-focus')).toContainText('290,000');
  expect(attempts).toBe(2);
});

const scenario = {name:'월간 전망',start:'2027-01-01',end:'2027-12-31',weather:'normal',demand_growth_pct:null,solar_growth_pct:null,coal_adjust_pct:Array(12).fill(0),reserve_ratio:.12,quality:'normal',workers:null,coal_oh:[],nuclear_oh:[]};
const detail = {id:5,payload:{scenario,heat_prices:{'당진1':Array(12).fill(30000)},fuel:{calorific_kcal_kg:5500,is_assumption:true}}};

test('연월별 단가를 수정해도 호기 제원과 회귀 이력이 저장 입력에 함께 남는다', async ({page}) => {
  const reference = {coal_units:[{unit:'당진1',heat_a1:1}],nuclear_units:[{unit:'원전A',active_from:'2027-01-01'}],
    heat_prices_by_month:{'당진1':{'2026-11':12000,'2026-12':12500,'2027-01':13000,'2027-02':14000}},
    price_regression:{'당진1':{method:'linear_ols',trained_through:'2026-10'}}};
  const source={...detail,payload:{...detail.payload,scenario:{...scenario,start:'2026-11-09',end:'2027-02-06'},input_reference:reference}};
  await page.route('**/api/planning/inputs/5',r=>r.fulfill({json:source}));
  let body='';
  await page.route('**/api/planning/inputs/upload',r=>{body=r.request().postDataBuffer()!.toString();return r.fulfill({json:{...source,id:6}});});
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정',exact:true}).click();
  await expect(page.getByText(/2026년 11·12월은 과거 단가의 회귀 추정값/)).toBeVisible();
  await page.getByText('호기별 월 열량단가',{exact:false}).click();
  await expect(page.getByLabel('2027-01',{exact:true})).toHaveValue('13000');
  await page.getByLabel('2026-11',{exact:true}).fill('13500');
  await page.getByRole('button',{name:'입력 저장',exact:true}).click();
  await expect.poll(()=>body).toContain('name="input_reference"');
  expect(body).toContain('"2026-11":13500');
  expect(body).toContain('"heat_a1":1');
  expect(body).toContain('"method":"linear_ols"');
  expect(body).toContain('"source":"manual"');
});

test('호기별 정지계획은 CSV를 저장한 DB 일정을 연도와 발전원으로 조회한다', async ({page},testInfo) => {
  await page.route('**/api/planning/outages',r=>r.fulfill({json:{input_id:17,name:'CSV 계획',default_year:2027,source_files:[],rows:[
    {unit:'당진1',kind:'coal',start:'2027-01-20',end:'2027-02-20',start_at:'2027-01-20T00:00:00+09:00',end_at:'2027-02-21T00:00:00+09:00',capacity_mw:500,note:'정비 A'},
    {unit:'새울3',kind:'nuclear',start:'2027-10-23',end:'2028-01-15',start_at:'2027-10-23T00:00:00+09:00',end_at:'2028-01-16T00:00:00+09:00',capacity_mw:1000,note:'정비 B'},
  ]}}));
  await page.goto('/#schedule');
  await expect(page.getByRole('heading',{name:'호기별 계획정지 일정',exact:true})).toBeVisible();
  const table=page.locator('.gf-outage-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table).toContainText('2028-01-15');
  await page.getByLabel('정비 호기 검색').fill('당진1');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('정비 호기 검색').fill('');
  await page.getByLabel('정비 발전원').selectOption('nuclear');
  await expect(table).toContainText('새울3');
  await expect(table).not.toContainText('당진1');
  await page.screenshot({path:testInfo.outputPath('db-outages-light.png'),fullPage:true});
  await page.getByRole('button',{name:'다크 모드로 전환',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('db-outages-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('정비 DB 연결 실패를 빈 일정이나 샘플 일정으로 바꾸지 않는다', async ({page}) => {
  await page.route('**/api/planning/outages',r=>r.fulfill({status:503,json:{detail:'정비 DB 연결 불가'}}));
  await page.goto('/#schedule');
  await expect(page.getByRole('alert')).toContainText('정비 DB 연결 불가');
  await expect(page.locator('.gf-outage-table')).toHaveCount(0);
});

test('미래 계산보다 오늘을 포함한 계산을 우선 선택하고 오늘부터 조회한다', async ({page}, testInfo) => {
  await page.clock.install({time:new Date('2026-11-08T15:01:00Z')});
  await page.route('**/api/runs', r => r.fulfill({json:[
    {id:'future',name:'2027 계획',period:'2027-01-01 ~ 2027-12-31'},
    {id:'current',name:'현재 계획',period:'2026-11-01 ~ 2027-02-06'},
  ]}));
  await page.route('**/api/planning/runs/current/snapshot?**', r => {
    const query = new URL(r.request().url()).searchParams;
    expect(query.get('start')).toBe('2026-11-09');
    expect(query.get('horizon')).toBe('30');
    const snapshot = suppliedPlanningFixture('current','2026-11-09',30);
    snapshot.run_start='2026-11-01'; snapshot.run_end='2027-02-06';
    return r.fulfill({json:snapshot});
  });
  await page.goto('/#simulation');
  await expect(page.getByLabel('저장된 MILP 계산')).toHaveValue('current');
  await expect(page.getByLabel('MILP 조회 시작일')).toHaveValue('2026-11-09');
  await expect(page.locator('.gf-forecast-focus')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('today-result.png'),fullPage:true});
});

test('저장 조건을 오늘부터 90일로 복사하고 해당 기간을 실행 요청에 저장한다', async ({page}, testInfo) => {
  await page.clock.install({time:new Date('2026-11-08T15:01:00Z')});
  let savedBody = '';
  await page.route('**/api/planning/inputs/upload', r => {
    savedBody = r.request().postDataBuffer()!.toString();
    return r.fulfill({json:{...detail,id:6}});
  });
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정',exact:true}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2027-01-01');
  await page.getByRole('button',{name:'오늘부터 90일',exact:true}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2026-11-09');
  await expect(page.getByLabel('종료일',{exact:true})).toHaveValue('2027-02-06');
  await page.screenshot({path:testInfo.outputPath('today-conditions.png'),fullPage:true});
  await page.getByRole('button',{name:'입력 저장',exact:true}).click();
  await expect.poll(() => savedBody).toContain('2026-11-09');
  expect(savedBody).toContain('2027-02-06');
  expect(savedBody).toContain('30000');
  expect(scenario.start).toBe('2027-01-01');
});

test('핵심 전망을 먼저 보여주고 상세 차트와 정지 일정은 펼쳐서 확인한다',async({page},testInfo)=>{
  await page.route('**/api/runs',r=>r.fulfill({json:[{id:'review',name:'월간 전망',period:'2027-01-01 ~ 2027-01-30'}]}));
  await page.route('**/api/planning/runs/review/snapshot?**',r=>r.fulfill({json:suppliedPlanningFixture('review','2027-01-01',30)}));
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#simulation');
  await expect(page.locator('.gf-forecast-focus')).toBeVisible();
  const supply=page.locator('details').filter({has:page.locator('summary strong',{hasText:'저탄장별 수급 상세'})});
  await expect(supply).not.toHaveAttribute('open','');
  await page.screenshot({path:testInfo.outputPath('forecast-result-light.png'),fullPage:true});
  await supply.locator('summary').click();
  await expect(supply.locator('.gf-forecast-details-content')).toBeVisible();
  await expect(supply.locator('svg').first()).toBeVisible();
  await page.getByRole('button',{name:'호기별 일정 보기'}).click();
  await expect(page.locator('#gf-forecast-outages details')).toHaveAttribute('open','');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:testInfo.outputPath('forecast-result-dark.png'),fullPage:true});
  await page.setViewportSize({width:1024,height:768});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test.beforeEach(async({page})=>{
  await page.route('**/api/runs',r=>r.fulfill({json:[]}));
  await page.route('**/api/planning/inputs',r=>r.fulfill({json:[{id:5,...scenario}]}));
  await page.route('**/api/planning/inputs/5',r=>r.fulfill({json:detail}));
  await page.route('**/api/planning/executions',r=>r.fulfill({json:[]}));
  await page.route('**/api/job',r=>r.fulfill({json:{state:'idle'}}));
});

test('실행 요청 실패 후 저장된 조건을 중복 저장하지 않고 다시 실행한다',async({page})=>{
  let saves=0, starts=0;
  await page.route('**/api/planning/inputs/upload',r=>{saves++;return r.fulfill({json:{...detail,id:6}})});
  await page.route('**/api/run',r=>{
    starts++;expect(r.request().postDataJSON()).toEqual({input_id:6});
    return starts===1?r.fulfill({status:503,json:{detail:'계산 서버 연결 실패'}}):r.fulfill({json:{run_id:'retry-run'}});
  });
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정'}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2027-01-01');
  await page.getByRole('button',{name:'저장 후 전망 실행'}).click();
  await expect(page.getByRole('alert')).toContainText('조건은 저장됐지만');
  await page.getByRole('button',{name:'저장된 조건으로 다시 실행'}).click();
  await expect(page.getByRole('region',{name:'전망 실행 상태'})).toContainText('전망을 계산하고 있습니다');
  expect(saves).toBe(1);expect(starts).toBe(2);
});

test('DB 연결 실패를 빈 목록으로 표시하지 않고 다시 불러온다',async({page})=>{
  let loads=0;
  await page.route('**/api/planning/inputs',r=>++loads===1?r.fulfill({status:503,json:{detail:'DB 연결 실패'}}):r.fulfill({json:[{id:5,...scenario}]}));
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정'}).click();
  await expect(page.getByRole('alert')).toContainText('DB 연결 실패');
  await expect(page.getByText('저장된 전망 조건이 없습니다')).not.toBeVisible();
  await page.getByRole('button',{name:'조건 다시 불러오기'}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2027-01-01');
});

test('상태 확인 전에는 실행을 막고 입력 화면은 라이트·다크·좁은 화면에서 넘치지 않는다',async({page},testInfo)=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/job',async r=>{await gate;await r.fulfill({json:{state:'idle'}})});
  await page.setViewportSize({width:1920,height:1080});
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정'}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2027-01-01');
  await expect(page.getByRole('button',{name:'저장 후 전망 실행'})).toBeDisabled();
  release();
  await expect(page.getByRole('button',{name:'저장 후 전망 실행'})).toBeEnabled();
  const start=page.getByLabel('시작일',{exact:true});
  expect(await start.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const inherited=page.getByLabel('DB에서 가져온 조건');
  expect((await inherited.boundingBox())!.x).toBeGreaterThan((await start.boundingBox())!.x);
  await page.screenshot({path:testInfo.outputPath('forecast-input-light.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:testInfo.outputPath('forecast-input-dark.png'),fullPage:true});
  await page.setViewportSize({width:1024,height:768});
  expect((await inherited.boundingBox())!.y).toBeGreaterThan((await start.boundingBox())!.y);
  await page.getByText('호기별 월 열량단가 · 1개 호기',{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('forecast-input-compact.png'),fullPage:true});
});

test('일반 회원은 조건과 결과를 조회하고 저장·실행은 노출하지 않는다',async({page})=>{
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{id:'00000000-0000-4000-8000-000000000001',username:'member',displayName:'Member',role:'member',status:'active',version:1,createdAt:0,reviewedAt:null,mustChangePassword:0},scope:'full'}}));
  await page.route('**/api/planning/executions',r=>r.fulfill({json:[{id:'past',input_id:5,state:'done',summary:{scenario}}]}));
  await page.goto('/#simulation');
  await page.getByRole('tab',{name:'조건 설정'}).click();
  await expect(page.getByLabel('시작일',{exact:true})).toHaveValue('2027-01-01');
  await expect(page.getByLabel('시작일',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('기준으로 가져올 입력',{exact:true})).toBeEnabled();
  await expect(page.getByText('조건 저장과 전망 실행은 관리자 권한이 필요합니다.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'저장 후 전망 실행'})).toHaveCount(0);
  await page.getByText('최근 계산 이력 · 1건',{exact:true}).click();
  await expect(page.getByRole('button',{name:'결과 보기',exact:true})).toBeVisible();
});

