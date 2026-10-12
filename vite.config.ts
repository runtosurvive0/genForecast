import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath, URL } from "node:url";
import { devOriginBridge, developmentBackend } from "./scripts/dev-origin.ts";

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "MIDTERM_");
  const backend = developmentBackend(localEnv);
  return {
    plugins: [react(), tailwindcss(), viteSingleFile(),
      ...(backend.origin ? [devOriginBridge(backend.origin)] : [])],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: Number(localEnv.MIDTERM_DEV_PORT || "5173"),
      strictPort: true,
      proxy: {
        "/api": {
          target: backend.target,
          changeOrigin: true,
          secure: true,
        },
      },
      watch: {
        ignored: [
          "**/.tooling-tmp/**",
          "**/.npm-cache/**",
          "**/test-results/**",
          "**/artifacts/**",
        ],
      },
    },
    build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  };
});
