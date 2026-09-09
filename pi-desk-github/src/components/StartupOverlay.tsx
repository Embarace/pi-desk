import { useEffect, useMemo, useRef, useState } from "react";
import type { BackendStatus, PiDeskSettings } from "../global";
import I from "./Icon";

interface Props {
  settings: PiDeskSettings;
  backend: BackendStatus;
  onRetry: () => void;
  onDone: () => void;
  onOpenSettings: () => void;
}

export default function StartupOverlay({ settings, backend, onRetry, onDone, onOpenSettings }: Props) {
  const [hiding, setHiding] = useState(false);
  const shownAt = useRef(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const started = useRef(false);
  const doneCalled = useRef(false);

  const anim = settings.startup.animation;
  const minDuration = Math.max(0, Math.min(settings.startup.minDuration, 8000));
  const ready = backend.phase === "ready";
  const failed = backend.phase === "error";

  // 启动音频（自动播放策略已在主进程放开）
  useEffect(() => {
    const a = settings.startup.audio;
    if (!a.enabled || !a.file || started.current) return;
    started.current = true;
    const el = new Audio(`pidesk-media://local/${a.file}`);
    el.volume = a.volume;
    el.loop = false;
    audioRef.current = el;
    el.play().catch(() => {});
    return () => {
      try { el.pause(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 就绪且动画最短时长已过 → 淡出
  useEffect(() => {
    if (!ready || doneCalled.current) return;
    const elapsed = Date.now() - shownAt.current;
    const wait = Math.max(0, minDuration - elapsed);
    const timer = setTimeout(() => {
      doneCalled.current = true;
      setHiding(true);
      setTimeout(onDone, 520);
    }, wait);
    return () => clearTimeout(timer);
  }, [ready, minDuration, onDone]);

  const statusText = useMemo(() => {
    switch (backend.phase) {
      case "starting":
        if (backend.startDetail) return backend.startDetail;
        return backend.mode === "external" || backend.mode === "auto"
          ? "正在连接本地 pi 服务"
          : "正在启动 pi 后端服务";
      case "ready":
        return "就绪，正在进入工作台";
      case "error":
        return "后端启动失败";
      default:
        return "正在初始化";
    }
  }, [backend]);

  // 粒子画布
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (anim !== "particles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let w = 0, h = 0;
    const particles = Array.from({ length: 46 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.0016,
      vy: -0.0006 - Math.random() * 0.0014,
      hue: 220 + Math.random() * 60,
      tw: Math.random() * Math.PI * 2,
    }));
    const resize = () => {
      w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      h = canvas.height = canvas.offsetHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.tw += 0.03;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        if (p.x < -0.05) p.x = 1.05;
        if (p.x > 1.05) p.x = -0.05;
        const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.tw));
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 72%, ${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [anim]);

  return (
    <div className={`startup-overlay anim-${anim} ${hiding ? "hide" : ""}`}>
      {anim === "aurora" && <div className="so-aurora" />}
      {anim === "particles" && <canvas ref={canvasRef} className="so-particles" />}
      <div className="so-inner" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div className="so-logo-wrap">
          <div className="so-ring" />
          <div className="so-logo">π</div>
        </div>
        <h1 className="so-title">Pi Desk</h1>
        <p className="so-sub">
          {failed ? (
            <>
              {I.warn(14)} {statusText}
            </>
          ) : ready ? (
            <>
              {I.check(14)} {statusText}
            </>
          ) : (
            <>
              {I.spinner(14)} {statusText}
              <span className="so-dots" />
            </>
          )}
        </p>
        {failed && (
          <>
            <p className="so-err">{backend.error}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="so-retry" onClick={onRetry}>重试</button>
              <button className="so-retry" onClick={onOpenSettings}>打开设置</button>
              <button className="so-retry ghost" onClick={onDone}>跳过，进入应用</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
