export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface HttpResult {
  ok: boolean;
  status: number;
  contentType: string;
  text?: string;
  json?: any;
  base64?: string;
  error?: string;
}

export interface BackendStatus {
  phase: "stopped" | "starting" | "ready" | "error";
  mode: string;
  url: string;
  port: number;
  error: string;
  startDetail?: string;
  logTail: string[];
}

export interface PiDeskSettings {
  backend: {
    mode: "auto" | "npx" | "local" | "external";
    port: number;
    localPath: string;
    externalUrl: string;
  };
  appearance: {
    accent: string;
    builtinVariant: number;
    panelOpacity: number;
    background: {
      kind: "builtin" | "media";
      media: string | null;
      mediaKind: "image" | "video" | "gif" | null;
      fit: "cover" | "contain" | "tile" | "stretch";
      opacity: number;
      dim: number;
      blur: number;
    };
  };
  startup: {
    animation: "fade" | "zoom" | "slide-up" | "aurora" | "particles" | "none";
    minDuration: number;
    audio: {
      enabled: boolean;
      file: string | null;
      volume: number;
    };
  };
  chat: {
    completionSound: boolean;
    sendOnEnter: boolean;
    fontSize: number;
  };
  onboarding: {
    completed: boolean;
    downloadedSkills: string[];
  };
}

export interface PrereqItem {
  ok: boolean;
  version: string;
  path: string;
  hint: string;
}

export interface PrereqsResult {
  node: PrereqItem;
  pi: PrereqItem;
  agentDir: boolean;
  apiConfigured: boolean;
  modelsCount: number;
}

export interface SkillItem {
  name: string;
  desc: string;
  license?: string;
  dir: string;
  root: string;
  source: string;
}

export interface ExtensionItem {
  name: string;
  path: string;
  kind: "file" | "dir";
  loadable: boolean;
  source: string;
}

export interface PackageItem {
  spec: string;
  installed: boolean | null;
  filter?: boolean;
}

export interface PideskApi {
  platform: string;
  getSettings(): Promise<PiDeskSettings>;
  setSettings(patch: DeepPartial<PiDeskSettings>): Promise<PiDeskSettings>;
  importMedia(kind: "background" | "audio"): Promise<{ rel: string; mediaKind: string; name: string } | null>;
  removeMedia(kind: "background" | "audio"): Promise<void>;
  getBackendStatus(): Promise<BackendStatus>;
  onBackendStatus(cb: (s: BackendStatus) => void): () => void;
  restartBackend(): Promise<void>;
  detectPrereqs(): Promise<PrereqsResult>;
  downloadSkill(args: { name: string; repo: string; prefix: string }): Promise<{ ok: boolean; dir?: string; error?: string }>;
  listInstalledSkills(): Promise<string[]>;
  manage: {
    listSkills(): Promise<{ skills: SkillItem[]; disabled: SkillItem[] }>;
    removeSkill(dir: string): Promise<boolean>;
    setSkillEnabled(dir: string, enabled: boolean): Promise<boolean>;
    installSkillFolder(): Promise<{ name: string; dir: string } | null>;
    listExtensions(): Promise<{ extensions: ExtensionItem[]; disabled: ExtensionItem[] }>;
    removeExtension(p: string): Promise<boolean>;
    setExtensionEnabled(p: string, enabled: boolean): Promise<boolean>;
    installExtensionFolder(): Promise<{ name: string; path: string } | null>;
    listPackages(): Promise<{ packages: PackageItem[] }>;
    runPiPkg(op: string, spec: string): Promise<{ ok: boolean; jobId?: number; error?: string }>;
    onPkgLog(cb: (e: { id: number; line: string }) => void): () => void;
    onPkgExit(cb: (e: { id: number; code: number }) => void): () => void;
  };
  request(p: string, opts?: { method?: string; body?: any; raw?: boolean }): Promise<HttpResult>;
  sseOpen(p: string): number;
  sseClose(id: number): void;
  onSseEvent(cb: (e: { streamId: number; data: string }) => void): () => void;
  onSseEnd(cb: (e: { streamId: number; error?: string }) => void): () => void;
  pickFolder(defaultPath?: string): Promise<string | null>;
  saveExport(name: string, content: string): Promise<{ canceled: boolean; path?: string }>;
  downloadFile(apiPath: string, defaultName?: string): Promise<{ canceled?: boolean; error?: string; path?: string }>;
  showItemInFolder(absPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximized(cb: (max: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    pidesk: PideskApi;
  }
}
