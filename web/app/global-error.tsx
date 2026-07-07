// SPDX-License-Identifier: Apache-2.0
/**
 * Root-layout error boundary (crashes in app/layout.tsx itself). Must render
 * its own <html>/<body> and stay completely dependency-free — inline styles
 * only, since globals.css may not have loaded.
 */
"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#050816",
          color: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong · Algo deu errado</h1>
        <p style={{ color: "#94a3b8", fontSize: 14, maxWidth: 560, lineHeight: 1.6 }}>
          An unexpected error occurred. · Ocorreu um erro inesperado.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "12px 24px",
            borderRadius: 12,
            border: "none",
            background: "#3b82f6",
            color: "#f8fafc",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again · Tentar novamente
        </button>
        {error?.digest && <p style={{ marginTop: 24, fontSize: 13, color: "#94a3b8" }}>ref: {error.digest}</p>}
      </body>
    </html>
  );
}
