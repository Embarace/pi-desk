import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendStatus, DeepPartial, PiDeskSettings, PrereqsResult } from "../global";
import I from "./Icon";

// 教程视频（B 站）
const VIDEO_BVID = "BV139bD6gEa8";
const VIDEO_EMBED = `https://player.bilibili.com/player.html?bvid=${VIDEO_BVID}&page=1&high_quality=1&danmaku=0&autoplay=0`;

// 功能简介（欢迎页卡片）
const FEATURES = [
  { icon: "chat", title: "智能体工作台", desc: "与 pi 共享会话与配置，流式对话、思考过程、工具执行一目了然" },
  { icon: "queue", title: "排队与打断", desc: "运行中也能继续输入，任务自动排队；随时停止当前运行" },
  { icon: "folder", title: "文件面板", desc: "项目文件树与全文搜索，文本、图片、音视频直接预览" },
  { icon: "panel", title: "技能与插件", desc: "内置管理页，技能、插件、pi 包安装卸载全可视化" },
  { icon: "image", title: "个性化外观", desc: "自定义背景壁纸（图片/视频/GIF）与 6 种启动动画、开机音" },
  { icon: "gear", title: "后端自管", desc: "自动拉起并守护 pi-web 服务，断线重连、崩溃自愈" },
] as const;

// 热门提供商快捷标签（点击即搜索，q 同时匹配 id 与显示名）
const POPULAR_PROVIDERS = [
  { q: "deepseek", label: "DeepSeek" },
  { q: "openai", label: "OpenAI" },
  { q: "anthropic", label: "Anthropic" },
  { q: "moonshot", label: "Moonshot" },
  { q: "zhipu", label: "智谱" },
  { q: "qwen", label: "通义" },
  { q: "gemini", label: "Gemini" },
  { q: "siliconflow", label: "硅基流动" },
];

// 提供商导入步骤
interface ProviderItem {
  id: string;
  displayName: string;
  configured: boolean;
  modelCount: number;
}

interface Props {
  settings: PiDeskSettings;
  setSettings: (patch: DeepPartial<PiDeskSettings>) => void;
  backend: BackendStatus;
  onImportBackground: () => Promise<boolean>;
  onDone: () => void;
}

