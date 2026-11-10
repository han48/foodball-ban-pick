import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const laravelOrigin = process.env.LARAVEL_ORIGIN || "http://127.0.0.1:13280";

export default defineConfig({
  base: "/football-draft/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: laravelOrigin,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "132.one/public/football-draft",
    emptyOutDir: true,
  },
});
