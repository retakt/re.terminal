import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,   // bind to 0.0.0.0 — reachable on Tailscale (100.77.70.7) and LAN
    // Proxy WebSocket connections to the terminal server in dev
    proxy: {
      "/ws": {
        target:      "ws://localhost:3003",
        ws:          true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3003",
        changeOrigin: true,
      },
    },
  },
});
