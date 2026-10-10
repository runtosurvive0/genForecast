import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planningFixture } from "./planning-fixture";

test("MILP backend shows ten units, date-bound plans and missing inventory explicitly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    // 저탄장 연계(/api/supply, /api/v1)는 이 MILP 목업 대상이 아니다.
    if (url.pathname !== "/api/runs" && !url.pathname.startsWith("/api/planning/"))
      return route.fulfill({ status: 404, json: { detail: "목업 없음" } });
    const body =
      url.pathname === "/api/runs"
        ? [
            {
              id: "검증 계산",
              name: "검증 계산",
              period: "2027-01-01 ~ 2027-12-31",
            },
          ]
        : planningFixture(
            "검증 계산",
            url.searchParams.get("start")!,
            Number(url.searchParams.get("horizon")),
          );
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.locator("[data-unit-id]")).toHaveCount(10);
  await expect(
    page.getByRole("heading", { name: "월별 석탄 사용 예정량" }),
  ).toBeVisible();
  await expect(page.locator(".fuel-supply-kpis")).toContainText("미등록");
  await expect(page.locator(".fuel-supply-kpis")).toContainText("미확정");
  await expect(
    page.getByText("동작 확인용 MILP", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(1);
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("288,000");
  await expect(
    page.locator('[data-fuel-metric="일평균 사용 예정량"]'),
  ).toContainText("9,600");
  await expect(page.getByText("실적 미연계", { exact: true })).toBeVisible();
  await page
    .getByText("월별 예정량·계획 확보일수 보기", { exact: true })
    .click();
  await expect(page.locator(".fuel-monthly tbody tr")).toHaveCount(12);
  await expect(page.locator(".fuel-monthly tbody tr").first()).toContainText(
    "297,600",
  );
  await page.getByRole("button", { name: "7일", exact: true }).click();
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("67,200");
  await expect(page.locator(".fuel-monthly tbody tr").first()).toContainText(
    "297,600",
  );
  await page.getByRole("button", { name: "90일", exact: true }).click();
  await expect(page.locator(".midterm-source")).toContainText("2027-03-31");
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("864,000");
  await expect(page.locator(".fuel-monthly .fuel-selected-month")).toHaveCount(
    3,
  );
  await page.getByLabel("MILP 조회 시작일").fill("2027-02-01");
  await expect(page.locator(".midterm-source")).toContainText("2027-05-01");
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(0);
  await expect(page.locator(".fuel-monthly .fuel-selected-month")).toHaveCount(
    4,
  );
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  // 진입 시 항상 당진 (fact-default-dangjin): 기본 60개, 전체 선택 시 72개.
  await expect(page.locator(".yard-pile")).toHaveCount(60);
  await page
    .getByRole("group", { name: "발전소 선택" })
    .getByRole("button", { name: "전체", exact: true })
    .click();
  await expect(page.locator(".yard-pile")).toHaveCount(72);
  await expect(page.locator(".midterm-page")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "발전소 종합 데이터 모드" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  await expect(page.locator(".shipment-card")).toHaveCount(4);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "예측/모델 상세", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "재학습 · 전망에 적용" }),
  ).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "발전소 종합", exact: true })
    .click();
  await expect(page.locator("[data-unit-id]")).toHaveCount(10);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("incomplete fuel plans remain unknown and DB inventory forecasts render separately", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/runs") {
      await route.fulfill({
        json: [
          {
            id: "연료 검증",
            name: "연료 검증",
            period: "2027-01-01 ~ 2027-12-31",
          },
        ],
      });
      return;
    }
    const snapshot = planningFixture(
      "연료 검증",
      url.searchParams.get("start")!,
      Number(url.searchParams.get("horizon")),
    );
    snapshot.daily[2].fuel_tonnes = null;
    snapshot.units[0].fuel_tonnes = null;
    snapshot.monthly.forEach((month) => {
      month.fuel_tonnes = null;
    });
    snapshot.inventory.kpis = {
      stock: 100000,
      min_days: 8.5,
      risk: "caution",
      arrivals: 40000,
      arrival_count: 1,
      unloading_remaining: 6000,
      active_vessels: 1,
      incoming_cv: 5800,
    };
    snapshot.inventory.thresholds = { danger_days: 7, normal_days: 15 };
    Object.assign(snapshot.inventory.groups[0], {
      stock: 100000,
      days: 12,
      min_days: 8.5,
      expected_receipts: 25000,
      risk: "caution",
    });
    snapshot.inventory.daily.forEach((day, i) => {
      day.groups.g14.stock = 100000 - 960 * (i + 1);
    });
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await expect(
    page.locator('[data-fuel-metric="기간 석탄 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(
    page.locator('[data-fuel-metric="일평균 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(
    page.locator('[data-fuel-metric="최대 일 사용 예정량"]'),
  ).toContainText("미확정");
  await expect(page.locator('[data-fuel-metric="총 재고"]')).toContainText(
    "100,000",
  );
  await expect(
    page.locator('[data-fuel-metric="입항 예정 (30일)"]'),
  ).toContainText("40,000");
  await expect(page.locator(".fuel-flow")).toContainText("25,000");
  await expect(
    page.getByText("온전한 월별 연료계획이 없습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "처별 일말 예상 석탄 재고 톤" }),
  ).toBeVisible();
  await expect(page.locator('[data-unit-id="dj-1"]')).toContainText("미확정");
  await page.getByText("일별 계획 수치 보기", { exact: true }).click();
  await expect(page.locator(".fuel-daily tbody tr").nth(2)).toContainText(
    "미확정",
  );
  await expect(
    page.getByRole("heading", { name: "예측·최적화 핵심 지표" }),
  ).toBeVisible();
});

test("failed backend stays an error and synthetic demo requires explicit selection", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 503, json: { detail: "서버 연결 확인" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("서버 연결 확인");
  await expect(page.locator(".tower-kpis")).toHaveCount(0);
  await page.getByRole("button", { name: "합성 데모", exact: true }).click();
  await expect(page.locator(".tower-metric").first()).toContainText("739,600");
  await expect(page.getByText("샘플 데이터", { exact: true })).toBeVisible();
});

test("world map accepts 200 normalized vessel positions without hard-coded shipment IDs", async ({
  page,
}) => {
  await page.goto("/tests/map-harness.html");
  await expect(page.locator(".vessel-map-marker")).toHaveCount(200);
  await page.locator(".vessel-map-vessels button").last().click();
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(
    "Test vessel 199",
  );
});

test("pile drilldown, stale AIS and model training update the operational forecast", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  const before = await page.locator(".tower-metric").nth(7).innerText();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  const da04 = page.locator(".yard-pile", { hasText: "DA-04" });
  await da04.click();
  await expect(da04).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "DA-04 · 인니 저열량탄" }),
  ).toBeVisible();
  await expect(page.locator(".tower-details")).toContainText("미연결");
  await expect(page.locator(".tower-details")).toContainText("당진 9호기");
  await expect(page.locator(".tower-details")).not.toContainText("당진 1호기");
  await expect(
    page.getByRole("heading", { name: "주간 소진 · 혼탄 시뮬레이션" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "발전소 선택" })
    .getByRole("button", { name: "당진", exact: true })
    .click();
  await expect(page.locator(".yard-pile")).toHaveCount(60);
  await expect(page.locator(".tower-metric").first()).toContainText("381,600");
  await expect(
    page.getByRole("heading", { name: "재고 전망", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stockyard-incoming tbody tr")).toHaveCount(1);
  await page
    .getByRole("group", { name: "발전소 선택" })
    .getByRole("button", { name: "전체", exact: true })
    .click();
  await expect(page.locator(".yard-pile")).toHaveCount(72);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".shipment-card .tower-tag").first()).toHaveText(
    "STALE",
  );
  await expect(page.getByText("SOG / COG", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "예측/모델 상세", exact: true })
    .click();
  await page.getByLabel("학습 반복").selectOption("300");
  await page.getByRole("button", { name: "재학습 · 전망에 적용" }).click();
  await expect(page.locator(".tower-page")).toContainText(
    "local-linear-v1/300",
  );
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "발전소 종합", exact: true })
    .click();
  expect(await page.locator(".tower-metric").nth(7).innerText()).not.toBe(
    before,
  );
  await page.getByRole("button", { name: "90일", exact: true }).click();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "월별 수급 집계" }),
  ).toBeVisible();
});

