import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const serverOrigin = process.env.BOTANICAL_SERVER_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@botanical/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: serverOrigin,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
