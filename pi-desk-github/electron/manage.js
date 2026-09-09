"use strict";

// 技能与插件管理：列表 / 安装（本地文件夹）/ 删除 / 启用禁用（移动目录）
// pi 包（插件包）：读写 ~/.pi/agent/settings.json 的 packages 数组，经 pi CLI 安装/移除

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { dialog } = require("electron");

const HOME = os.homedir();
const AGENT_DIR = path.join(HOME, ".pi", "agent");
const SKILL_ROOTS = [path.join(AGENT_DIR, "skills"), path.join(HOME, ".agents", "skills")];
const SKILL_DISABLED = path.join(AGENT_DIR, "skills-disabled");
const EXT_ROOT = path.join(AGENT_DIR, "extensions");
const EXT_DISABLED = path.join(AGENT_DIR, "extensions-disabled");
const SETTINGS_FILE = path.join(AGENT_DIR, "settings.json");

function inRoot(p, root) {
  const abs = path.normalize(p);
  const r = path.normalize(root);
  return abs === r || abs.startsWith(r + path.sep);
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function readSkillInfo(dir) {
  const p = path.join(dir, "SKILL.md");
  try {
    const fm = parseFrontmatter(fs.readFileSync(p, "utf8"));
    return {
      name: fm.name || path.basename(dir),
      desc: fm.description || "",
      license: fm.license || "",
    };
  } catch {
    return { name: path.basename(dir), desc: "" };
  }
}

// ---------------- 技能 ----------------

function listSkills() {
  const skills = [];
  const disabled = [];
  for (const root of SKILL_ROOTS) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      // ~/.pi/agent/skills：只扫根级目录；~/.agents/skills：递归两层
      if (path.basename(path.dirname(root)) === "agent" && path.basename(root) === "skills") {
        for (const d of entries) {
          if (!d.isDirectory()) continue;
          const dir = path.join(root, d.name);
          if (fs.existsSync(path.join(dir, "SKILL.md"))) {
            skills.push({ ...readSkillInfo(dir), dir, root, source: "pi/agent" });
          }
        }
      } else {
        const walk = (base, depth) => {
          for (const d of fs.readdirSync(base, { withFileTypes: true })) {
            if (!d.isDirectory()) continue;
            const dir = path.join(base, d.name);
            if (fs.existsSync(path.join(dir, "SKILL.md"))) {
              skills.push({ ...readSkillInfo(dir), dir, root, source: "agents" });
            } else if (depth > 0) {
              walk(dir, depth - 1);
            }
          }
        };
        walk(root, 3);
      }
    } catch { /* ignore */ }
  }
  try {
    if (fs.existsSync(SKILL_DISABLED)) {
      for (const d of fs.readdirSync(SKILL_DISABLED, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = path.join(SKILL_DISABLED, d.name);
        if (fs.existsSync(path.join(dir, "SKILL.md"))) {
          disabled.push({ ...readSkillInfo(dir), dir, root: SKILL_DISABLED, source: "已禁用" });
        }
      }
    }
  } catch { /* ignore */ }
  return { skills, disabled };
}

function removeSkill(dir) {
  if (!SKILL_ROOTS.some((r) => inRoot(dir, r)) && !inRoot(dir, SKILL_DISABLED)) {
    throw new Error("拒绝删除：目录不在技能目录内");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function setSkillEnabled(dir, enabled) {
  if (enabled) {
    // 启用：读回原始根目录，移回原位
    if (!inRoot(dir, SKILL_DISABLED)) return false;
    const name = path.basename(dir);
    let origin = SKILL_ROOTS[0];
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, ".pidesk-origin.json"), "utf8"));
      if (SKILL_ROOTS.some((r) => meta.root === r)) origin = meta.root;
    } catch { /* 默认放回 pi/agent */ }
    const dest = path.join(origin, name);
    fs.mkdirSync(origin, { recursive: true });
    if (fs.existsSync(dest)) throw new Error(`目标位置已存在同名技能：${dest}`);
    fs.renameSync(dir, dest);
    try { fs.rmSync(path.join(dest, ".pidesk-origin.json"), { force: true }); } catch { /* ignore */ }
    return true;
  }
  if (!SKILL_ROOTS.some((r) => inRoot(dir, r))) throw new Error("拒绝操作：目录不在技能目录内");
  const name = path.basename(dir);
  fs.mkdirSync(SKILL_DISABLED, { recursive: true });
  const dest = path.join(SKILL_DISABLED, name);
  if (fs.existsSync(dest)) throw new Error("已存在同名禁用技能");
  fs.renameSync(dir, dest);
  // 记住原始根，供启用时还原
  const origin = SKILL_ROOTS.find((r) => inRoot(dir, r));
  if (origin) fs.writeFileSync(path.join(dest, ".pidesk-origin.json"), JSON.stringify({ root: origin }));
  return true;
}

async function installSkillFromFolder() {
  const win = require("electron").BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "选择技能文件夹（包含 SKILL.md）",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const src = result.filePaths[0];
  if (!fs.existsSync(path.join(src, "SKILL.md"))) {
    throw new Error("所选文件夹中没有 SKILL.md，不是有效的技能");
  }
  const name = path.basename(src);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new Error("文件夹名不合法");
  const dest = path.join(SKILL_ROOTS[0], name);
  if (fs.existsSync(dest)) throw new Error(`已存在同名技能：${dest}`);
  fs.cpSync(src, dest, { recursive: true });
  return { name, dir: dest };
}

