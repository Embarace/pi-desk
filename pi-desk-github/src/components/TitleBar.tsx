import { useEffect, useState } from "react";
import type { BackendStatus } from "../global";
import I from "./Icon";

interface Props {
  backend: BackendStatus;
  sessionTitle: string;
  onOpenSettings: () => void;
  onOpenWeb: () => void;
}

export default function TitleBar({ backend, sessionTitle, onOpenSettings, onOpenWeb }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const un = window.pidesk.window.onMaximized(setMaximized);
    void window.pidesk.window.isMaximized().then(setMaximized);
    return un;
  }, []);

  const dot =
    backend.phase === "ready" ? (
      <span className="dot-ok">{I.dot(8)}</span>
    ) : backend.phase === "error" ? (
      <span className="dot-err">{I.dot(8)}</span>
    ) : (
      <span className="dot-start">{I.dot(8)}</span>
    );

  const label =
    backend.phase === "ready"
      ? "pi 已连接"
      : backend.phase === "error"
        ? "后端异常"
        : "连接中…";

  return (
    <div className="titlebar">
      <div className="tb-logo">π</div>
      <span className="tb-title">{sessionTitle || "Pi Desk"}</span>
      <div className="tb-spacer" />
      <button
        className="tb-status"
        title={`后端状态：${backend.phase}${backend.error ? "\n" + backend.error : ""}`}
        onClick={onOpenSettings}
      >
        {dot}
        {label}
      </button>
      <button className="tb-btn" title="打开 pi-web 网页版（模型/登录等高级配置）" onClick={onOpenWeb}>
        {I.external(15)}
      </button>
      <button className="tb-btn" title="设置" onClick={onOpenSettings}>
        {I.gear(16)}
      </button>
      <div style={{ width: 4 }} />
      <button className="tb-btn" title="最小化" onClick={() => window.pidesk.window.minimize()}>
        {I.min(15)}
      </button>
      <button className="tb-btn" title={maximized ? "还原" : "最大化"} onClick={() => window.pidesk.window.toggleMaximize()}>
        {maximized ? I.restore(14) : I.max(13)}
      </button>
      <button className="tb-btn win-close" title="关闭" onClick={() => window.pidesk.window.close()}>
        {I.close(15)}
      </button>
    </div>
  );
}
