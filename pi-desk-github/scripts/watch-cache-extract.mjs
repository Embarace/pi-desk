// 监视 electron-builder 缓存目录，自动解压新下载的 .7z（跳过符号链接）
// 用途：绕过 Windows 无符号链接权限导致的 winCodeSign/nsis 解压失败
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const cacheDir = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "winCodeSign");
const sevenZip = process.argv[2] || "node_modules/7zip-bin/win/x64/7za.exe";

const queue = new Set();

function extract(zipPath) {
  const base = zipPath.replace(/\.7z$/, "");
  if (fs.existsSync(base)) return;
  try {
    execFileSync(sevenZip, ["x", "-bd", "-y", zipPath, `-o${base}`], { stdio: "ignore", timeout: 120000 });
    console.log("extracted:", path.basename(base));
  } catch (e) {
    // 符号链接错误可以容忍（darwin 部分）；稍后重试
    if (fs.existsSync(base)) console.log("extracted (partial):", path.basename(base));
  }
}

function scan() {
  let files;
  try {
    files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".7z"));
  } catch {
    return;
  }
  for (const f of files) {
    const full = path.join(cacheDir, f);
    const base = full.replace(/\.7z$/, "");
    if (!fs.existsSync(base) && !queue.has(full)) {
      queue.add(full);
      const size = fs.statSync(full).size;
      // 等待下载完成：2 秒内大小不变再解压
      setTimeout(() => {
        try {
          if (fs.statSync(full).size === size) extract(full);
        } catch { /* ignore */ }
        queue.delete(full);
      }, 2500);
    }
  }
}

console.log("watching:", cacheDir);
setInterval(scan, 1500);
scan();