// ---------------- 扩展（插件） ----------------

function listExtensions() {
  const extensions = [];
  const disabled = [];
  const scan = (root, out, kindLabel) => {
    try {
      if (!fs.existsSync(root)) return;
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, d.name);
        if (d.isFile() && d.name.endsWith(".ts")) {
          out.push({ name: d.name, path: p, kind: "file", loadable: true, source: kindLabel });
        } else if (d.isFile() && d.name.endsWith(".js")) {
          out.push({ name: d.name, path: p, kind: "file", loadable: true, source: kindLabel });
        } else if (d.isDirectory()) {
          const hasIndex = fs.existsSync(path.join(p, "index.ts"));
          out.push({ name: d.name, path: p, kind: "dir", loadable: hasIndex, source: kindLabel });
        }
      }
    } catch { /* ignore */ }
  };
  scan(EXT_ROOT, extensions, "全局");
  scan(EXT_DISABLED, disabled, "已禁用");
  return { extensions, disabled };
}

function removeExtension(p) {
  if (!inRoot(p, EXT_ROOT) && !inRoot(p, EXT_DISABLED)) throw new Error("拒绝删除：路径不在扩展目录内");
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

function setExtensionEnabled(p, enabled) {
  if (enabled) {
    if (!inRoot(p, EXT_DISABLED)) return false;
    const dest = path.join(EXT_ROOT, path.basename(p));
    if (fs.existsSync(dest)) throw new Error("已存在同名扩展");
    fs.mkdirSync(EXT_ROOT, { recursive: true });
    fs.renameSync(p, dest);
    return true;
  }
  if (!inRoot(p, EXT_ROOT)) throw new Error("拒绝操作：路径不在扩展目录内");
  fs.mkdirSync(EXT_DISABLED, { recursive: true });
  const dest = path.join(EXT_DISABLED, path.basename(p));
  if (fs.existsSync(dest)) throw new Error("已存在同名禁用扩展");
  fs.renameSync(p, dest);
  return true;
}

async function installExtensionFromFolder() {
  const win = require("electron").BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "选择扩展（文件夹含 index.ts，或单个 .ts 文件）",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "TypeScript / 文件夹", extensions: ["ts"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const src = result.filePaths[0];
  const stat = fs.statSync(src);
  fs.mkdirSync(EXT_ROOT, { recursive: true });
  if (stat.isFile()) {
    if (!src.endsWith(".ts")) throw new Error("扩展文件必须是 .ts");
    const dest = path.join(EXT_ROOT, path.basename(src));
    if (fs.existsSync(dest)) throw new Error(`已存在同名扩展：${dest}`);
    fs.copyFileSync(src, dest);
    return { name: path.basename(src), path: dest };
  }
  if (!fs.existsSync(path.join(src, "index.ts"))) throw new Error("文件夹中没有 index.ts，不是有效的扩展");
  const name = path.basename(src);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new Error("文件夹名不合法");
  const dest = path.join(EXT_ROOT, name);
  if (fs.existsSync(dest)) throw new Error(`已存在同名扩展：${dest}`);
  fs.cpSync(src, dest, { recursive: true });
  return { name, path: dest };
}

// ---------------- pi 包（插件包） ----------------

function readPackages() {
  try {
    const j = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    const pkgs = Array.isArray(j.packages) ? j.packages : [];
    return pkgs.map((p) => {
      if (typeof p === "string") return { spec: p };
      if (p && typeof p === "object") return { spec: p.source || JSON.stringify(p), filter: true };
      return { spec: String(p) };
    });
  } catch {
    return [];
  }
}

function packageDirExists(spec) {
  // npm:xxx → ~/.pi/agent/npm/node_modules/<name>（pi 的 npm 布局是共享根）
  const npmMatch = /^npm:([^@\s]+)/.exec(spec);
  if (!npmMatch) return null; // git / 本地无法简单定位，交给 pi 管理
  const name = npmMatch[1];
  const dir = path.join(AGENT_DIR, "npm", "node_modules", name);
  return fs.existsSync(path.join(dir, "package.json"));
}

// 经 pi CLI 安装/移除（异步流式日志，事件推给渲染层）
let pkgJobs = 0;
function runPiPkg(op, spec, onLog, onExit) {
  const isWin = process.platform === "win32";
  const child = spawn(isWin ? "pi.cmd" : "pi", [op, spec], {
    shell: isWin,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  pkgJobs++;
  const id = pkgJobs;
  const push = (line) => onLog(id, line);
  push(`$ pi ${op} ${spec}`);
  child.stdout?.on("data", (c) => push(c.toString()));
  child.stderr?.on("data", (c) => push(c.toString()));
  child.on("error", (e) => { push("启动 pi 失败: " + (e.message || e)); onExit(id, 1); });
  child.on("exit", (code) => {
    push(`--- pi ${op} 退出码 ${code ?? "null"} ---`);
    onExit(id, code ?? 1);
  });
  return id;
}

module.exports = {
  listSkills,
  removeSkill,
  setSkillEnabled,
  installSkillFromFolder,
  listExtensions,
  removeExtension,
  setExtensionEnabled,
  installExtensionFromFolder,
  readPackages,
  packageDirExists,
  runPiPkg,
  SKILL_ROOTS,
  EXT_ROOT,
};
