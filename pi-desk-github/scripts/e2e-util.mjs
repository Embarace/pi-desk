// e2e 公共工具：隔离 profile 启动
// 每个测试用独立 userData（PI_DESK_USER_DATA），与用户真实数据/运行中的实例完全隔离；
// 单实例锁以 userData 为键，隔离后测试与用户应用互不干扰。
import path from "path";
import fs from "fs";
import os from "os";
import { _electron as electron } from "playwright";

export function makeProfile(name) {
  const profile = path.join(os.tmpdir(), `pidesk-e2e-${name}-${process.pid}`);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  return profile;
}

export async function launchIsolated(electronPath, root, opts = {}) {
  const { name = "app", extraEnv = {}, onboardingCompleted = true } = opts;
  const profile = makeProfile(name);
  if (onboardingCompleted) {
    fs.writeFileSync(
      path.join(profile, "settings.json"),
      JSON.stringify({ onboarding: { completed: true } }),
    );
  }
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["."],
    cwd: root,
    env: { ...process.env, PI_DESK_USER_DATA: profile, ...extraEnv },
    timeout: 90_000,
  });
  return { app, profile };
}

export function cleanupProfile(profile) {
  if (profile && fs.existsSync(profile)) {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
