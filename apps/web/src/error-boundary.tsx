import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only console use in the web app: surface render failures to the developer.
    // oxlint-disable-next-line no-console
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main>
          <h1>Something went wrong</h1>
          <p>Reload the page. If it keeps happening, check the server log.</p>
        </main>
      );
    }
    return this.props.children;
  }
}
