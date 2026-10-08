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
  await expect(page.locator(".midterm-kpis")).toContainText("미등록");
  await expect(page.locator(".midterm-kpis")).toContainText("미확정");
  await expect(
    page.getByText("동작 확인용 MILP", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(1);
  await page.getByRole("button", { name: "90일", exact: true }).click();
  await expect(page.locator(".midterm-source")).toContainText("2027-03-31");
  await page.getByLabel("MILP 조회 시작일").fill("2027-02-01");
  await expect(page.locator(".midterm-source")).toContainText("2027-05-01");
  await expect(page.locator(".midterm-outage-bar")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "저탄장 현황", exact: true })
    .click();
  await expect(page.locator(".yard-pile")).toHaveCount(16);
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
  await expect(page.locator(".tower-metric").first()).toContainText("538,000");
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
  await page.locator(".yard-pile").nth(3).click();
  await expect(page.locator(".yard-pile").nth(3)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "DA-04 · 인니 저열량탄" }),
  ).toBeVisible();
  await expect(page.locator(".tower-details")).toContainText("미연결");
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
  await expect(page.locator(".tower-metric").first()).toContainText("538,000");
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
