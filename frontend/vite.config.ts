import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI server so the UI and API share an origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8000" },
  },
  build: {
    chunkSizeWarningLimit: 700, // recharts is ~550 kB raw, ~160 kB gzipped
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"] } },
    },
  },
  test: { environment: "node" },
});
