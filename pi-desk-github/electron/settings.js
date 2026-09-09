"use strict";

const fs = require("fs");
const path = require("path");
const { dialog } = require("electron");
const crypto = require("crypto");

const DEFAULT_SETTINGS = {
  backend: {
    mode: "auto", // auto | npx | local | external
    port: 30141,
    localPath: "", // pi-web 源码目录（local 模式）
    externalUrl: "", // external 模式：已运行的 pi-web 地址
  },
  appearance: {
    accent: "#6d8dff",
    builtinVariant: 0,
    panelOpacity: 0.78,
    background: {
      kind: "builtin", // builtin | media
      media: null, // 相对 media 目录：backgrounds/xxx.mp4
      mediaKind: null, // image | video | gif
      fit: "cover", // cover | contain | tile | stretch
      opacity: 0.32, // 背景媒体不透明度 0..1
      dim: 0.42, // 压暗遮罩 0..0.9
      blur: 0, // px 0..40
    },
  },
  startup: {
    animation: "aurora", // fade | zoom | slide-up | aurora | particles | none
    minDuration: 1800, // 启动动画最短展示时长 ms
    audio: {
      enabled: false,
      file: null, // 相对 media 目录：audio/xxx.mp3
      volume: 0.6,
    },
  },
  chat: {
    completionSound: true,
    sendOnEnter: true,
    fontSize: 15,
  },
  onboarding: {
    completed: false, // 首次启动引导是否已完成
    downloadedSkills: [], // 已通过引导下载的 skill 名
  },
};

const MEDIA_EXT_BY_KIND = {
  background: {
    filters: [
      { name: "图片 / 视频 / GIF", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "m4v", "avif"] },
    ],
    maxBytes: 300 * 1024 * 1024,
  },
  audio: {
    filters: [
      { name: "音频", extensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"] },
    ],
    maxBytes: 50 * 1024 * 1024,
  },
};

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v"]);

class SettingsStore {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.file = path.join(userDataDir, "settings.json");
    this.mediaDir = path.join(userDataDir, "media");
    fs.mkdirSync(path.join(this.mediaDir, "backgrounds"), { recursive: true });
    fs.mkdirSync(path.join(this.mediaDir, "audio"), { recursive: true });
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      return this.#merge(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  #merge(base, patch) {
    const out = structuredClone(base);
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k]) {
        out[k] = this.#merge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = this.#merge(this.data, patch);
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
    return this.data;
  }

  /** 弹出原生文件选择框并复制媒体到 userData/media */
  async importMedia(kind) {
    const spec = MEDIA_EXT_BY_KIND[kind];
    if (!spec) throw new Error("Unknown media kind: " + kind);
    const win = require("electron").BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: kind === "background" ? "选择背景图片 / 视频 / GIF" : "选择启动音频",
      properties: ["openFile"],
      filters: spec.filters,
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const src = result.filePaths[0];
    const stat = fs.statSync(src);
    if (stat.size > spec.maxBytes) {
      throw new Error(`文件过大（>${Math.round(spec.maxBytes / 1024 / 1024)}MB）`);
    }
    const ext = path.extname(src).slice(1).toLowerCase();
    const name = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const destDir = path.join(this.mediaDir, kind === "background" ? "backgrounds" : "audio");
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, name));

    const mediaKind = VIDEO_EXTS.has(ext) ? "video" : ext === "gif" ? "gif" : "image";
    const rel = `${kind === "background" ? "backgrounds" : "audio"}/${name}`;
    if (kind === "background") {
      this.set({
        appearance: {
          background: { kind: "media", media: rel, mediaKind },
        },
      });
    } else {
      this.set({
        startup: { audio: { enabled: true, file: rel, volume: this.data.startup.audio.volume } },
      });
    }
    return { rel, mediaKind, name };
  }

  /** 删除当前背景或音频媒体文件 */
  removeMedia(kind) {
    const rel = kind === "background"
      ? this.data.appearance.background.media
      : this.data.startup.audio.file;
    if (!rel) return;
    const abs = path.join(this.mediaDir, rel);
    try { fs.unlinkSync(abs); } catch { /* ignore */ }
    if (kind === "background") {
      this.set({ appearance: { background: { kind: "builtin", media: null, mediaKind: null } } });
    } else {
      this.set({ startup: { audio: { file: null } } });
    }
  }

  resolveMedia(rel) {
    if (!rel) return null;
    // 防止路径穿越
    const abs = path.normalize(path.join(this.mediaDir, rel));
    if (!abs.startsWith(this.mediaDir)) return null;
    return abs;
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