test("theme persists, scope recalculates, and planned stop details remain explicit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?source=synthetic");
  await expect(
    page.getByRole("heading", { name: "발전소 종합", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tower-metric").first()).toContainText("739,600");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "하동", exact: true }).click();
  await expect(page.locator(".tower-metric").first()).toContainText("108,000");
  await expect(
    page.locator(".tower-table").first().locator("tbody tr"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "정지계획", exact: true }).click();
  await page.locator(".schedule-row").first().click();
  await expect(page.getByRole("dialog")).toContainText("샘플 운영 및 정비계획");
  await expect(page.getByRole("dialog")).toContainText(
    "계획정지는 서로 독립된 정보",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("scenario is applied explicitly, shows actual orb canvas and updates forecast", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("button", { name: "시나리오 분석", exact: true })
    .click();
  const before = await page.locator(".comparison-card").nth(1).innerText();
  await page.getByRole("button", { name: "수급 지연", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "발전 부하 변화", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "입항·하역 지연", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".scenario-save-state")).toContainText(
    "아직 결과에 반영되지 않았습니다",
  );
  expect(await page.locator(".comparison-card").nth(1).innerText()).toBe(
    before,
  );
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".processing-strip canvas")).toBeVisible();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  await expect(page.locator(".applied-conditions")).toContainText("부하 +15%");
  await expect(page.locator(".applied-conditions")).toContainText("지연 +3일");
  expect(await page.locator(".comparison-card").nth(1).innerText()).not.toBe(
    before,
  );
  await page.getByRole("button", { name: "기준 조건", exact: true }).click();
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".comparison-card").nth(1)).toHaveText(before, {
    useInnerText: true,
  });
});

