import { useState } from "react";
import { Activity } from "lucide-react";
import { api, setToken } from "../lib/api.js";
import { reconnectWithToken } from "../lib/socket.js";
import { useI18n } from "../lib/i18n.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function Login({ onLogin }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Diisi setelah server menjawab bahwa akun ini memakai 2FA
  const [code, setCode] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { username, password, code: code || undefined }, auth: false });
      setToken(token);
      reconnectWithToken();
      onLogin(user);
    } catch (err) {
      if (err.data?.requires_2fa && code === null) {
        setCode("");
        setError("");
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-[radial-gradient(ellipse_at_top,rgb(var(--c-accent)/0.10),transparent_60%)]">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 space-y-5">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-accent/15 grid place-items-center"><Activity className="text-accent" /></span>
          <div>
            <h1 className="text-lg font-semibold text-fg">Pulsewatch</h1>
            <p className="text-xs text-muted">{t("login.subtitle")}</p>
          </div>
        </div>
        <div>
          <label className="label">{t("login.username")}</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div>
          <label className="label">{t("login.password")}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {code !== null && (
          <div>
            <label className="label">{t("twofa.code")}</label>
            <input className="input font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" placeholder="123456" />
            <p className="text-xs text-muted mt-1">{t("twofa.loginHint")}</p>
          </div>
        )}
        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy}>{busy ? t("login.busy") : t("login.submit")}</button>
        <div className="flex justify-center text-xs text-muted pt-1"><ThemeToggle /></div>
      </form>
    </div>
  );
}
