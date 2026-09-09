// pidesk-media 协议探测
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mediaDir = path.join(process.env.APPDATA || "", "Pi Desk", "media", "backgrounds");
fs.mkdirSync(mediaDir, { recursive: true });
fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(mediaDir, "test-bg.png"));

const app = await electron.launch({ executablePath: electronPath, args: ["."], cwd: root, timeout: 60000 });
const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");
await sleep(2500);

const result = await win.evaluate(async () => {
  const out = {};
  try {
    const res = await fetch("pidesk-media://local/backgrounds/test-bg.png");
    out.status = res.status;
    out.contentType = res.headers.get("content-type");
    const buf = await res.arrayBuffer();
    out.bytes = buf.byteLength;
  } catch (e) {
    out.error = String(e);
  }
  try {
    const res2 = await fetch("pidesk-media://local/backgrounds/missing.png");
    out.missingStatus = res2.status;
  } catch (e) {
    out.missingError = String(e);
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));

// 同时测试 pidesk-file 协议（转发后端 /api/home）
const fileResult = await win.evaluate(async () => {
  try {
    const res = await fetch("pidesk-file://pi/home");
    const j = await res.json();
    return { status: res.status, home: j.home?.slice(0, 30) };
  } catch (e) {
    return { error: String(e) };
  }
});
console.log("pidesk-file:", JSON.stringify(fileResult));
await app.close();
cleanupProfile(profile);
console.log("PROTO_DONE");
