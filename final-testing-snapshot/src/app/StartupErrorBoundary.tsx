import { Component } from "react";
import type { ReactNode } from "react";

/**
 * Last-resort startup boundary. A failed view must not leave a blank window
 * or automatically delete encrypted/native records or browser-local fixtures.
 * Repairs and destructive resets require an explicit user action.
 */
export class StartupErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Diagnostic only: do not report volunteer records or authentication data.
    console.error("CivicFlow interface failed to initialize:", error.name);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const judgingDemo =
      typeof window !== "undefined" && window.location.pathname.startsWith("/judge/demo");
    return (
      <main
        role="alert"
        style={{
          width: "min(560px, calc(100% - 40px))",
          margin: "12vh auto 0",
          padding: 32,
          border: "1px solid #d4d5d0",
          borderRadius: 12,
          background: "#fffdfa",
          color: "#20313b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em" }}>
          CIVICFLOW · RECOVERY
        </p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 32, lineHeight: 1.16 }}>
          This workspace could not open.
        </h1>
        <p>
          No automatic data reset was attempted. Reload the application to try again. If the problem
          continues, keep the current workspace files and ask the maintainer to review the error
          before restoring a backup.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            display: "inline-block",
            marginTop: 14,
            padding: "11px 17px",
            borderRadius: 7,
            border: 0,
            background: "#20313b",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload application
        </button>
        {judgingDemo ? (
          <p style={{ marginTop: 22 }}>
            <a href="/judge/">Return to the judging overview</a>
          </p>
        ) : null}
      </main>
    );
  }
}
