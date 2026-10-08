import { defineConfig } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync(".tooling-tmp", { recursive: true });
process.env.TEMP = process.env.TMP = resolve(".tooling-tmp");
const localChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ??
        (existsSync(localChrome) ? localChrome : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
