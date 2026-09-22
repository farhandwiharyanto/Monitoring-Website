import { useEffect, useState } from "react";
import { KeyRound, Plus, Copy, Check, Ban, Trash2, X, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { fmtTime, timeAgo } from "../lib/format.js";

const SCOPES = [
  ["read", "apikeys.scopeRead", "apikeys.scopeReadDesc"],
  ["write", "apikeys.scopeWrite", "apikeys.scopeWriteDesc"],
];

export default function ApiKeys() {
  const { t } = useI18n();
  const [keys, setKeys] = useState([]);
  const [limit, setLimit] = useState(null);
  const [form, setForm] = useState(null);        // { label, scope } saat modal terbuka
  const [created, setCreated] = useState(null);  // kunci penuh, hanya ada sesaat di memori
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    api("/api-keys")
      .then((d) => { setKeys(d.keys); setLimit(d.rate_limit); })
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setError("");
    try {
      const res = await api("/api-keys", { method: "POST", body: form });
      setForm(null);
      setCreated(res);   // satu-satunya kesempatan menampilkan kunci penuh
      load();
    } catch (err) { setError(err.message); }
  };
  const revoke = async (k) => {
    if (!confirm(t("apikeys.revokeConfirm", { label: k.label }))) return;
    try { await api(`/api-keys/${k.id}/revoke`, { method: "POST" }); load(); } catch (err) { setError(err.message); }
  };
  const remove = async (k) => {
    if (!confirm(t("apikeys.deleteConfirm", { label: k.label }))) return;
    try { await api(`/api-keys/${k.id}`, { method: "DELETE" }); load(); } catch (err) { setError(err.message); }
  };
  const copy = () => {
    navigator.clipboard.writeText(created.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium text-fg flex items-center gap-2"><KeyRound size={16} className="text-accent" /> {t("apikeys.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("apikeys.subtitle")}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => { setForm({ label: "", scope: "read" }); setError(""); }}>
          <Plus size={16} /> {t("apikeys.create")}
        </button>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-muted">{t("apikeys.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((k) => (
            <li key={k.id} className="py-3 flex items-center gap-3 flex-wrap">
              <span className={clsx("h-8 w-8 rounded-lg grid place-items-center shrink-0", k.active ? "bg-panel2" : "bg-down/10")}>
                <KeyRound size={14} className={k.active ? "text-accent" : "text-down"} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg flex items-center gap-2 flex-wrap">
                  {k.label}
                  <span className={clsx("text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border",
                    k.scope === "write" ? "text-pending border-pending/40" : "text-muted border-border")}>
                    {t(k.scope === "write" ? "apikeys.scopeWrite" : "apikeys.scopeRead")}
                  </span>
                  {!k.active && <span className="text-[10px] uppercase tracking-wider text-down border border-down/40 rounded px-1.5 py-0.5">{t("apikeys.revoked")}</span>}
                </p>
                <p className="text-xs text-muted font-mono">
                  {k.prefix}…
                  <span className="ml-2 font-sans">
                    {k.last_used_at ? t("apikeys.lastUsed", { when: timeAgo(k.last_used_at) }) : t("apikeys.neverUsed")}
                    {k.created_by ? ` · ${t("apikeys.createdBy", { by: k.created_by })}` : ""}
                  </span>
                </p>
              </div>
              {k.active && (
                <button type="button" className="btn-ghost !px-2.5" title={t("apikeys.revoke")} onClick={() => revoke(k)}>
                  <Ban size={14} />
                </button>
              )}
              <button type="button" className="btn-danger !px-2.5" onClick={() => remove(k)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      {limit && <p className="text-xs text-muted">{t("apikeys.rateLimit", { max: limit.max_requests, window: limit.window_seconds })}</p>}
      <p className="text-xs text-muted flex items-start gap-1.5"><ShieldAlert size={13} className="mt-0.5 shrink-0" /> {t("apikeys.restricted")}</p>

      <div>
        <p className="label !mb-1">{t("apikeys.usage")}</p>
        <code className="block rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono text-fg2 overflow-x-auto">
          curl -H &quot;Authorization: Bearer $PULSEWATCH_KEY&quot; {window.location.origin}/api/monitors
        </code>
      </div>

      {error && <p className="text-sm text-down">{error}</p>}

      {/* Modal pembuatan */}
      {form && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setForm(null)}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-fg">{t("apikeys.create")}</h3>
              <button type="button" onClick={() => setForm(null)} className="text-muted hover:text-fg"><X size={18} /></button>
            </div>
            <div>
              <label className="label">{t("apikeys.label")}</label>
              <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t("apikeys.labelPlaceholder")} required autoFocus />
            </div>
            <div>
              <label className="label">{t("apikeys.scope")}</label>
              <div className="grid grid-cols-2 gap-2">
                {SCOPES.map(([v, labelKey, descKey]) => (
                  <button type="button" key={v} onClick={() => setForm({ ...form, scope: v })}
                    className={clsx("text-left rounded-lg border p-3", form.scope === v ? "border-accent bg-accent/10" : "border-border")}>
                    <p className={clsx("text-sm font-medium", form.scope === v ? "text-accent" : "text-fg2")}>{t(labelKey)}</p>
                    <p className="text-xs text-muted">{t(descKey)}</p>
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <button className="btn-primary">{t("common.create")}</button>
          </form>
        </div>
      )}

      {/* Kunci penuh ditampilkan sekali saja */}
      {created && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="card w-full max-w-lg p-6 space-y-4">
            <h3 className="font-medium text-fg">{created.label}</h3>
            <p className="rounded-lg border border-pending/40 bg-pending/10 text-pending text-sm px-3 py-2">{t("apikeys.createdOnce")}</p>
            <code className="block rounded-lg border border-border bg-bg px-3 py-3 text-xs font-mono text-fg break-all">{created.key}</code>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={copy}>
                {copied ? <><Check size={15} /> {t("apikeys.copied")}</> : <><Copy size={15} /> {t("apikeys.copyKey")}</>}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setCreated(null); setCopied(false); }}>{t("common.close")}</button>
            </div>
            <p className="text-xs text-muted">{fmtTime(created.created_at)}</p>
          </div>
        </div>
      )}
    </section>
  );
}
