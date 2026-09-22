/** @type {import('tailwindcss').Config} */
// Semua warna dirujuk lewat CSS variable (lihat src/index.css) agar tema gelap
// dan terang bisa ditukar tanpa mengubah satu pun class di komponen.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        panel: token("panel"),
        panel2: token("panel2"),
        border: token("border"),
        muted: token("muted"),
        // fg = teks utama, fg2 = teks sekunder, fg3 = teks paling redup
        fg: token("fg"),
        fg2: token("fg2"),
        fg3: token("fg3"),
        accent: token("accent"),
        accentfg: token("accentfg"),
        accenthover: token("accenthover"),
        up: token("up"),
        down: token("down"),
        pending: token("pending"),
        maint: token("maint"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
