import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { createDemoServer } = require("../scripts/fuel-demo/server.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts =
  process.env.FUEL_DEMO_QA_DIR || path.join(root, "artifacts", "fuel-demo");
await fs.mkdir(artifacts, { recursive: true });
const app = createDemoServer({ port: 0, interval: 50 });
const address = await app.listen();
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>운전 데모 검증</title><style>body{padding:16px}#qa-controls{display:flex;gap:10px;margin-bottom:16px}</style></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FuelDemoControl} from '/src/components/fuel-demo/FuelDemoControl.tsx';
import {FuelDemoProvider} from '/src/domain/fuel-demo/FuelDemoProvider.tsx';
import '/src/index.css';
function Probe(){
 const [enabled,setEnabled]=React.useState(false),[theme,setTheme]=React.useState('light');
 React.useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark')},[theme]);
 return React.createElement(React.Fragment,null,
 React.createElement('nav',{id:'qa-controls'},React.createElement('button',{onClick:()=>setEnabled(!enabled)},enabled?'데모 연결 해제':'데모 연결'),React.createElement('button',{onClick:()=>setTheme(theme==='light'?'dark':'light')},'테마 전환')),
 React.createElement(FuelDemoProvider,{enabled,role:'controller'},React.createElement(FuelDemoControl,{theme})))
}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Probe)));
</script></body></html>`;
const vite = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: {
    entries: [],
    include: ["react", "react-dom/client", "react/jsx-runtime"],
  },
  plugins: [
    react(),
    {
      name: "fuel-demo-control-qa",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__fuel-demo-qa") {
            next();
            return;
          }
          response.setHeader("Content-Type", "text/html");
          response.end(
            await server.transformIndexHtml("/__fuel-demo-qa", html),
          );
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/demo-stream": {
        target: `ws://127.0.0.1:${address.port}`,
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
let browser;
const errors = [];
try {
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5174/__fuel-demo-qa");
  await page.getByRole("heading", { name: "운전 데모 조작반" }).waitFor();
  assert.equal(app.wss.clients.size, 0, "disabled provider must not connect");
  await page.getByRole("button", { name: "데모 연결", exact: true }).click();
  await page.getByRole("heading", { name: "이송 설비", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".fdc-connection")?.textContent === "정상 수신",
  );
  assert.equal(
    app.wss.clients.size,
    1,
    "StrictMode has only one live connection",
  );
  await page
    .getByRole("button", { name: "예제 불러오기", exact: true })
    .click();
  await page
    .getByText("예제가 준비됐습니다. 재생을 누르세요.", { exact: true })
    .waitFor();
  assert.equal(app.engine.snapshot().material.jobs.unload.lotId, "p5-c");
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".fdc-clock")?.textContent.includes("재생 중"),
  );
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        ".fdc-playback button:first-child:not(:disabled)",
      ) !== null,
  );
  await page.getByRole("button", { name: "7호기 편집", exact: true }).click();
  await page.getByLabel("변경 운전값").fill("321");
  await page.getByRole("button", { name: "지금 적용", exact: true }).click();
  await page.getByText("운전값이 적용됐습니다.", { exact: true }).waitFor();
  assert.equal(app.engine.snapshot().units[7].mw, 321);
  await page.getByLabel("예약 지연", { exact: true }).fill("120");
  await page
    .getByRole("button", { name: "스케줄에 등록", exact: true })
    .click();
  await page
    .getByText("운전 스케줄에 등록했습니다.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "7호기 예약 취소", exact: true })
    .last()
    .click();
  await page.getByText("예약을 취소했습니다.", { exact: true }).waitFor();
  assert.equal(app.engine.snapshot().schedule.at(-1).status, "cancelled");
  await page
    .getByRole("button", { name: "초기 스냅샷 복원", exact: true })
    .click();
  await page
    .getByText("사진 기준 초기 재고와 운전값을 복원했습니다.", { exact: true })
    .waitFor();
  const work = page.locator(".fdc-work-form").first();
  await work.getByRole("button", { name: "시작", exact: true }).click();
  await page
    .getByText(
      "작업 준비 완료 · 가상 운전 시계를 재생하면 물량이 이동합니다.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector(".fdc-mass")
          ?.textContent.match(/하역 ([\d,.]+)/)?.[1]
          .replaceAll(",", ""),
      ) > 0,
  );
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const material = app.engine.snapshot().material;
  assert.ok(material.received > 0);
  assert.ok(
    Math.abs(
      material.totalStock -
        material.baselineStock -
        material.received +
        material.outbound,
    ) < 1e-6,
  );
  for (const width of [1920, 1131, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.screenshot({
      path: path.join(artifacts, `control-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `page overflow at ${width}`,
    );
  }
  await page.getByRole("button", { name: "테마 전환", exact: true }).click();
  await page.screenshot({
    path: path.join(artifacts, "control-dark-320.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: path.join(artifacts, "control-dark-1920.png"),
    fullPage: true,
  });
  await app.close();
  await page.waitForFunction(() =>
    document
      .querySelector(".fdc-connection")
      ?.textContent.includes("연결 끊김"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "예제 불러오기", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "데모 연결 해제", exact: true })
    .click();
  assert.equal(app.wss.clients.size, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Fuel demo UI passed: explicit connection, StrictMode cleanup, presets, play/pause, units, schedule/cancel, unload conservation, disconnected controls, 1920/1131/390/320 and dark layouts.",
  );
} finally {
  await browser?.close();
  await vite.close();
  await app.close();
}
