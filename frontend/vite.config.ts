import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@wayfinder/protocol": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  server: {
    open: true,
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/ready": "http://localhost:3001",
      "/socket.io": { target: "ws://localhost:3001", ws: true }
    }
  },
});
