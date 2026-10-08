import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "MIDTERM_");
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: Number(localEnv.MIDTERM_DEV_PORT || "5173"),
      strictPort: true,
      proxy: {
        "/api": {
          target: localEnv.MIDTERM_API_TARGET || "http://127.0.0.1:8093",
          changeOrigin: true,
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
