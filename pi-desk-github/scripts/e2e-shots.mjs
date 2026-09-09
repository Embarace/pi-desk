// 生成宣传截图：主界面（会话打开）、设置-外观、设置-启动
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const outDir = path.join(root, ".e2e-shots");
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, profile } = await launchIsolated(electronPath, root, { name: "shots" });
const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");
for (let i = 0; i < 60; i++) {
  const s = await win.evaluate(() => window.pidesk.getBackendStatus());
  if (s.phase === "ready") break;
  await sleep(1000);
}
await sleep(3800); // 等待启动遮罩淡出

// 打开当前会话（本对话）——选第一个有用户消息的
await win.locator(".sb-item").first().click();
await sleep(3000);
await win.screenshot({ path: path.join(outDir, "shot-main.png") });

// 设置 - 外观
await win.click(".tb-btn[title=设置]");
await sleep(600);
await win.screenshot({ path: path.join(outDir, "shot-settings-bg.png") });

// 设置 - 启动
await win.click("text=启动动画与音频");
await sleep(400);
await win.screenshot({ path: path.join(outDir, "shot-settings-startup.png") });

await win.click(".settings-modal .icon-btn");
await sleep(300);

// 文件面板
await win.click(".chat-head .icon-btn[title=文件面板]");
await sleep(2500);
await win.screenshot({ path: path.join(outDir, "shot-files.png") });

await app.close();
cleanupProfile(profile);
console.log("SHOTS_DONE");
