// 深度交互探针：会话加载 / 文件面板 / 媒体背景协议
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 准备一张测试背景图（用应用图标），模拟“用户上传”后的状态（隔离 profile）
const { app, profile } = await launchIsolated(electronPath, root, { name: "deep" });
const mediaDir = path.join(profile, "media", "backgrounds");
fs.mkdirSync(mediaDir, { recursive: true });
fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(mediaDir, "test-bg.png"));

const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");
for (let i = 0; i < 40; i++) {
  const s = await win.evaluate(() => window.pidesk.getBackendStatus());
  if (s.phase === "ready") break;
  await sleep(1000);
}
await sleep(3500);

// 1) 设置媒体背景（走设置持久化通道），然后 reload 验证持久化 + 协议渲染
await win.evaluate(() =>
  window.pidesk.setSettings({
    appearance: {
      background: { kind: "media", media: "backgrounds/test-bg.png", mediaKind: "image", fit: "cover", opacity: 0.4, dim: 0.3 },
    },
  }),
);
await win.reload();
await win.waitForLoadState("domcontentloaded");
await sleep(3000);
const bg = await win.evaluate(async () => {
  const el = document.querySelector(".bg-layer img.bg-media");
  let loaded = false;
  if (el) {
    if (el.complete) loaded = el.naturalWidth > 0;
    else await new Promise((r) => { el.onload = () => r(true); el.onerror = () => r(false); });
    loaded = el.naturalWidth > 0;
  }
  return { exists: !!el, loaded, w: el?.naturalWidth, src: el?.src ?? "" };
});
console.log("media background:", JSON.stringify(bg));

// 2) 打开第一个会话
const firstSession = win.locator(".sb-item").first();
await firstSession.click();
await sleep(2500);
const chat = await win.evaluate(() => ({
  msgCount: document.querySelectorAll(".msg").length,
  hasUserBubble: !!document.querySelector(".msg.user .bubble"),
  hasAssistant: !!document.querySelector(".msg.assistant"),
  mdRendered: !!document.querySelector(".msg.assistant .md"),
  headerTitle: document.querySelector(".chat-head .ch-name")?.textContent?.trim(),
  modelChips: [...document.querySelectorAll(".chip-select")].map((s) => s.title),
}));
console.log("chat view:", JSON.stringify(chat));

// 3) 打开文件面板
await win.click(".chat-head .icon-btn[title=文件面板]");
await sleep(2500);
const fp = await win.evaluate(() => ({
  panel: !!document.querySelector(".file-panel"),
  rows: document.querySelectorAll(".fp-row").length,
  search: !!document.querySelector(".fp-search"),
}));
console.log("file panel:", JSON.stringify(fp));

// 4) 设置恢复内置背景
await win.evaluate(() =>
  window.pidesk.setSettings({ appearance: { background: { kind: "builtin", media: null } } }),
);

await app.close();
cleanupProfile(profile);
console.log("DEEP_DONE");
