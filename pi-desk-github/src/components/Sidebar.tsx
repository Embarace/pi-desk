import { useMemo, useState } from "react";
import type { SessionInfo } from "../lib/types";
import { baseName, relativeTime, truncate } from "../lib/format";
import I from "./Icon";

interface Props {
  sessions: SessionInfo[];
  runningIds: Set<string>;
  selectedId: string | null;
  draft: { cwd: string } | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onSelectDraft: () => void;
  onNewSession: () => void;
  onDelete: (s: SessionInfo) => void;
  onRename: (s: SessionInfo) => void;
  onOpenSettings: () => void;
}

interface Group {
  key: string;
  label: string;
  path: string;
  sessions: SessionInfo[];
  lastModified: string;
}

export default function Sidebar(props: Props) {
  const { sessions, runningIds, selectedId, draft, collapsed } = props;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const s of sessions) {
      const root = s.projectRoot || s.cwd;
      const key = s.projectKey || root.toLowerCase();
      let g = map.get(key);
      if (!g) {
        g = { key, label: baseName(root) || root, path: root, sessions: [], lastModified: s.modified };
        map.set(key, g);
      }
      g.sessions.push(s);
      if (s.modified > g.lastModified) g.lastModified = s.modified;
    }
    for (const g of map.values()) {
      g.sessions.sort((a, b) => b.modified.localeCompare(a.modified));
    }
    return [...map.values()].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }, [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {collapsed ? (
        <>
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
            <button className="sb-icobtn" title="展开侧栏" onClick={props.onToggleCollapsed}>
              {I.chevronR(16)}
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <div className="sb-foot" style={{ flexDirection: "column" }}>
            <button className="sb-icobtn" title="新建会话" onClick={props.onNewSession}>{I.plus(16)}</button>
            <button className="sb-icobtn" title="设置" onClick={props.onOpenSettings}>{I.gear(16)}</button>
          </div>
        </>
      ) : (
        <>
          <div className="sb-head">
            <span className="sb-label">会话</span>
            <button className="sb-icobtn" title="收起侧栏" onClick={props.onToggleCollapsed}>
              {I.panel(15)}
            </button>
          </div>
          <div style={{ padding: "0 10px 6px", display: "flex", gap: 8 }}>
            <button className="sb-new" onClick={props.onNewSession}>
              {I.plus(15)}
              新建会话
            </button>
          </div>
          <div className="sb-list">
            {draft && (
              <div
                className={`sb-item ${selectedId === null ? "active" : ""}`}
                onClick={props.onSelectDraft}
              >
                <div className="row1">
                  <span className="sname" style={{ color: "var(--accent)" }}>
                    ＋ 新会话（未开始）
                  </span>
                </div>
                <div className="smeta">
                  <span>{baseName(draft.cwd)}</span>
                </div>
              </div>
            )}
            {groups.length === 0 && !draft && (
              <div className="sb-empty">
                还没有会话。
                <br />
                点击「新建会话」选择工作目录，
                <br />
                开始和你的 pi 智能体对话。
              </div>
            )}
            {groups.map((g) => {
              const collapsedGroup = collapsedGroups.has(g.key);
              return (
                <div key={g.key}>
                  <div className="sb-group-head" onClick={() => toggleGroup(g.key)} title={g.path}>
                    {collapsedGroup ? I.chevronR(12) : I.chevronD(12)}
                    {I.folder(13)}
                    <span className="gname">{g.label}</span>
                    <span style={{ fontSize: 10.5 }}>{g.sessions.length}</span>
                  </div>
                  {!collapsedGroup &&
                    g.sessions.map((s) => {
                      const running = runningIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          className={`sb-item ${selectedId === s.id ? "active" : ""}`}
                          onClick={() => props.onSelect(s.id)}
                          title={`${s.name || s.firstMessage}\n${s.cwd}\n${s.path}`}
                        >
                          <div className="row1">
                            <span className="sname">{s.name || truncate(s.firstMessage, 36) || "（空会话）"}</span>
                            {running && <span className="running-ico" title="运行中">{I.spinner(12)}</span>}
                          </div>
                          <div className="smeta">
                            <span>{relativeTime(s.modified)}</span>
                            {s.messageCount > 0 && <span>· {s.messageCount} 条</span>}
                            {s.isWorktree && <span>· {s.branch}</span>}
                          </div>
                          <div
                            style={{ display: "flex", gap: 2, marginTop: 1, opacity: 0, transition: "opacity .12s" }}
                            className="sb-item-ops"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="sb-icobtn"
                              style={{ width: 24, height: 24 }}
                              title="重命名"
                              onClick={() => props.onRename(s)}
                            >
                              {I.pencil(12)}
                            </button>
                            <button
                              className="sb-icobtn"
                              style={{ width: 24, height: 24 }}
                              title="删除"
                              onClick={() => props.onDelete(s)}
                            >
                              {I.trash(12)}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
          <div className="sb-foot">
            <button className="sb-icobtn" title="设置" onClick={props.onOpenSettings}>
              {I.gear(16)}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-dim)", flex: 1 }}>
              {sessions.length} 个会话
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
