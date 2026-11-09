import { test, expect } from './auth-fixture';

test('이탄과 하역 실적은 입력한 값으로 원장에 저장한다', async ({page}) => {
  const writes: {path:string, body:unknown}[] = [];
  await page.route('**/api/supply/records', route => route.fulfill({json:{transfers:[],vessels:[{
    id:1,name:'TEST SHIP',cargo:1000,arrival_at:'2026-11-01T00:00:00+09:00',classification:'planned',
    points:[{at:'2026-11-01T00:00:00+09:00',cumulative:0,rate:100,allocations:{g14:1,g58:0,g910:0}}]
  }]}}));
  await page.route('**/api/supply/transfers', route => { writes.push({path:'transfer',body:route.request().postDataJSON()}); return route.fulfill({json:{id:1}}); });
  await page.route('**/api/supply/vessels/1/unloading', route => { writes.push({path:'unload',body:route.request().postDataJSON()}); return route.fulfill({json:{id:2}}); });
  await page.goto('/#fuel-ledger');
  await page.getByText('이탄 입력', {exact:true}).click();
  await page.getByLabel('이탄 시각 · KST').fill('2026-11-05T10:00');
  await page.getByLabel('이탄량 (t)').fill('120');
  await page.getByRole('button',{name:'이탄 저장'}).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({from_group:'g14',to_group:'g58',tonnes:120,at:'2026-11-05T10:00:00+09:00'});
  await page.getByText('하역 입력', {exact:true}).click();
  await page.getByRole('combobox', {name:'선박', exact:true}).selectOption('1');
  await page.getByLabel('기록 시각 · KST').fill('2026-11-05T11:00');
  await page.getByLabel('누적 하역량 (t)').fill('400');
  await page.getByLabel('하역 속도 (t/h)').fill('80');
  await page.getByRole('button',{name:'하역 저장'}).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toMatchObject({cumulative:400,rate:80,allocations:{g14:1,g58:0,g910:0}});
});
