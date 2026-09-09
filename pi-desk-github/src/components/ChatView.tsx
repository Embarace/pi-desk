import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PiDeskSettings } from "../global";
import { api, ApiError } from "../lib/api";
import type { AgentMessage, ClientAssistantMessageEvent, ModelsData, SessionDetail, SessionInfo, SseAgentEvent } from "../lib/types";
import { INITIAL_STREAMING, applyStreamDelta, streamEnd, streamSnapshot, type StreamingState } from "../lib/streaming";
import { baseName, truncate } from "../lib/format";
import { useToast } from "./Toast";
import MessageItem from "./MessageItem";
import ChatInput, { type ComposerState } from "./ChatInput";
import I from "./Icon";

const TOOL_PRESETS: Record<string, string[]> = {
  none: [],
  "read-only": ["read", "grep", "find", "ls"],
  default: ["read", "bash", "edit", "write"],
  full: ["bash", "read", "edit", "write", "grep", "find", "ls"],
};

interface Props {
  sessionId: string | null;
  sessionInfo: SessionInfo | undefined;
  draft: { cwd: string } | null;
  models: ModelsData | null;
  modelsLoading: boolean;
  settings: PiDeskSettings;
  onSessionsChanged: () => void;
  onSessionCreated: (id: string) => void;
  onSessionForked: (id: string) => void;
  onOpenFilePanel: () => void;
  onNewSession: () => void;
}

