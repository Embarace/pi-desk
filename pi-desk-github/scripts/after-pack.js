"use strict";

// afterPack 钩子：electron-builder 跳过 winCodeSign 后，
// 用 vendored rcedit 给 exe 设置图标与版本信息（NSIS 打包前生效）。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rcedit = path.join(__dirname, "..", "build", "tools", "rcedit-x64.exe");
const icon = path.join(__dirname, "..", "build", "icon.ico");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  if (!fs.existsSync(rcedit)) {
    console.warn("[after-pack] rcedit not found, skipping icon embed:", rcedit);
    return;
  }
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exe)) {
    console.warn("[after-pack] exe not found:", exe);
    return;
  }
  const version = context.packager.appInfo.version || "0.1.0";
  const args = [
    exe,
    "--set-icon", icon,
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-version-string", "ProductName", "Pi Desk",
    "--set-version-string", "FileDescription", "Pi Desk —— 你的 pi 智能体桌面端",
    "--set-version-string", "CompanyName", "Pi Desk",
    "--set-version-string", "LegalCopyright", "MIT License",
  ];
  console.log("[after-pack] rcedit:", path.basename(exe));
  // exe 刚写入时可能被杀软扫描锁定，重试直到成功
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 1; i <= 12; i++) {
    try {
      execFileSync(rcedit, args, { stdio: "ignore" });
      console.log("[after-pack] icon & version applied");
      return;
    } catch {
      if (i === 12) {
        console.warn("[after-pack] rcedit failed after retries, continuing without icon");
        return;
      }
      await sleep(2000);
    }
  }
};
