import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendStatus, DeepPartial, PiDeskSettings } from "./global";
import { api } from "./lib/api";
import type { ModelsData, SessionInfo } from "./lib/types";
import { ToastProvider, useToast } from "./components/Toast";
import BackgroundLayer from "./components/BackgroundLayer";
import StartupOverlay from "./components/StartupOverlay";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import FilePanel from "./components/FilePanel";
import SettingsModal from "./components/SettingsModal";
import OnboardingOverlay from "./components/OnboardingOverlay";
import I from "./components/Icon";

const DEFAULT_SETTINGS: PiDeskSettings = {
  backend: { mode: "auto", port: 30141, localPath: "", externalUrl: "" },
  appearance: {
    accent: "#6d8dff",
    builtinVariant: 0,
    panelOpacity: 0.78,
    background: { kind: "builtin", media: null, mediaKind: null, fit: "cover", opacity: 0.32, dim: 0.42, blur: 0 },
  },
  startup: {
    animation: "aurora",
    minDuration: 1800,
    audio: { enabled: false, file: null, volume: 0.6 },
  },
  chat: { completionSound: true, sendOnEnter: true, fontSize: 15 },
  onboarding: { completed: false, downloadedSkills: [] },
};

function AppInner() {
  const toast = useToast();
  const [settings, setSettingsState] = useState<PiDeskSettings>(DEFAULT_SETTINGS);
  const [backend, setBackend] = useState<BackendStatus>({
    phase: "starting", mode: "auto", url: "", port: 30141, error: "", logTail: [],
  });
  const [booting, setBooting] = useState(true);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ cwd: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelsCache, setModelsCache] = useState<Map<string, ModelsData>>(new Map());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SessionInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [homeDir, setHomeDir] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ---- 加载设置 ----
  useEffect(() => {
    (async () => {
      try {
        const s = await window.pidesk.getSettings();
        setSettingsState(s);
      } catch { /* 使用默认值 */ }
      setSettingsLoaded(true);
      try {
        const st = await window.pidesk.getBackendStatus();
        setBackend(st);
        // 不直接关闭启动遮罩：由 StartupOverlay 自己控制（就绪 + 最短时长后淡出），
        // 保证每次启动都播放动画与音频。
      } catch { /* ignore */ }
      try {
        const h = await api.home();
        setHomeDir(h.home);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const un = window.pidesk.onBackendStatus((s) => {
      setBackend(s);
      if (s.phase === "error") toast(s.error || "后端出错", "error");
    });
    return un;
  }, [toast]);

  const setSettings = useCallback((patch: DeepPartial<PiDeskSettings>) => {
    setSettingsState((prev) => {
      const merge = (base: any, p: any): any => {
        const out = { ...base };
        for (const [k, v] of Object.entries(p ?? {})) {
          if (v && typeof v === "object" && !Array.isArray(v)) out[k] = merge(base[k], v);
          else out[k] = v;
        }
        return out;
      };
      return merge(prev, patch);
    });
    void window.pidesk.setSettings(patch);
  }, []);

  // ---- CSS 变量 ----
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--accent", settings.appearance.accent);
    r.setProperty("--panel-opacity", String(settings.appearance.panelOpacity));
    r.setProperty("--font-size", settings.chat.fontSize + "px");
  }, [settings.appearance.accent, settings.appearance.panelOpacity, settings.chat.fontSize]);

  // ---- 会话轮询 ----
  const refreshSessions = useCallback(async () => {
    try {
      const res = await api.sessions();
      setSessions(res.sessions);
      setRunningIds(new Set(res.runningSessionIds));
    } catch {
      // 后端未就绪时静默
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshSessions();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshSessions]);

  // ---- 模型 ----
  const currentCwd = useMemo(() => {
    if (selectedId) return sessions.find((s) => s.id === selectedId)?.cwd ?? "";
    return draft?.cwd ?? "";
  }, [selectedId, sessions, draft]);

  useEffect(() => {
    if (!currentCwd) return;
    if (modelsCache.has(currentCwd)) return;
    setModelsLoading(true);
    let cancelled = false;
    api.models(currentCwd)
      .then((m) => {
        if (!cancelled) setModelsCache((prev) => new Map(prev).set(currentCwd, m));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentCwd, modelsCache]);

  const models = currentCwd ? modelsCache.get(currentCwd) ?? null : null;

  // ---- 新建会话 ----
  const newSession = useCallback(async () => {
    const last = localStorage.getItem("pidesk:lastCwd") || homeDir || undefined;
    const cwd = await window.pidesk.pickFolder(last);
    if (!cwd) return;
    localStorage.setItem("pidesk:lastCwd", cwd);
    setDraft({ cwd });
    setSelectedId(null);
    setFilePanelOpen(false);
  }, [homeDir]);

  const selectSession = useCallback((id: string) => {
    setSelectedId(id);
    setDraft(null);
  }, []);

  const handleSessionCreated = useCallback((id: string) => {
    setDraft(null);
    setSelectedId(id);
    void refreshSessions();
  }, [refreshSessions]);

  const handleSessionForked = useCallback((id: string) => {
    void refreshSessions();
    setSelectedId(id);
  }, [refreshSessions]);

  // ---- 删除 / 重命名 ----
  const confirmDelete = useCallback(async (s: SessionInfo) => {
    const ok = window.confirm(`确定删除会话「${s.name || s.firstMessage?.slice(0, 30) || s.id}」吗？此操作不可撤销。`);
    if (!ok) return;
    try {
      await api.deleteSession(s.id);
      toast("已删除会话", "ok");
      if (selectedId === s.id) setSelectedId(null);
      void refreshSessions();
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`, "error");
    }
  }, [selectedId, refreshSessions, toast]);

  const startRename = useCallback((s: SessionInfo) => {
    setRenameTarget(s);
    setRenameValue(s.name || "");
  }, []);

  const commitRename = useCallback(async () => {
    const t = renameTarget;
    if (!t) return;
    setRenameTarget(null);
    const name = renameValue.trim();
    if (!name) return;
    try {
      await api.renameSession(t.id, name);
      toast("已重命名", "ok");
      void refreshSessions();
    } catch (e) {
      toast(`重命名失败：${(e as Error).message}`, "error");
    }
  }, [renameTarget, renameValue, refreshSessions, toast]);

  // ---- 其它 ----
  const openWeb = useCallback(() => {
    if (backend.phase === "ready" && backend.url) {
      void window.pidesk.openExternal(backend.url);
    } else {
      void window.pidesk.openExternal(`http://127.0.0.1:${backend.port || 30141}`);
    }
  }, [backend]);

  const selectedInfo = selectedId ? sessions.find((s) => s.id === selectedId) : undefined;
  const filePanelRoot = selectedInfo?.projectRoot || selectedInfo?.cwd || "";

  return (
    <div className="app-root">
      <BackgroundLayer settings={settings} />
      <TitleBar
        backend={backend}
        sessionTitle={selectedInfo?.name || (selectedInfo ? "会话" : draft ? "新会话" : "Pi Desk")}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenWeb={openWeb}
      />
      <div className="app-body">
        <Sidebar
          sessions={sessions}
          runningIds={runningIds}
          selectedId={selectedId}
          draft={draft}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          onSelect={selectSession}
          onSelectDraft={() => { setSelectedId(null); }}
          onNewSession={() => void newSession()}
          onDelete={(s) => void confirmDelete(s)}
          onRename={startRename}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChatView
          key={selectedId ?? "draft"}
          sessionId={selectedId}
          sessionInfo={selectedInfo}
          draft={draft}
          models={models}
          modelsLoading={modelsLoading}
          settings={settings}
          onSessionsChanged={() => void refreshSessions()}
          onSessionCreated={handleSessionCreated}
          onSessionForked={handleSessionForked}
          onOpenFilePanel={() => setFilePanelOpen((o) => !o)}
          onNewSession={() => void newSession()}
        />
        {filePanelOpen && filePanelRoot && (
          <FilePanel root={filePanelRoot} sessionId={selectedId} onClose={() => setFilePanelOpen(false)} />
        )}
      </div>

      {/* 重命名弹窗 */}
      {renameTarget && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setRenameTarget(null); }}>
          <div className="settings-modal" style={{ width: 420, height: "auto" }}>
            <div className="sm-head">
              <span className="sm-title">重命名会话</span>
              <button className="icon-btn" onClick={() => setRenameTarget(null)}>{I.close(15)}</button>
            </div>
            <div className="sm-content">
              <input
                className="sm-input"
                autoFocus
                value={renameValue}
                placeholder="输入会话名称"
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenameTarget(null);
                }}
              />
              <div className="sm-row" style={{ marginTop: 14 }}>
                <button className="sm-btn primary" onClick={() => void commitRename()}>保存</button>
                <button className="sm-btn" onClick={() => setRenameTarget(null)}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          setSettings={setSettings}
          backend={backend}
          onClose={() => setSettingsOpen(false)}
          onRestartBackend={() => {
            setBooting(true);
            void window.pidesk.restartBackend();
          }}
          onOpenWeb={openWeb}
        />
      )}

      {booting && (
        <StartupOverlay
          settings={settings}
          backend={backend}
          onRetry={() => void window.pidesk.restartBackend()}
          onDone={() => setBooting(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {!booting && settingsLoaded && !settings.onboarding.completed && !settingsOpen && (
        <OnboardingOverlay
          settings={settings}
          setSettings={setSettings}
          backend={backend}
          onImportBackground={async () => {
            try {
              const r = await window.pidesk.importMedia("background");
              if (r) {
                setSettingsState(await window.pidesk.getSettings());
                toast("背景已应用", "ok");
                return true;
              }
            } catch (e) {
              toast(`导入失败：${(e as Error).message}`, "error");
            }
            return false;
          }}
          onDone={() => {
            setSettingsState((prev) => ({ ...prev, onboarding: { ...prev.onboarding, completed: true } }));
            toast("欢迎使用 Pi Desk！", "ok");
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
