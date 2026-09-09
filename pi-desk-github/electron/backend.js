"use strict";

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { app } = require("electron");
const { net } = require("electron");

const HEALTH_PATH = "/api/agent/running";

/**
 * 管理本地 pi-web 后端：
 *  - auto：优先复用已运行的 pi-web（127.0.0.1:port），否则按 local/npx 启动
 *  - local：node bin/pi-web.js（需要先在该目录 npm run build）
 *  - npx：npx --yes @agegr/pi-web@latest
 *  - external：用户指定的已运行服务
 */
class BackendManager extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settingsStore = settingsStore;
    this.child = null;
    this.state = {
      phase: "stopped", // stopped | starting | ready | error
      mode: "auto",
      url: "",
      port: 30141,
      error: "",
      startDetail: "", // starting 阶段的提示文案（如「正在下载组件…」）
      logTail: [],
      spawnLog: "",
    };
    this.healthTimer = null;
    this.startAttempt = 0;
    this.stopping = false;
    this.kickTimer = null; // 定期健康探测，避免后端空闲退出
    this.manualRetry = false; // 超时自动重试期间忽略子进程退出事件
    this.logFile = path.join(app.getPath("userData"), "logs", "backend.log");
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
  }

  getState() {
    return this.state;
  }

  getBaseUrl() {
    return this.state.url || `http://127.0.0.1:${this.state.port}`;
  }

  #setState(patch) {
    Object.assign(this.state, patch);
    this.emit("status", { ...this.state });
  }

  #log(line) {
    const text = String(line).replace(/\r?\n$/, "");
    try {
      fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${text}\n`);
    } catch { /* ignore */ }
    this.state.logTail.push(text);
    if (this.state.logTail.length > 300) this.state.logTail.shift();
  }

  async #health(port, timeoutMs = 2500) {
    const url = `http://127.0.0.1:${port}${HEALTH_PATH}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await net.fetch(url, {
        signal: ac.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.runningSessionIds) ? { url: `http://127.0.0.1:${port}`, data } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    if (this.state.phase === "starting" || this.state.phase === "ready") return;
    this.stopping = false;
    const cfg = this.settingsStore.get().backend;
    const port = cfg.port || 30141;
    this.#setState({ phase: "starting", mode: cfg.mode, port, error: "", url: `http://127.0.0.1:${port}` });

    try {
      // external：直接探测指定地址
      if (cfg.mode === "external" && cfg.externalUrl) {
        const base = cfg.externalUrl.replace(/\/+$/, "");
        const u = new URL(base);
        const healthy = await this.#health(Number(u.port) || (u.protocol === "https:" ? 443 : 80), 4000);
        if (healthy) {
          this.#setState({ phase: "ready", url: base, mode: "external" });
          this.#startKicker();
          return;
        }
        throw new Error(`无法连接指定的 pi-web 服务：${base}`);
      }

      // 1) 探测已运行的同端口服务
      if (cfg.mode === "auto") {
        const existing = await this.#health(port);
        if (existing) {
          this.#log("复用已运行的 pi-web 服务 " + existing.url);
          this.#setState({ phase: "ready", url: existing.url, mode: "external" });
          this.#startKicker();
          return;
        }
      }

      // 2) 启动子进程（npx 首次启动超时放宽到 5 分钟覆盖冷下载；超时后自动重试一次）
      const mode = cfg.mode === "external" ? "npx" : cfg.mode;
      const timeouts = this.#spawnTimeouts(mode);
      let lastErr = null;
      for (let attempt = 0; attempt < timeouts.length; attempt++) {
        try {
          this.manualRetry = false;
          await this.#spawn(mode, port);
          this.#setState({
            mode,
            phase: "starting",
            startDetail:
              mode === "npx" && attempt === 0
                ? "正在下载并启动 pi-web 组件（首次启动可能需要几分钟）"
                : "正在启动 pi-web 服务…",
          });
          const url = await this.#waitReady(port, timeouts[attempt], attempt > 0);
          this.startAttempt = 0;
          this.#setState({ phase: "ready", url, startDetail: "" });
          this.#startKicker();
          this.emit("ready", url);
          return;
        } catch (e) {
          if (e?.code === "SPAWN_TIMEOUT" && attempt < timeouts.length - 1) {
            // 首次超时：杀掉重试一次——npx 缓存已暖，第二次几乎必成
            this.#log(`启动超时（${Math.round(timeouts[attempt] / 1000)}s），自动重试…`);
            this.manualRetry = true;
            this.#killChild();
            this.#setState({ phase: "starting", startDetail: "首次启动超时，正在自动重试…" });
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          // 最终失败：杀掉超时/僵死的子进程，避免占用端口、干扰用户手动重试
          this.manualRetry = true;
          this.#killChild();
          lastErr = e;
          break;
        }
      }
      throw lastErr || new Error("后端启动失败");
    } catch (e) {
      this.#log("启动失败: " + (e.message || String(e)));
      this.#setState({ phase: "error", error: e.message || String(e), startDetail: "" });
    }
  }

  // 每次启动尝试的等待上限：npx 首次 5 分钟（冷下载）、重试 2 分钟；local 单次 2 分钟。
  // e2e 可用环境变量覆盖：PI_DESK_SPAWN_TIMEOUTS="5000,4000"
  #spawnTimeouts(mode) {
    const env = process.env.PI_DESK_SPAWN_TIMEOUTS;
    if (env) {
      const parts = env.split(",").map((s) => parseInt(s, 10)).filter((n) => n > 0);
      if (parts.length) return parts.slice(0, 2).map((n) => Math.max(500, n));
    }
    return mode === "npx" ? [300_000, 120_000] : [120_000];
  }

  // 轮询健康检查直到就绪；超时抛 code=SPAWN_TIMEOUT
  async #waitReady(port, timeoutMs, retried) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping) return;
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        throw new Error(`后端进程提前退出（exit ${this.child.exitCode}）`);
      }
      const ok = await this.#health(port, 1500);
      if (ok) return ok.url;
      await new Promise((r) => setTimeout(r, 800));
    }
    const err = new Error(
      retried
        ? "等待 pi-web 启动超时（已自动重试一次）。请检查日志。"
        : `等待 pi-web 启动超时（${Math.round(timeoutMs / 1000)} 秒）。请检查日志。`,
    );
    err.code = "SPAWN_TIMEOUT";
    throw err;
  }

  // 同步树杀当前子进程（见 AGENTS.md 第 2 节，顺序不可颠倒）
  #killChild() {
    if (!this.child) return;
    const pid = this.child.pid;
    if (process.platform === "win32" && pid) {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
      } catch { /* ignore */ }
    }
    try {
      this.child.kill();
    } catch { /* ignore */ }
    this.child = null;
  }

  #spawn(mode, port) {
    const isWin = process.platform === "win32";
    let cmd, args, options;

    // 找可用 node：系统 PATH → pi 自带（%LOCALAPPDATA%\pi-node\current\node.exe）
    // 没装 Node 也没装 pi 的机器走不到这里——上层会给出安装引导。
    let fallbackNode = "";
    try {
      const { findNode } = require("./prereqs");
      const n = findNode();
      if (n.ok && n.path) fallbackNode = n.path;
    } catch { /* ignore */ }
    const pathEnv = fallbackNode
      ? path.dirname(fallbackNode) + path.delimiter + (process.env.PATH || "")
      : process.env.PATH;

    if (mode === "local") {
      const localPath = this.settingsStore.get().backend.localPath;
      if (!localPath) throw new Error("local 模式需要先在设置中指定 pi-web 源码目录");
      const binPath = path.join(localPath, "bin", "pi-web.js");
      if (!fs.existsSync(binPath)) throw new Error(`未找到 ${binPath}`);
      // 优先用系统/pi 自带的 Node；都没有时 Electron 以 Node 模式运行（无需系统 Node）
      cmd = fallbackNode || process.execPath;
      args = [binPath, "--port", String(port), "--no-open"];
      options = { cwd: localPath, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: fallbackNode ? undefined : "1" } };
      this.#log(`local 模式启动: ${cmd} ${args.join(" ")}`);
    } else {
      // npx（auto 模式的默认启动方式也走这里）
      // 系统没有 npx 时用 pi 自带的 node + npm（pi-node 布局）
      const piNpmCli = (() => {
        try {
          const p = path.join(process.env.LOCALAPPDATA || "", "pi-node", "current", "node_modules", "npm", "bin", "npx-cli.js");
          return fs.existsSync(p) ? p : "";
        } catch { return ""; }
      })();
      if (piNpmCli && fallbackNode) {
        cmd = fallbackNode;
        args = [piNpmCli, "--yes", "@agegr/pi-web@latest", "--port", String(port), "--no-open"];
        options = { shell: isWin };
        this.#log(`npx(pi 自带 node) 启动: ${cmd} ${args.join(" ")}`);
      } else {
        cmd = isWin ? "npx.cmd" : "npx";
        args = ["--yes", "@agegr/pi-web@latest", "--port", String(port), "--no-open"];
        // Windows 上 .cmd 必须用 shell 启动，否则 spawn EINVAL
        options = { shell: isWin };
        this.#log(`npx 模式启动: ${cmd} ${args.join(" ")}`);
      }
    }

    const env = {
      ...(options.env || process.env),
      PATH: pathEnv,
      PI_WEB_NO_OPEN: "1",
      PI_WEB_IDLE_TIMEOUT_MS: "0", // 桌面端常驻，禁用空闲退出
      PI_WEB_SKIP_VERSION_CHECK: "1",
    };

    this.child = spawn(cmd, args, {
      ...options,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const onData = (chunk) => {
      const text = chunk.toString();
      this.#log(text);
      this.emit("backend-log", text);
    };
    const child = this.child;
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code, signal) => {
      this.#log(`后端进程退出 code=${code} signal=${signal}`);
      // 只有「自己退出的当前子进程」才走重启逻辑；被手动杀掉（重试/停止）或已换新进程时忽略
      if (this.child === child) this.child = null;
      if (this.stopping || this.manualRetry || this.child !== null) return;
      // 意外退出：自动重启（最多 3 次）
      if (this.startAttempt < 3 && (this.state.phase === "ready" || this.state.phase === "starting")) {
        this.startAttempt += 1;
        this.#log(`${this.startAttempt * 3} 秒后自动重启…`);
        setTimeout(() => { if (!this.stopping) this.start().catch(() => {}); }, 3000);
      } else {
        this.#setState({ phase: "error", error: `后端进程意外退出（exit ${code ?? signal}）` });
      }
    });
  }

  #startKicker() {
    this.#stopKicker();
    // 每 45 秒探测一次：external 服务空闲 10 分钟会自停，探测可保持链路；
    // 若探测失败且是我们自己启动的子进程，自动重启。
    this.kickTimer = setInterval(async () => {
      if (this.stopping) return;
      const ok = await this.#health(this.state.port, 3000);
      if (!ok && this.state.phase !== "error") {
        this.#log("健康探测失败，重启后端…");
        this.child?.kill();
        this.child = null;
        this.start().catch(() => {});
      }
    }, 45_000);
  }

  #stopKicker() {
    if (this.kickTimer) {
      clearInterval(this.kickTimer);
      this.kickTimer = null;
    }
  }

  async stop() {
    this.stopping = true;
    this.#stopKicker();
    this.#killChild();
    this.#setState({ phase: "stopped" });
  }
}

module.exports = { BackendManager };
