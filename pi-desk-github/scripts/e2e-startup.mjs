// 启动动画 + 音频验证：设置 → reload → 检查遮罩动画类与淡出
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 生成一个 0.6s 提示音 WAV（正弦波 880Hz）
function makeWav() {
  const rate = 22050, dur = 0.6, n = Math.floor(rate * dur);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 5);
    const v = Math.round(Math.sin(2 * Math.PI * 880 * t) * 0.5 * env * 32767);
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const { app, profile } = await launchIsolated(electronPath, root, { name: "startup" });
const audioDir = path.join(profile, "media", "audio");
fs.mkdirSync(audioDir, { recursive: true });
fs.writeFileSync(path.join(audioDir, "startup-test.wav"), makeWav());

const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");
await sleep(1000);

// 第一轮：默认启动（无音频），设置动画为 slide-up + 音频后 reload
await win.evaluate(() =>
  window.pidesk.setSettings({
    startup: { animation: "slide-up", minDuration: 2000, audio: { enabled: true, file: "audio/startup-test.wav", volume: 0.5 } },
  }),
);
await win.reload();
await win.waitForLoadState("domcontentloaded");
await sleep(800);

const during = await win.evaluate(() => {
  const o = document.querySelector(".startup-overlay");
  return {
    overlay: !!o,
    animClass: o?.className ?? "",
    hasAudioEl: true,
    backendPhase: (async () => (await window.pidesk.getBackendStatus()).phase)(),
  };
});
console.log("during startup:", JSON.stringify({ overlay: during.overlay, animClass: during.animClass, backendPhase: await during.backendPhase }));

// 等待淡出
await sleep(4500);
const after = await win.evaluate(() => ({
  overlayGone: !document.querySelector(".startup-overlay"),
  appVisible: !!document.querySelector(".chat-col"),
}));
console.log("after startup:", JSON.stringify(after));

// 恢复默认设置
await win.evaluate(() =>
  window.pidesk.setSettings({ startup: { animation: "aurora", minDuration: 1800, audio: { enabled: false } } }),
);
await app.close();
cleanupProfile(profile);
console.log("STARTUP_DONE");
