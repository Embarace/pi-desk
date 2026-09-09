"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { SettingsStore } = require("./settings");
const { BackendManager } = require("./backend");
const { detect: detectPrereqs } = require("./prereqs");
const { downloadSkill, listInstalledSkills } = require("./skills");
const manage = require("./manage");

// e2e/调试用：指定独立 userData 目录，与用户真实数据完全隔离
// （多实例共存时共享 settings.json 会互相踩踏，见 AGENTS.md）
if (process.env.PI_DESK_USER_DATA) {
  app.setPath("userData", process.env.PI_DESK_USER_DATA);
}

// 崩溃日志（帮助诊断启动问题）
const CRASH_LOG = () => {
  try {
    return path.join(app.getPath("userData"), "logs", "crash.log");
  } catch {
    return path.join(process.env.TEMP || ".", "pi-desk-crash.log");
  }
};
function logCrash(...args) {
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG()), { recursive: true });
    fs.appendFileSync(CRASH_LOG(), `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`);
  } catch { /* ignore */ }
}
logCrash("main.js loaded, argv=", process.argv.join(" "));
process.on("uncaughtException", (e) => logCrash("uncaughtException:", e?.stack || e));
process.on("unhandledRejection", (r) => logCrash("unhandledRejection:", r?.stack || r));
process.on("exit", (code) => logCrash("process exit code=", code));

// 允许自动播放（启动音频无需用户手势）
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pidesk-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: "pidesk-file",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let win = null;
let settingsStore = null;
let backend = null;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: "#0b0e14",
    title: "Pi Desk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("maximize", () => win?.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win?.webContents.send("window:maximized", false));

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.on("closed", () => { win = null; });

  // 开发模式：F12 开关 DevTools
  if (DEV_SERVER_URL) {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
        else win.webContents.openDevTools({ mode: "detach" });
      }
    });
  }
}

// ---------- 协议：pidesk-media://<host>/<rel> → userData/media/<rel> ----------
function registerMediaProtocol() {
  protocol.handle("pidesk-media", (request) => {
    try {
      const u = new URL(request.url);
      const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      const abs = settingsStore.resolveMedia(rel);
      if (!abs || !fs.existsSync(abs)) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).toString(), { headers: request.headers });
    } catch {
      return new Response("Bad request", { status: 400 });
    }
  });
}

