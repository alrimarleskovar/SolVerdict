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
      },
    },
  },
  plugins: [],
};

export default config;
