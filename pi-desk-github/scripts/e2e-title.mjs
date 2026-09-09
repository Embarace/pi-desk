// 定位会话标题问题
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import { launchIsolated, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, profile } = await launchIsolated(electronPath, root, { name: "title" });
const win = await app.firstWindow({ timeout: 40000 });
await win.waitForLoadState("domcontentloaded");
for (let i = 0; i < 40; i++) {
  const s = await win.evaluate(() => window.pidesk.getBackendStatus());
  if (s.phase === "ready") break;
  await sleep(1000);
}
await sleep(3500);

await win.locator(".sb-item").first().click();
await sleep(3000);

const dump = await win.evaluate(() => {
  const head = document.querySelector(".chat-head");
  const userBubbles = [...document.querySelectorAll(".msg.user .bubble")].map((b) => b.textContent?.trim().slice(0, 40));
  return {
    headHtml: head?.innerHTML.slice(0, 400),
    firstUserBubbles: userBubbles.slice(0, 3),
    msgRoles: [...document.querySelectorAll(".chat-inner > div")].slice(0, 6).map((d) => d.className),
  };
});
console.log(JSON.stringify(dump, null, 2));
await app.close();
cleanupProfile(profile);
console.log("TITLE_DONE");
