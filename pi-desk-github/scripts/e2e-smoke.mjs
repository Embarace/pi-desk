// Electron 端到端冒烟测试：启动应用 → 等待后端就绪 → 截图 + 检查关键 UI
// 用法：node scripts/e2e-smoke.mjs [--shot outdir]
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // 解析为 electron 可执行文件路径
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const shotDir = path.join(root, ".e2e-shots");
fs.mkdirSync(shotDir, { recursive: true });

const errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 清理可能残留的 electron 进程，避免端口/锁冲突
if (process.platform === "win32") {
  await new Promise((resolve) => {
    const { exec } = require("child_process");
    exec("taskkill /F /IM electron.exe", () => resolve());
  });
  await sleep(1500);
}

let app;
let profile = "";
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    ({ app, profile } = await launchIsolated(electronPath, root, { name: "smoke", extraEnv: { PIDESK_SMOKE: "1" } }));
    break;
  } catch (e) {
    console.log(`launch attempt ${attempt + 1} failed:`, e.message.split("\n")[0]);
    await sleep(2000);
  }
}
if (!app) {
  console.log("SMOKE_FAIL launch");
  process.exit(1);
}

const win = await app.firstWindow({ timeout: 40_000 });
await win.waitForLoadState("domcontentloaded");

win.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
});
win.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

// 等待后端就绪（启动遮罩消失）
let ready = false;
for (let i = 0; i < 60; i++) {
  const state = await win.evaluate(() => window.pidesk.getBackendStatus());
  if (state.phase === "ready") { ready = true; break; }
  if (state.phase === "error") { console.log("BACKEND_ERROR:", state.error); break; }
  await sleep(1000);
}
console.log("backend ready:", ready);

// 等待启动遮罩淡出（最短时长默认 1800ms）
await sleep(3500);
await win.screenshot({ path: path.join(shotDir, "1-main.png") });

// 打开设置
await win.click(".tb-btn[title=设置]");
await sleep(600);
await win.screenshot({ path: path.join(shotDir, "2-settings-appearance.png") });

// 切换到「启动动画与音频」tab
await win.click("text=启动动画与音频");
await sleep(500);
await win.screenshot({ path: path.join(shotDir, "3-settings-startup.png") });

// 切换到「后端服务」tab
await win.click("text=后端服务");
await sleep(500);
await win.screenshot({ path: path.join(shotDir, "4-settings-backend.png") });

// 关闭设置
await win.click(".settings-modal .icon-btn");
await sleep(400);

// 侧栏会话数
const sessionCount = await win.locator(".sb-item").count();
console.log("sidebar session items:", sessionCount);

const title = await win.title();
console.log("window title:", title);

console.log("console errors:", errors.length);
for (const e of errors.slice(0, 10)) console.log("  ", e);

await win.screenshot({ path: path.join(shotDir, "5-final.png") });
await app.close();
cleanupProfile(profile);
console.log("SMOKE_DONE");
