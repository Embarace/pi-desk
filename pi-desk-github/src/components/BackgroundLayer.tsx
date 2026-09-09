import { useMemo } from "react";
import type { PiDeskSettings } from "../global";

function mediaUrl(rel: string | null): string | null {
  return rel ? `pidesk-media://local/${rel}` : null;
}

export default function BackgroundLayer({ settings }: { settings: PiDeskSettings }) {
  const bg = settings.appearance.background;
  const src = bg.kind === "media" ? mediaUrl(bg.media) : null;

  const mediaStyle = useMemo(() => {
    if (!src) return undefined;
    const base: React.CSSProperties = {
      opacity: bg.opacity,
      filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
      transform: bg.blur > 0 ? "scale(1.06)" : undefined,
    };
    switch (bg.fit) {
      case "contain":
        return { ...base, objectFit: "contain" as const, background: "var(--bg-deep)" };
      case "stretch":
        return { ...base, objectFit: "fill" as const };
      case "tile":
        return { ...base, objectFit: undefined, backgroundImage: `url(${src})`, backgroundRepeat: "repeat", backgroundSize: undefined };
      default:
        return { ...base, objectFit: "cover" as const };
    }
  }, [src, bg.opacity, bg.blur, bg.fit]);

  const isVideo = bg.mediaKind === "video";
  const isTileImage = bg.fit === "tile" && bg.mediaKind !== "video";

  return (
    <div className="bg-layer">
      {bg.kind === "builtin" || !src ? (
        <>
          <div className={`bg-builtin g${settings.appearance.builtinVariant % 3}`} />
          <div className="bg-aurora-anim" style={{ opacity: 0.55 }} />
        </>
      ) : isTileImage ? (
        <div className="bg-media" style={mediaStyle} />
      ) : isVideo ? (
        <video className="bg-media" src={src} style={mediaStyle} autoPlay muted loop playsInline />
      ) : (
        <img className="bg-media" src={src} style={mediaStyle} alt="" />
      )}
      <div className="bg-dim" style={{ opacity: bg.kind === "builtin" ? 0 : bg.dim }} />
    </div>
  );
}
