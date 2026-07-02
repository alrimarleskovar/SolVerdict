// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";

/** The SolVerdict verdict glyph — check (green) + cross (red), matching docs/. */
export function Logo({ className = "logo" }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="SolVerdict verdict glyph"
    >
      <path d="M3 13l4 4 6-9" stroke="#14F195" />
      <path d="M14 8l6 8M20 8l-6 8" stroke="#e0635e" />
    </svg>
  );
}

/** Wordmark: glyph + gradient "SolVerdict". */
export function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontFamily: "var(--mono)", fontWeight: 700 }}>
      <Logo />
      <span className="sol">SolVerdict</span>
    </span>
  );
}

/** Top navigation bar shared across pages. */
export function TopBar() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "1.1rem 0 0.4rem",
      }}
    >
      <Link href="/" style={{ textDecoration: "none" }}>
        <Wordmark />
      </Link>
      <Link href="/submit" className="btn">
        Start audit →
      </Link>
    </nav>
  );
}