test("mobile navigation, all views, and dark mode stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?source=synthetic");
  await page.getByRole("button", { name: "60일", exact: true }).click();
  await expect(page.locator('.processing-strip [role="status"]')).toBeVisible();
  await expect(page.locator(".processing-strip canvas")).toBeVisible();
  await expect(page.locator(".processing-strip")).not.toBeVisible();
  for (const label of [
    "저탄장 현황",
    "선박 추적",
    "예측/모델 상세",
    "데이터/관리자",
    "발전소 종합",
  ]) {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await page
      .getByRole("navigation", { name: "모바일 메뉴" })
      .getByRole("button", { name: label, exact: label !== "발전기 정지계획" })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("offline single HTML supports calculation without network", async ({
  browser,
}) => {
  const context = await browser.newContext({
    offline: true,
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve("발전운영_대시보드.html")).href);
  await expect(
    page.getByRole("heading", { name: "발전소 종합", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "시나리오 분석", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "입항 예정 연료 포함" }).uncheck();
  await page.getByRole("button", { name: "시나리오 분석 실행" }).click();
  await expect(page.locator(".applied-conditions")).toContainText("입항 제외");
  await expect(page.locator(".comparison-card").nth(1)).toContainText("10.");
  expect(errors).toEqual([]);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  await context.close();
});

test("world map selection, zoom and scoped shipment details stay synchronized", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  await expect(page.locator(".vessel-map-dots").first()).toBeVisible();
  const selector = page.locator(".vessel-map-vessels button").last();
  const name = (await selector.innerText()).trim();
  await selector.click();
  await expect(selector).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(name);
  await page.getByRole("button", { name: "지도 확대", exact: true }).click();
  await page
    .getByRole("button", { name: "전체 세계지도 보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "지도 축소", exact: true }),
  ).toBeDisabled();
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "하동", exact: true }).click();
  await expect(page.locator(".vessel-map-vessels button")).toHaveCount(1);
  await expect(page.locator(".vessel-map-detail")).toContainText("하동");
  await expect(page.locator(".shipment-card")).toHaveCount(1);
});

