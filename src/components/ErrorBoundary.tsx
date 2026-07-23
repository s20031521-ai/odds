import { Component, type ErrorInfo, type ReactNode } from "react";
import { Mascot } from "./Kawaii";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Last line of defence: a render error must never unmount the whole tree into
// a blank white page. Show a friendly fallback with a way to recover instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("App render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-loading" role="alert">
          <Mascot pose="momonga-alert" />
          <p>頁面載入時出咗問題，請重新整理。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新整理
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
