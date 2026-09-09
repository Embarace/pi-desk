// e2e：后端启动超时 → 自动重试 → 报错可跳过 的完整链路
// 用假 pi-web（存活但从不监听）模拟下载挂死；超时时间用环境变量压到秒级。
// 完全隔离：独立 userData（PI_DESK_USER_DATA），不碰用户真实数据。
import { _electron as electron } from "playwright";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))), "..");
const outDir = path.join(root, ".e2e-shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 独立测试 profile
const profile = path.join(os.tmpdir(), `pidesk-profile-timeout-${process.pid}`);
fs.mkdirSync(profile, { recursive: true });

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

// 假 pi-web：存活但不监听端口（模拟首次下载挂死）
const fakeWeb = path.join(profile, "fake-web");
fs.mkdirSync(path.join(fakeWeb, "bin"), { recursive: true });
fs.writeFileSync(
  path.join(fakeWeb, "bin", "pi-web.js"),
  'setInterval(() => {}, 1000); console.log("pidesk-fake-web alive");\n',
);
fs.writeFileSync(
  path.join(profile, "settings.json"),
  // 用独立端口：即使真实 pi-web 占用 30141（用户在用），测试也不受干扰
  JSON.stringify({ backend: { mode: "local", port: 39999, localPath: fakeWeb, externalUrl: "" }, onboarding: { completed: true } }),
);

try { require("child_process").execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
try {
  require("child_process").execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*pidesk-fake-web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
    { stdio: "ignore" },
  );
} catch {}
await sleep(1500);

let app = null;
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    cwd: root,
    timeout: 90000,
    env: { ...process.env, PI_DESK_USER_DATA: profile, PI_DESK_SPAWN_TIMEOUTS: "5000,4000" },
  });
  const win = await app.firstWindow({ timeout: 45000 });
  await win.waitForLoadState("domcontentloaded");

  // 订阅后端状态流直到 error（带 30s 兜底）
  const statesP = win.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = [];
        const done = () => { un(); clearTimeout(t); resolve(seen); };
        const un = window.pidesk.onBackendStatus((s) => {
          seen.push({ phase: s.phase, detail: s.startDetail || "", error: s.error || "" });
          if (s.phase === "error") done();
        });
        const t = setTimeout(done, 30000);
      }),
  );
  const states = await statesP;

  const startingStates = states.filter((s) => s.phase === "starting");
  ok("首次尝试文案（本地模式）", startingStates.some((s) => s.detail.includes("正在启动 pi-web")));
  ok("自动重试文案出现", startingStates.some((s) => s.detail.includes("自动重试")));
  ok("最终进入 error", states[states.length - 1].phase === "error");
  ok("报错提示含『超时』", states[states.length - 1].error.includes("超时"));
  ok("重试后报错注明已重试", states[states.length - 1].error.includes("自动重试"));

  // 遮罩上的错误与跳过入口
  await win.waitForSelector(".so-err", { timeout: 5000 }).catch(() => {});
  ok("遮罩显示错误信息", (await win.locator(".so-err").count()) === 1);
  await win.screenshot({ path: path.join(outDir, "timeout-1-error.png") });
  await win.locator(".so-retry.ghost").click({ timeout: 8000 });
  await sleep(1800);
  ok("跳过按钮可进入主界面（遮罩已移除）", (await win.locator(".startup-overlay").count()) === 0 && (await win.locator(".app-root").count()) === 1);
  await win.screenshot({ path: path.join(outDir, "timeout-2-skipped.png") });

  // 点「重试」重新拉起后端，验证错误状态可恢复（同样超时→error，链路闭合）
  const retryStates = await win.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = [];
        const done = () => { un(); clearTimeout(t); resolve(seen); };
        const un = window.pidesk.onBackendStatus((s) => {
          seen.push(s.phase);
          if (s.phase === "error") done();
        });
        const t = setTimeout(done, 20000);
        void window.pidesk.restartBackend();
      }),
  );
  ok("重试后再次走完超时链路", retryStates.includes("starting") && retryStates[retryStates.length - 1] === "error");

  await app.close();
  app = null;
  console.log(failures === 0 ? "TIMEOUT_DONE all pass" : `TIMEOUT_DONE ${failures} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.log("TIMEOUT_FAIL:", e?.message || e);
  process.exitCode = 1;
} finally {
  if (app) {
    // 关闭失败也别卡死测试：8 秒后强制退出
    await Promise.race([app.close().catch(() => {}), sleep(8000)]).catch(() => {});
  }
  // 清理假后端残留进程与临时 profile
  try {
    require("child_process").execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*pidesk-fake-web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: "ignore" },
    );
  } catch {}
  fs.rmSync(profile, { recursive: true, force: true });
  try { require("child_process").execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
}