test("inventory chart exposes interval boundary and scopes cargo", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await expect(page.getByText(/가로축: 다음날 09:00 KST/)).toBeVisible();
  await page.getByRole("combobox", { name: "발전본부 선택" }).click();
  await page.getByRole("option", { name: "보령", exact: true }).click();
  await expect(page.locator(".tower-metric").nth(2)).toContainText("65,000");
  await expect(
    page.locator(".tower-chart").first().locator("svg"),
  ).toBeVisible();
});

test("tablet and narrow phone retain all navigation views without page overflow", async ({
  page,
}) => {
  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?source=synthetic");
    for (const name of [
      "저탄장 현황",
      "선박 추적",
      "예측/모델 상세",
      "데이터/관리자",
    ]) {
      if (width <= 760) {
        await page.getByRole("button", { name: "메뉴 열기" }).click();
        await page
          .getByRole("navigation", { name: "모바일 메뉴" })
          .getByRole("button", { name, exact: true })
          .click();
      } else {
        await page
          .getByRole("navigation", { name: "주 메뉴" })
          .getByRole("button", { name, exact: true })
          .click();
      }
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("dotted map supports keyboard selection, theme changes and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "선박 추적", exact: true })
    .click();
  const marker = page
    .locator(".vessel-map-marker")
    .filter({ hasText: "Southern Star" });
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".vessel-map-detail-name strong")).toHaveText(
    "Southern Star",
  );
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".aceternity-world-map")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveAttribute(
    "stroke-dashoffset",
    /^0(?:px)?$/,
  );
  const route = await page
    .locator(".vessel-map-route.is-selected")
    .getAttribute("d");
  const lightFill = await page
    .locator(".vessel-map-dots")
    .evaluate((el) => getComputedStyle(el).fill);
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect
    .poll(() =>
      page
        .locator(".vessel-map-dots")
        .evaluate((el) => getComputedStyle(el).fill),
    )
    .not.toBe(lightFill);
  await expect(page.locator(".vessel-map-route.is-selected")).toHaveAttribute(
    "d",
    route!,
  );
  await page.getByRole("button", { name: "발전 영향 보기" }).click();
  await expect(page.getByRole("dialog")).toContainText("하동");
});
test("dangjin site plan links harbor, yards, burn conveyor and pile history", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  // 진입 시 항상 당진 (fact-default-dangjin).
  await expect(page.locator(".yard-pile")).toHaveCount(60);
  await expect(page.locator(".tower-metric").first()).toContainText("381,600");
  // 앞바다·접안·저탄장·상탄이 한 약도 카드: 흐름 문구와 개별 섹션은 없다.
  const site = page.locator(".stockyard-site");
  await expect(
    site.getByRole("heading", { name: "당진 항만 · 저탄장 현황" }),
  ).toBeVisible();
  await expect(page.getByText("연료부두", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "상탄 현황" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "발전처별 저탄장" }),
  ).toHaveCount(0);
  const headings = await page.getByRole("heading").allInnerTexts();
  const siteAt = headings.findIndex((h) => h.includes("항만 · 저탄장"));
  const forecastAt = headings.findIndex((h) => h.includes("재고 전망"));
  expect(siteAt).toBeGreaterThanOrEqual(0);
  expect(forecastAt).toBeGreaterThan(siteAt);
  // 1440×1000에서 약도 카드가 한 화면 안에 들어간다.
  const siteBox = await site.boundingBox();
  expect(siteBox!.height).toBeLessThan(1000);
  // 상탄은 발전소로 들어가는 컨베이어 위 t/h (fact-gauge-th).
  await expect(site.locator(".site-belt.stockyard-gauge")).toContainText("t/h");
  await expect(site.locator(".site-plant")).toContainText("당진 발전소");
  // 부두 3개, 하역선은 안벽과 평행하게 접안, 해상 예시 대기선 1척 (더미 AIS).
  await expect(site.locator(".harbor-berth")).toHaveCount(3);
  const moored = site.locator(".harbor-ship.is-moored");
  await expect(moored).toHaveCount(1);
  const hull = await moored.locator(".ship-glyph").boundingBox();
  expect(hull!.width).toBeGreaterThan(hull!.height * 3);
  await expect(site.locator(".harbor-ship.is-sample")).toHaveCount(1);
  await expect(site.locator(".harbor-ship.is-sample")).toContainText("예시");
  await expect(site.locator(".link-chip").first()).toContainText("AIS 더미");
  // 약도 선박 ↔ 패널 선택 동기화, 대기 카드 4종 + Freshness·추천 태그.
  await moored.click();
  await expect(
    site.locator('.site-ship-list button[aria-pressed="true"]'),
  ).toContainText("Pacific Horizon");
  await expect(moored).toHaveAttribute("aria-pressed", "true");
  await expect(site.locator(".site-ship-detail")).toContainText("BD-1");
  await expect(site.locator(".site-ship-detail .tower-tag")).toHaveCount(2);
  await expect(site.locator(".site-ship-detail")).toContainText("추천 BD-1");
  // 옥내 (fact-indoor-badge): P2·P3 40개, 구역×5개 (fact-zone-assert).
  await expect(
    page.locator(".yard-pile", { hasText: "옥내" }),
  ).toHaveCount(40);
  await expect(site.locator(".yard-block.is-indoor")).toHaveCount(2);
  await expect(page.locator(".zone-group")).toHaveCount(12);
  await expect(
    page.locator(".zone-group").first().locator(".yard-pile"),
  ).toHaveCount(5);
  // 하역 이력은 Pile 배지와 마우스오버로 본다. BD-1 하역분은 1발전처 Pile에만 귀속.
  await expect(page.locator(".stockyard-history-pile")).toHaveCount(0);
  const da05 = page.locator(".yard-pile", { hasText: "DA-05" });
  await expect(da05.locator(".pile-badge")).toHaveText("↓1");
  await expect(
    page.locator(".yard-pile", { hasText: "DA-23" }).locator(".pile-badge"),
  ).toHaveCount(0);
  await da05.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("하역 이력·예정 1건");
  await expect(tip).toContainText("Pacific Horizon");
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  // 위험도 필터는 약도 자리를 유지하고 나머지를 흐리게.
  await page.getByLabel("위험도 필터").selectOption("높음");
  await expect(page.locator(".yard-pile")).toHaveCount(60);
  await expect(page.locator(".yard-pile:not(.is-dimmed)")).toHaveCount(1);
  await page.getByLabel("위험도 필터").selectOption("all");
  // 처 탭: 수기 이탄 초과 경고 + 약도 처 표시 + 모의 적용·되돌리기 (fact-transfer-warn).
  await site.locator(".yard-title").first().click();
  await expect(site.getByRole("tab", { name: "처" })).toHaveAttribute("aria-selected", "true");
  await expect(site.locator(".yard-block.is-selected")).toHaveCount(1);
  await page.getByLabel("이송량 입력").fill("25000");
  await page.getByRole("button", { name: "이탄 적용", exact: true }).click();
  await expect(page.locator(".stockyard-transfer-result")).toContainText(
    "가용 초과",
  );
  await expect(site.locator(".yard-transfer-tag")).toHaveCount(2);
  await expect(site.locator(".site-transfer-list")).toContainText("모의 적용");
  await expect(page.locator(".alert-chip", { hasText: "이탄 가용 초과" })).toHaveCount(1);
  await site.getByRole("button", { name: "되돌리기" }).click();
  await expect(site.locator(".yard-transfer-tag")).toHaveCount(0);
  // 접안 지정 → 선박이 BD-2로 이동, 부두 점유·하역 귀속 갱신 (fact-assign-button).
  await site.getByRole("tab", { name: "선박" }).click();
  await page.getByLabel("Pacific Horizon 접안 부두").selectOption("BD-2");
  await page.getByRole("button", { name: "접안 지정", exact: true }).click();
  const busy = site.locator(".stockyard-berths .harbor-berth.is-unloading");
  await expect(busy).toHaveCount(1);
  await expect(busy).toContainText("BD-2");
  await expect(busy).toContainText("Pacific Horizon");
  await expect(
    page.locator(".yard-pile", { hasText: "DA-23" }).locator(".pile-badge"),
  ).toHaveText("↓1");
  await expect(da05.locator(".pile-badge")).toHaveCount(0);
  await expect(site.locator(".site-sim-note")).toContainText("모의 적용");
});

