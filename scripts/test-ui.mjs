import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const temp = resolve(".tooling-tmp");
mkdirSync(temp, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    resolve("node_modules/@playwright/test/cli.js"),
    "test",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, TEMP: temp, TMP: temp },
  },
);
process.exit(result.status ?? 1);
