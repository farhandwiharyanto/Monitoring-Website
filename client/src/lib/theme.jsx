import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const KEY = "pw_theme";
const Ctx = createContext(null);

// "auto" mengikuti preferensi sistem; "dark"/"light" memaksa salah satu.
export const THEMES = ["dark", "light", "auto"];

const prefersLight = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;
export const resolveTheme = (theme) => (theme === "auto" ? (prefersLight() ? "light" : "dark") : theme === "light" ? "light" : "dark");

// Dipasang di <html> supaya seluruh token warna ikut berubah sekaligus.
export function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolved);
  return resolved;
}

const stored = () => {
  try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : null; } catch { return null; }
};

export function ThemeProvider({ children, fallback = "dark" }) {
  // Pilihan user (localStorage) menang atas default instance dari server.
  const [theme, setThemeState] = useState(() => stored() || fallback);
  const [resolved, setResolved] = useState(() => applyTheme(stored() || fallback));

  // Default server hanya berlaku bila user belum pernah memilih sendiri
  useEffect(() => {
    if (!stored() && THEMES.includes(fallback)) setThemeState(fallback);
  }, [fallback]);

  useEffect(() => { setResolved(applyTheme(theme)); }, [theme]);

  // Saat "auto", ikuti perubahan preferensi sistem secara langsung
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(applyTheme("auto"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    try { localStorage.setItem(KEY, next); } catch {}
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx) || { theme: "dark", resolved: "dark", setTheme: () => {} };

// Recharts butuh warna sebagai string, bukan class Tailwind. Nilainya dibaca
// dari CSS variable yang sedang aktif agar grafik ikut berganti tema.
export function useChartColors() {
  const { resolved } = useTheme();
  return useMemo(() => {
    const read = (name, fallback) => {
      if (typeof window === "undefined") return fallback;
      const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim();
      return v ? `rgb(${v})` : fallback;
    };
    return {
      accent: read("accent", "#38bdf8"),
      grid: read("border", "#1f2937"),
      axis: read("muted", "#8b95a7"),
      tooltipBg: read("panel2", "#151d2c"),
      tooltipBorder: read("border", "#1f2937"),
    };
    // `resolved` sengaja jadi dependency: token berubah saat tema berganti
  }, [resolved]);
}
