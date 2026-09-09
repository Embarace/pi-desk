import { memo, useMemo, useState } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, ImageContent, ToolCallContent, ThinkingContent } from "../lib/types";
import { backendMediaUrl } from "../lib/api";
import { formatCost } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import I from "./Icon";

function ImageBlock({ img }: { img: ImageContent }) {
  const src = img.source.type === "base64"
    ? `data:${img.source.media_type || "image/png"};base64,${img.source.data || ""}`
    : backendMediaUrl(img.source.url || "");
  return <img className="attach-img" src={src} alt="" loading="lazy" />;
}

function UserContent({ msg }: { msg: Extract<AgentMessage, { role: "user" }> }) {
  if (typeof msg.content === "string") {
    return <div className="bubble">{msg.content}</div>;
  }
  return (
    <div className="bubble" style={{ display: "flex", flexDirection: "column", gap: 6, background: "transparent", border: "none", padding: 0, maxWidth: "78%" }}>
      {msg.content.map((b, i) =>
        b.type === "text"
          ? <div key={i} className="bubble" style={{ margin: 0 }}>{b.text}</div>
          : <ImageBlock key={i} img={b} />,
      )}
    </div>
  );
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

function ThinkingBlock({ block, isStreaming }: { block: ThinkingContent; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="think-block">
      <button className="think-head" onClick={() => setOpen((o) => !o)}>
        {I.brain(13)}
        {open ? "收起思考过程" : "查看思考过程"}
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
          {block.deferred ? "（历史思考已折叠）" : `${block.thinking.length} 字`}
        </span>
        <span style={{ marginLeft: "auto" }}>{open ? I.chevronD(13) : I.chevronR(13)}</span>
      </button>
      {open && <div className="think-body">{block.thinking || (isStreaming ? "…" : "（空）")}</div>}
    </div>
  );
}

function ToolCallBlock({ block, running }: { block: ToolCallContent; running: boolean }) {
  const [open, setOpen] = useState(false);
  const raw = block.rawInput ?? "";
  const args = raw || (Object.keys(block.input || {}).length ? JSON.stringify(block.input, null, 2) : "");
  return (
    <div className="tool-block">
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        {running ? <span className="tool-running">{I.spinner(13)}</span> : I.check(13)}
        <span className="tname">{block.toolName}</span>
        <span className="tstatus">{running ? "执行中…" : ""}</span>
        <span style={{ color: "var(--text-dim)" }}>{open ? I.chevronD(13) : I.chevronR(13)}</span>
      </button>
      {open && args && <div className="tool-body">{args}</div>}
    </div>
  );
}

function ToolResultBlock({ msg }: { msg: Extract<AgentMessage, { role: "toolResult" }> }) {
  const [open, setOpen] = useState(false);
  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const imgs = msg.content.filter((b): b is ImageContent => b.type === "image");
  const preview = text.length > 600 ? text.slice(0, 600) + "…" : text;
  return (
    <div className={`tool-block ${msg.isError ? "tool-error" : ""}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        {msg.isError ? <span style={{ color: "var(--danger)" }}>{I.warn(13)}</span> : I.check(13)}
        <span style={{ fontSize: 12 }}>{msg.isError ? "执行出错" : "执行结果"}</span>
        <span className="tstatus" style={{ flex: "none" }}>
          {msg.toolName ? `${msg.toolName}` : ""}
          {text ? ` · ${text.length} 字` : ""}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>{open ? I.chevronD(13) : I.chevronR(13)}</span>
      </button>
      {open && (
        <div className="tool-body">
          {preview || "（无文本输出）"}
          {imgs.map((img, i) => <ImageBlock key={i} img={img} />)}
        </div>
      )}
    </div>
  );
}

function BashBlock({ msg }: { msg: Extract<AgentMessage, { role: "bashExecution" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-block">
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>$</span>
        <span className="tname">{msg.command}</span>
        <span className="tstatus">{msg.cancelled ? "已取消" : `exit ${msg.exitCode ?? "?"}`}</span>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>{open ? I.chevronD(13) : I.chevronR(13)}</span>
      </button>
      {open && <div className="tool-body">{msg.output || "（无输出）"}</div>}
    </div>
  );
}

interface Props {
  msg: AgentMessage;
  isStreaming?: boolean;
  runningTools?: Map<string, string>;
  onFork?: () => void;
  forking?: boolean;
}

export default function MessageItem({ msg, isStreaming, runningTools, onFork, forking }: Props) {
  if (msg.role === "user") {
    return (
      <div className="msg user">
        <UserContent msg={msg} />
        {onFork && (
          <div className="msg-actions">
            <button className="msg-act" onClick={onFork} disabled={forking}>
              {forking ? I.spinner(11) : I.fork(11)}
              {forking ? "分支中…" : "从这条消息分支"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (msg.role === "assistant") {
    const am = msg as AssistantMessage;
    const cost = am.usage?.cost?.total;
    const modelLabel = am.model ? (am.provider ? `${am.provider}/${am.model}` : am.model) : "";
    return (
      <div className="msg assistant">
        <div className="msg-meta">
          <span style={{ fontWeight: 600, color: "color-mix(in srgb, var(--accent) 70%, var(--text))" }}>π</span>
          {modelLabel && <span>{modelLabel}</span>}
          {am.errorMessage && <span style={{ color: "var(--danger)" }}>{am.errorMessage}</span>}
          {am.stopReason && <span>{am.stopReason}</span>}
          {cost !== undefined && cost > 0 && <span>{formatCost(cost)}</span>}
        </div>
        {am.content.map((b: AssistantContentBlock, i) => {
          switch (b.type) {
            case "text":
              return (
                <div key={i} style={{ position: "relative" }}>
                  <Markdown text={b.text} />
                  {isStreaming && i === am.content.length - 1 && b.text && <span className="typing-cursor" />}
                </div>
              );
            case "thinking":
              return <ThinkingBlock key={i} block={b} isStreaming={!!isStreaming} />;
            case "toolCall":
              return <ToolCallBlock key={i} block={b} running={!!isStreaming && !!runningTools?.has(b.toolCallId)} />;
            case "image":
              return <ImageBlock key={i} img={b} />;
            default:
              return null;
          }
        })}
        {isStreaming && am.content.length === 0 && <span className="typing-cursor" />}
      </div>
    );
  }

  if (msg.role === "toolResult") {
    return <ToolResultBlock msg={msg} />;
  }

  if (msg.role === "bashExecution") {
    return <BashBlock msg={msg} />;
  }

  // custom
  if (msg.role === "custom" && msg.display) {
    const text = typeof msg.content === "string" ? msg.content : msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return <div className="msg" style={{ color: "var(--text-dim)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{text}</div>;
  }

  return null;
}
