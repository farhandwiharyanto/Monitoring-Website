import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";
import clsx from "clsx";
import { api, setToken } from "../lib/api.js";
import { reconnectWithToken } from "../lib/socket.js";
import { useI18n } from "../lib/i18n.jsx";

// 2FA milik user yang sedang login. Alurnya: password → pindai QR → satu kode
// benar → kode cadangan ditampilkan sekali. Mematikannya butuh password + kode.
export default function TwoFactor() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(null); // null | "password" | "scan" | "codes" | "disable" | "regen"
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () => api("/auth/2fa").then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  const reset = (next = null) => { setStep(next); setPassword(""); setCode(""); setError(""); };
  const run = (fn) => async (e) => {
    e.preventDefault();
    setError("");
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const startSetup = run(async () => {
    setSetup(await api("/auth/2fa/setup", { method: "POST", body: { password } }));
    reset("scan");
  });
  const enable = run(async () => {
    const res = await api("/auth/2fa/enable", { method: "POST", body: { code } });
    // Sesi lain dibatalkan server; sesi ini lanjut dengan token baru
    setToken(res.token);
    reconnectWithToken();
    setCodes(res.recovery_codes);
    setSetup(null);
    reset("codes");
    load();
  });
  const disable = run(async () => {
    await api("/auth/2fa/disable", { method: "POST", body: { password, code } });
    reset();
    load();
  });
  const regen = run(async () => {
    const res = await api("/auth/2fa/recovery", { method: "POST", body: { password } });
    setCodes(res.recovery_codes);
    reset("codes");
    load();
  });

  const copy = async () => {
    await navigator.clipboard.writeText(codes.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!status) return null;

  const passwordField = (
    <div>
      <label className="label">{t("settings.currentPassword")}</label>
      <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="current-password" />
    </div>
  );
  const codeField = (
    <div>
      <label className="label">{t("twofa.code")}</label>
      <input className="input font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} required
        inputMode={step === "scan" ? "numeric" : "text"} autoComplete="one-time-code" placeholder="123456" />
    </div>
  );
  const actions = (label, danger = false) => (
    <div className="flex gap-2">
      <button className={danger ? "btn-danger" : "btn-primary"}>{label}</button>
      <button type="button" className="btn-ghost" onClick={() => { setSetup(null); reset(); }}>{t("common.cancel")}</button>
    </div>
  );

  return (
    <section className="card p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-fg flex items-center gap-2">
          {status.enabled ? <ShieldCheck size={16} className="text-up" /> : <ShieldOff size={16} className="text-muted" />}
          {t("twofa.title")}
        </h2>
        <span className={clsx("text-xs font-medium", status.enabled ? "text-up" : "text-muted")}>
          {status.enabled ? t("twofa.on") : t("twofa.off")}
        </span>
      </div>
      <p className="text-sm text-muted">{t("twofa.hint")}</p>

      {!step && !status.enabled && (
        <button className="btn-primary" onClick={() => reset("password")}>{t("twofa.enable")}</button>
      )}
      {!step && status.enabled && (
        <>
          <p className={clsx("text-sm", status.recovery_remaining <= 2 ? "text-down" : "text-fg2")}>
            {t("twofa.remaining", { n: status.recovery_remaining })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => reset("regen")}>{t("twofa.regen")}</button>
            <button className="btn-danger" onClick={() => reset("disable")}>{t("twofa.disable")}</button>
          </div>
        </>
      )}

      {step === "password" && (
        <form onSubmit={startSetup} className="space-y-3">{passwordField}{error && <p className="text-sm text-down">{error}</p>}{actions(t("twofa.next"))}</form>
      )}

      {step === "scan" && setup && (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-sm text-fg2">{t("twofa.scan")}</p>
          {/* SVG dibuat server dari URL otpauth, bukan dari masukan pengguna */}
          <div className="w-44 h-44 rounded-lg bg-white p-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
          <p className="text-xs text-muted">{t("twofa.manual")} <code className="font-mono text-fg2 break-all">{setup.secret}</code></p>
          {codeField}
          {error && <p className="text-sm text-down">{error}</p>}
          {actions(t("twofa.verify"))}
        </form>
      )}

      {step === "codes" && codes && (
        <div className="space-y-3">
          <p className="text-sm text-fg2">{t("twofa.codesHint")}</p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border p-3 font-mono text-sm text-fg">
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {t("twofa.copy")}</button>
            <button type="button" className="btn-primary" onClick={() => { setCodes(null); reset(); }}>{t("twofa.saved")}</button>
          </div>
        </div>
      )}

      {step === "disable" && (
        <form onSubmit={disable} className="space-y-3">{passwordField}{codeField}{error && <p className="text-sm text-down">{error}</p>}{actions(t("twofa.disable"), true)}</form>
      )}

      {step === "regen" && (
        <form onSubmit={regen} className="space-y-3">
          <p className="text-sm text-muted">{t("twofa.regenHint")}</p>
          {passwordField}{error && <p className="text-sm text-down">{error}</p>}{actions(t("twofa.regen"))}
        </form>
      )}
    </section>
  );
}
