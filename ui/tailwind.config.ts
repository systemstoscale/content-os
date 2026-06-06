import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Skalers DARK-ONLY brand system. Six dark surfaces stepping from
        // pitch (#000) to slate (#555) — see ../docs/brand-tokens or the
        // canonical CSS variables in src/styles/tokens.css.
        bg: {
          pitch: "#000",
          deep: "#111",
          ink: "#222",
          charcoal: "#333",
          graphite: "#444",
          slate: "#555",
        },
        // Single accent gold on every surface — no deep-gold variant.
        gold: "#f8d380",
        // Semantic status colors (replace scattered emerald/yellow/red literals).
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171",
      },
      fontSize: {
        // Smallest semantic step — replaces arbitrary text-[10px]/text-[11px]
        // (labels, badges, hints). Everything else uses Tailwind's scale.
        "2xs": ["0.6875rem", { lineHeight: "0.875rem" }],
      },
      fontFamily: {
        // .font-display is auto-uppercased via globals.css.
        display: ["var(--font-archivo-black)", "system-ui", "sans-serif"],
        sub: ["var(--font-poppins)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        // Skalers brand card radius — 8px on every container.
        card: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