// ---------- 协议：pidesk-file://pi/<api-path> → 后端 /api/... ----------
function registerFileProtocol() {
  protocol.handle("pidesk-file", (request) => {
    try {
      if (!backend || backend.getState().phase !== "ready") {
        return new Response("Backend not ready", { status: 503 });
      }
      const u = new URL(request.url);
      const apiPath = u.pathname.replace(/^\/+/, "");
      const target = `${backend.getBaseUrl()}/api/${apiPath}${u.search}`;
      return net.fetch(target, { headers: request.headers });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  });
}

// ---------- HTTP 代理（渲染进程所有请求走主进程，避免 CORS） ----------
ipcMain.handle("http:request", async (event, opts) => {
  const { p, method = "GET", body, headers = {}, raw = false } = opts || {};
  if (!backend || backend.getState().phase !== "ready") {
    return { ok: false, status: 503, error: "后端未就绪" };
  }
  const url = backend.getBaseUrl() + (p.startsWith("/") ? p : "/" + p);
  try {
    const init = { method, headers: { Accept: "application/json", ...headers } };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await net.fetch(url, init);
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        base64: buf.toString("base64"),
      };
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") || "", text, json };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
});

// ---------- SSE 代理 ----------
const sseStreams = new Map(); // key = wcId:streamId → AbortController
ipcMain.on("sse:open", (event, { streamId, p }) => {
  const wc = event.sender;
  const key = `${wc.id}:${streamId}`;
  sseStreams.get(key)?.abort();
  const ac = new AbortController();
  sseStreams.set(key, ac);

  (async () => {
    try {
      const url = backend.getBaseUrl() + (p.startsWith("/") ? p : "/" + p);
      const res = await net.fetch(url, {
        signal: ac.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        wc.send("sse:end", { streamId, error: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^\s/, ""))
            .join("\n");
          if (data && !wc.isDestroyed()) {
            wc.send("sse:event", { streamId, data });
          }
        }
      }
      if (!wc.isDestroyed()) wc.send("sse:end", { streamId });
    } catch (e) {
      if (!wc.isDestroyed()) wc.send("sse:end", { streamId, error: String(e) });
    } finally {
      sseStreams.delete(key);
    }
  })();
});
ipcMain.on("sse:close", (event, { streamId }) => {
  const key = `${event.sender.id}:${streamId}`;
  sseStreams.get(key)?.abort();
  sseStreams.delete(key);
});

// ---------- 其它 IPC ----------
ipcMain.handle("settings:get", () => settingsStore.get());
ipcMain.handle("settings:set", (e, patch) => settingsStore.set(patch));
ipcMain.handle("media:import", (e, kind) => settingsStore.importMedia(kind));
ipcMain.handle("media:remove", (e, kind) => settingsStore.removeMedia(kind));
ipcMain.handle("backend:get-status", () => backend.getState());
ipcMain.handle("sys:detect-prereqs", () => {
  try {
    return detectPrereqs();
  } catch (e) {
    return { error: String(e) };
  }
});
ipcMain.handle("skill:download", (e, args) => downloadSkill(args));
ipcMain.handle("skill:list-installed", () => listInstalledSkills());

// ---------- 技能与插件管理 ----------
ipcMain.handle("manage:list-skills", () => manage.listSkills());
ipcMain.handle("manage:remove-skill", (e, dir) => manage.removeSkill(dir));
ipcMain.handle("manage:set-skill-enabled", (e, { dir, enabled }) => manage.setSkillEnabled(dir, enabled));
ipcMain.handle("manage:install-skill-folder", () => manage.installSkillFromFolder());
ipcMain.handle("manage:list-extensions", () => manage.listExtensions());
ipcMain.handle("manage:remove-extension", (e, p) => manage.removeExtension(p));
ipcMain.handle("manage:set-extension-enabled", (e, { path: p, enabled }) => manage.setExtensionEnabled(p, enabled));
ipcMain.handle("manage:install-extension-folder", () => manage.installExtensionFromFolder());
ipcMain.handle("manage:list-packages", () => ({
  packages: manage.readPackages().map((p) => ({ ...p, installed: manage.packageDirExists(p.spec) })),
}));
ipcMain.handle("manage:run-pi-pkg", (e, { op, spec }) => {
  try {
    const jobId = manage.runPiPkg(
      op,
      spec,
      (id, line) => win?.webContents.send("manage:pkg-log", { id, line }),
      (id, code) => win?.webContents.send("manage:pkg-exit", { id, code }),
    );
    return { ok: true, jobId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
ipcMain.handle("backend:restart", async () => {
  await backend.stop();
  backend.start();
});
ipcMain.handle("dialog:pick-folder", async (e, defaultPath) => {
  const result = await dialog.showOpenDialog(win, {
    title: "选择工作目录",
    defaultPath: defaultPath || app.getPath("home"),
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("export:save", async (e, { name, content }) => {
  const result = await dialog.showSaveDialog(win, {
    title: "导出会话",
    defaultPath: name,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, content, "utf8");
  return { canceled: false, path: result.filePath };
});
ipcMain.handle("file:download", async (e, { apiPath, defaultName }) => {
  try {
    const res = await net.fetch(backend.getBaseUrl() + apiPath);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const result = await dialog.showSaveDialog(win, {
      title: "保存文件",
      defaultPath: defaultName || "download",
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(result.filePath, buf);
    return { canceled: false, path: result.filePath };
  } catch (e) {
    return { error: String(e) };
  }
});
ipcMain.handle("shell:show-item", (e, absPath) => {
  if (typeof absPath === "string" && absPath) shell.showItemInFolder(absPath);
});
ipcMain.handle("shell:open-external", (e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// ---------- 窗口控制 ----------
ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("window:close", () => win?.close());
ipcMain.handle("window:is-maximized", () => !!win?.isMaximized());

// ---------- 单实例锁 ----------
// 多开实例会争抢 settings.json 与 30141 端口；第二个实例直接唤起已有窗口。
// 锁以 userData 为键——e2e 用独立 userData 时不受用户运行中的应用影响。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logCrash("another instance is running, quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------- 生命周期 ----------
if (gotLock) {
  app.whenReady().then(() => {
    logCrash("whenReady reached");
    settingsStore = new SettingsStore(app.getPath("userData"));
    backend = new BackendManager(settingsStore);
    backend.on("status", (state) => win?.webContents.send("backend:status", state));

    registerMediaProtocol();
    registerFileProtocol();
    createWindow();

    backend.start();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async (e) => {
  if (backend && !backend.stopping) {
    // 允许事件循环完成退出前的清理
    backend.stop();
  }
});
