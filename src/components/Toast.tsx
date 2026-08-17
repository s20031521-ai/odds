import { useEffect, useRef } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

export type ToastMessage = {
  kind: "success" | "error";
  text: string;
  link?: { href: string; label: string };
};

const AUTO_DISMISS_MS = 4000;

export function Toast(props: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}): React.ReactElement | null {
  const dismissRef = useRef(props.onDismiss);
  dismissRef.current = props.onDismiss;

  useEffect(() => {
    if (!props.toast) return;
    const timer = window.setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [props.toast]);

  if (!props.toast) return null;
  const { kind, text, link } = props.toast;

  return (
    <div className={`toast toast--${kind}`} role="status">
      {kind === "success" ? (
        <CheckCircle2 size={16} aria-hidden="true" />
      ) : (
        <XCircle size={16} aria-hidden="true" />
      )}
      <span className="toast__text">{text}</span>
      {link ? (
        <a className="toast__link" href={link.href} onClick={() => dismissRef.current()}>
          {link.label}
        </a>
      ) : null}
      <button
        type="button"
        className="toast__close"
        aria-label="關閉提示"
        onClick={() => dismissRef.current()}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
