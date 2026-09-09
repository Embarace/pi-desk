// e2e：技能与插件管理 tab
// 用临时技能/扩展目录测试 列表→禁用→启用→删除 全生命周期，不动真实数据
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
const HOME = os.homedir();
const skillsDir = path.join(HOME, ".pi", "agent", "skills");
const skillsDisabled = path.join(HOME, ".pi", "agent", "skills-disabled");
const extDir = path.join(HOME, ".pi", "agent", "extensions");
const extDisabled = path.join(HOME, ".pi", "agent", "extensions-disabled");

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

// 清理上次可能残留的测试项（幂等）
const testSkill = path.join(skillsDir, "test-manage-skill");
const testExt = path.join(extDir, "test-manage-ext.ts");
fs.rmSync(testSkill, { recursive: true, force: true });
fs.rmSync(path.join(skillsDisabled, "test-manage-skill"), { recursive: true, force: true });
fs.rmSync(testExt, { force: true });
fs.rmSync(path.join(extDisabled, "test-manage-ext.ts"), { force: true });

// 预置临时技能与扩展
fs.mkdirSync(testSkill, { recursive: true });
fs.writeFileSync(path.join(testSkill, "SKILL.md"), `---\nname: test-manage-skill\ndescription: e2e 测试用临时技能，请勿使用\n---\n\n# 测试\n`);
fs.writeFileSync(testExt, `export default function () { /* e2e test */ }\n`);

// 清理推荐技能下载残留（幂等）
fs.rmSync(path.join(skillsDir, "brave-search"), { recursive: true, force: true });

try { require("child_process").execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
await sleep(1500);

try {
  const { app, profile } = await launchIsolated(electronPath, root, { name: "manage" });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState("domcontentloaded");
  for (let i = 0; i < 90; i++) {
    const s = await win.evaluate(() => window.pidesk.getBackendStatus()).catch(() => null);
    if (s?.phase === "ready") break;
    await sleep(1000);
  }
  await sleep(3500); // 等启动遮罩淡出（onboarding 已完成不会出现引导）

  await win.click('.tb-btn[title="设置"]');
  await sleep(500);
  await win.locator(".sm-nav button", { hasText: "技能与插件" }).click();
  await sleep(800);

  ok("管理页渲染", (await win.locator(".sm-section").count()) >= 3);

  // ---- 插件 ----
  const extRow = win.locator(".mgr-row", { hasText: "test-manage-ext.ts" });
  ok("临时扩展已列出", (await extRow.count()) === 1);
  await win.screenshot({ path: path.join(outDir, "mgr-1-overview.png") });

  await extRow.locator("button", { hasText: "禁用" }).click();
  await sleep(600);
  ok("禁用后磁盘移到 disabled", fs.existsSync(path.join(extDisabled, "test-manage-ext.ts")));
  ok("禁用行显示启用按钮", (await win.locator(".mgr-row", { hasText: "test-manage-ext.ts" }).locator("button", { hasText: "启用" }).count()) === 1);

  const disRow = win.locator(".mgr-row", { hasText: "test-manage-ext.ts" }).first();
  await disRow.locator("button", { hasText: "启用" }).click();
  await sleep(600);
  ok("重新启用回到原目录", fs.existsSync(testExt));

  // ---- 技能 ----
  const skillRow = win.locator(".mgr-row", { hasText: "test-manage-skill" });
  ok("临时技能已列出", (await skillRow.count()) === 1);
  await skillRow.locator("button", { hasText: "禁用" }).click();
  await sleep(600);
  ok("技能禁用移动成功", fs.existsSync(path.join(skillsDisabled, "test-manage-skill")));
  const disSkillRow = win.locator(".mgr-row", { hasText: "test-manage-skill" }).first();
  await disSkillRow.locator("button", { hasText: "启用" }).click();
  await sleep(600);
  ok("技能重新启用成功", fs.existsSync(path.join(testSkill, "SKILL.md")));

  // 用户真实数据也应列出（playwright-cli 技能 + weather.ts 扩展）
  ok("真实技能 playwright-cli 在列", (await win.locator(".mgr-row", { hasText: "playwright-cli" }).count()) >= 1);
  ok("真实扩展 weather.ts 在列", (await win.locator(".mgr-row", { hasText: "weather.ts" }).count()) >= 1);

  // ---- 推荐技能下载 ----
  const catCard = win.locator(".mgr-cat", { hasText: "brave-search" });
  await catCard.locator("button").click();
  let downloaded = false;
  for (let i = 0; i < 30; i++) {
    if (await win.locator(".mgr-cat", { hasText: "brave-search" }).locator(".ob-skill-ok").count()) { downloaded = true; break; }
    await sleep(1000);
  }
  ok("管理页下载 brave-search 成功", downloaded);
  ok("磁盘验证 SKILL.md", fs.existsSync(path.join(skillsDir, "brave-search", "SKILL.md")));
  await win.screenshot({ path: path.join(outDir, "mgr-2-skills.png") });

  // ---- pi 包 ----
  const pkgRows = await win.locator(".mgr-row").count();
  ok(`pi 包列表渲染（${pkgRows} 行）`, pkgRows >= 4);
  ok("包含 pi-mcp-adapter", (await win.locator(".mgr-row", { hasText: "pi-mcp-adapter" }).count()) >= 1);
  ok("安装输入框存在", (await win.locator(".mgr-install-row .sm-input").count()) === 1);
  ok("已安装徽标", (await win.locator(".mgr-badge", { hasText: "已安装" }).count()) >= 1);
  await win.screenshot({ path: path.join(outDir, "mgr-3-packages.png") });

  await app.close();
  cleanupProfile(profile);
  console.log(failures === 0 ? "MANAGE_DONE all pass" : `MANAGE_DONE ${failures} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.log("MANAGE_FAIL:", e?.message || e);
  process.exitCode = 1;
} finally {
  // 清理测试项
  fs.rmSync(testSkill, { recursive: true, force: true });
  fs.rmSync(path.join(skillsDisabled, "test-manage-skill"), { recursive: true, force: true });
  fs.rmSync(testExt, { force: true });
  fs.rmSync(path.join(extDisabled, "test-manage-ext.ts"), { force: true });
  fs.rmSync(path.join(skillsDir, "brave-search"), { recursive: true, force: true });
}
