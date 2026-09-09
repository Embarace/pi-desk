"use strict";

// 开发模式：先起 Vite，再把 URL 交给 Electron
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const isWin = process.platform === "win32";
const viteBin = path.join(root, "node_modules", ".bin", isWin ? "vite.cmd" : "vite");
const electronBin = path.join(root, "node_modules", ".bin", isWin ? "electron.cmd" : "electron");

const vite = spawn(viteBin, ["--port", "5173", "--strictPort"], {
  cwd: root,
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, FORCE_COLOR: "1" },
});

function tryStart() {
  const electron = spawn(electronBin, ["."], {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173", FORCE_COLOR: "1" },
  });
  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}

// 等待 Vite 就绪（探测端口 5173）
const http = require("http");
function poll() {
  const req = http.get("http://127.0.0.1:5173", (res) => {
    res.resume();
    tryStart();
  });
  req.on("error", () => setTimeout(poll, 300));
  req.setTimeout(500, () => { req.destroy(); setTimeout(poll, 300); });
}

vite.on("exit", (code) => {
  if (code) process.exit(code);
});
setTimeout(poll, 800);
