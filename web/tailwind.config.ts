import type { Config } from "tailwindcss";

// Solana visual identity — brand tokens mirror docs/style.css so the SaaS app
// reads as the same product as the static landing page.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a14",
        panel: "#161b22",
        "panel-2": "#11151c",
        border: "#30363d",
        text: "#c9d1d9",
        "text-strong": "#e6edf3",
        muted: "#8b949e",
        "sol-purple": "#9945FF",
        "sol-green": "#14F195",
        "purple-soft": "#bd8aff",
        "sol-red": "#e0635e",
        // Landing palette (research-platform identity; inner pages keep the
        // Solana tokens above).
        ink: {
          DEFAULT: "#050816",
          surface: "#0B1225",
          card: "#111827",
          line: "rgba(148, 163, 184, 0.14)",
        },
        accent: {
          blue: "#3B82F6",
          cyan: "#06B6D4",
          violet: "#8B5CF6",
        },
        state: {
          ok: "#22C55E",
          warn: "#F59E0B",
          bad: "#EF4444",
        },
        snow: "#F8FAFC",
        mist: "#94A3B8",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Landing type system (next/font variables set on the .landing root;
        // graceful system fallbacks if the variables are absent).
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        code: ["var(--font-code)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
