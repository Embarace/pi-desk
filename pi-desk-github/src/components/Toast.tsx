import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import I from "./Icon";

interface ToastItem {
  id: number;
  kind: "info" | "error" | "ok";
  text: string;
}

const ToastCtx = createContext<(text: string, kind?: ToastItem["kind"]) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, kind: ToastItem["kind"] = "info") => {
    const id = ++seq.current;
    setItems((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? I.warn(14) : t.kind === "ok" ? I.check(14) : null}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