export default function OnboardingOverlay({ settings, setSettings, backend, onDone }: Props) {
  const [step, setStep] = useState<"welcome" | "api">("welcome");
  const [prereqs, setPrereqs] = useState<PrereqsResult | null>(null);
  const [providers, setProviders] = useState<ProviderItem[] | null>(null);
  const [providersError, setProvidersError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProviderItem | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [importError, setImportError] = useState("");

  const finish = useCallback(() => {
    setSettings({ onboarding: { completed: true } });
    onDone();
  }, [setSettings, onDone]);

  // 环境检测（一行状态展示）
  useEffect(() => {
    void window.pidesk.detectPrereqs().then((r) => {
      if (!(r as any).error) setPrereqs(r);
      if ((r as any).error) setPrereqs(null);
    }).catch(() => {});
  }, []);

  // 后端就绪后拉提供商列表
  const loadProviders = useCallback(async () => {
    if (backend.phase !== "ready") return;
    setProvidersError("");
    try {
      const res = await window.pidesk.request("/api/auth/providers");
      if (!res.ok) throw new Error(res.json?.error || "获取提供商列表失败");
      const list = (res.json?.apiKeyProviders ?? []) as ProviderItem[];
      setProviders(list);
      if (list.length > 0 && !list.some((p) => p.configured)) setSelected(list[0]);
    } catch (e) {
      setProvidersError((e as Error).message);
    }
  }, [backend.phase]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = providers ?? [];
    if (!q) return []; // 空搜索不展示列表，只展示热门提示
    return list.filter((p) => p.id.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q));
  }, [providers, search]);

  const doImport = async () => {
    if (!selected || !apiKey.trim() || importing) return;
    setImporting(true);
    setImportError("");
    setImported(null);
    try {
      const res = await window.pidesk.request(`/api/auth/api-key/${encodeURIComponent(selected.id)}`, {
        method: "POST",
        body: { apiKey: apiKey.trim() },
      });
      if (!res.ok) throw new Error(res.json?.error || `导入失败 (HTTP ${res.status})`);
      setImported(selected.id);
      setApiKey("");
      // 刷新列表状态（模型计数）
      await loadProviders();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const configuredCount = providers?.filter((p) => p.configured).length ?? 0;
  const envOk = !!prereqs?.node.ok || !!prereqs?.pi.ok;

  return (
    <div className="ob-overlay">
      <div className="ob-card">
        {step === "welcome" && (
          <div className="ob-body">
            <div className="ob-logo">π</div>
            <h1>欢迎使用 Pi Desk</h1>
            <p className="ob-sub">你的 pi 智能体桌面端——与 pi 共享全部会话、模型与配置。</p>

            <div className="ob-feat-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="ob-feat">
                  <span className="ob-feat-icon">{I[f.icon](16)}</span>
                  <div>
                    <b>{f.title}</b>
                    <em>{f.desc}</em>
                  </div>
                </div>
              ))}
            </div>

            {/* 教程视频 */}
            <h2 style={{ marginTop: 20 }}>一分钟上手</h2>
            <div className="ob-video">
              <iframe
                src={VIDEO_EMBED}
                title="Pi Desk 入门教程"
                allowFullScreen
                scrolling="no"
                frameBorder="0"
              />
            </div>
            <div className="ob-row center" style={{ marginTop: 10 }}>
              <button
                className="sm-btn"
                onClick={() => void window.pidesk.openExternal(`https://www.bilibili.com/video/${VIDEO_BVID}/`)}
              >
                {I.external(13)} 在 B 站观看
              </button>
            </div>

            {/* 环境状态一行 */}
            <div className="ob-envline">
              {!prereqs ? (
                <>{I.spinner(13)} 正在检测运行环境…</>
              ) : envOk ? (
                <>{I.check(13)} 运行环境就绪{prereqs.pi.ok ? `（pi ${prereqs.pi.version ?? ""}）` : "（Node.js）"}</>
              ) : (
                <>
                  {I.warn(13)} 未检测到 Node.js / pi——Pi Desk 会自动在线下载后端组件（首次约几分钟），
                  或到 <a href="#" onClick={(e) => { e.preventDefault(); void window.pidesk.openExternal("https://pi.dev"); }}>pi.dev</a> 安装 pi 获得完整体验
                </>
              )}
            </div>

            <div className="ob-row center">
              <button className="sm-btn primary" onClick={() => setStep("api")}>一键接入大模型 {I.chevronR(14)}</button>
              <button className="sm-btn" onClick={finish}>直接开始使用</button>
            </div>
          </div>
        )}

        {step === "api" && (
          <div className="ob-body">
            <h2>一键接入大模型</h2>
            <p className="ob-sub">
              选择你使用的大模型提供商，粘贴 API Key，一键导入——配置与 pi 完全共享。
            </p>

            {backend.phase !== "ready" ? (
              <div className="ob-okline warn">
                {I.warn(16)} 后端尚未就绪（首次启动正在下载组件），就绪后才能导入 API。
                <button className="sm-btn small" onClick={() => void window.pidesk.restartBackend()} style={{ marginLeft: 10 }}>
                  {I.refresh(13)} 重试连接
                </button>
              </div>
            ) : providers === null && !providersError ? (
              <div className="ob-loading">正在获取提供商列表…</div>
            ) : (
              <>
                {providersError && (
                  <div className="ob-okline warn">
                    {I.warn(16)} 获取提供商失败：{providersError}
                    <button className="sm-btn small" onClick={() => void loadProviders()} style={{ marginLeft: 10 }}>重试</button>
                  </div>
                )}

                {!providersError && (
                  <>
                    {configuredCount > 0 && (
                      <div className="ob-okline">{I.check(16)} 已配置 {configuredCount} 个提供商，也可以继续添加新的</div>
                    )}

                    <div className="ob-api-grid">
                      {/* 左：搜索 → 只展示命中结果 */}
                      <div className="ob-api-side">
                        <div className="ob-search">
                          {I.search(16)}
                          <input
                            placeholder="输入提供商名称搜索，如 deepseek / openai"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setSearch("");
                            }}
                          />
                          {search && (
                            <button className="ob-search-clear" title="清空" onClick={() => setSearch("")}>
                              {I.close(13)}
                            </button>
                          )}
                        </div>
                        {!search.trim() ? (
                          <div className="ob-search-hint">
                            <p>{I.search(13)} 搜索你使用的大模型提供商</p>
                            <div className="ob-pop-chips">
                              {POPULAR_PROVIDERS.map((p) => (
                                <button key={p.q} className="ob-pop-chip" onClick={() => setSearch(p.q)}>
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (filtered ?? []).length === 0 ? (
                          <div className="ob-prov-empty">
                            未找到「{search.trim()}」，试试 DeepSeek / OpenAI / Anthropic 等名称
                          </div>
                        ) : (
                          <div className="ob-prov-list">
                            {filtered.map((p) => (
                              <button
                                key={p.id}
                                className={`ob-prov${selected?.id === p.id ? " sel" : ""}`}
                                data-id={p.id}
                                onClick={() => { setSelected(p); setImportError(""); setImported(null); }}
                              >
                                <span className="ob-prov-dot" />
                                <span className="ob-prov-name">{p.displayName}</span>
                                {p.configured && <em className="ob-prov-tag ok">已配置{p.modelCount > 0 ? ` · ${p.modelCount} 模型` : ""}</em>}
                                {!p.configured && p.modelCount > 0 && <em className="ob-prov-tag">{p.modelCount} 模型</em>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 右：密钥输入 */}
                      <div className="ob-api-form">
                        <label>提供商</label>
                        <div className="ob-api-sel">
                          {selected ? selected.displayName : "请从左侧选择"}
                        </div>
                        <label style={{ marginTop: 12 }}>API Key</label>
                        <div className="ob-key-row">
                          <input
                            type={showKey ? "text" : "password"}
                            placeholder={selected?.configured ? "已配置——输入新 Key 可覆盖" : "粘贴你的 API Key（sk-…）"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void doImport(); }}
                          />
                          <button className="icon-btn" title={showKey ? "隐藏" : "显示"} onClick={() => setShowKey((s) => !s)}>
                            {showKey ? I.eyeOff(14) : I.eye(14)}
                          </button>
                        </div>
                        <p className="ob-hint">
                          Key 只保存在本机 <code>~/.pi/agent</code>，与命令行 pi 共用，不会上传到任何服务器。
                        </p>
                        {imported && (
                          <div className="ob-okline" style={{ marginTop: 8 }}>{I.check(16)} 「{imported}」已导入成功，马上可用</div>
                        )}
                        {importError && (
                          <div className="ob-okline warn" style={{ marginTop: 8 }}>{I.warn(16)} {importError}</div>
                        )}
                        <div className="ob-row" style={{ marginTop: 12 }}>
                          <button
                            className="sm-btn primary"
                            disabled={!selected || !apiKey.trim() || importing}
                            onClick={() => void doImport()}
                          >
                            {importing ? `${I.spinner(13)} 导入中…` : `${I.download(13)} 一键导入并验证`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="ob-row center" style={{ marginTop: 16 }}>
              <button className="sm-btn" onClick={() => setStep("welcome")}>{I.chevronL(14)} 上一步</button>
              <button className="sm-btn primary" onClick={finish}>完成，开始使用</button>
              <button className="sm-btn ghost" onClick={finish}>稍后再说</button>
            </div>
            <p className="ob-hint center" style={{ textAlign: "center" }}>
              也可以到 <a href="#" onClick={(e) => { e.preventDefault(); void window.pidesk.openExternal(backend.url || `http://127.0.0.1:${backend.port || 30141}`); }}>pi-web 配置页</a> 使用完整配置面板（OAuth 登录、自定义 Provider 等）
            </p>
          </div>
        )}

        <div className="ob-foot">
          <button className="sm-btn ghost" onClick={finish}>跳过引导</button>
          <span className="ob-foot-note">功能与外观随时可在「设置中心」调整</span>
        </div>
      </div>
    </div>
  );
}
