/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f17",
        panel: "#111827",
        panel2: "#151d2c",
        border: "#1f2937",
        muted: "#8b95a7",
        accent: "#38bdf8",
        up: "#22c55e",
        down: "#ef4444",
        pending: "#f59e0b",
        maint: "#818cf8",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
