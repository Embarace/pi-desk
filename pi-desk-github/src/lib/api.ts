// 后端 API 客户端：全部通过主进程代理（无 CORS 问题）
import type { ModelsData, SessionDetail, SessionInfo } from "./types";

const P = () => window.pidesk;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function req<T = any>(p: string, opts?: { method?: string; body?: any }): Promise<T> {
  const res = await P().request(p, opts);
  if (!res.ok) {
    const msg = res.json?.error || res.json?.message || `请求失败 (HTTP ${res.status})`;
    throw new ApiError(String(msg), res.status);
  }
  return (res.json ?? null) as T;
}

/** 编码绝对路径用于 /api/files/... （同 pi-web lib/file-paths.ts） */
export function encodeFilePathForApi(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/** 项目文件的媒体 URL（走 pidesk-file 协议 → 主进程 → 后端流式转发） */
export function fileMediaUrl(absPath: string, type: "read" | "download" = "read", sessionId?: string): string {
  const q = new URLSearchParams({ type });
  if (sessionId) q.set("sessionId", sessionId);
  return `pidesk-file://pi/files/${encodeFilePathForApi(absPath)}?${q.toString()}`;
}

/** 会话上下文里给出的相对 /api/... URL → pidesk-file URL */
export function backendMediaUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  const clean = url.replace(/^\/+/, "");
  return `pidesk-file://pi/${clean}`;
}

export const api = {
  home: () => req<{ home: string }>("/api/home"),
  running: () =>
    req<{
      sessionListVersion: number;
      runningSessionIds: string[];
      completionNotificationSuppressedSessionIds: string[];
    }>("/api/agent/running"),

  sessions: () =>
    req<{
      sessions: SessionInfo[];
      sessionListVersion: number;
      runningSessionIds: string[];
    }>("/api/sessions"),

  session: (id: string, opts?: { deferThinking?: boolean; tail?: number }) => {
    const q = new URLSearchParams();
    if (opts?.deferThinking) q.set("deferThinking", "1");
    q.set("tail", String(opts?.tail ?? 200));
    return req<SessionDetail>(`/api/sessions/${id}?${q.toString()}`);
  },

  sessionFullThinking: (id: string) => {
    const q = new URLSearchParams({ tail: "200" });
    return req<SessionDetail>(`/api/sessions/${id}?${q.toString()}`);
  },

  renameSession: (id: string, name: string) =>
    req(`/api/sessions/${id}`, { method: "PATCH", body: { name } }),

  deleteSession: (id: string) => req(`/api/sessions/${id}`, { method: "DELETE" }),

  exportSession: async (id: string): Promise<string> => {
    const res = await P().request(`/api/sessions/${id}/export`);
    if (!res.ok) throw new ApiError(res.json?.error || "导出失败", res.status);
    return res.text ?? "";
  },

  agentState: (id: string) => req<{ running: boolean; state?: unknown }>(`/api/agent/${id}`),

  sendCommand: (id: string, command: Record<string, unknown>) =>
    req(`/api/agent/${id}`, { method: "POST", body: command }),

  newSession: (cwd: string, command: Record<string, unknown>) =>
    req<{ sessionId: string; data?: unknown; model?: { provider: string; modelId: string } | null; thinkingLevel?: string }>(
      "/api/agent/new",
      { method: "POST", body: { cwd, ...command } },
    ),

  models: (cwd: string) => req<ModelsData>(`/api/models?cwd=${encodeURIComponent(cwd)}`),

  fileList: (absPath: string) =>
    req<{ entries: { name: string; isDir: boolean; size: number; modified: string }[]; path: string }>(
      `/api/files/${encodeFilePathForApi(absPath)}?type=list`,
    ),

  fileRead: async (absPath: string): Promise<{ kind: "text" | "binary"; text?: string; language?: string; base64?: string; mime?: string }> => {
    const p = `/api/files/${encodeFilePathForApi(absPath)}?type=read`;
    const res = await P().request(p);
    if (!res.ok) {
      throw new ApiError(res.json?.error || `无法读取 (HTTP ${res.status})`, res.status);
    }
    if (res.json && typeof res.json.content === "string") {
      return { kind: "text", text: res.json.content, language: res.json.language };
    }
    if (res.base64) {
      return { kind: "binary", base64: res.base64, mime: res.contentType };
    }
    throw new ApiError("未知响应格式");
  },

  fileIndex: (cwd: string) =>
    req<{ files: string[]; hardTruncated?: boolean }>(`/api/file-index?cwd=${encodeURIComponent(cwd)}`),
};
