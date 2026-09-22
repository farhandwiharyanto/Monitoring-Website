import { useState } from "react";
import { Download, Languages, Moon, Sun, Laptop, Check } from "lucide-react";
import clsx from "clsx";
import { api, download, setToken } from "../lib/api.js";
import { useI18n, LANGUAGES } from "../lib/i18n.jsx";
import { useTheme, THEMES } from "../lib/theme.jsx";
import { useAuth } from "../lib/auth.jsx";
import { reconnectWithToken } from "../lib/socket.js";

const THEME_ICONS = { dark: Moon, light: Sun, auto: Laptop };
const THEME_KEYS = { dark: "settings.themeDark", light: "settings.themeLight", auto: "settings.themeAuto" };

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { isAdmin } = useAuth();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState(null);
  const [savedDefault, setSavedDefault] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return setMsg({ ok: false, text: t("settings.mismatch") });
    if (f.newPassword.length < 8) return setMsg({ ok: false, text: t("settings.minLength") });
    try {
      const res = await api("/auth/change-password", { method: "POST", body: f });
      // Token lama sudah dibatalkan server; pakai token baru agar sesi ini tetap hidup
      if (res.token) { setToken(res.token); reconnectWithToken(); }
      setMsg({ ok: true, text: t("settings.passwordChanged") });
      setF({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  // Admin bisa menetapkan pilihan saat ini sebagai default untuk user baru
  const saveAsDefault = async () => {
    try {
      await api("/settings", { method: "PUT", body: { language: lang, theme } });
      setSavedDefault(true);
      setTimeout(() => setSavedDefault(false), 2000);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  const grab = async (path) => {
    setExportMsg(null);
    try { await download(path); } catch (err) { setExportMsg(`${t("settings.exportFailed")}: ${err.message}`); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-fg">{t("settings.title")}</h1>
        <p className="text-sm text-muted mt-1">{t("settings.subtitle")}</p>
      </div>

      <section className="card p-6 space-y-5">
        <h2 className="font-medium text-fg flex items-center gap-2"><Languages size={16} className="text-accent" /> {t("settings.appearance")}</h2>

        <div>
          <label className="label">{t("settings.language")}</label>
          <div className="grid grid-cols-2 gap-2">
            {LANGUAGES.map((l) => (
              <button type="button" key={l.code} onClick={() => setLang(l.code)}
                className={clsx("rounded-lg border px-3 py-2 text-sm", lang === l.code ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">{t("settings.theme")}</label>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((v) => {
              const Icon = THEME_ICONS[v];
              return (
                <button type="button" key={v} onClick={() => setTheme(v)}
                  className={clsx("rounded-lg border px-3 py-2 text-sm inline-flex items-center justify-center gap-2", theme === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>
                  <Icon size={15} /> {t(THEME_KEYS[v])}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted">{t("settings.defaultHint")}</p>
        {isAdmin && (
          <button type="button" className="btn-ghost" onClick={saveAsDefault}>
            {savedDefault ? <><Check size={15} className="text-up" /> {t("settings.savedDefault")}</> : t("settings.saveAsDefault")}
          </button>
        )}
      </section>

      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-medium text-fg flex items-center gap-2"><Download size={16} className="text-accent" /> {t("settings.exportTitle")}</h2>
          <p className="text-sm text-muted mt-1">{t("settings.exportSubtitle")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" className="btn-ghost justify-start" onClick={() => grab("/export/monitors?format=csv")}>
            <Download size={14} /> {t("settings.exportMonitors")} (CSV)
          </button>
          <button type="button" className="btn-ghost justify-start" onClick={() => grab("/export/heartbeats?format=csv&hours=168")}>
            <Download size={14} /> {t("settings.exportHeartbeats")} (CSV)
          </button>
          <button type="button" className="btn-ghost justify-start" onClick={() => grab("/export/incidents?format=csv")}>
            <Download size={14} /> {t("settings.exportIncidents")} (CSV)
          </button>
          {isAdmin && (
            <button type="button" className="btn-ghost justify-start" onClick={() => grab("/export/config")}>
              <Download size={14} /> {t("settings.exportConfig")} (JSON)
            </button>
          )}
        </div>
        {isAdmin && <p className="text-xs text-muted">{t("settings.exportConfigHint")}</p>}
        {exportMsg && <p className="text-sm text-down">{exportMsg}</p>}
      </section>

      <form onSubmit={submit} className="card p-6 space-y-4">
        <h2 className="font-medium text-fg">{t("settings.changePassword")}</h2>
        <div><label className="label">{t("settings.currentPassword")}</label><input className="input" type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required autoComplete="current-password" /></div>
        <div><label className="label">{t("settings.newPassword")}</label><input className="input" type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required minLength={8} autoComplete="new-password" /></div>
        <div><label className="label">{t("settings.confirm")}</label><input className="input" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required autoComplete="new-password" /></div>
        {msg && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}
        <button className="btn-primary">{t("common.save")}</button>
      </form>
    </div>
  );
}
