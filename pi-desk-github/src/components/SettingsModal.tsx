import { useCallback, useEffect, useRef, useState } from "react";
import type { BackendStatus, DeepPartial, ExtensionItem, PackageItem, PiDeskSettings, SkillItem } from "../global";
import { SKILLS_CATALOG } from "../lib/skills-catalog";
import { useToast } from "./Toast";
import I from "./Icon";

interface Props {
  settings: PiDeskSettings;
  setSettings: (patch: DeepPartial<PiDeskSettings>) => void;
  backend: BackendStatus;
  onClose: () => void;
  onRestartBackend: () => void;
  onOpenWeb: () => void;
}

type Tab = "appearance" | "startup" | "backend" | "chat" | "manage" | "help";

const ANIM_LABELS: Record<string, string> = {
  fade: "淡入",
  zoom: "缩放浮现",
  "slide-up": "上滑浮现",
  aurora: "极光流转",
  particles: "粒子升腾",
  none: "无动画",
};

const FIT_LABELS: Record<string, string> = {
  cover: "裁剪铺满",
  contain: "完整显示",
  tile: "平铺",
  stretch: "拉伸",
};

export default function SettingsModal(props: Props) {
  const { settings, setSettings, backend } = props;
  const [tab, setTab] = useState<Tab>("appearance");
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ---- 技能与插件管理状态 ----
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsDisabled, setSkillsDisabled] = useState<SkillItem[]>([]);
  const [exts, setExts] = useState<ExtensionItem[]>([]);
  const [extsDisabled, setExtsDisabled] = useState<ExtensionItem[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [piAvailable, setPiAvailable] = useState<boolean | null>(null);
  const [skillBusy, setSkillBusy] = useState<Record<string, string>>({});
  const [pkgSpec, setPkgSpec] = useState("");
  const [pkgLog, setPkgLog] = useState<string[]>([]);
  const [pkgRunning, setPkgRunning] = useState(false);

  const refreshManage = useCallback(async () => {
    try {
      const [sk, ex, pk, pre] = await Promise.all([
        window.pidesk.manage.listSkills(),
        window.pidesk.manage.listExtensions(),
        window.pidesk.manage.listPackages(),
        window.pidesk.detectPrereqs().catch(() => null),
      ]);
      setSkills(sk.skills);
      setSkillsDisabled(sk.disabled);
      setExts(ex.extensions);
      setExtsDisabled(ex.disabled);
      setPackages(pk.packages);
      if (pre) setPiAvailable(pre.pi.ok);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (tab === "manage") void refreshManage();
  }, [tab, refreshManage]);

  // pi 包安装日志订阅
  useEffect(() => {
    const un1 = window.pidesk.manage.onPkgLog((e) => {
      setPkgLog((prev) => [...prev.slice(-80), e.line.trimEnd()]);
    });
    const un2 = window.pidesk.manage.onPkgExit(() => {
      setPkgRunning(false);
      void refreshManage();
    });
    return () => { un1(); un2(); };
  }, [refreshManage]);

  const installPkg = async () => {
    const spec = pkgSpec.trim();
    if (!spec) return;
    if (!/^(npm:|git:|https?:\/\/|ssh:\/\/|git@|\.{0,2}[\/]|[A-Za-z]:[\/])/.test(spec)) {
      toast("格式：npm:包名 / git:仓库 / https 链接 / 本地路径", "error");
      return;
    }
    setPkgLog([]);
    setPkgRunning(true);
    const r = await window.pidesk.manage.runPiPkg("install", spec);
    if (!r.ok) {
      setPkgRunning(false);
      toast(r.error || "启动 pi 失败", "error");
    }
  };

  const removePkg = async (spec: string) => {
    if (!window.confirm(`确定移除 pi 包「${spec}」吗？`)) return;
    setPkgLog([]);
    setPkgRunning(true);
    const r = await window.pidesk.manage.runPiPkg("remove", spec);
    if (!r.ok) {
      setPkgRunning(false);
      toast(r.error || "启动 pi 失败", "error");
    }
  };

  const bg = settings.appearance.background;
  const mediaSrc = bg.kind === "media" && bg.media ? `pidesk-media://local/${bg.media}` : null;
  const audioSrc = settings.startup.audio.file ? `pidesk-media://local/${settings.startup.audio.file}` : null;

  const importBackground = useCallback(async () => {
    try {
      const res = await window.pidesk.importMedia("background");
      if (res) toast("背景已更新", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  const importAudio = useCallback(async () => {
    try {
      const res = await window.pidesk.importMedia("audio");
      if (res) toast("启动音频已设置", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);

  const set = useCallback((patch: DeepPartial<PiDeskSettings>) => {
    setSettings(patch);
  }, [setSettings]);

  const previewAudio = useCallback(() => {
    if (!audioSrc) return;
    const a = audioRef.current ?? new Audio(audioSrc);
    audioRef.current = a;
    a.volume = settings.startup.audio.volume;
    void a.play().catch(() => {});
  }, [audioSrc, settings.startup.audio.volume]);

  const nav = (t: Tab, label: string, icon: () => React.ReactNode) => (
    <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
      {icon()}
      {label}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="settings-modal">
        <div className="sm-head">
          <span className="sm-title">设置</span>
          <button className="icon-btn" onClick={props.onClose}>{I.close(15)}</button>
        </div>
        <div className="sm-body">
          <div className="sm-nav">
            {nav("appearance", "外观与背景", () => I.image(15))}
            {nav("startup", "启动动画与音频", () => I.play(15))}
            {nav("backend", "后端服务", () => I.gear(15))}
            {nav("chat", "聊天", () => I.chat(15))}
            {nav("manage", "技能与插件", () => I.panel(15))}
            {nav("help", "帮助与支持", () => I.external(15))}
          </div>
          <div className="sm-content">
            {/* ============ 外观 ============ */}
            {tab === "appearance" && (
              <>
                <div className="sm-section">
                  <h3>界面背景</h3>
                  <div className="bg-preview">
                    {mediaSrc ? (
                      bg.mediaKind === "video"
                        ? <video key={mediaSrc} src={mediaSrc} style={{ objectFit: bg.fit === "stretch" ? "fill" : bg.fit === "contain" ? "contain" : "cover", opacity: bg.opacity, filter: bg.blur ? `blur(${bg.blur}px)` : undefined }} autoPlay muted loop playsInline />
                        : bg.fit === "tile"
                          ? <div style={{ backgroundImage: `url(${mediaSrc})`, backgroundRepeat: "repeat", width: "100%", height: "100%", opacity: bg.opacity }} />
                          : <img src={mediaSrc} style={{ objectFit: bg.fit === "stretch" ? "fill" : bg.fit === "contain" ? "contain" : "cover", opacity: bg.opacity, filter: bg.blur ? `blur(${bg.blur}px)` : undefined }} alt="" />
                    ) : (
                      <div className={`bg-builtin g${settings.appearance.builtinVariant % 3}`} />
                    )}
                    {mediaSrc && <div className="pv-dim" style={{ opacity: bg.dim }} />}
                    <div className="pv-ui">
                      <div className="pv-line accent" />
                      <div className="pv-line" />
                      <div className="pv-line" style={{ width: "70%" }} />
                    </div>
                  </div>
                  <div className="sm-row">
                    <button className="sm-btn primary" onClick={() => void importBackground()}>
                      {I.upload(13)} 上传图片 / 视频 / GIF
                    </button>
                    {bg.kind === "media" && (
                      <>
                        <button
                          className="sm-btn danger"
                          onClick={() => { void window.pidesk.removeMedia("background"); toast("已恢复内置背景"); }}
                        >
                          移除自定义背景
                        </button>
                        <span className="hint" style={{ margin: 0 }}>
                          {bg.media?.split("/").pop()}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="sm-row">
                    <label>显示方式</label>
                    <select
                      className="sm-select"
                      value={bg.fit}
                      onChange={(e) => set({ appearance: { background: { fit: e.target.value as never } } })}
                    >
                      {Object.entries(FIT_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm-row">
                    <label>背景亮度 {Math.round(bg.opacity * 100)}%</label>
                    <div className="grow">
                      <input type="range" min={0.05} max={1} step={0.01} value={bg.opacity}
                        onChange={(e) => set({ appearance: { background: { opacity: Number(e.target.value) } } })} />
                    </div>
                  </div>
                  <div className="sm-row">
                    <label>压暗遮罩 {Math.round(bg.dim * 100)}%</label>
                    <div className="grow">
                      <input type="range" min={0} max={0.85} step={0.01} value={bg.dim}
                        onChange={(e) => set({ appearance: { background: { dim: Number(e.target.value) } } })} />
                    </div>
                  </div>
                  <div className="sm-row">
                    <label>背景模糊 {bg.blur}px</label>
                    <div className="grow">
                      <input type="range" min={0} max={40} step={1} value={bg.blur}
                        onChange={(e) => set({ appearance: { background: { blur: Number(e.target.value) } } })} />
                    </div>
                  </div>
                  <div className="hint">视频 / GIF 背景会自动循环播放（静音）。遮罩越深，界面文字越清晰。</div>
                </div>
                <div className="sm-section">
                  <h3>主题</h3>
                  <div className="sm-row">
                    <label>强调色</label>
                    <input type="color" value={settings.appearance.accent}
                      onChange={(e) => set({ appearance: { accent: e.target.value } })} />
                    <select
                      className="sm-select"
                      value={settings.appearance.builtinVariant}
                      onChange={(e) => set({ appearance: { builtinVariant: Number(e.target.value) } })}
                    >
                      <option value={0}>内置背景 · 蓝紫</option>
                      <option value={1}>内置背景 · 青橙</option>
                      <option value={2}>内置背景 · 粉蓝</option>
                    </select>
                  </div>
                  <div className="sm-row">
                    <label>面板透明度 {Math.round(settings.appearance.panelOpacity * 100)}%</label>
                    <div className="grow">
                      <input type="range" min={0.35} max={1} step={0.01} value={settings.appearance.panelOpacity}
                        onChange={(e) => set({ appearance: { panelOpacity: Number(e.target.value) } })} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ============ 启动动画与音频 ============ */}
            {tab === "startup" && (
              <>
                <div className="sm-section">
                  <h3>启动动画</h3>
                  <div className="anim-preview">
                    <div className={`ap-box anim-${settings.startup.animation}`} key={settings.startup.animation}
                      style={{ animation: settings.startup.animation === "none" ? "none" : undefined }}>
                      π
                    </div>
                  </div>
                  <div className="sm-row">
                    <label>动画效果</label>
                    <select
                      className="sm-select"
                      value={settings.startup.animation}
                      onChange={(e) => set({ startup: { animation: e.target.value as never } })}
                    >
                      {Object.entries(ANIM_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm-row">
                    <label>展示时长 {settings.startup.minDuration / 1000}s</label>
                    <div className="grow">
                      <input type="range" min={500} max={6000} step={100} value={settings.startup.minDuration}
                        onChange={(e) => set({ startup: { minDuration: Number(e.target.value) } })} />
                    </div>
                  </div>
                  <div className="hint">
                    每次启动应用时展示。后端就绪且最短时长结束后自动淡出；后端出错时保留并显示错误。
                  </div>
                </div>
                <div className="sm-section">
                  <h3>启动音频</h3>
                  <div className="sm-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.startup.audio.enabled}
                        onChange={(e) => set({ startup: { audio: { enabled: e.target.checked } } })}
                      />{" "}
                      启用启动音
                    </label>
                    <span className="hint" style={{ margin: 0 }}>
                      {audioSrc ? audioSrc.split("/").pop() : "未设置音频"}
                    </span>
                  </div>
                  <div className="sm-row">
                    <button className="sm-btn primary" onClick={() => void importAudio()}>
                      {I.music(13)} 选择音频文件
                    </button>
                    {audioSrc && (
                      <>
                        <button className="sm-btn" onClick={previewAudio}>{I.play(12)} 试听</button>
                        <button className="sm-btn danger" onClick={() => void window.pidesk.removeMedia("audio")}>
                          移除
                        </button>
                      </>
                    )}
                  </div>
                  <div className="sm-row">
                    <label>音量 {Math.round(settings.startup.audio.volume * 100)}%</label>
                    <div className="grow">
                      <input type="range" min={0} max={1} step={0.01} value={settings.startup.audio.volume}
                        onChange={(e) => set({ startup: { audio: { volume: Number(e.target.value) } } })} />
                    </div>
                  </div>
                  <div className="hint">支持 mp3 / wav / ogg / m4a / flac，文件会复制到应用数据目录。</div>
                </div>
              </>
            )}

            {/* ============ 后端 ============ */}
            {tab === "backend" && (
              <>
                <div className="sm-section">
                  <h3>pi 后端服务</h3>
                  <div className="sm-row">
                    <label>当前状态</label>
                    <span style={{ fontSize: 12.5, color: backend.phase === "ready" ? "var(--ok)" : backend.phase === "error" ? "var(--danger)" : "var(--warn)" }}>
                      {backend.phase === "ready" ? "已连接" : backend.phase === "error" ? "出错" : backend.phase === "starting" ? "启动中" : "已停止"}
                      {backend.url && backend.phase !== "stopped" ? ` · ${backend.url}` : ""}
                    </span>
                  </div>
                  {backend.phase === "starting" && backend.startDetail && (
                    <p className="sm-note">{backend.startDetail}</p>
                  )}
                  <div className="sm-row">
                    <label>启动方式</label>
                    <select
                      className="sm-select"
                      value={settings.backend.mode}
                      onChange={(e) => set({ backend: { mode: e.target.value as never } })}
                    >
                      <option value="auto">自动（复用已运行服务，否则 npx 启动）</option>
                      <option value="npx">npx 官方包（@agegr/pi-web）</option>
                      <option value="local">本地源码（需先 npm run build）</option>
                      <option value="external">外部地址（已运行的服务）</option>
                    </select>
                  </div>
                  <div className="sm-row">
                    <label>端口</label>
                    <input
                      className="sm-input"
                      style={{ width: 100 }}
                      type="number"
                      value={settings.backend.port}
                      onChange={(e) => set({ backend: { port: Number(e.target.value) || 30141 } })}
                    />
                  </div>
                  {settings.backend.mode === "local" && (
                    <div className="sm-row">
                      <label>源码目录</label>
                      <div className="grow" style={{ display: "flex", gap: 8 }}>
                        <input
                          className="sm-input"
                          value={settings.backend.localPath}
                          placeholder="例如 D:/path/to/pi-web"
                          onChange={(e) => set({ backend: { localPath: e.target.value } })}
                        />
                        <button
                          className="sm-btn"
                          onClick={async () => {
                            const p = await window.pidesk.pickFolder();
                            if (p) set({ backend: { localPath: p } });
                          }}
                        >
                          浏览
                        </button>
                      </div>
                    </div>
                  )}
                  {settings.backend.mode === "external" && (
                    <div className="sm-row">
                      <label>服务地址</label>
                      <div className="grow">
                        <input
                          className="sm-input"
                          value={settings.backend.externalUrl}
                          placeholder="http://127.0.0.1:30141"
                          onChange={(e) => set({ backend: { externalUrl: e.target.value } })}
                        />
                      </div>
                    </div>
                  )}
                  <div className="sm-row">
                    <button className="sm-btn primary" onClick={props.onRestartBackend}>
                      {I.refresh(13)} 重启后端
                    </button>
                    <button className="sm-btn" onClick={props.onOpenWeb}>
                      {I.external(13)} 打开 pi-web 网页版
                    </button>
                    <span className="hint" style={{ margin: 0 }}>
                      模型登录、API Key、插件等高级配置请用网页版
                    </span>
                  </div>
                  {backend.error && (
                    <div className="sm-row" style={{ color: "var(--danger)", fontSize: 12.5 }}>
                      {I.warn(14)} {backend.error}
                    </div>
                  )}
                </div>
                <div className="sm-section">
                  <h3>后端日志</h3>
                  <div className="log-view">
                    {backend.logTail.length === 0 ? "（暂无日志）" : backend.logTail.join("\n")}
                  </div>
                </div>
              </>
            )}

            {/* ============ 聊天 ============ */}
            {tab === "chat" && (
              <>
                <div className="sm-section">
                  <h3>交互</h3>
                  <div className="sm-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.chat.sendOnEnter}
                        onChange={(e) => set({ chat: { sendOnEnter: e.target.checked } })}
                      />{" "}
                      Enter 发送（Shift+Enter 换行）
                    </label>
                  </div>
                  <div className="sm-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.chat.completionSound}
                        onChange={(e) => set({ chat: { completionSound: e.target.checked } })}
                      />{" "}
                      完成提示音
                    </label>
                  </div>
                  <div className="sm-row">
                    <label>字体大小 {settings.chat.fontSize}px</label>
                    <div className="grow">
                      <input type="range" min={12} max={20} step={1} value={settings.chat.fontSize}
                        onChange={(e) => set({ chat: { fontSize: Number(e.target.value) } })} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ============ 技能与插件 ============ */}
            {tab === "manage" && (
              <>
                <div className="sm-section">
                  <h3>插件（扩展）</h3>
                  <p className="sm-note">
                    位于 <code>~/.pi/agent/extensions</code>，pi 启动时自动加载。
                    改完后在 pi 里 <code>/reload</code> 或重启 pi 生效。
                  </p>
                  {exts.length === 0 && extsDisabled.length === 0 && (
                    <p className="sm-note dim">暂无插件。插件是 TypeScript 模块，可注册自定义工具、命令、事件拦截等。</p>
                  )}
                  {exts.map((e) => (
                    <div key={e.path} className="mgr-row">
                      <div className="mgr-info">
                        <b className="mono">{e.name}</b>
                        <span className={`mgr-badge${e.kind === "dir" ? " dir" : ""}`}>{e.kind === "dir" ? "目录" : "文件"}</span>
                        {!e.loadable && <span className="mgr-badge warn">无 index.ts</span>}
                        <em>{e.source}</em>
                      </div>
                      <div className="mgr-actions">
                        <button className="sm-btn small" onClick={() => {
                          void window.pidesk.manage.setExtensionEnabled(e.path, false).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                        }}>禁用</button>
                        <button className="sm-btn small danger" onClick={() => {
                          if (window.confirm(`确定删除插件「${e.name}」吗？`)) {
                            void window.pidesk.manage.removeExtension(e.path).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                          }
                        }}>删除</button>
                      </div>
                    </div>
                  ))}
                  {extsDisabled.map((e) => (
                    <div key={e.path} className="mgr-row dim">
                      <div className="mgr-info">
                        <b className="mono">{e.name}</b>
                        <span className="mgr-badge off">已禁用</span>
                      </div>
                      <div className="mgr-actions">
                        <button className="sm-btn small" onClick={() => {
                          void window.pidesk.manage.setExtensionEnabled(e.path, true).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                        }}>启用</button>
                        <button className="sm-btn small danger" onClick={() => {
                          if (window.confirm(`确定删除插件「${e.name}」吗？`)) {
                            void window.pidesk.manage.removeExtension(e.path).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                          }
                        }}>删除</button>
                      </div>
                    </div>
                  ))}
                  <div className="sm-row">
                    <button className="sm-btn" onClick={() => {
                      void window.pidesk.manage.installExtensionFolder()
                        .then(() => { void refreshManage(); toast("插件已安装", "ok"); })
                        .catch((err) => toast(err.message, "error"));
                    }}>
                      {I.upload(13)} 安装插件（本地文件夹 / .ts 文件）
                    </button>
                  </div>
                </div>

                <div className="sm-section">
                  <h3>技能（Skills）</h3>
                  <p className="sm-note">
                    位于 <code>~/.pi/agent/skills</code> 与 <code>~/.agents/skills</code>，
                    pi 在对话中按需自动调用。
                  </p>
                  {skills.length === 0 && skillsDisabled.length === 0 && (
                    <p className="sm-note dim">暂无技能。技能是带 SKILL.md 的能力包（工作流、脚本、参考资料）。</p>
                  )}
                  {skills.map((s) => (
                    <div key={s.dir} className="mgr-row">
                      <div className="mgr-info">
                        <b className="mono">{s.name}</b>
                        <span className="mgr-badge src">{s.source}</span>
                        <em>{s.desc || "（无描述）"}</em>
                      </div>
                      <div className="mgr-actions">
                        <button className="sm-btn small" onClick={() => {
                          void window.pidesk.manage.setSkillEnabled(s.dir, false).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                        }}>禁用</button>
                        <button className="sm-btn small danger" onClick={() => {
                          if (window.confirm(`确定删除技能「${s.name}」吗？`)) {
                            void window.pidesk.manage.removeSkill(s.dir).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                          }
                        }}>删除</button>
                      </div>
                    </div>
                  ))}
                  {skillsDisabled.map((s) => (
                    <div key={s.dir} className="mgr-row dim">
                      <div className="mgr-info">
                        <b className="mono">{s.name}</b>
                        <span className="mgr-badge off">已禁用</span>
                        <em>{s.desc || "（无描述）"}</em>
                      </div>
                      <div className="mgr-actions">
                        <button className="sm-btn small" onClick={() => {
                          void window.pidesk.manage.setSkillEnabled(s.dir, true).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                        }}>启用</button>
                        <button className="sm-btn small danger" onClick={() => {
                          if (window.confirm(`确定删除技能「${s.name}」吗？`)) {
                            void window.pidesk.manage.removeSkill(s.dir).then(() => refreshManage()).catch((err) => toast(err.message, "error"));
                          }
                        }}>删除</button>
                      </div>
                    </div>
                  ))}
                  <div className="sm-row">
                    <button className="sm-btn" onClick={() => {
                      void window.pidesk.manage.installSkillFolder()
                        .then(() => { void refreshManage(); toast("技能已安装", "ok"); })
                        .catch((err) => toast(err.message, "error"));
                    }}>
                      {I.upload(13)} 安装技能（本地文件夹）
                    </button>
                  </div>

                  <h4 style={{ marginTop: 16 }}>推荐技能（官方 Pi Skills 仓库）</h4>
                  <div className="mgr-catalog">
                    {SKILLS_CATALOG.map((c) => {
                      const installed = skills.some((s) => s.name === c.name) || skillsDisabled.some((s) => s.name === c.name);
                      const busy = skillBusy[c.name];
                      return (
                        <div key={c.name} className={`mgr-cat${installed ? " on" : ""}`}>
                          <div className="mgr-cat-head">
                            <b className="mono">{c.name}</b>
                            {c.badge && <span className="mgr-badge">{c.badge}</span>}
                          </div>
                          <p>{c.desc}</p>
                          {installed ? (
                            <span className="ob-skill-ok">{I.check(13)} 已安装</span>
                          ) : (
                            <button
                              className="sm-btn small primary"
                              disabled={busy === "busy"}
                              onClick={() => {
                                setSkillBusy((prev) => ({ ...prev, [c.name]: "busy" }));
                                void window.pidesk.downloadSkill({ name: c.name, repo: c.repo, prefix: c.prefix }).then((r) => {
                                  if (r.ok) { toast(`技能「${c.name}」已安装`, "ok"); void refreshManage(); }
                                  else toast(r.error || "下载失败", "error");
                                  setSkillBusy((prev) => ({ ...prev, [c.name]: r.ok ? "done" : r.error || "失败" }));
                                });
                              }}
                            >
                              {busy === "busy" ? "下载中…" : `${I.download(13)} 下载`}
                            </button>
                          )}
                          {busy && busy !== "busy" && busy !== "done" && <span className="ob-skill-err">{busy}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="sm-section">
                  <h3>pi 包（插件包）</h3>
                  <p className="sm-note">
                    通过 pi 安装的扩展/技能合集（记录在 <code>~/.pi/agent/settings.json</code> 的 packages 中），
                    安装与移除由 pi 命令完成。
                  </p>
                  {piAvailable === false && (
                    <div className="ob-okline warn">未检测到 pi 命令，pi 包的安装/移除不可用（技能与插件不受影响）</div>
                  )}
                  {packages.length === 0 && <p className="sm-note dim">暂无 pi 包。</p>}
                  {packages.map((p) => (
                    <div key={p.spec} className="mgr-row">
                      <div className="mgr-info">
                        <b className="mono">{p.spec}</b>
                        {p.installed === true && <span className="mgr-badge ok">已安装</span>}
                        {p.installed === false && <span className="mgr-badge warn">未安装（设置已配置）</span>}
                        {p.installed === null && <span className="mgr-badge">git / 本地</span>}
                      </div>
                      <div className="mgr-actions">
                        <button className="sm-btn small danger" disabled={pkgRunning || piAvailable !== true} onClick={() => void removePkg(p.spec)}>
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="mgr-install-row">
                    <input
                      className="sm-input"
                      placeholder="npm:包名 / git:github.com/user/repo / 链接 / 本地路径"
                      value={pkgSpec}
                      onChange={(e) => setPkgSpec(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void installPkg(); }}
                    />
                    <button className="sm-btn primary" disabled={pkgRunning || piAvailable !== true} onClick={() => void installPkg()}>
                      {pkgRunning ? "处理中…" : "安装"}
                    </button>
                  </div>
                  {pkgLog.length > 0 && <pre className="mgr-log">{pkgLog.join("\n")}</pre>}
                </div>
              </>
            )}

            {/* ============ 帮助与支持 ============ */}
            {tab === "help" && (
              <>
                <div className="sm-section">
                  <h3>入门视频</h3>
                  <div className="help-video-card">
                    <div className="help-video-badge">B站</div>
                    <div className="help-video-info">
                      <b>Pi Desk 使用教程</b>
                      <em>BV139bD6gEa8 · 哔哩哔哩</em>
                    </div>
                    <button
                      className="sm-btn primary"
                      onClick={() => void window.pidesk.openExternal("https://www.bilibili.com/video/BV139bD6gEa8/")}
                    >
                      观看视频 {I.external(13)}
                    </button>
                  </div>
                </div>
                <div className="sm-section">
                  <h3>常用链接</h3>
                  <div className="sm-row">
                    <button className="sm-btn" onClick={() => void window.pidesk.openExternal("https://pi.dev")}>
                      pi 官方网站 {I.external(13)}
                    </button>
                    <button className="sm-btn" onClick={props.onOpenWeb}>
                      pi-web 配置页（模型 / 登录）{I.external(13)}
                    </button>
                  </div>
                  <div className="sm-row">
                    <button className="sm-btn" onClick={() => void window.pidesk.openExternal("https://github.com/badlogic/pi-skills")}>
                      推荐 skills 仓库 {I.external(13)}
                    </button>
                  </div>
                </div>
                <div className="sm-section">
                  <h3>关于</h3>
                  <p className="sm-note">
                    Pi Desk —— 你的 pi 智能体桌面端。<br />
                    会话、模型与配置均与 pi 共享（~/.pi/agent）。<br />
                    本应用为社区作品，与 pi 官方无关。
                  </p>
                </div>
                <div className="sm-section">
                  <h3>重新体验</h3>
                  <div className="sm-row">
                    <button
                      className="sm-btn"
                      onClick={() => {
                        set({ onboarding: { completed: false } });
                        props.onClose();
                      }}
                    >
                      {I.refresh(13)} 重新体验首次启动引导
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
