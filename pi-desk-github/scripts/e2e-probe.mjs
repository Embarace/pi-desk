// 结构化 UI 探针：验证布局与关键元素
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ executablePath: electronPath, args: ["."], cwd: root, timeout: 60000 });
const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");

for (let i = 0; i < 40; i++) {
  const s = await win.evaluate(() => window.pidesk.getBackendStatus());
  if (s.phase === "ready") break;
  await sleep(1000);
}
await sleep(3500); // 等待启动遮罩淡出

const info = await win.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const sessions = qa(".sb-item .sname").map((el) => el.textContent?.trim());
  return {
    overlayGone: !q(".startup-overlay"),
    titlebar: !!q(".titlebar"),
    bgLayer: !!q(".bg-layer"),
    bgBuiltin: !!q(".bg-builtin"),
    sidebar: !!q(".sidebar"),
    chatCol: !!q(".chat-col"),
    composer: !!q(".composer textarea"),
    sessionNames: sessions.slice(0, 5),
    groupNames: qa(".sb-group-head .gname").map((el) => el.textContent?.trim()).slice(0, 5),
    emptyState: q(".empty-state .es-title")?.textContent?.trim() ?? null,
    accentVar: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    panelOpacityVar: getComputedStyle(document.documentElement).getPropertyValue("--panel-opacity").trim(),
  };
});
console.log(JSON.stringify(info, null, 2));

// 打开设置 → 启动 tab → 检查控件
await win.click(".tb-btn[title=设置]");
await sleep(500);
await win.click("text=启动动画与音频");
await sleep(300);
const startup = await win.evaluate(() => ({
  animSelect: [...document.querySelectorAll(".sm-select option")].slice(0, 8).map((o) => o.textContent),
  hasAnimPreview: !!document.querySelector(".anim-preview .ap-box"),
  hasAudioCheckbox: !!document.querySelector('input[type="checkbox"]'),
  hasUploadAudioBtn: [...document.querySelectorAll(".sm-btn")].some((b) => b.textContent.includes("选择音频文件")),
}));
console.log(JSON.stringify(startup, null, 2));

// 切换动画为 fade，检查预览类名
await win.selectOption(".sm-content .sm-select", "fade");
await sleep(200);
const previewCls = await win.evaluate(() => document.querySelector(".anim-preview .ap-box")?.className);
console.log("preview class after fade:", previewCls);

// 回到外观 tab，检查背景控件
await win.click("text=外观与背景");
await sleep(300);
const appearance = await win.evaluate(() => ({
  hasUploadBg: [...document.querySelectorAll(".sm-btn")].some((b) => b.textContent.includes("上传图片")),
  fitOptions: [...document.querySelectorAll(".sm-select option")].slice(0, 6).map((o) => o.textContent),
  hasOpacitySlider: !!document.querySelector('.sm-row input[type="range"]'),
}));
console.log(JSON.stringify(appearance, null, 2));

await app.close();
console.log("PROBE_DONE");
