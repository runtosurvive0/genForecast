import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    watch: {
      ignored: ["**/.tooling-tmp/**", "**/.npm-cache/**", "**/test-results/**", "**/artifacts/**"],
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
