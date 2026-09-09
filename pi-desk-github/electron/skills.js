"use strict";

// 推荐 skills 下载：从 GitHub 仓库 tarball 提取单个 skill 到 ~/.pi/agent/skills/
// 不依赖 git——用 Windows 自带 tar.exe（bsdtar）。

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { net } = require("electron");

const SKILLS_DIR = path.join(os.homedir(), ".pi", "agent", "skills");

function findTar() {
  const candidates = [
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
    "tar",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore", windowsHide: true });
      return c;
    } catch { /* try next */ }
  }
  return null;
}

async function downloadSkill({ name, repo, prefix }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    return { ok: false, error: "非法的 skill 名称" };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { ok: false, error: "非法的仓库地址" };
  }
  const tar = findTar();
  if (!tar) return { ok: false, error: "系统缺少 tar.exe，无法解压" };

  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/main`;
  try {
    const res = await net.fetch(url, { headers: { "user-agent": "PiDesk" } });
    if (!res.ok) return { ok: false, error: `下载失败：HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 60 * 1024 * 1024) return { ok: false, error: "仓库压缩包过大" };

    const tmpFile = path.join(os.tmpdir(), `pidesk-skill-${Date.now()}.tar.gz`);
    const tmpDir = path.join(os.tmpdir(), `pidesk-skill-${Date.now()}-x`);
    fs.writeFileSync(tmpFile, buf);
    try {
      // 列出条目，确认 skill 在仓库中的路径（前缀可能为 "" 或 "skills"）
      const listing = execFileSync(tar, ["-tzf", tmpFile], { windowsHide: true, encoding: "utf8" });
      const lines = listing.split(/\r?\n/).filter(Boolean);
      const root = lines[0]?.split("/")[0] ?? "";
      const needle = `${prefix ? prefix + "/" : ""}${name}/`;
      const match = lines.find((l) => l.startsWith(`${root}/${needle}`));
      if (!match) {
        return { ok: false, error: `仓库中未找到 skill「${name}」` };
      }
      const strip = 1 + (prefix ? prefix.split("/").filter(Boolean).length : 0);

      const dest = path.join(SKILLS_DIR, name);
      fs.mkdirSync(tmpDir, { recursive: true });
      execFileSync(tar, ["-xzf", tmpFile, "-C", tmpDir, "--strip-components", String(strip)], {
        windowsHide: true,
        stdio: "ignore",
      });
      // 校验解压结果：<tmpDir>/<name>/SKILL.md
      const extractedSkill = path.join(tmpDir, name, "SKILL.md");
      if (!fs.existsSync(extractedSkill)) {
        return { ok: false, error: `解压结果中未找到 ${name}/SKILL.md` };
      }
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.renameSync(path.join(tmpDir, name), dest);
      return { ok: true, dir: dest };
    } finally {
      try { fs.rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function listInstalledSkills() {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return [];
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, "SKILL.md")))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

module.exports = { downloadSkill, listInstalledSkills, SKILLS_DIR };