export default function ChatView(props: Props) {
  const { sessionId, sessionInfo, draft, models, settings } = props;
  const toast = useToast();

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState>(INITIAL_STREAMING);
  const [running, setRunning] = useState(false);
  const [runningTools, setRunningTools] = useState<Map<string, string>>(new Map());
  const [queueCount, setQueueCount] = useState(0);
  const [isCompacting, setIsCompacting] = useState(false);
  const [composer, setComposer] = useState<ComposerState>({ text: "", images: [] });
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [forkingId, setForkingId] = useState<string | null>(null);

  const sseRef = useRef<{ streamId: number; id: string; retries: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const runningRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const hasSession = !!sessionId;

  // ---------------- 会话加载 ----------------
  const loadSession = useCallback(async (id: string) => {
    try {
      const d = await api.session(id, { deferThinking: true, tail: 200 });
      if (sessionIdRef.current !== id) return;
      setDetail(d);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds);
      setLoading(false);
      // 若仍在运行则重连 SSE（顶层 running 恒为 true，用 state 字段判定）
      const st = await api.agentState(id);
      const rs = (st.state ?? {}) as any;
      const runningNow = !!(rs?.isPromptRunning || rs?.isStreaming || rs?.isBashRunning || rs?.isCompacting || (rs?.queuedMessages?.followUp?.length ?? 0) > 0);
      if (runningNow) {
        runningRef.current = true;
        setRunning(true);
        openSse(id);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && sessionIdRef.current === id) {
        // 新会话（尚无文件）——空视图
        setDetail(null);
        setMessages([]);
        setLoading(false);
        return;
      }
      if (sessionIdRef.current === id) {
        setLoading(false);
        toast(`加载会话失败：${(e as Error).message}`, "error");
      }
    }
  }, [toast]);

  // ---------------- SSE ----------------
  // 与后端对账运行状态：GET /api/agent/[id] 的顶层 running 只要会话进程活着就恒为 true，
  // 真实运行状态在 state 字段里（isPromptRunning / isStreaming / isBashRunning / isCompacting / 队列）。
  // pi 0.85 起不再发 agent_start，事件流可能漏 agent_end/prompt_done（扩展注入的运行没有 prompt_done），
  // 单纯依赖事件收敛会卡死「运行中」（血泪教训：见 AGENTS.md §23）。
  const reconcile = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const st = await api.agentState(sid);
      if (sessionIdRef.current !== sid) return;
      const s = (st.state ?? {}) as any;
      const qFollow = s?.queuedMessages?.followUp?.length ?? 0;
      const qSteer = s?.queuedMessages?.steering?.length ?? 0;
      setQueueCount(Math.max(qFollow, qSteer));
      const runningNow = !!(s?.isPromptRunning || s?.isStreaming || s?.isBashRunning || s?.isCompacting || qFollow > 0);
      if (!runningNow && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        setQueueCount(0);
        setIsCompacting(false);
        setRunningTools(new Map());
        setStreaming(streamEnd);
        void loadSession(sid);
      }
    } catch { /* 后端暂不可达时忽略，事件流会重连 */ }
  }, [loadSession]);

  // 运行期间每 4 秒对账一次（事件丢了也能收敛）
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reconcile(), 4000);
    return () => clearInterval(timer);
  }, [running, reconcile]);

  const handleAgentEvent = useCallback((evt: SseAgentEvent) => {
    switch (evt.type) {
      case "agent_start":
        runningRef.current = true;
        setRunning(true);
        break;
      case "agent_end": {
        void reconcile();
        if (settings.chat.completionSound) playCompletionSound();
        break;
      }
      case "agent_settled":
        void reconcile();
        break;
      case "prompt_done":
        // 普通 prompt 收尾事件；是否真正结束由 reconcile 对账决定
        void reconcile();
        break;
      case "prompt_error":
        toast((evt.errorMessage as string) || "命令执行失败", "error");
        runningRef.current = false;
        setRunning(false);
        break;
      case "extension_error":
        toast((evt.error as string) || "扩展执行失败", "error");
        break;
      case "message_start": {
        const msg = evt.message;
        if (!msg) break;
        if (msg.role === "assistant") {
          setStreaming((s) => streamSnapshot(s, msg));
        } else if (msg.role === "user") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user" && JSON.stringify(last) === JSON.stringify(msg)) return prev;
            return [...prev, msg];
          });
        }
        break;
      }
      case "message_update": {
        const delta = evt.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
        if (delta) setStreaming((s) => applyStreamDelta(s, delta));
        break;
      }
      case "message_end": {
        const completed = evt.message;
        if (completed) {
          if (completed.role === "user") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "user") {
                return [...prev.slice(0, -1), completed];
              }
              return [...prev, completed];
            });
          } else {
            setMessages((prev) => [...prev, completed]);
          }
        }
        setStreaming(streamEnd);
        break;
      }
      case "tool_execution_start":
        setRunningTools((prev) => {
          const next = new Map(prev);
          next.set(String(evt.toolCallId), String(evt.toolName || "tool"));
          return next;
        });
        break;
      case "tool_execution_update": {
        const id = String(evt.toolCallId);
        setRunningTools((prev) => {
          const next = new Map(prev);
          if (next.has(id)) next.set(id, String(evt.toolName || next.get(id)));
          return next;
        });
        break;
      }
      case "tool_execution_end":
        setRunningTools((prev) => {
          const next = new Map(prev);
          next.delete(String(evt.toolCallId));
          return next;
        });
        break;
      case "compaction_start":
      case "auto_compaction_start":
        setIsCompacting(true);
        break;
      case "compaction_end":
      case "auto_compaction_end":
        setIsCompacting(false);
        if (evt.errorMessage) toast(String(evt.errorMessage), "error");
        else {
          const sid = sessionIdRef.current;
          if (sid) void loadSession(sid);
        }
        break;
      case "auto_retry_start":
        toast(`自动重试 ${evt.attempt}/${evt.maxAttempts}…`);
        break;
      default:
        break;
    }
  }, [loadSession, settings.chat.completionSound, toast]);

  const openSse = useCallback((id: string) => {
    closeSse();
    const streamId = window.pidesk.sseOpen(`/api/agent/${id}/events`);
    sseRef.current = { streamId, id, retries: 0 };
  }, []);

  const closeSse = useCallback(() => {
    const s = sseRef.current;
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      window.pidesk.sseClose(s.streamId);
      sseRef.current = null;
    }
  }, []);

  // 全局 SSE 事件监听（一次）
  useEffect(() => {
    const unEvt = window.pidesk.onSseEvent(({ streamId, data }) => {
      const s = sseRef.current;
      if (!s || s.streamId !== streamId) return;
      try {
        handleAgentEvent(JSON.parse(data) as SseAgentEvent);
      } catch {
        // 非 JSON 帧，忽略
      }
    });
    const unEnd = window.pidesk.onSseEnd(({ streamId, error }) => {
      const s = sseRef.current;
      if (!s || s.streamId !== streamId) return;
      sseRef.current = null;
      if (sessionIdRef.current !== s.id) return;
      if (runningRef.current) {
        // 断线重连
        if (s.retries < 12) {
          const retries = s.retries + 1;
          const timer = setTimeout(() => {
            if (sessionIdRef.current === s.id && runningRef.current) {
              const streamId = window.pidesk.sseOpen(`/api/agent/${s.id}/events`);
              sseRef.current = { streamId, id: s.id, retries };
            }
          }, Math.min(500 * retries, 4000));
          sseRef.current = { ...s, retries, timer };
        } else {
          toast("事件流断开，正在从服务器同步…", "error");
          void loadSession(s.id);
        }
      } else if (!error) {
        // 正常结束：同步一次会话
        void loadSession(s.id);
      }
    });
    return () => { unEvt(); unEnd(); };
  }, [handleAgentEvent, loadSession, toast]);

  useEffect(() => {
    if (!sessionId) {
      closeSse();
      setDetail(null);
      setMessages([]);
      setEntryIds([]);
      setStreaming(INITIAL_STREAMING);
      setRunning(false);
      runningRef.current = false;
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadSession(sessionId);
    return () => { /* 切走时由下一次 openSse 关闭旧流 */ };
  }, [sessionId, loadSession, closeSse]);

  // 组件卸载
  useEffect(() => () => closeSse(), [closeSse]);

  // 页面可见性变化时对账
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        const sid = sessionIdRef.current;
        if (sid) {
          void loadSession(sid);
          void api.agentState(sid).then((st) => {
            const rs = (st.state ?? {}) as any;
            const runningNow = !!(rs?.isPromptRunning || rs?.isStreaming || rs?.isBashRunning || rs?.isCompacting || (rs?.queuedMessages?.followUp?.length ?? 0) > 0);
            if (runningNow) {
              runningRef.current = true;
              setRunning(true);
              openSse(sid);
            }
          });
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadSession, openSse]);

  // ---------------- 滚动 ----------------
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming]);

  // ---------------- 发送 ----------------
  const send = useCallback(async (state: ComposerState) => {
    const text = state.text.trim();
    if (!text && state.images.length === 0) return;
    const queued = runningRef.current; // 运行中发送 → pi 的 follow-up 排队
    setComposer({ text: "", images: [] });

    const images = state.images.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    const textBlocks = text ? [{ type: "text" as const, text }] : [];
    const imageBlocks = state.images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
    }));
    const optimistic: AgentMessage = {
      role: "user",
      content: state.images.length > 0 ? [...textBlocks, ...imageBlocks] : text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);
    runningRef.current = true;
    setRunning(true);

    try {
      if (!sessionIdRef.current && draft) {
        const res = await api.newSession(draft.cwd, {
          type: "prompt",
          message: text,
          ...(images.length ? { images } : {}),
          ...(state.model ? { provider: state.model.provider, modelId: state.model.modelId } : {}),
          ...(state.thinking ? { thinkingLevel: state.thinking } : {}),
          ...(state.tools ? { toolNames: TOOL_PRESETS[state.tools] ?? undefined } : {}),
        });
        props.onSessionCreated(res.sessionId);
        if (res.sessionId) openSse(res.sessionId);
      } else if (sessionIdRef.current) {
        const sid = sessionIdRef.current;
        if (state.model) {
          try {
            await api.sendCommand(sid, { type: "set_model", provider: state.model.provider, modelId: state.model.modelId });
          } catch { /* 忽略 */ }
        }
        if (state.thinking) {
          try {
            await api.sendCommand(sid, { type: "set_thinking_level", level: state.thinking });
          } catch { /* 忽略 */ }
        }
        if (state.tools) {
          try {
            await api.sendCommand(sid, { type: "set_tools", toolNames: TOOL_PRESETS[state.tools] ?? [] });
          } catch { /* 忽略 */ }
        }
        openSse(sid);
        await api.sendCommand(sid, {
          type: "prompt",
          message: text,
          ...(images.length ? { images } : {}),
          // 运行中发送 → 嫁接 pi 的 follow-up 排队（当前任务完成后继续）
          ...(queued ? { streamingBehavior: "followUp" } : {}),
        });
        if (queued) toast("已加入队列，当前任务完成后继续", "ok");
      } else {
        throw new Error("请先选择工作目录创建会话");
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      runningRef.current = false;
      setRunning(false);
      // 回滚乐观消息
      setMessages((prev) => {
        const i = prev.lastIndexOf(optimistic);
        return i === -1 ? prev : prev.slice(0, i);
      });
      setComposer(state);
      toast(`发送失败：${err.message}`, "error");
    }
  }, [draft, openSse, props, toast]);

  const stop = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || !runningRef.current) return;
    try {
      await api.sendCommand(sid, { type: "abort" });
    } catch (e) {
      toast(`停止失败：${(e as Error).message}`, "error");
    }
  }, [toast]);

  // ---------------- 会话操作 ----------------
  const doRename = useCallback(async () => {
    if (!sessionId) return;
    const name = renameValue.trim();
    setRenaming(false);
    if (!name) return;
    try {
      await api.renameSession(sessionId, name);
      props.onSessionsChanged();
      toast("已重命名", "ok");
    } catch (e) {
      toast(`重命名失败：${(e as Error).message}`, "error");
    }
  }, [sessionId, renameValue, props, toast]);

  const doDelete = useCallback(async () => {
    if (!sessionId) return;
    const ok = window.confirm("确定删除这个会话吗？此操作不可撤销。");
    if (!ok) return;
    try {
      await api.deleteSession(sessionId);
      toast("已删除会话", "ok");
      props.onSessionsChanged();
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`, "error");
    }
  }, [sessionId, props, toast]);

  const doExport = useCallback(async () => {
    if (!sessionId) return;
    try {
      const html = await api.exportSession(sessionId);
      const name = (sessionInfo?.name || "session").replace(/[\\/:*?"<>|]/g, "_");
      const res = await window.pidesk.saveExport(`${name}.html`, html);
      if (!res.canceled && res.path) toast(`已导出到 ${res.path}`, "ok");
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, "error");
    }
  }, [sessionId, sessionInfo, toast]);

  const doFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid || runningRef.current || !entryId) return;
    setForkingId(entryId);
    try {
      const res = await api.sendCommand(sid, { type: "fork", entryId }) as { data?: { cancelled?: boolean; newSessionId?: string } };
      const { cancelled, newSessionId } = res.data ?? {};
      if (!cancelled && newSessionId) {
        toast("已创建分支会话", "ok");
        props.onSessionForked(newSessionId);
      }
    } catch (e) {
      const msg = (e as Error).message || "";
      toast(msg.includes("running") ? "会话运行中无法分支，请先停止当前运行" : `分支失败：${msg}`, "error");
    } finally {
      setForkingId(null);
    }
  }, [props, toast]);

  // ---------------- 模型/思维状态 ----------------
  const sessionModel = detail?.context.model ?? null;
  const sessionThinking = detail?.context.thinkingLevel ?? "";

  const firstUserText = useMemo(() => {
    for (const m of messages) {
      if (m.role !== "user") continue;
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
      if (text.trim()) return text;
    }
    // 无用户消息（例如子代理会话）：退回任意助手文本
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const text = m.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
      if (text.trim()) return text;
    }
    return "";
  }, [messages]);

  const title = sessionInfo?.name || truncate(firstUserText, 30) || "会话";

  const modelOptions = useMemo(() => {
    if (!models) return [];
    return models.modelList.map((m) => ({
      value: `${m.provider}/${m.id}`,
      label: m.name || m.id,
      provider: m.provider,
      modelId: m.id,
    }));
  }, [models]);

  // ---------------- 渲染 ----------------
  const showEmpty = !hasSession && !draft;
  const showDraft = !hasSession && !!draft;
  const streamMsg = streaming.isStreaming ? streaming.streamingMessage : null;

  return (
    <div className="chat-col" onDragOver={(e) => e.preventDefault()}>
      {/* 头部 */}
      <div className="chat-head">
        {hasSession && (
          <>
            {renaming ? (
              <input
                className="sm-input"
                style={{ width: 240, padding: "4px 10px" }}
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={() => setRenaming(false)}
              />
            ) : (
              <span
                className="ch-name"
                title="点击重命名"
                onClick={() => {
                  setRenameValue((sessionInfo?.name as string) || (typeof title === "string" ? title : ""));
                  setRenaming(true);
                }}
              >
              {typeof title === "string" && title !== "会话" ? title : sessionInfo?.name || "（无标题会话）"}
              </span>
            )}
            {sessionInfo?.cwd && (
              <span className="ch-cwd" title={sessionInfo.cwd}>
                {baseName(sessionInfo.cwd)}
              </span>
            )}
            {isCompacting && (
              <span style={{ fontSize: 11.5, color: "var(--warn)", display: "flex", alignItems: "center", gap: 5 }}>
                {I.spinner(12)} 压缩上下文中…
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button className="icon-btn" title="在侧栏刷新" onClick={() => props.onSessionsChanged()}>
              {I.refresh(14)}
            </button>
            <button className="icon-btn" title="文件面板" onClick={props.onOpenFilePanel}>
              {I.folder(15)}
            </button>
            <button className="icon-btn" title="导出为 HTML" onClick={() => void doExport()}>
              {I.export(14)}
            </button>
            <button className="icon-btn" title="删除会话" onClick={() => void doDelete()}>
              {I.trash(14)}
            </button>
          </>
        )}
        {showDraft && (
          <>
            <span className="ch-name">新会话</span>
            <span className="ch-cwd" title={draft.cwd}>{baseName(draft.cwd)}</span>
            <div style={{ flex: 1 }} />
            <button className="sm-btn" onClick={props.onNewSession} style={{ fontSize: 11.5 }}>
              切换目录
            </button>
          </>
        )}
        {showEmpty && <span className="ch-name">Pi Desk</span>}
      </div>

      {/* 消息区 */}
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-inner">
          {loading && (
            <>
              <div className="skeleton-line" style={{ width: "40%" }} />
              <div className="skeleton-line" style={{ width: "70%" }} />
              <div className="skeleton-line" style={{ width: "55%" }} />
            </>
          )}
          {!loading && messages.length === 0 && !streamMsg && (
            <div className="empty-state">
              <div className="es-logo">π</div>
              {showDraft ? (
                <>
                  <div className="es-title">开始新对话</div>
                  <div className="es-sub">
                    工作目录：<b>{draft.cwd}</b>
                    <br />
                    输入你的第一个任务，pi 会在此目录下开始工作。
                  </div>
                  <div className="es-hint">Enter 发送 · Shift+Enter 换行</div>
                </>
              ) : (
                <>
                  <div className="es-title">选择一个会话，或新建一个</div>
                  <div className="es-sub">在左侧选择历史会话继续对话，或点击「新建会话」选择工作目录开始。</div>
                </>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <MessageItem
              key={`${i}-${m.role}`}
              msg={m}
              // 运行中不允许 fork（后端会话替换限制），隐藏按钮与 pi-web 一致
              onFork={m.role === "user" && hasSession && !running ? () => void doFork(entryIds[i] || "") : undefined}
              forking={forkingId === entryIds[i]}
            />
          ))}
          {streamMsg && (
            <MessageItem msg={streamMsg} isStreaming runningTools={runningTools} />
          )}
        </div>
      </div>

      {/* 输入区 */}
      <ChatInput
        composer={composer}
        setComposer={setComposer}
        running={running}
        queueCount={queueCount}
        onSend={(s) => void send(s)}
        onStop={() => void stop()}
        models={models}
        modelsLoading={props.modelsLoading}
        modelOptions={modelOptions}
        sessionModel={sessionModel}
        sessionThinking={sessionThinking}
        defaultModel={models?.defaultModel ?? null}
        thinkingLevels={models?.thinkingLevels ?? {}}
        sendOnEnter={settings.chat.sendOnEnter}
        disabled={showEmpty}
      />
    </div>
  );
}

// ---------- 完成提示音（WebAudio 合成，无需音频文件） ----------
let audioCtx: AudioContext | null = null;

function playCompletionSound() {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const notes = [
      { f: 660, t: now, d: 0.12, v: 0.12 },
      { f: 880, t: now + 0.1, d: 0.18, v: 0.1 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0, n.t);
      gain.gain.linearRampToValueAtTime(n.v, n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(n.t);
      osc.stop(n.t + n.d + 0.05);
    }
  } catch {
    // 忽略
  }
}

export function titleOf(sessionInfo?: SessionInfo, firstMessage?: string): string {
  return sessionInfo?.name || truncate(firstMessage || "", 30) || "会话";
}
