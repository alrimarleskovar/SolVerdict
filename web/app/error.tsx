// SPDX-License-Identifier: Apache-2.0
/**
 * App Router error boundary: any uncaught client-side exception below the
 * root layout renders this graceful fallback instead of Next's blank
 * "Application error" screen. Deliberately dependency-free (no i18n context,
 * no landing components) so it cannot itself be part of a crash; copy is
 * static EN + PT.
 */
"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the real error for debugging/telemetry.
    console.error("SolVerdict client error:", error);
  }, [error]);

  return (
    <main
      className="landing full-bleed relative flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center font-body text-snow antialiased"
      role="alert"
    >
      <p className="font-code text-[13px] uppercase tracking-[0.2em] text-accent-cyan">SolVerdict</p>
      <h1 className="mt-3 font-display text-[28px] font-bold leading-[1.15] tracking-tight text-snow">
        Something went wrong · Algo deu errado
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-mist">
        An unexpected error occurred on this page. Your audits and results are unaffected.
        <br />
        Ocorreu um erro inesperado nesta página. Suas auditorias e resultados não foram afetados.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-gradient-to-br from-accent-blue to-accent-violet px-6 py-3 text-base font-semibold text-snow shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-px hover:shadow-black/40"
        >
          Try again · Tentar novamente
        </button>
        <a
          href="/"
          className="rounded-xl border border-ink-line bg-ink-surface/60 px-6 py-3 text-base font-semibold text-snow transition-colors duration-200 ease-brand hover:border-mist/40 hover:bg-ink-surface"
        >
          Home · Início
        </a>
      </div>
      {error?.digest && <p className="mt-6 font-code text-[13px] text-mist/60">ref: {error.digest}</p>}
    </main>
  );
}
