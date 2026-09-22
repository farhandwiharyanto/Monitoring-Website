import { Moon, Sun, Laptop } from "lucide-react";
import clsx from "clsx";
import { useTheme, THEMES } from "../lib/theme.jsx";
import { useI18n } from "../lib/i18n.jsx";

const ICONS = { dark: Moon, light: Sun, auto: Laptop };

// Tombol ringkas di sidebar: berputar dark → light → auto.
export default function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const Icon = ICONS[theme] || Moon;
  const label = t(`settings.theme${theme === "light" ? "Light" : theme === "auto" ? "Auto" : "Dark"}`);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`${t("settings.theme")}: ${label}`}
      aria-label={`${t("settings.theme")}: ${label}`}
      className={clsx("inline-flex items-center gap-2 hover:text-fg transition-colors", className)}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
