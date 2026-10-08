import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync(".tooling-tmp", { recursive: true });
process.env.TEMP = process.env.TMP = resolve(".tooling-tmp");
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  colorScheme: "light",
  reducedMotion: "reduce",
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173/");
await page.getByRole("heading", { name: "발전소 종합", exact: true }).waitFor();
await page.screenshot({
  path: "artifacts/overview-light.png",
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "다크 모드로 전환" }).click();
await page.screenshot({
  path: "artifacts/overview-dark.png",
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
await page
  .getByRole("navigation", { name: "주 메뉴" })
  .getByRole("button", { name: "선박 추적", exact: true })
  .click();
await page.locator(".vessel-map-dots").first().waitFor();
await page.screenshot({
  path: "artifacts/vessels-light.png",
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "다크 모드로 전환" }).click();
await page.screenshot({
  path: "artifacts/vessels-dark.png",
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
await page
  .getByRole("navigation", { name: "주 메뉴" })
  .getByRole("button", { name: "발전소 종합", exact: true })
  .click();
await page.getByRole("button", { name: "시나리오 분석", exact: true }).click();
await page.screenshot({
  path: "artifacts/scenario-light.png",
  fullPage: true,
  animations: "disabled",
});
await page
  .getByRole("navigation", { name: "주 메뉴" })
  .getByRole("button", { name: "발전소 종합", exact: true })
  .click();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "artifacts/overview-mobile.png",
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "메뉴 열기" }).click();
await page
  .getByRole("navigation", { name: "모바일 메뉴" })
  .getByRole("button", { name: "선박 추적", exact: true })
  .click();
await page.screenshot({
  path: "artifacts/vessels-mobile.png",
  fullPage: true,
  animations: "disabled",
});
for (const [label, file] of [
  ["저탄장 현황", "stockyard"],
  ["예측/모델 상세", "models"],
  ["데이터/관리자", "data"],
]) {
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page
    .getByRole("navigation", { name: "모바일 메뉴" })
    .getByRole("button", { name: label, exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/" + file + "-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "artifacts/" + file + "-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await page.screenshot({
    path: "artifacts/" + file + "-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
}
await page.waitForFunction(
  () => document.documentElement.scrollWidth <= innerWidth,
);
console.log(
  JSON.stringify({
    errors,
    mobileWidth: await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
    })),
  }),
);
await browser.close();
