"use strict";

// 环境检测：Node.js / pi 是否可用、API 是否已配置。
// 用于首次启动引导（傻瓜式安装流程）。

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");

function run(cmd, timeoutMs = 15000) {
  try {
    const out = execSync(cmd, {
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32" ? true : undefined,
    });
    return { ok: true, out: String(out).trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/** 找到可用的 node 可执行文件：PATH → pi 自带 → Program Files */
function findNode() {
  const r = run(`node --version`, 10000);
  if (r.ok) {
    const where = run(process.platform === "win32" ? "where node" : "which node", 5000);
    return { ok: true, version: r.out.replace(/^v/, ""), path: (where.ok && where.out.split(/\r?\n/)[0]) || "" };
  }
  const candidates = [
    path.join(LOCALAPPDATA, "pi-node", "current", "node.exe"), // pi 自带 node
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const v = run(`"${p}" --version`, 10000);
      if (v.ok) return { ok: true, version: v.out.replace(/^v/, ""), path: p };
    }
  }
  return { ok: false, version: "", path: "" };
}

/** 找到 pi 命令（不执行它——pi CLI 启动慢） */
function findPi() {
  const where = run(process.platform === "win32" ? "where pi" : "which pi", 5000);
  if (where.ok && where.out) {
    const first = where.out.split(/\r?\n/)[0].trim();
    return { ok: true, version: "", path: first };
  }
  // 检查 pi 的安装目录（pi-node 布局）
  const piBin = path.join(LOCALAPPDATA, "pi-node", "current", "bin");
  const piExe = path.join(LOCALAPPDATA, "pi-node", "current", "node.exe");
  if (fs.existsSync(piBin) || fs.existsSync(piExe)) {
    return { ok: true, version: "", path: piBin };
  }
  // npm 全局安装
  const npmRoot = run("npm root -g", 10000);
  if (npmRoot.ok && npmRoot.out) {
    const globalPi = path.join(npmRoot.out, "@earendil-works", "pi-coding-agent");
    if (fs.existsSync(globalPi)) return { ok: true, version: "", path: globalPi };
  }
  return { ok: false, version: "", path: "" };
}

/** 判断 API 是否已配置：~/.pi/agent 下的模型/凭据文件 */
function checkAgent() {
  const agentDir = path.join(HOME, ".pi", "agent");
  const exists = fs.existsSync(agentDir);
  let apiConfigured = false;
  let modelsCount = 0;
  if (exists) {
    for (const f of ["models-store.json", "auth.json", "models.json"]) {
      const p = path.join(agentDir, f);
      try {
        if (fs.statSync(p).size > 20) {
          apiConfigured = true;
          if (f === "models-store.json") {
            try {
              const j = JSON.parse(fs.readFileSync(p, "utf8"));
              const arr = Array.isArray(j) ? j : j.models ?? j.store ?? [];
              if (Array.isArray(arr)) modelsCount = arr.length;
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
  }
  return { exists, apiConfigured, modelsCount, agentDir };
}

function detect() {
  const node = findNode();
  const pi = findPi();
  const agent = checkAgent();
  return {
    node: { ...node, hint: "" },
    pi: { ...pi, hint: "" },
    agentDir: agent.exists,
    apiConfigured: agent.apiConfigured,
    modelsCount: agent.modelsCount,
    agentPath: agent.agentDir,
  };
}

module.exports = { detect, findNode, HOME };
