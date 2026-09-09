// e2e：新版首次引导（欢迎：功能说明 + 教程视频 → 一键接入大模型）
// 前置：npm run build:renderer；后端可用或可 npx 拉起
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { makeProfile, cleanupProfile } from "./e2e-util.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const outDir = path.join(root, ".e2e-shots");
const profile = makeProfile("onboard"); // 全新 profile：无 settings → 引导必然出现
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = "http://127.0.0.1:30141";

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

async function launchApp() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    cwd: root,
    timeout: 90000,
    env: { ...process.env, PI_DESK_USER_DATA: profile },
  });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState("domcontentloaded");
  return { app, win };
}

async function waitBackend(win) {
  for (let i = 0; i < 120; i++) {
    const s = await win.evaluate(() => window.pidesk.getBackendStatus()).catch(() => null);
    if (s && s.phase === "ready") return true;
    await sleep(1000);
  }
  return false;
}

async function waitOverlay(win) {
  for (let i = 0; i < 20; i++) {
    if ((await win.locator(".ob-overlay").count()) > 0) return;
    await sleep(500);
  }
}

let app = null;
let importedProvider = "";
try {
  // 先等后端就绪（遮罩会先出现；引导挂在遮罩淡出后）
  app = (await launchApp()).app;
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState("domcontentloaded");
  ok("后端就绪", await waitBackend(win));
  await sleep(3500); // 遮罩淡出 → 引导出现
  await waitOverlay(win);

  // ---- 欢迎页 ----
  ok("引导遮罩出现", (await win.locator(".ob-overlay").count()) === 1);
  ok("欢迎标题", await win.locator(".ob-card h1").textContent().then((t) => (t || "").includes("欢迎使用 Pi Desk")).catch(() => false));
  ok("功能卡片 6 张", (await win.locator(".ob-feat").count()) === 6);
  const vf = win.locator(".ob-video iframe");
  ok("教程视频 iframe", (await vf.count()) === 1);
  ok("视频指向 B 站 BV139bD6gEa8", ((await vf.getAttribute("src")) || "").includes("BV139bD6gEa8"));
  ok("环境状态行", (await win.locator(".ob-envline").count()) === 1);
  await win.screenshot({ path: path.join(outDir, "ob-1-welcome.png") });

  // ---- 一键接入大模型 ----
  await win.locator(".ob-card button", { hasText: "一键接入大模型" }).click();
  await sleep(1200);
  ok("搜索框与热门提示出现", (await win.locator(".ob-search input").count()) === 1 && (await win.locator(".ob-pop-chip").count()) >= 6);
  ok("空搜索不展示提供商列表", (await win.locator(".ob-prov").count()) === 0);
  await win.screenshot({ path: path.join(outDir, "ob-2-api.png") });

  // 搜索过滤
  await win.fill(".ob-search input", "deepseek");
  await sleep(300);
  const dsRows = await win.locator(".ob-prov").count();
  ok(`搜索过滤生效（deepseek → ${dsRows} 行）`, dsRows >= 1 && dsRows <= 2);
  ok("已配置徽标显示", (await win.locator(".ob-prov-tag.ok").count()) >= 1);
  ok("清空按钮出现", (await win.locator(".ob-search-clear").count()) === 1);
  // 清空 → 列表再次隐藏
  await win.locator(".ob-search-clear").click();
  await sleep(300);
  ok("清空后列表隐藏", (await win.locator(".ob-prov").count()) === 0);
  // 热门 chip 快捷搜索
  await win.locator(".ob-pop-chip", { hasText: "OpenAI" }).click();
  await sleep(300);
  ok("热门 chip 快捷搜索生效", (await win.locator(".ob-prov").count()) >= 1);
  await win.screenshot({ path: path.join(outDir, "ob-2b-search.png") });

  // 选一个未配置的提供商（不碰用户真实 Key）
  const target = await win.evaluate(() => {
    const rows = [...document.querySelectorAll(".ob-prov")];
    const row = rows.find((r) => !r.querySelector(".ob-prov-tag.ok"));
    return row ? (row.querySelector(".ob-prov-name")?.textContent || "") : "";
  });
  if (target) {
    await win.locator(".ob-prov", { hasText: target }).first().click();
    await sleep(300);
    ok(`选中未配置提供商（${target}）`, (await win.locator(".ob-prov.sel").count()) === 1);
    await win.fill(".ob-key-row input", "sk-fake-key-for-e2e-test");
    ok("导入按钮可用", !(await win.locator(".ob-row button", { hasText: "一键导入" }).isDisabled()));
    await win.locator(".ob-row button", { hasText: "一键导入" }).click();
    // 成功或失败提示都算走通客户端链路（假 Key 可能被后端校验拒绝）
    let outcome = "";
    for (let i = 0; i < 15; i++) {
      if ((await win.locator(".ob-okline", { hasText: "已导入成功" }).count()) === 1) { outcome = "ok"; break; }
      if ((await win.locator(".ob-okline.warn", { hasText: "Key" }).count()) === 1 || (await win.locator(".ob-okline.warn").count()) >= 1) { outcome = "err"; break; }
      await sleep(1000);
    }
    ok(`导入链路反馈（${outcome || "无反馈"}）`, outcome === "ok" || outcome === "err");
    if (outcome === "ok") {
      // 趁后端还存活立即删除假 Key（用渲染层桥，此时必然可达）
      const delOk = await win.evaluate(async () => {
        const id = document.querySelector(".ob-prov.sel")?.getAttribute("data-id");
        if (!id) return false;
        const res = await window.pidesk.request(`/api/auth/api-key/${encodeURIComponent(id)}`, { method: "DELETE" });
        return res.ok;
      });
      ok("假 Key 已清理", delOk);
      importedProvider = ""; // 已删，finally 无需兜底
      await sleep(300);
    }
    await win.screenshot({ path: path.join(outDir, "ob-3-import.png") });
  } else {
    ok("存在未配置提供商（全部已配置则跳过导入测试）", false);
  }

  // 完成引导
  await win.locator(".ob-card button", { hasText: "完成，开始使用" }).click();
  await sleep(800);
  ok("引导遮罩消失", (await win.locator(".ob-overlay").count()) === 0);
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")).onboarding?.completed;
  ok("onboarding.completed 已持久化", persisted === true);

  // 帮助与支持 tab（视频入口仍在）
  await win.click('.tb-btn[title="设置"]');
  await sleep(500);
  await win.locator(".sm-nav button", { hasText: "帮助与支持" }).click();
  await sleep(400);
  ok("B 站视频卡片", (await win.locator(".help-video-card").count()) === 1);
  await win.screenshot({ path: path.join(outDir, "ob-4-help.png") });

  await app.close();
  app = null;
  await sleep(2000);

  // ---- 第二轮：重启后不再出现引导 ----
  const { app: app2, win: win2 } = await launchApp();
  await waitBackend(win2);
  await sleep(3500);
  ok("重启后引导不再出现", (await win2.locator(".ob-overlay").count()) === 0);
  await app2.close();

  console.log(failures === 0 ? "ONBOARD_DONE all pass" : `ONBOARD_DONE ${failures} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.log("ONBOARD_FAIL:", e?.message || e);
  process.exitCode = 1;
} finally {
  if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]).catch(() => {});
  // 清理导入测试的假 Key（按显示名解析出提供商 id 后删除）
  if (importedProvider) {
    try {
      const res = await fetch(`${BASE}/api/auth/providers`);
      const data = await res.json();
      const hit = (data.apiKeyProviders ?? []).find((p) => p.displayName === importedProvider);
      if (hit) {
        await fetch(`${BASE}/api/auth/api-key/${encodeURIComponent(hit.id)}`, { method: "DELETE" });
        console.log("cleaned fake key for", hit.id);
      }
    } catch { /* ignore */ }
  }
  cleanupProfile(profile);
  try { require("child_process").execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
}
