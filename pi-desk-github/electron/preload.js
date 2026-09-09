"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

let sseSeq = 0;

contextBridge.exposeInMainWorld("pidesk", {
  platform: process.platform,

  // ---- 设置 ----
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  importMedia: (kind) => ipcRenderer.invoke("media:import", kind),
  removeMedia: (kind) => ipcRenderer.invoke("media:remove", kind),

  // ---- 后端 ----
  getBackendStatus: () => ipcRenderer.invoke("backend:get-status"),
  onBackendStatus: (cb) => subscribe("backend:status", cb),
  restartBackend: () => ipcRenderer.invoke("backend:restart"),

  // ---- 安装引导 / 环境检测 / skills ----
  detectPrereqs: () => ipcRenderer.invoke("sys:detect-prereqs"),
  downloadSkill: (args) => ipcRenderer.invoke("skill:download", args),
  listInstalledSkills: () => ipcRenderer.invoke("skill:list-installed"),

  // ---- 技能与插件管理 ----
  manage: {
    listSkills: () => ipcRenderer.invoke("manage:list-skills"),
    removeSkill: (dir) => ipcRenderer.invoke("manage:remove-skill", dir),
    setSkillEnabled: (dir, enabled) => ipcRenderer.invoke("manage:set-skill-enabled", { dir, enabled }),
    installSkillFolder: () => ipcRenderer.invoke("manage:install-skill-folder"),
    listExtensions: () => ipcRenderer.invoke("manage:list-extensions"),
    removeExtension: (p) => ipcRenderer.invoke("manage:remove-extension", p),
    setExtensionEnabled: (p, enabled) => ipcRenderer.invoke("manage:set-extension-enabled", { path: p, enabled }),
    installExtensionFolder: () => ipcRenderer.invoke("manage:install-extension-folder"),
    listPackages: () => ipcRenderer.invoke("manage:list-packages"),
    runPiPkg: (op, spec) => ipcRenderer.invoke("manage:run-pi-pkg", { op, spec }),
    onPkgLog: (cb) => subscribe("manage:pkg-log", cb),
    onPkgExit: (cb) => subscribe("manage:pkg-exit", cb),
  },

  // ---- HTTP 代理（主进程转发，无 CORS） ----
  request: (p, opts) => ipcRenderer.invoke("http:request", { p, ...opts }),

  // ---- SSE ----
  sseOpen: (p) => {
    const streamId = ++sseSeq;
    ipcRenderer.send("sse:open", { streamId, p });
    return streamId;
  },
  sseClose: (streamId) => ipcRenderer.send("sse:close", { streamId }),
  onSseEvent: (cb) => subscribe("sse:event", cb),
  onSseEnd: (cb) => subscribe("sse:end", cb),

  // ---- 对话框 / 文件 ----
  pickFolder: (defaultPath) => ipcRenderer.invoke("dialog:pick-folder", defaultPath),
  saveExport: (name, content) => ipcRenderer.invoke("export:save", { name, content }),
  downloadFile: (apiPath, defaultName) => ipcRenderer.invoke("file:download", { apiPath, defaultName }),
  showItemInFolder: (absPath) => ipcRenderer.invoke("shell:show-item", absPath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  // ---- 窗口 ----
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximized: (cb) => subscribe("window:maximized", cb),
  },
});
