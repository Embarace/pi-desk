import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ModelsData } from "../lib/types";
import I from "./Icon";

export interface ComposerState {
  text: string;
  images: { data: string; mimeType: string; name: string }[];
  model?: { provider: string; modelId: string } | null;
  thinking?: string | null;
  tools?: string | null;
}

interface Props {
  composer: ComposerState;
  setComposer: React.Dispatch<React.SetStateAction<ComposerState>>;
  running: boolean;
  queueCount: number;
  onSend: (state: ComposerState) => void;
  onStop: () => void;
  models: ModelsData | null;
  modelsLoading: boolean;
  modelOptions: { value: string; label: string; provider: string; modelId: string }[];
  sessionModel: { provider: string; modelId: string } | null;
  sessionThinking: string;
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  sendOnEnter: boolean;
  disabled: boolean;
}

const FALLBACK_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const LEVEL_LABELS: Record<string, string> = {
  off: "关闭思考",
  minimal: "极少思考",
  low: "少量思考",
  medium: "中等思考",
  high: "较多思考",
  xhigh: "大量思考",
  max: "全力思考",
};

const TOOL_LABELS: Record<string, string> = {
  "": "工具：会话默认",
  none: "工具：纯聊天",
  "read-only": "工具：只读",
  default: "工具：标准",
  full: "工具：完整",
};

export default function ChatInput(props: Props) {
  const { composer, setComposer, running } = props;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const autoResize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [composer.text, autoResize]);

  const canSend = (composer.text.trim().length > 0 || composer.images.length > 0) && !props.disabled;

  const modelKey = composer.model
    ? `${composer.model.provider}/${composer.model.modelId}`
    : props.sessionModel
      ? `${props.sessionModel.provider}/${props.sessionModel.modelId}`
      : props.defaultModel
        ? `${props.defaultModel.provider}/${props.defaultModel.modelId}`
        : "";

  const levels = useMemo(() => {
    if (modelKey && props.thinkingLevels[modelKey]?.length) return props.thinkingLevels[modelKey];
    return FALLBACK_LEVELS;
  }, [modelKey, props.thinkingLevels]);

  const thinkingValue = composer.thinking ?? props.sessionThinking ?? "";

  const onPickImages = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 20 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        setComposer((prev) => ({
          ...prev,
          images: [...prev.images, { data: base64, mimeType: f.type, name: f.name }],
        }));
      };
      reader.readAsDataURL(f);
    }
  }, [setComposer]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && props.sendOnEnter) {
      e.preventDefault();
      if (canSend) props.onSend(composer);
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={
            props.disabled
              ? "先在左侧选择或新建一个会话…"
              : running
                ? "pi 运行中——可直接输入排队，或点停止打断"
                : "给 pi 发送消息（Enter 发送，Shift+Enter 换行）"
          }
          value={composer.text}
          disabled={props.disabled}
          onChange={(e) => setComposer((prev) => ({ ...prev, text: e.target.value }))}
          onKeyDown={handleKeyDown}
        />
        {composer.images.length > 0 && (
          <div className="preview-imgs">
            {composer.images.map((img, i) => (
              <div key={i} className="pv">
                <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} />
                <button
                  className="pv-x"
                  title="移除"
                  onClick={() =>
                    setComposer((prev) => ({ ...prev, images: prev.images.filter((_, j) => j !== i) }))
                  }
                >
                  {I.close(10)}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              onPickImages(e.target.files);
              e.target.value = "";
            }}
          />
          <button className="icon-btn" title="附加图片" onClick={() => fileRef.current?.click()} disabled={props.disabled}>
            {I.paperclip(15)}
          </button>

          <select
            className="chip-select"
            title="选择模型"
            disabled={props.disabled || !props.modelOptions.length}
            value={composer.model ? `${composer.model.provider}/${composer.model.modelId}` : modelKey}
            onChange={(e) => {
              const opt = props.modelOptions.find((o) => o.value === e.target.value);
              if (opt) setComposer((prev) => ({ ...prev, model: { provider: opt.provider, modelId: opt.modelId } }));
            }}
          >
            {!composer.model && (
              <option value={modelKey}>
                {modelKey ? `模型：${modelKey}` : props.modelsLoading ? "模型加载中…" : "模型：默认"}
              </option>
            )}
            {props.modelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            className="chip-select"
            title="思考强度"
            disabled={props.disabled}
            value={thinkingValue}
            onChange={(e) => setComposer((prev) => ({ ...prev, thinking: e.target.value || null }))}
          >
            {!composer.thinking && (
              <option value={thinkingValue}>
                {thinkingValue ? `思考：${LEVEL_LABELS[thinkingValue] || thinkingValue}` : "思考：默认"}
              </option>
            )}
            {levels.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l] || l}
              </option>
            ))}
          </select>

          <select
            className="chip-select"
            title="工具权限"
            disabled={props.disabled}
            value={composer.tools ?? ""}
            onChange={(e) => setComposer((prev) => ({ ...prev, tools: e.target.value || null }))}
          >
            {Object.entries(TOOL_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>

          <div className="spacer" />
          {running && (
            <span className="run-chip" title="运行中仍可继续输入，消息会排队执行">
              {I.spinner(12)} 运行中
              {props.queueCount > 0 && <em className="run-queue">{I.queue(11)} 排队 {props.queueCount}</em>}
            </span>
          )}
          {running ? (
            <>
              <button className="send-btn queue" title="排队发送（当前任务完成后继续）" disabled={!canSend} onClick={() => props.onSend(composer)}>
                {I.queue(16)}
              </button>
              <button className="send-btn stop" title="停止（打断当前运行）" onClick={props.onStop}>
                {I.stop(15)}
              </button>
            </>
          ) : (
            <button className="send-btn" title="发送" disabled={!canSend} onClick={() => props.onSend(composer)}>
              {I.send(15)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
