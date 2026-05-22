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
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      "takt-pc.reverse-cliff.ts.net",
    ],
    proxy: {

      // ─── WebSocket to Terminal Server ───────────────────
      '/ws': {
        target: 'ws://localhost:3003',
        ws: true,
        changeOrigin: true,
      },
      // ─── API to Backend Server ──────────────────────────
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
    },
  },
  // Optional: optimize deps for faster dev
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
});