import type { JSX } from "react";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function wrap(children: JSX.Element, size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden>
      {children}
    </svg>
  );
}

export const I = {
  plus: (s?: number) => wrap(<><path d="M12 5v14M5 12h14" /></>, s),
  send: (s?: number) => wrap(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>, s),
  stop: (s?: number) => wrap(<rect x="6" y="6" width="12" height="12" rx="2" />, s),
  gear: (s?: number) =>
    wrap(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </>,
      s,
    ),
  trash: (s?: number) => wrap(<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" /></>, s),
  pencil: (s?: number) => wrap(<><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>, s),
  export: (s?: number) => wrap(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>, s),
  folder: (s?: number) => wrap(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />, s),
  folderOpen: (s?: number) => wrap(<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />, s),
  file: (s?: number) => wrap(<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></>, s),
  chevronR: (s?: number) => wrap(<path d="m9 18 6-6-6-6" />, s),
  chevronL: (s?: number) => wrap(<path d="m15 18-6-6 6-6" />, s),
  download: (s?: number) => wrap(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>, s),
  chevronD: (s?: number) => wrap(<path d="m6 9 6 6 6-6" />, s),
  close: (s?: number) => wrap(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, s),
  min: (s?: number) => wrap(<path d="M5 12h14" />, s),
  max: (s?: number) => wrap(<rect x="5" y="5" width="14" height="14" rx="1.5" />, s),
  restore: (s?: number) => wrap(<><rect x="4" y="8" width="12" height="12" rx="1.5" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /></>, s),
  refresh: (s?: number) => wrap(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>, s),
  upload: (s?: number) => wrap(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>, s),
  music: (s?: number) => wrap(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>, s),
  play: (s?: number) => wrap(<path d="m6 4 14 8-14 8Z" />, s),
  image: (s?: number) => wrap(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>, s),
  external: (s?: number) => wrap(<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>, s),
  fork: (s?: number) => wrap(<><circle cx="6" cy="5" r="2.5" /><circle cx="18" cy="5" r="2.5" /><circle cx="12" cy="19" r="2.5" /><path d="M6 7.5v3a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-3" /><path d="M12 14.5V16.5" /></>, s),
  queue: (s?: number) => wrap(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>, s),
  search: (s?: number) => wrap(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /></>, s),
  eye: (s?: number) => wrap(<><path d="M2.06 12.35a1 1 0 0 1 0-.7C3.42 8.6 7.22 5.5 12 5.5s8.58 3.1 9.94 6.15a1 1 0 0 1 0 .7c-1.36 3.05-5.16 6.15-9.94 6.15S3.42 15.4 2.06 12.35Z" /><circle cx="12" cy="12" r="3" /></>, s),
  eyeOff: (s?: number) => wrap(<><path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c4.78 0 8.58 3.1 9.94 6.15a1 1 0 0 1 0 .7 11.9 11.9 0 0 1-2.34 3.38" /><path d="M6.62 6.62A13.6 13.6 0 0 0 2.06 12.35a1 1 0 0 0 0 .7C3.42 15.4 7.22 18.5 12 18.5a9.9 9.9 0 0 0 5.38-1.62" /><path d="m9.9 9.9a3 3 0 0 0 4.24 4.24" /><path d="M2 2l20 20" /></>, s),
  panel: (s?: number) => wrap(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>, s),
  chat: (s?: number) => wrap(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />, s),
  paperclip: (s?: number) => wrap(<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />, s),
  check: (s?: number) => wrap(<path d="M20 6 9 17l-5-5" />, s),
  warn: (s?: number) => wrap(<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>, s),
  spinner: (s?: number) => (
    <svg width={s ?? 16} height={s ?? 16} viewBox="0 0 24 24" fill="none" aria-hidden className="spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  brain: (s?: number) => wrap(
    <>
      <path d="M9.5 2a2.5 2.5 0 0 0-2.5 2.5v.5A2.5 2.5 0 0 0 4.5 7.5 2.5 2.5 0 0 0 4.5 12a2.5 2.5 0 0 0 0 4.5 2.5 2.5 0 0 0 2.5 2.5v.5a2.5 2.5 0 0 0 5 0V17" />
      <path d="M14.5 2a2.5 2.5 0 0 1 2.5 2.5v.5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1 0 4.5 2.5 2.5 0 0 1 0 4.5 2.5 2.5 0 0 1-2.5 2.5v.5a2.5 2.5 0 0 1-5 0V17" />
    </>,
    s,
  ),
  dot: (s?: number) => (
    <svg width={s ?? 8} height={s ?? 8} viewBox="0 0 8 8" aria-hidden>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  ),
};

export default I;
