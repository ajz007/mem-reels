import { defineConfig } from "vite";

export default defineConfig({
  preview: { host: "127.0.0.1", port: 4173 },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
