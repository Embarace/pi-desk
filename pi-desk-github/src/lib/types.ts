// 与 pi-web 会话格式对齐的类型（摘自 pi-web/lib/types.ts）

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  deferred?: boolean;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  rawInput?: string;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  usage?: AgentUsage;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
  usage?: AgentUsage;
}

export interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage | BashExecutionMessage;

// ---- 会话列表 ----

export type SubagentSessionStatus = "starting" | "running" | "completed" | "failed" | "aborted" | "interrupted";

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  relation?: {
    kind: "fork" | "subagent";
    originSessionId?: string;
    parentSessionId?: string;
    profile?: string;
    description?: string;
    status?: SubagentSessionStatus;
  };
  projectRoot?: string;
  projectKey?: string;
  branch?: string;
  isWorktree?: boolean;
  transient?: boolean;
}

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  oldestEntryId: string | null;
  hasMore: boolean;
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface SessionDetail {
  context: SessionContext;
  info: SessionInfo;
  totalActiveMs?: number;
  stats?: unknown;
  [key: string]: unknown;
}

export interface ModelListEntry {
  id: string;
  name: string;
  provider: string;
  input?: string[];
}

export interface ModelsData {
  models: Record<string, string>;
  modelList: ModelListEntry[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  modelError?: string;
  modelScopeWarnings?: string[];
}

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

// ---- SSE 事件 ----

export interface ClientAssistantMessageEvent {
  type:
    | "text_start" | "text_delta" | "text_end"
    | "thinking_start" | "thinking_delta" | "thinking_end"
    | "toolcall_start" | "toolcall_delta" | "toolcall_end";
  contentIndex?: number;
  delta?: string;
  content?: string;
  id?: string;
  toolName?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}

export interface SseAgentEvent {
  type: string;
  message?: AgentMessage;
  assistantMessageEvent?: ClientAssistantMessageEvent;
  toolCallId?: string;
  toolName?: string;
  partialResult?: unknown;
  errorMessage?: string;
  attempt?: number;
  maxAttempts?: number;
  aborted?: boolean;
  reason?: string;
  result?: unknown;
  steering?: string[];
  followUp?: string[];
  [key: string]: unknown;
}