test("stockyard KPIs, alerts, search, keyboard, forecast and ledger work together", async ({
  page,
}) => {
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  // KPI 7칸, 최저 재고일수는 처 단위.
  await expect(page.locator(".stockyard-kpi")).toHaveCount(7);
  await expect(page.locator(".stockyard-kpi").nth(1)).toContainText("3발전처");
  await expect(page.locator(".yard-days")).toHaveCount(3);
  // 알림: 처 재고 소진 예상, 고위험 Pile.
  await expect(page.locator(".alert-chip", { hasText: "소진 예상" })).not.toHaveCount(0);
  await page.locator(".alert-chip", { hasText: "DA-04" }).click();
  await expect(page.locator(".site-pile-title")).toHaveText("DA-04 · 인니 저열량탄");
  // 고위험 KPI = 위험도 필터 토글.
  const high = page.locator(".stockyard-kpi", { hasText: "고위험" });
  await high.click();
  await expect(high).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("위험도 필터")).toHaveValue("높음");
  await high.click();
  await expect(page.getByLabel("위험도 필터")).toHaveValue("all");
  // Pile 검색과 방향키 이동 (roving tabindex).
  await page.getByLabel("Pile 검색").fill("4");
  await page.getByLabel("Pile 검색").press("Enter");
  await expect(page.locator(".yard-pile[data-pile-id='DA-04']")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".yard-pile[data-pile-id='DA-41']")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".yard-pile[data-pile-id='DA-36']")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".site-pile-title")).toHaveText("DA-36 · 호주 역청탄");
  await expect(page.locator('.site-yards [tabindex="0"]')).toHaveCount(1);
  // 원장: 20행 페이지, 혼탄 열, 원장에서 보기 → 해당 페이지에서 펼침.
  const ledger = page.locator(".stockyard-ledger");
  await expect(ledger.locator("tbody tr")).toHaveCount(20);
  await expect(page.locator(".ledger-pager button[aria-current]")).toHaveText("1");
  await expect(ledger.locator("thead")).toContainText("주간 소진");
  await page.getByRole("button", { name: "원장에서 보기 →" }).click();
  await expect(ledger.locator(".ledger-detail")).toHaveCount(1);
  await expect(ledger.locator("tr.is-selected")).toContainText("DA-36");
  await ledger.getByRole("button", { name: /^재고 · t/ }).click();
  await expect(ledger.locator("th[aria-sort='ascending']")).toContainText("재고");
  // 혼탄 요약은 처별 소진과 일치: 소속 호기가 없는 2발전처는 소진 없음.
  await expect(
    page.getByRole("heading", { name: "주간 소진 · 혼탄 시뮬레이션" }),
  ).toBeVisible();
  await expect(page.locator(".stockyard-top-list")).not.toContainText("DA-02");
  // 처별 전망 표와 기간 연동.
  await expect(page.locator(".stockyard-groups tbody tr")).toHaveCount(3);
  await expect(page.locator(".stockyard-groups")).toContainText("소비 없음");
  await page
    .getByRole("group", { name: "전망 기간" })
    .getByRole("button", { name: "60일", exact: true })
    .click();
  await expect(page.locator(".stockyard-kpi").nth(4)).toContainText("60일");
  await expect(page.locator(".timeline-head")).toContainText("+60일");
});

