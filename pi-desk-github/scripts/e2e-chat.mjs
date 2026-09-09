// e2e：真实对话链路——发送 → 运行状态收敛 → 运行中排队(follow-up) → fork 分支
// 消耗少量真实模型 token（消息是极短回复）；后端需可用。
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const outDir = path.join(root, ".e2e-shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

// 独立工作目录（新建会话用）
const probeCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-chat-e2e-"));
fs.writeFileSync(path.join(probeCwd, "note.txt"), "chat e2e\n");

let app = null;
let profile = "";
try {
  ({ app, profile } = await launchIsolated(electronPath, root, { name: "chat" }));
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState("domcontentloaded");
  for (let i = 0; i < 90; i++) {
    const s = await win.evaluate(() => window.pidesk.getBackendStatus()).catch(() => null);
    if (s?.phase === "ready") break;
    await sleep(1000);
  }
  await sleep(3500); // 遮罩淡出

  // 1) 新建会话并发送首条消息（目录选择是原生对话框无法驱动 → 直接用 API，App 5s 轮询会刷新侧栏）
  await win.evaluate(async (cwd) => {
    const r = await window.pidesk.request("/api/agent/new", { method: "POST", body: { cwd, type: "prompt", message: "只回复两个字：收到" } });
    return r.ok;
  }, probeCwd);
  await sleep(6000);

  // 等新会话出现在侧栏并选中
  const items = win.locator(".sb-item");
  await items.first().click();
  await sleep(3500);

  // 2) 等待运行收敛：run-chip 消失（对账机制兜底）
  let settled = false;
  for (let i = 0; i < 40; i++) {
    const n = await win.locator(".run-chip").count();
    if (n === 0) { settled = true; break; }
    await sleep(2000);
  }
  ok("首条消息后运行状态收敛（run-chip 消失）", settled);
  const hasReply = await win.evaluate(() =>
    [...document.querySelectorAll(".msg.assistant")].some((m) => (m.textContent || "").includes("收到")),
  );
  ok("助手已回复", hasReply);
  await win.screenshot({ path: path.join(outDir, "chat-1-done.png") });

  // 3) 运行中排队：发一个需要工具调用的长任务，运行中再发第二条 → follow-up 排队
  await win.fill(".composer textarea", "列出当前目录的所有文件，并逐个用一句话说明它们可能的用途");
  await win.click(".send-btn");
  await sleep(500); // 运行必然还在（工具调用任务）
  ok("运行中状态出现", (await win.locator(".run-chip").count()) === 1);
  ok("排队按钮可见", (await win.locator(".send-btn.queue").count()) === 1);
  ok("停止按钮可见", (await win.locator(".send-btn.stop").count()) === 1);
  ok("停止按钮非红色", await win.evaluate(() => {
    const el = document.querySelector(".send-btn.stop");
    if (!el) return false;
    return getComputedStyle(el).background !== "rgb(229, 72, 77)"; // var(--danger)
  }));
  await win.fill(".composer textarea", "再回复两个字：好的");
  await win.click(".send-btn.queue");
  await sleep(800);
  ok("排队 toast 出现", (await win.locator(".toast", { hasText: "队列" }).count()) >= 1);
  await win.screenshot({ path: path.join(outDir, "chat-2-queued.png") });

  // 等全部跑完
  let settled2 = false;
  for (let i = 0; i < 60; i++) {
    if ((await win.locator(".run-chip").count()) === 0) { settled2 = true; break; }
    await sleep(2000);
  }
  ok("排队任务全部完成后收敛", settled2);
  const hasFollow = await win.evaluate(() =>
    [...document.querySelectorAll(".msg.assistant")].some((m) => (m.textContent || "").includes("好的")),
  );
  ok("排队的第二条也已执行", hasFollow);

  // 4) fork：运行结束后对第一条用户消息分支
  await win.screenshot({ path: path.join(outDir, "chat-3-fork-btn.png") });
  const forkBtns = win.locator(".msg-act", { hasText: "从这条消息分支" });
  ok("fork 按钮可见（运行结束后）", (await forkBtns.count()) >= 1);
  await forkBtns.first().click();
  await sleep(3000);
  ok("fork 后切换/创建了新会话", (await win.locator(".chat-head .ch-name").count()) === 1);
  await win.screenshot({ path: path.join(outDir, "chat-4-forked.png") });

  await app.close();
  app = null;
  console.log(failures === 0 ? "CHAT_DONE all pass" : `CHAT_DONE ${failures} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.log("CHAT_FAIL:", e?.message || e);
  process.exitCode = 1;
} finally {
  if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]).catch(() => {});
  cleanupProfile(profile);
  fs.rmSync(probeCwd, { recursive: true, force: true });
  try { require("child_process").execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
}
