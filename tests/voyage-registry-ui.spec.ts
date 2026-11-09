import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.beforeEach(async ({ context, page }) => {
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    url.port = "8097";
    const response = await route.fetch({ url: url.href });
    await route.fulfill({ response });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?source=synthetic#voyages");
  await page.getByLabel("아이디", { exact: true }).fill("test-admin");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("only-for-isolated-ui-tests-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "항차·화물 원장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "항차·화물 원장 공용 원장" }),
  ).toBeVisible();
});

test('항차·화물의 상위 보기와 원장 하위 메뉴가 고정된 위치에서 구분된다', async ({page}) => {
  const nav=page.getByRole('navigation',{name:'항차·화물 화면'});
  await expect(nav.getByRole('button',{name:'항차·화물 원장'})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('tablist',{name:'원장 종류'})).toBeVisible();
  await page.getByRole('tab',{name:/화물 원장/}).click();
  await expect(nav.getByRole('button',{name:'항차·화물 원장'})).toHaveAttribute('aria-current','page');
  await nav.getByRole('button',{name:'선박 추적'}).click();
  await expect(nav.getByRole('button',{name:'선박 추적'})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('heading',{name:'관심 선박',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'항차·화물 원장'}).click();
  await expect(page.getByRole('tablist',{name:'원장 종류'})).toBeVisible();
});

test('원장 날짜 필터에 결과가 없으면 등록 누락이 아니라 필터 상태를 안내한다', async ({ page }) => {
  const name = `FILTER-${Date.now()}`;
  await page.getByRole('button', { name: '배선 등록', exact: true }).click();
  await page.getByLabel('배선 메모', { exact: true }).fill(name);
  await page.getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await page.getByRole('button', { name: '공용 원장에 반영', exact: true }).click();
  await page.getByLabel('조회 시작일', { exact: true }).fill('2000-01-01');
  await page.getByLabel('조회 종료일', { exact: true }).fill('2000-01-02');
  await expect(page.locator('.vr-empty')).toContainText('조건에 맞는 결과가 없습니다');
  await page.getByRole('button', { name: '조건 초기화', exact: true }).first().click();
  await expect(page.locator('.vr-table-scroll')).toContainText(name);
  await page.getByLabel('원장 검색', { exact: true }).fill(`  ${name}  `);
  await expect(page.locator('.vr-table-scroll')).toContainText(name);
});

test("draft voyage entry preserves multiple cargo when its formal number is assigned", async ({
  page,
}) => {
  const name = `DRAFT-${Date.now()}`;
  await page.getByRole("button", { name: "배선 등록", exact: true }).click();
  await page.getByLabel("배선 메모", { exact: true }).fill(name);
  await page.getByLabel("탄종 *", { exact: true }).fill("TEST COAL A");
  await page.getByLabel("예정물량(t)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "화물 추가", exact: true }).click();
  await page.getByLabel("탄종 *", { exact: true }).nth(1).fill("TEST COAL B");
  await page.getByLabel("예정물량(t)", { exact: true }).nth(1).fill("2000");
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await page.getByRole("tab", { name: /화물 원장/ }).click();
  await page.getByLabel("원장 검색", { exact: true }).fill("TEST COAL A");
  await expect(page.locator(".vr-table-scroll")).toContainText("TEST COAL A");
  await page.getByRole("button", { name: "화물 등록", exact: true }).click();
  await page.getByLabel("배선 *", { exact: true }).selectOption({ label: name });
  await page.getByRole("button", { name: "TEST COAL A · 기존 화물 수정" }).click();
  await expect(page.getByLabel("탄종 *", { exact: true })).toHaveValue("TEST COAL A");
  await expect(page.getByLabel("예정물량(t)", { exact: true })).toHaveValue("1000");
  await page.getByRole("button", { name: "입력 닫기" }).click();
  await page.getByRole("tab", { name: /배선 원장/ }).click();
  await page.getByLabel("원장 검색", { exact: true }).fill(name);
  await expect(page.locator(".vr-table-scroll")).toContainText(name);
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("접안부두", { exact: true }).selectOption("BD-2");
  await page.getByLabel("저탄장", { exact: true }).selectOption("1");
  await page.getByLabel("항차 연도", { exact: true }).fill("26");
  await page.getByLabel("항차 일련번호", { exact: true }).fill("998");
  await expect(page.getByLabel("항차번호", { exact: true })).toHaveValue("26-2-998");
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await expect(page.locator(".vr-table-scroll")).toContainText("26-2-998");
  await expect(page.locator(".vr-related")).toContainText("TEST COAL A");
  await expect(page.locator(".vr-related")).toContainText("TEST COAL B");
});

test('voyage number suggests the next used sequence and leaves plans unnumbered', async ({page}) => {
  const records = await page.evaluate(async () => (await fetch('/api/voyage-registry/records')).json());
  const used = records.voyages.map((v: {voyage_number: string | null}) => v.voyage_number?.match(/^26-2-(\d{3})$/)).filter(Boolean).map((m: RegExpMatchArray) => Number(m[1]));
  const next = Math.max(0, ...used) + 1;
  await page.getByRole('button', {name:'배선 등록', exact:true}).click();
  await expect(page.getByLabel('항차번호', {exact:true})).toHaveValue('');
  await expect(page.getByLabel('항차번호 부여', {exact:true})).toHaveCount(0);
  await page.getByLabel('항차 연도', {exact:true}).fill('26');
  await page.getByLabel('접안부두', {exact:true}).selectOption('BD-2');
  await page.getByLabel('저탄장', {exact:true}).selectOption('1');
  await expect(page.getByLabel('항차 일련번호', {exact:true})).toHaveValue(String(next));
  if (next <= 999) await expect(page.getByLabel('항차번호', {exact:true})).toHaveValue(`26-2-${String(next).padStart(3, '0')}`);
  if (used.length) {
    await page.getByLabel('항차 일련번호', {exact:true}).fill(String(used[0]));
    await page.getByRole('button', {name:'변경 내용 확인', exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('이미 사용 중인 항차번호');
  }
});

test('voyage entry brings in interest vessels and reuses matching shared ships', async ({page}) => {
  const suffix = Date.now().toString();
  const result = await page.evaluate(async suffix => {
    const records = await (await fetch('/api/voyage-registry/records')).json();
    const changes = { ships: [{ ship_code: `S-${suffix}`, name: '공용 선박', mmsi: '440123456' }] };
    const saved = await fetch('/api/voyage-registry/commit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({changes,revision:records.revision}) });
    const state = await (await fetch('/api/me/vessel-workspace')).json();
    state.workspace = { version:1, watchlist:['interest-existing','interest-new'], voyages:[], vessels:[
      {id:'interest-existing', name:'관심 선박 기존', mmsi:'440123456', imo:'', source:'manual'},
      {id:'interest-new', name:'관심 선박 신규', mmsi:'440123457', imo:'', source:'manual'}] };
    const workspace = await fetch('/api/me/vessel-workspace', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(state) });
    return saved.ok && workspace.ok;
  }, suffix);
  expect(result).toBe(true);
  await page.reload();
  await page.getByRole('button', {name:'항차·화물 원장', exact:true}).click();
  await page.getByRole('button', {name:'배선 등록', exact:true}).click();
  const sections = page.locator('.ve-main > section');
  await expect(sections.first().getByRole('heading')).toHaveText('투입 선박');
  const select = page.getByLabel('선박 연결', {exact:true});
  await expect(select.locator('optgroup[label="관심 선박"]')).toContainText('관심 선박 기존');
  await select.selectOption('interest:interest-existing');
  await expect(page.getByLabel('선박명 *', {exact:true})).toHaveValue('공용 선박');
  await page.getByLabel('배선 메모', {exact:true}).fill(`EXISTING-${suffix}`);
  await page.getByRole('button', {name:'변경 내용 확인', exact:true}).click();
  await page.getByRole('button', {name:'공용 원장에 반영', exact:true}).click();
  const reused = await page.evaluate(async () => (await fetch('/api/voyage-registry/records')).json());
  expect(reused.voyages.find((v: {notes:string}) => v.notes === `EXISTING-${suffix}`).ship_code).toBe(`S-${suffix}`);
  expect(reused.ships.filter((s: {mmsi:string}) => s.mmsi === '440123456')).toHaveLength(1);
  await page.getByRole('button', {name:'배선 등록', exact:true}).click();
  await select.selectOption('interest:interest-new');
  await expect(page.getByLabel('선박명 *', {exact:true})).toHaveValue('관심 선박 신규');
  await expect(page.getByLabel('MMSI', {exact:true})).toHaveValue('440123457');
  await page.getByLabel('배선 메모', {exact:true}).fill(`INTEREST-${suffix}`);
  await page.getByRole('button', {name:'변경 내용 확인', exact:true}).click();
  await page.getByRole('button', {name:'공용 원장에 반영', exact:true}).click();
  const after = await page.evaluate(async () => (await fetch('/api/voyage-registry/records')).json());
  expect(after.ships.filter((s: {mmsi:string}) => s.mmsi === '440123457')).toHaveLength(1);
  expect(after.ships.filter((s: {mmsi:string}) => s.mmsi === '440123456')).toHaveLength(1);
});

async function saveManual(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await expect(dialog.locator(".vr-validation")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

test('화물 원장은 항차·화물 원장의 하위 탭에서 연다', async ({page}) => {
  await page.getByRole('tab', {name:/^화물 원장/}).click();
  await expect(page.getByRole('heading', {name:'항차·화물 원장 공용 원장'})).toBeVisible();
  await expect(page.getByRole('tab', {name:/^화물 원장/})).toHaveAttribute('aria-selected','true');
  await expect(page).not.toHaveURL(/#fuel-ledger/);
});

test('배선 화면에서 입력한 실제 입고가 Pile 배분·정정과 저탄 현황에 이어진다', async ({page}) => {
  const coal=`입고연결-${Date.now()}`;
  await page.getByRole('button',{name:'배선 등록',exact:true}).click();
  await page.getByLabel('탄종 *',{exact:true}).fill(coal);
  await page.getByLabel('예정물량(t)',{exact:true}).fill('100');
  await page.getByLabel('입고 시작일',{exact:true}).fill('2026-11-03');
  await page.getByLabel('입고 종료일',{exact:true}).fill('2026-11-04');
  await page.getByLabel('입하량(t)',{exact:true}).fill('100');
  await page.getByLabel('실제 하역완료(KST)',{exact:true}).fill('2026-11-04T12:00');
  await page.getByRole('button',{name:'변경 내용 확인',exact:true}).click();
  await page.getByRole('button',{name:'공용 원장에 반영',exact:true}).click();
  await page.getByRole('button',{name:'Pile 재고',exact:true}).click();
  await page.getByLabel('입하 화물',{exact:true}).selectOption({label:`항차 미정 · ${coal} · 100 t`});
  await page.getByLabel('적치 구역 1',{exact:true}).selectOption('P1');
  await page.getByLabel('적치량 1',{exact:true}).fill('100');
  await page.getByRole('button',{name:'재고에 반영',exact:true}).click();
  const lot=page.locator('.gf-inventory-row').filter({hasText:coal});
  await expect(lot).toContainText('Pile 1');
  await expect(lot).toContainText('100');
  await lot.getByRole('button',{name:'배분 정정'}).click();
  await page.getByLabel('정정 구역 1').selectOption('P5');
  await page.getByLabel('정정 잔량 1').fill('90');
  await page.getByLabel('배분 정정 사유').fill('입고 위치 확인');
  await page.getByRole('button',{name:'정정 저장'}).click();
  await expect(lot).toContainText('Pile 5');
  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'저탄·재고',exact:true}).click();
  await page.getByRole('tab',{name:/^2저탄장/}).click();
  await expect(page.getByLabel('수기 원장 구역별 잔량')).toContainText('Pile 5 90 t');
  await expect(page.getByLabel('수기 원장 구역별 잔량')).toContainText('더미 위치 미확인');
});

test('received cargo flows into manual pile stock and constraint-based blend', async ({page}) => {
  const suffix = Date.now().toString();
  const seeded = await page.evaluate(async suffix => {
    const current = await (await fetch('/api/voyage-registry/records')).json();
    const changes = {
      voyages: [{voyage_no: `V-${suffix}`, status: 'completed', actual_unload_end: '2026-11-04 12:00'}],
      cargo: [{cargo_no: `C-${suffix}`, voyage_no: `V-${suffix}`, destination_plant_id: 'dangjin', coal_name: `연계탄-${suffix}`,
        planned_t: 100, received_t: 100, receipt_end_date: '2026-11-04'}],
      assays: [{assay_id: `A-${suffix}`, cargo_no: `C-${suffix}`, stage: 'unloading', result_status: 'confirmed', gcv_arb: 5500, tm_ar: 10, sulfur_ar: .3}],
    };
    const response = await fetch('/api/voyage-registry/commit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({changes, revision:current.revision})});
    return response.ok;
  }, suffix);
  expect(seeded).toBe(true);
  await page.getByRole('button', {name:'Pile 재고', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Pile 재고 원장'})).toBeVisible();
  await page.getByLabel('입하 화물', {exact:true}).selectOption({label:`항차 미정 · 연계탄-${suffix} · 100 t`});
  await page.getByLabel('적치 구역 1', {exact:true}).selectOption('P1');
  await page.getByLabel('적치량 1', {exact:true}).fill('100');
  await page.getByRole('button', {name:'재고에 반영', exact:true}).click();
  await expect(page.locator('.gf-inventory-row').filter({hasText:`연계탄-${suffix}`})).toContainText('100');
  await page.locator('.gf-inventory-row').filter({hasText:`연계탄-${suffix}`}).getByRole('button',{name:'배분 정정'}).click();
  await page.getByLabel('정정 구역 1').selectOption('P5');
  await page.getByLabel('정정 잔량 1').fill('90');
  await page.getByLabel('배분 정정 사유').fill('위치 확인 후 정정');
  await page.screenshot({path:'.tooling-tmp/pile-reconcile-form-1920.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('화물 배분 정정')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('화물 배분 정정').scrollIntoViewIfNeeded();
  await page.screenshot({path:'.tooling-tmp/pile-reconcile-form-mobile.png'});
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('button',{name:'정정 저장'}).click();
  await expect(page.locator('.gf-inventory-row').filter({hasText:`연계탄-${suffix}`})).toContainText('Pile 5');
  await page.getByText('배분 정정 이력', {exact:true}).click();
  await expect(page.locator('.gf-inventory-history')).toContainText('위치 확인 후 정정');
  await page.screenshot({path:'.tooling-tmp/inventory-link-1920.png'});
  await page.getByRole('button', {name:'상탄·혼탄', exact:true}).click();
  await page.getByRole('button', {name:'혼탄 분석', exact:true}).click();
  await page.getByLabel(`Pile 5 연계탄-${suffix} 선택`, {exact:true}).check();
  await page.getByLabel('혼탄 요청량', {exact:true}).fill('50');
  await page.getByLabel('목표 발열량 ARB', {exact:true}).fill('5500');
  await page.getByLabel('유황분 상한', {exact:true}).fill('0.5');
  await page.getByRole('button', {name:'조건 충족 조합 계산', exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'조건 충족 조합'})).toContainText('50 t');
  await page.screenshot({path:'.tooling-tmp/blend-link-1920.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.gf-inventory-result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'.tooling-tmp/blend-link-mobile.png'});
});

test("shared voyage registry saves related records, previews Excel conflicts and fits both themes", async ({
  page,
}) => {
  test.setTimeout(90000);
  mkdirSync("artifacts/voyage-registry", { recursive: true });
  const suffix = Date.now().toString().slice(-8);
  const voyage = `TEST PLAN ${suffix}`,
    cargo = `TEST COAL ${suffix}`;
  await page.getByRole("button", { name: "배선 등록", exact: true }).click();
  await page.getByLabel("배선 메모", { exact: true }).fill(voyage);
  await page.getByLabel("선박 연결", { exact: true }).selectOption("new");
  await page.getByLabel("선박명 *", { exact: true }).fill("REGISTRY TEST BULK");
  await page.getByLabel("MMSI", { exact: true }).fill(`0${suffix}`);
  await page.getByLabel("선적항", { exact: true }).fill("Newcastle");
  await page.getByLabel("하역항", { exact: true }).fill("당진");
  await page
    .getByLabel("예정 출항(KST)", { exact: true })
    .fill("2026-11-01T08:30");
  await page
    .getByLabel("예정 입항(KST)", { exact: true })
    .fill("2026-11-12T09:00");
  await page.getByLabel("탄종 *", { exact: true }).fill(cargo);
  await page.getByLabel("예정물량(t)", { exact: true }).fill("30000");
  await page.getByLabel("입고 시작일", { exact: true }).fill("2026-11-12");
  await page.getByLabel("입고 종료일", { exact: true }).fill("2026-11-14");
  await page.getByLabel("입하량(t)", { exact: true }).fill("29500");
  await page.screenshot({ path: "artifacts/voyage-registry/entry-1920.png" });
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await expect(page.locator(".vr-validation")).toHaveCount(0);
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await page.getByRole("tab", { name: /^화물/ }).click();
  await page.getByLabel("원장 검색", { exact: true }).fill(cargo);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "전체 내보내기", exact: true })
    .click();
  const download = await downloadEvent;
  const workbook = `.tooling-tmp/registry-${suffix}.xlsx`;
  await download.saveAs(workbook);
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("예정물량(t)", { exact: true }).fill("32000");
  await saveManual(page);
  await page
    .getByLabel("엑셀 원장 파일", { exact: true })
    .setInputFiles(workbook);
  await expect(page.getByRole("dialog")).toContainText("수정 1건");
  await expect(
    page.getByRole("button", { name: "공용 원장에 반영", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "artifacts/voyage-registry/excel-review.png" });
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".vr-table-scroll")).toContainText("30,000");
  await page.reload();
  await page.getByRole("button", { name: "항차·화물 원장", exact: true }).click();
  await page.getByRole("tab", { name: /^화물/ }).click();
  await expect(page.locator(".vr-table-scroll")).toContainText(cargo);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/voyage-registry/light-1920.png" });
  await page
    .getByRole("button", { name: "다크 모드로 전환", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/voyage-registry/dark-1920.png" });
  await page
    .getByRole("button", { name: "최근 변경 이력", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("엑셀");
  await page.getByRole("button", { name: "이력 닫기", exact: true }).click();
  for (const width of [1131, 390]) {
    await page.setViewportSize({ width, height: 884 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `artifacts/voyage-registry/dark-${width}.png`,
      fullPage: true,
    });
  }
});

test("registry reports unavailable backend without local or synthetic save fallback", async ({
  page,
}) => {
  await page.route("**/api/voyage-registry/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "ZGX 연결 불가" }),
    }),
  );
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.locator('.vr-workspace [role="alert"]')).toContainText(
    "ZGX 연결 불가",
  );
});

test("manual fields freeze while the server prepares the exact change preview", async ({
  page,
}) => {
  await page.getByRole("tab", { name: /^선박/ }).click();
  await page.getByRole("button", { name: "선박 등록", exact: true }).click();
  await page.getByLabel("선박명 *", { exact: true }).fill("Reviewed value");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/voyage-registry/preview", async (route) => {
    await gate;
    await route.fallback();
  });
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  try {
    await expect(page.getByLabel("선박명 *", { exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole("dialog")).toContainText("Reviewed value");
});

test("approved members can edit the shared registry", async ({ page }) => {
  const username = `registry-${Date.now()}`;
  await page.evaluate(async (username) => {
    const registered = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        displayName: "Registry Editor",
        password: "registry-test-2026",
      }),
    });
    if (!registered.ok) throw new Error("Test registration failed");
    const { user } = await registered.json();
    const approved = await fetch(`/api/admin/users/${user.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", version: user.version }),
    });
    if (!approved.ok) throw new Error("Test approval failed");
  }, username);
  await page.getByRole("button", { name: "내 계정", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByLabel("아이디", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("registry-test-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("button", { name: "항차·화물 원장", exact: true }).click();
  await expect(page.locator(".vr-context")).toContainText("팀 공동 편집");
  await page.getByRole("tab", { name: /^선박/ }).click();
  await page.getByRole("button", { name: "선박 등록", exact: true }).click();
  await page.getByLabel("선박명 *", { exact: true }).fill("TEAM EDITED SHIP");
  await saveManual(page);
  await expect(page.locator(".vr-table-scroll")).toContainText(
    "TEAM EDITED SHIP",
  );
});

test("assay entry keeps stage history, detailed values and unknown NCV basis", async ({
  page,
}) => {
  test.setTimeout(90000);
  const name = `ASSAY PLAN ${Date.now()}`;
  await page.getByRole("button", { name: "배선 등록", exact: true }).click();
  await page.getByLabel("배선 메모", { exact: true }).fill(name);
  await page.getByLabel("탄종 *", { exact: true }).fill("QUALITY TEST");
  await page.getByLabel("산지국가", { exact: true }).fill("TEST ORIGIN");
  await page.getByLabel("예정물량(t)", { exact: true }).fill("15000");
  await page.getByLabel("입하량(t)", { exact: true }).fill("14500");
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await page.getByRole("tab", { name: /^성상/ }).click();
  for (const stage of ["loading", "unloading", "buyer"]) {
    await page
      .getByRole("button", { name: "성상분석 등록", exact: true })
      .click();
    await page
      .getByLabel("화물 *", { exact: true })
      .selectOption({ label: `${name} · QUALITY TEST` });
    await page.getByLabel("분석구분 *", { exact: true }).selectOption(stage);
    await page
      .getByLabel("결과상태", { exact: true })
      .selectOption("confirmed");
    await page.getByLabel("분석일", { exact: true }).fill("2026-11-06");
    await page.getByLabel("성적서번호", { exact: true }).fill(`QA-${stage}`);
    await page
      .getByLabel("발열량 ARB(kcal/kg)", { exact: true })
      .fill(stage === "unloading" ? "5100" : "5400");
    if (stage === "unloading") {
      const values: Record<string, string> = {
        "총수분 AR(%wt)": "20",
        "유황분 AR(%wt)": "0.3",
        HGI: "55",
        "발열량 ADB(kcal/kg)": "6000",
        "발열량 DB(kcal/kg)": "6250",
        "NCV(kcal/kg)": "4800",
        "고유수분 IM": "4",
        "회분 Ash": "12",
        "휘발분 VM": "30",
        "고정탄소 FC": "54",
        "탄소 C": "70",
        "수소 H": "5",
        "질소 N": "1",
        "산소 O": "11",
        "유황 S": "0.5",
        SiO2: "50",
        Al2O3: "25",
        CaO: "4",
        MgO: "2",
        Na2O: "1",
        K2O: "2",
        SO3: "3",
        TiO2: "1",
        "기타 회성분": "12",
        "연소시작온도(°C)": "300",
        "연소종료온도(°C)": "700",
        "최대연소온도(°C)": "520",
        "최대연소속도(%/min)": "7.5",
        IT: "1100",
        ST: "1200",
        HT: "1300",
        FT: "1400",
        "2mm 이하(%wt)": "97",
        "0.25mm 이하(%wt)": "25",
        "염소 DB(ppm)": "120",
        "CSN 점결성 지수": "0.5",
      };
      for (const [label, value] of Object.entries(values))
        await page.getByLabel(label, { exact: true }).fill(value);
      await expect(page.locator(".vr-assay-note")).toContainText("12.500 %wt");
      await page.screenshot({
        path: "artifacts/voyage-registry/assay-entry.png",
      });
    }
    await saveManual(page);
  }
  await page.getByLabel("원장 검색", { exact: true }).fill("TEST ORIGIN");
  await expect.poll(()=>page.locator(".vr-table-scroll tbody td").first().evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(220);
  await expect(page.locator(".vr-table-scroll tbody tr")).toHaveCount(3);
  await expect(page.locator(".vr-quality")).toContainText("대표 성상 · 하역");
  await expect(page.locator(".vr-quality")).toContainText("NCV 기준 미확인");
  await page
    .getByLabel("분석 항목 보기", { exact: true })
    .selectOption("연료특성");
  await expect(page.locator(".vr-table-scroll")).toContainText(
    "최대연소속도(%/min)",
  );
  await expect(page.locator(".vr-table-scroll")).toContainText("7.5");
  await page
    .getByLabel("분석 항목 보기", { exact: true })
    .selectOption("회융점 · 환원성, °C");
  await expect(page.locator(".vr-table-scroll")).toContainText("1,400");
  await page
    .getByLabel("분석 항목 보기", { exact: true })
    .selectOption("입도·염소·점결성");
  await expect(page.locator(".vr-table-scroll")).toContainText("염소 DB(ppm)");
  await page.screenshot({ path: "artifacts/voyage-registry/assays-1920.png" });
  await page
    .getByRole("button", { name: "다크 모드로 전환", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/voyage-registry/assays-dark-1920.png",
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    )
    .toBe(true);
});

test("plan can be saved before assigning ship, number or cargo", async ({
  page,
}) => {
  const name = `EMPTY PLAN ${Date.now()}`;
  await page.getByRole("button", { name: "배선 등록", exact: true }).click();
  await page.getByLabel("배선 메모", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "변경 내용 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "공용 원장에 반영", exact: true })
    .click();
  await page.getByLabel("원장 검색", { exact: true }).fill(name);
  await expect(page.locator(".vr-table-scroll")).toContainText(name);
  await expect(page.locator(".vr-related button")).toHaveCount(0);
});

test("배선 메모와 항차번호 없이도 계획을 저장한다", async ({ page }) => {
  const before = await page.evaluate(async () => (await fetch('/api/voyage-registry/records')).json());
  await page.getByRole('button', { name: '배선 등록', exact: true }).click();
  await expect(page.getByLabel('계획명', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('배선 메모', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await page.getByRole('button', { name: '공용 원장에 반영', exact: true }).click();
  const after = await page.evaluate(async () => (await fetch('/api/voyage-registry/records')).json());
  const created = after.voyages.find((v: { voyage_no: string }) => !before.voyages.some((b: { voyage_no: string }) => b.voyage_no === v.voyage_no));
  expect(created).toBeTruthy();
  expect(created.voyage_number).toBeNull();
  expect(created.notes).toBeNull();
});

const DUMMY_VOYAGE = 'V-DUMMY-UI-TEST';
const MIXED_CARGO = 'C-MIXED-UI-TEST';
async function serveDummyRecords(page: Page, audit: unknown[] = []) {
  await page.route('**/api/voyage-registry/records', async (route) => {
    const url = new URL(route.request().url());
    url.port = '8097';
    const response = await route.fetch({ url: url.href });
    const records = await response.json();
    records.voyages = [...records.voyages, {
      voyage_no: DUMMY_VOYAGE, voyage_number: '26-1-901', classification: 'actual', status: 'completed',
      notes: '더미 표시 시험', origin_port: 'Newcastle', destination_port: '당진', ship_code: null,
      data_origin: 'dummy', dummy_fields: null, updated_at: '2026-11-10T09:00:00',
    }];
    records.cargo = [...records.cargo, {
      cargo_no: MIXED_CARGO, voyage_no: DUMMY_VOYAGE, coal_name: 'MIXED UI COAL', destination_plant_id: 'dangjin',
      planned_t: 50000, received_t: 49800, cv: 6000, cv_basis: 'arb', sulfur_pct: 0.5, analysis_basis: 'arb',
      data_origin: 'mixed', dummy_fields: 'cv,sulfur_pct', updated_at: '2026-11-10T09:00:00',
    }];
    records.assays = [...records.assays, {
      assay_id: 'A-DUMMY-UI-TEST', cargo_no: MIXED_CARGO, stage: 'unloading', result_status: 'confirmed',
      analysis_date: '2026-11-09', gcv_arb: 5900, tm_ar: 12, sulfur_ar: 0.45, lab: '더미(공개 일반값)',
      data_origin: 'dummy', dummy_fields: null, updated_at: '2026-11-10T09:00:00',
    }];
    if (audit.length) records.audit = audit;
    await route.fulfill({ response, json: records });
  });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.locator('.vr-table-scroll')).toContainText('26-1-901');
}

test('원장 표와 상세에 더미 표시가 보인다', async ({ page }) => {
  await serveDummyRecords(page);
  const table = page.locator('.vr-table-scroll');
  await expect(table.locator('.vr-dummy-badge')).toHaveCount(1);
  await expect(table.locator('tr', { hasText: '26-1-901' }).locator('.vr-dummy-badge')).toHaveAttribute('title', '더미 자료(공개 일반값으로 생성)');
  await page.getByRole('tab', { name: /^화물 원장/ }).click();
  await page.getByLabel('원장 검색', { exact: true }).fill('MIXED UI COAL');
  await page.getByRole('button', { name: 'MIXED UI COAL 상세 보기', exact: true }).click();
  await expect(table.locator('.vr-dummy-badge')).toHaveCount(1);
  const detail = page.locator('.vr-detail dl');
  const item = (label: string) => detail.locator('div').filter({ has: page.getByText(label, { exact: true }) });
  await expect(item('열량(kcal/kg)').locator('.vr-dummy-badge')).toHaveAttribute('title', '빈칸을 더미로 채운 값');
  await expect(item('황분(%)').locator('.vr-dummy-badge')).toHaveCount(1);
  await expect(item('입하량(t)').locator('.vr-dummy-badge')).toHaveCount(0);
  await expect(detail).not.toContainText('더미 구분');
  await expect(page.locator('.vr-quality .vr-dummy-badge').first()).toBeVisible();
});

test('편집기에 더미 구분 칸이 없다', async ({ page }) => {
  for (const [tab, button] of [[/^화물 원장/, '화물 등록'], [/^성상/, '성상분석 등록']] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('form')).toBeVisible();
    await expect(dialog.getByText('더미 구분')).toHaveCount(0);
    await expect(dialog.getByText('더미 칸')).toHaveCount(0);
    await page.getByRole('button', { name: '입력 닫기' }).click();
  }
  await page.getByRole('tab', { name: /^배선 원장/ }).click();
  await page.getByRole('button', { name: '배선 등록', exact: true }).click();
  await expect(page.locator('.ve-workspace')).toBeVisible();
  await expect(page.locator('.ve-workspace').getByText('더미 구분')).toHaveCount(0);
  await expect(page.locator('.ve-workspace').getByText('더미 칸')).toHaveCount(0);
});

test('다크 모드와 390px에서 배지가 보이고 가로 넘침이 없다', async ({ page }) => {
  await serveDummyRecords(page);
  await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
  const badge = page.locator('.vr-table-scroll .vr-dummy-badge').first();
  await expect(badge).toBeVisible();
  const colors = await badge.evaluate((el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor]; });
  expect(colors[0]).not.toBe(colors[1]);
  await page.setViewportSize({ width: 390, height: 844 });
  await badge.scrollIntoViewIfNeeded();
  await expect(badge).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('변경 이력에 삭제 기록과 더미 적재가 예외 없이 보인다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await serveDummyRecords(page, [
    { id: 900002, entity: 'cargo', record_key: MIXED_CARGO, origin: 'dummy-data', at: '2026-11-10T10:00:00', actor: 'dummy-seed', revision: 902,
      before_json: JSON.stringify({ cargo_no: MIXED_CARGO, coal_name: 'MIXED UI COAL', cv: 6000 }), after_json: 'null' },
    { id: 900001, entity: 'voyages', record_key: DUMMY_VOYAGE, origin: 'dummy-data', at: '2026-11-10T09:00:00', actor: 'dummy-seed', revision: 901,
      before_json: null, after_json: JSON.stringify({ voyage_no: DUMMY_VOYAGE, voyage_number: '26-1-901', data_origin: 'dummy' }) },
  ]);
  await page.getByRole('button', { name: '최근 변경 이력', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('summary').first()).toContainText('더미 적재');
  await expect(dialog.locator('summary').first()).toContainText('삭제');
  await expect(dialog.locator('summary').nth(1)).toContainText('더미 적재');
  await expect(dialog.locator('summary').nth(1)).not.toContainText('직접 입력');
  await dialog.locator('summary').first().click();
  await expect(dialog.locator('details').first()).toContainText('MIXED UI COAL');
  expect(errors).toEqual([]);
});

test('변경 확인·배선 미리보기·변경 이력에 더미 구분 칸 줄이 없다', async ({ page }) => {
  const editedBefore = { cargo_no: MIXED_CARGO, voyage_no: DUMMY_VOYAGE, coal_name: 'MIXED UI COAL', cv: 6000, sulfur_pct: 0.5, data_origin: 'dummy', dummy_fields: null };
  const editedAfter = { ...editedBefore, cv: 6100, data_origin: 'mixed', dummy_fields: 'sulfur_pct' };
  await serveDummyRecords(page, [
    { id: 900003, entity: 'cargo', record_key: MIXED_CARGO, origin: 'manual', at: '2026-11-10T11:00:00', actor: 'test-admin', revision: 903,
      before_json: JSON.stringify(editedBefore), after_json: JSON.stringify(editedAfter) },
  ]);
  const revision = await page.evaluate(async () => (await (await fetch('/api/voyage-registry/records')).json()).revision);
  await page.route('**/api/voyage-registry/preview', (route) => route.fulfill({ json: {
    revision, counts: { create: 0, update: 1 }, unchanged: 0, errors: [],
    changes: [{ entity: 'cargo', sheet: '화물', row: 2, key: MIXED_CARGO, action: 'update', before: editedBefore, after: editedAfter }],
  } }));
  const noSystemRows = async (scope: ReturnType<Page['locator']>) => {
    await expect(scope).toContainText('열량(kcal/kg)');
    await expect(scope.getByText('더미 구분')).toHaveCount(0);
    await expect(scope.getByText('더미 칸')).toHaveCount(0);
  };
  // 1) 원장 수정 대화상자의 변경 확인
  await page.getByRole('tab', { name: /^화물 원장/ }).click();
  await page.getByLabel('원장 검색', { exact: true }).fill('MIXED UI COAL');
  await page.getByRole('button', { name: 'MIXED UI COAL 상세 보기', exact: true }).click();
  await page.locator('.vr-detail').getByRole('button', { name: '수정' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await noSystemRows(page.locator('.vr-change').first());
  await page.getByRole('button', { name: '입력 닫기' }).click();
  // 2) 변경 이력
  await page.getByRole('button', { name: '최근 변경 이력', exact: true }).click();
  const history = page.getByRole('dialog').locator('details').first();
  await history.locator('summary').click();
  await noSystemRows(history);
  await page.getByRole('button', { name: '이력 닫기', exact: true }).click();
  // 3) 배선 등록 화면의 변경 미리보기
  await page.getByRole('tab', { name: /^배선 원장/ }).click();
  await page.getByRole('button', { name: '배선 등록', exact: true }).click();
  await page.getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await noSystemRows(page.locator('.ve-workspace'));
});
