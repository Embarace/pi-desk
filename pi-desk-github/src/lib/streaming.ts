// 流式消息 reducer（对齐 pi-web/lib/streaming-message.ts 语义）
import type { AgentMessage, AssistantContentBlock, AssistantMessage, ClientAssistantMessageEvent } from "./types";

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: AssistantMessage | null;
}

export const INITIAL_STREAMING: StreamingState = { isStreaming: false, streamingMessage: null };

function updateBlock(
  state: StreamingState,
  contentIndex: number,
  update: (current: AssistantContentBlock | undefined) => AssistantContentBlock | null,
): StreamingState {
  const message = state.streamingMessage;
  if (!message || !Number.isInteger(contentIndex) || contentIndex < 0) return state;
  const content = [...message.content];
  const next = update(content[contentIndex]);
  if (!next) return state;
  content[contentIndex] = next;
  return { isStreaming: true, streamingMessage: { ...message, content } };
}

export function applyStreamDelta(state: StreamingState, event: ClientAssistantMessageEvent): StreamingState {
  const i = event.contentIndex ?? 0;
  switch (event.type) {
    case "text_start":
      return updateBlock(state, i, (c) => (c?.type === "text" ? c : { type: "text", text: "" }));
    case "text_delta":
      return updateBlock(state, i, (c) =>
        c?.type === "text" ? { ...c, text: c.text + (event.delta ?? "") } : null,
      );
    case "text_end":
      return updateBlock(state, i, (c) => ({ ...(c?.type === "text" ? c : {}), type: "text", text: event.content ?? "" }));
    case "thinking_start":
      return updateBlock(state, i, (c) => (c?.type === "thinking" ? c : { type: "thinking", thinking: "" }));
    case "thinking_delta":
      return updateBlock(state, i, (c) =>
        c?.type === "thinking" ? { ...c, thinking: c.thinking + (event.delta ?? "") } : null,
      );
    case "thinking_end":
      return updateBlock(state, i, (c) => ({
        ...(c?.type === "thinking" ? c : {}),
        type: "thinking",
        thinking: event.content ?? "",
      }));
    case "toolcall_start":
      return updateBlock(state, i, (c) => {
        if (c?.type === "toolCall") {
          return {
            ...c,
            toolCallId: event.id ?? c.toolCallId,
            toolName: event.toolName ?? c.toolName,
            rawInput: c.rawInput ?? "",
          };
        }
        if (typeof event.toolName !== "string") return null;
        return { type: "toolCall", toolCallId: event.id ?? "", toolName: event.toolName, input: {}, rawInput: "" };
      });
    case "toolcall_delta":
      return updateBlock(state, i, (c) =>
        c?.type === "toolCall"
          ? {
              ...c,
              toolCallId: event.id || c.toolCallId,
              toolName: event.toolName || c.toolName,
              rawInput: (c.rawInput ?? "") + (event.delta ?? ""),
            }
          : null,
      );
    case "toolcall_end":
      return updateBlock(state, i, () => ({
        type: "toolCall",
        toolCallId: event.toolCall?.id ?? "",
        toolName: event.toolCall?.name ?? "",
        input: event.toolCall?.arguments ?? {},
      }));
    default:
      return state;
  }
}

export function streamSnapshot(state: StreamingState, message: AgentMessage): StreamingState {
  if (message.role !== "assistant") return state;
  return { isStreaming: true, streamingMessage: message };
}

export function streamEnd(state: StreamingState): StreamingState {
  return { isStreaming: false, streamingMessage: null };
}
