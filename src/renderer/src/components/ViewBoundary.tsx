import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Bumped by "Reload view" to build the view again. */
  attempt: number;
}

/** A problem in one view shows a message with a way to reload that view, never a blank window or a raw stack. */
export class ViewBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("view failed:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6" data-testid="view-error">
          <div className="mx-auto max-w-md text-center">
            <div className="mb-1 text-base font-semibold">This view hit a problem</div>
            <div className="mb-3 text-selectable" style={{ color: "var(--muted)" }}>
              {this.state.error.message}
            </div>
            <Button
              onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
              data-testid="view-reload"
            >
              Reload view
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div key={this.state.attempt} className="contents">
        {this.props.children}
      </div>
    );
  }
}