test("stockyard links save transfers and unloading, take live AIS and sensors", async ({
  page,
}) => {
  const posted: { url: string; body: any }[] = [];
  const now = new Date().toISOString();
  await page.route("**/api/supply/records", (route) =>
    route.fulfill({
      json: {
        transfers: [
          {
            id: 11,
            at: "2026-10-06T12:00:00+09:00",
            from_group: "g58",
            to_group: "g14",
            tonnes: 1000,
            note: "원장 기록",
          },
        ],
        vessels: [
          {
            id: 3,
            name: "Pacific Horizon",
            cargo: 80000,
            arrival_at: "2026-10-06T06:00:00+09:00",
            points: [
              {
                at: "2026-10-06T10:00:00+09:00",
                cumulative: 0,
                rate: 2000,
                allocations: { g14: 1, g58: 0, g910: 0 },
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/supply/transfers", async (route) => {
    posted.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { id: 12 } });
  });
  await page.route("**/api/supply/vessels/3/unloading", async (route) => {
    const body = route.request().postDataJSON();
    posted.push({ url: route.request().url(), body });
    await route.fulfill({ json: { id: 9, cumulative: body.cumulative } });
  });
  await page.route("**/api/v1/vessels?**", (route) =>
    route.fulfill({
      json: [
        {
          vessel_id: "999000001",
          mmsi: "999000001",
          received_at: now,
          latitude: 37.0,
          longitude: 126.6,
          sog_kn: 0,
          cog_deg: 90,
          source: "aisstream",
        },
      ],
    }),
  );
  await page.route("**/api/v1/stockpiles/sensors**", (route) =>
    route.fulfill({
      json: {
        readings: [
          {
            stockpile_id: "DA-05",
            measured_at: now,
            temperature_c: 61,
            co_ppm: 55,
            sensor_id: "DJ-P1-T05",
          },
        ],
      },
    }),
  );
  await page.goto("/?source=synthetic");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  const site = page.locator(".stockyard-site");
  // 실시간 AIS: 예시 대기선이 사라지고 최신성이 LIVE.
  await expect(site.locator(".link-chip", { hasText: "AIS 실시간" })).toHaveClass(/is-online/);
  await expect(site.locator(".harbor-ship.is-sample")).toHaveCount(0);
  await expect(site.locator(".site-ship-detail")).toContainText("LIVE");
  // 센서: DA-05 위험도에 온도·CO 반영 (12점 + 40 + 20 = 72, 높음).
  await expect(site.locator(".link-chip", { hasText: "센서 1건" })).toBeVisible();
  await expect(page.locator(".stockyard-kpi", { hasText: "고위험" })).toContainText("2");
  await page.locator(".yard-pile", { hasText: "DA-05" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("61 ℃ · 55 ppm");
  await expect(page.getByRole("tooltip")).toContainText("센서 + 적치·탄종");
  await page.mouse.move(0, 0);
  // 하역 원장: 등록된 선박의 누적 하역량 보정 저장.
  await expect(site.locator(".site-ledger-link")).toContainText("원장 #3");
  await page.getByLabel("누적 하역량 보정").fill("30000");
  await page.getByRole("button", { name: "보정 저장" }).click();
  await expect(site.locator(".site-ledger-link")).toContainText("저장했습니다");
  const unload = posted.find((p) => p.url.includes("/unloading"))!;
  expect(unload.body).toMatchObject({ cumulative: 30000, rate: 2000, allocations: { g14: 1 } });
  // 이탄 원장: 저장분(#11, 2→1발전처)이 약도에 반영되고, 모의 이탄을 g14→g910으로 저장.
  await site.locator(".yard-title").first().click();
  await expect(site.locator(".site-transfer-list")).toContainText("원장 #11");
  await expect(site.locator(".yard-transfer-tag")).toHaveCount(2);
  await page.getByLabel("이송량 입력").fill("5000");
  await page.getByLabel("도착 발전처").selectOption("P3");
  await page.getByLabel("이탄 비고").fill("UI 테스트");
  await page.getByRole("button", { name: "이탄 적용", exact: true }).click();
  await site.getByRole("button", { name: "원장 저장" }).click();
  await expect(site.locator(".site-transfer-list")).toContainText("원장 #12");
  const saved = posted.find((p) => p.url.endsWith("/api/supply/transfers"))!;
  expect(saved.body).toMatchObject({
    from_group: "g14",
    to_group: "g910",
    tonnes: 5000,
    note: "UI 테스트",
    at: "2026-10-06T09:00:00+09:00",
  });
});
