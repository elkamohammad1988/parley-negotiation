"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { PAPER, SIGNAL } from "@/lib/design";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: ReactNode;
  type: ToastType;
  duration?: number;
  dismissible?: boolean;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// Toasts render over Parley's light surfaces, so both the palette and the
// text colour come from lib/design.ts. These previously used the prior
// product's brand purple for "info" and a dark-theme ink for every label.
const COLORS: Record<ToastType, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: SIGNAL.gainSoft, border: SIGNAL.gain, icon: SIGNAL.gain, text: PAPER.ink },
  error: { bg: SIGNAL.claySoft, border: SIGNAL.clay, icon: SIGNAL.clay, text: PAPER.ink },
  warning: { bg: SIGNAL.warnSoft, border: SIGNAL.warn, icon: SIGNAL.warn, text: PAPER.ink },
  info: { bg: SIGNAL.steelSoft, border: SIGNAL.steel, icon: SIGNAL.steel, text: PAPER.ink },
};

// Default durations per type — errors persist until manually dismissed
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  error: 0,
  warning: 5000,
  info: 4000,
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = COLORS[toast.type];
  const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];

  function handleDismiss() {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 300);
  }

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (duration > 0) {
      timerRef.current = setTimeout(handleDismiss, duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused && timerRef.current) {
      clearTimeout(timerRef.current);
    } else if (!paused && duration > 0) {
      timerRef.current = setTimeout(handleDismiss, duration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div
      role="alert"
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 16px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: "12px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        maxWidth: "360px",
        width: "100%",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        cursor: "default",
        pointerEvents: "all",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          background: `${colors.icon}22`,
          border: `1px solid ${colors.icon}44`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: colors.icon,
          flexShrink: 0,
          marginTop: "1px",
        }}
      >
        {(() => { const Icon = ICONS[toast.type]; return <Icon size={12} strokeWidth={2.5} />; })()}
      </div>

      <p
        style={{
          flex: 1,
          margin: 0,
          fontSize: "13px",
          color: colors.text,
          lineHeight: "1.5",
          fontWeight: 400,
        }}
      >
        {toast.message}
      </p>

      {toast.dismissible !== false && (
        <button
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          style={{
            background: "none",
            border: "none",
            color: PAPER.inkFaint,
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
            flexShrink: 0,
            display: "flex",
            transition: "color 0.15s ease",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = PAPER.ink; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = PAPER.inkFaint; }}
        >
          <X size={14} />
        </button>
      )}

      {duration > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "2px",
            background: colors.icon,
            opacity: 0.4,
            animation: `parley-toast-shrink ${duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </div>
  );
}

// Module-level toast queue, shared across the app regardless of which component
// calls showToast() — ToastContainer (mounted once in app/layout.tsx) is the only
// subscriber that actually renders anything.
let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toastQueue: Toast[] = [];

export function showToast(
  message: ReactNode,
  type: ToastType = "info",
  options?: { duration?: number; dismissible?: boolean }
) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const toast: Toast = {
    id,
    message,
    type,
    duration: options?.duration ?? DEFAULT_DURATIONS[type],
    dismissible: options?.dismissible ?? true,
  };
  toastQueue = [...toastQueue, toast].slice(-5); // max 5 visible at once
  toastListeners.forEach(l => l(toastQueue));
  return id;
}

export function dismissToast(id: string) {
  toastQueue = toastQueue.filter(t => t.id !== id);
  toastListeners.forEach(l => l(toastQueue));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListeners.push(setToasts);
    return () => {
      toastListeners = toastListeners.filter(l => l !== setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes parley-toast-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
      <div
        aria-label="Notifications"
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          alignItems: "flex-end",
          pointerEvents: "none",
        }}
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </>
  );
}
