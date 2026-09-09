import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // file:// 加载，必须使用相对路径
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "chrome138",
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
