import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fileMediaUrl } from "../lib/api";
import { baseName, formatBytes, joinPath } from "../lib/format";
import { useToast } from "./Toast";
import I from "./Icon";

interface Props {
  root: string;
  sessionId: string | null;
  onClose: () => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface ViewerState {
  path: string;
  kind: "text" | "image" | "video" | "audio" | "binary";
  content?: string;
  language?: string;
  size?: number;
}

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const map = new Map<string, TreeNode>([["", root]]);
  for (const f of files.sort((a, b) => a.localeCompare(b))) {
    const parts = f.split("/");
    let cur = "";
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      cur = cur ? `${cur}/${p}` : p;
      const isLast = i === parts.length - 1;
      let child = map.get(cur);
      if (!child) {
        child = { name: p, path: cur, isDir: !isLast, children: isLast ? undefined : [] };
        map.set(cur, child);
        node.children = node.children || [];
        node.children.push(child);
      }
      node = child;
    }
  }
  // 子目录排序（目录在前）
  const sortNode = (n: TreeNode) => {
    if (!n.children) return;
    n.children.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children || [];
}

function mimeKind(mime: string): ViewerState["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "binary";
}

export default function FilePanel({ root, sessionId, onClose }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const toast = useToast();
  const loadedRef = useRef("");

  const load = useCallback(async (force = false) => {
    if (!root) return;
    setFiles(null);
    try {
      const res = await api.fileIndex(root);
      if (loadedRef.current === root || force) setFiles(res.files);
    } catch (e) {
      toast(`文件索引失败：${(e as Error).message}`, "error");
      setFiles([]);
    }
  }, [root, toast]);

  useEffect(() => {
    if (!root || loadedRef.current === root) return;
    loadedRef.current = root;
    setViewer(null);
    setSelected(null);
    setExpanded(new Set());
    setQuery("");
    void load();
  }, [root, load]);

  const tree = useMemo(() => (files ? buildTree(files) : null), [files]);

  const filteredTree = useMemo(() => {
    if (!tree) return null;
    if (!query.trim()) return tree;
    const q = query.trim().toLowerCase();
    const match = (n: TreeNode): TreeNode | null => {
      if (n.isDir) {
        const children = (n.children || []).map(match).filter(Boolean) as TreeNode[];
        if (children.length) return { ...n, children };
        return n.name.toLowerCase().includes(q) ? { ...n, children: [] } : null;
      }
      return n.name.toLowerCase().includes(q) ? n : null;
    };
    return tree.map(match).filter(Boolean) as TreeNode[];
  }, [tree, query]);

  const openFile = useCallback(async (relPath: string, isDir: boolean) => {
    if (isDir) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(relPath)) next.delete(relPath);
        else next.add(relPath);
        return next;
      });
      return;
    }
    const abs = joinPath(root, relPath);
    setSelected(relPath);
    setLoadingView(true);
    try {
      const res = await api.fileRead(abs);
      if (res.kind === "text") {
        setViewer({ path: abs, kind: "text", content: res.text, language: res.language });
      } else {
        setViewer({ path: abs, kind: mimeKind(res.mime || ""), size: undefined });
      }
    } catch (e) {
      toast(`读取失败：${(e as Error).message}`, "error");
      setViewer({ path: abs, kind: "binary" });
    } finally {
      setLoadingView(false);
    }
  }, [root, toast]);

  const renderNode = (n: TreeNode, depth: number) => {
    const isExpanded = expanded.has(n.path);
    return (
      <div key={n.path}>
        <div
          className={`fp-row ${selected === n.path ? "selected" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => void openFile(n.path, n.isDir)}
        >
          {n.isDir ? (
            <>
              {isExpanded ? I.chevronD(11) : I.chevronR(11)}
              {I.folder(13)}
            </>
          ) : (
            <>
              <span style={{ width: 11 }} />
              {I.file(13)}
            </>
          )}
          <span className={`fname ${n.isDir ? "fdir" : ""}`}>{n.name}</span>
        </div>
        {n.isDir && isExpanded && n.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="file-panel">
      <div className="fp-head">
        <span className="fp-title" title={root}>{baseName(root)}</span>
        <button className="icon-btn" title="刷新" onClick={() => void load(true)}>
          {I.refresh(14)}
        </button>
        <button className="icon-btn" title="关闭" onClick={onClose}>
          {I.close(14)}
        </button>
      </div>
      <input
        className="fp-search"
        placeholder="搜索文件…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="fp-tree">
        {files === null ? (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>正在索引文件…</div>
        ) : files.length === 0 ? (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>无文件</div>
        ) : (filteredTree ?? []).length === 0 ? (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>没有匹配的文件</div>
        ) : (
          (filteredTree ?? []).map((n) => renderNode(n, 0))
        )}
      </div>

      <div className="fp-viewer">
        <div className="fv-head">
          {loadingView ? I.spinner(12) : I.file(12)}
          <span className="fv-name">{viewer ? baseName(viewer.path) : "预览"}</span>
          {viewer && (
            <>
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                title="在资源管理器中显示"
                onClick={() => void window.pidesk.showItemInFolder(viewer.path)}
              >
                {I.external(12)}
              </button>
              <button
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                title="下载"
                onClick={() => void window.pidesk.downloadFile(`/api/files/${encodeURIComponent(viewer.path)}?type=download`, baseName(viewer.path)).then((r) => {
                  if (r.error) toast(r.error, "error");
                })}
              >
                {I.export(12)}
              </button>
            </>
          )}
        </div>
        <div className="fv-body">
          {!viewer ? (
            <div className="fv-empty">点击文件查看内容</div>
          ) : viewer.kind === "text" ? (
            viewer.content
          ) : viewer.kind === "image" ? (
            <img src={fileMediaUrl(viewer.path, "read", sessionId ?? undefined)} alt="" />
          ) : viewer.kind === "video" ? (
            <video src={fileMediaUrl(viewer.path, "read", sessionId ?? undefined)} controls autoPlay={false} />
          ) : viewer.kind === "audio" ? (
            <audio src={fileMediaUrl(viewer.path, "read", sessionId ?? undefined)} controls />
          ) : (
            <div className="fv-empty">
              二进制文件，无法预览
              {viewer.size !== undefined && <div>{formatBytes(viewer.size)}</div>}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
