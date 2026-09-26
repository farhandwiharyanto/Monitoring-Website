import { useEffect, useState } from "react";
import { Plus, Trash2, KeyRound, ShieldCheck, ShieldOff, Eye, X, Siren } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { fmtTime } from "../lib/format.js";

export default function Users() {
  const { user: me } = useAuth();
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null); // {username,password,role} | {id, password} (reset)
  const [error, setError] = useState("");
  // Notifikasi yang bisa dipakai sebagai kontak on-call pribadi
  const [notifs, setNotifs] = useState([]);

  const load = () => api("/users").then(setList);
  useEffect(() => { load(); api("/notifications").then(setNotifs).catch(() => setNotifs([])); }, []);

  const save = async (e) => {
    e.preventDefault(); setError("");
    try {
      if (form.id) await api(`/users/${form.id}`, { method: "PUT", body: { password: form.password } });
      else await api("/users", { method: "POST", body: form });
      setForm(null); load();
    } catch (err) { setError(err.message); }
  };
  const setRole = async (u, role) => {
    try { await api(`/users/${u.id}`, { method: "PUT", body: { role } }); load(); } catch (err) { alert(err.message); }
  };
  // Kontak on-call menentukan ke mana orang ini dipanggil saat sedang bertugas
  // dan sebuah tingkat eskalasi menunjuk jadwal rotasinya.
  const setContact = async (u, value) => {
    try { await api(`/users/${u.id}`, { method: "PUT", body: { oncall_notification_id: value || null } }); load(); }
    catch (err) { alert(err.message); }
  };
  // Untuk user yang kehilangan ponsel sekaligus kode cadangannya
  const reset2fa = async (u) => {
    if (!confirm(t("users.confirmReset2fa", { username: u.username }))) return;
    try { await api(`/users/${u.id}/2fa/reset`, { method: "POST" }); load(); } catch (err) { alert(err.message); }
  };
  const remove = async (u) => {
    if (!confirm(t("users.confirmDelete", { username: u.username }))) return;
    try { await api(`/users/${u.id}`, { method: "DELETE" }); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{t("users.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("users.subtitle")}</p>
        </div>
        <button className="btn-primary" onClick={() => { setForm({ username: "", password: "", role: "viewer" }); setError(""); }}><Plus size={16} /> {t("users.addUser")}</button>
      </div>

      <div className="card divide-y divide-border">
        {list.map((u) => (
          <div key={u.id} className="flex items-center gap-4 px-5 py-3.5">
            <span className="h-9 w-9 rounded-lg bg-panel2 grid place-items-center">
              {u.role === "admin" ? <ShieldCheck size={16} className="text-accent" /> : <Eye size={16} className="text-muted" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-fg">{u.username} {u.id === me.id && <span className="text-xs text-muted">{t("users.you")}</span>}</p>
              <p className="text-xs text-muted">{t("users.createdAt", { date: fmtTime(u.created_at) })}</p>
            </div>
            <Siren size={14} className={clsx("shrink-0", u.oncall_notification_id ? "text-accent" : "text-muted")} />
            <select
              className="input !w-auto !py-1.5 text-xs max-w-[11rem]"
              title={t("users.oncallContactHint")}
              value={u.oncall_notification_id ?? ""}
              onChange={(e) => setContact(u, e.target.value)}
            >
              <option value="">{t("users.noOncallContact")}</option>
              {notifs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <select
              className="input !w-auto !py-1.5 text-xs"
              value={u.role}
              disabled={u.id === me.id}
              onChange={(e) => setRole(u, e.target.value)}
            >
              <option value="admin">admin</option>
              <option value="viewer">viewer</option>
            </select>
            {u.totp_enabled && (
              <button className="btn-ghost !px-2.5" title={t("users.reset2fa")} onClick={() => reset2fa(u)}><ShieldOff size={14} /></button>
            )}
            <button className="btn-ghost !px-2.5" title={t("users.resetPassword")} onClick={() => { setForm({ id: u.id, username: u.username, password: "" }); setError(""); }}><KeyRound size={14} /></button>
            <button className="btn-danger !px-2.5" disabled={u.id === me.id} onClick={() => remove(u)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {form && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setForm(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-fg">{form.id ? t("users.resetTitle", { username: form.username }) : t("users.addUser")}</h2>
              <button type="button" onClick={() => setForm(null)} className="text-muted hover:text-fg"><X size={18} /></button>
            </div>
            {!form.id && (
              <div><label className="label">{t("users.username")}</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoFocus /></div>
            )}
            <div><label className="label">{form.id ? t("users.newPassword") : t("users.password")}</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
            {!form.id && (
              <div>
                <label className="label">{t("users.role")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {[["admin", "users.admin", "users.adminDesc"], ["viewer", "users.viewer", "users.viewerDesc"]].map(([v, labelKey, descKey]) => (
                    <button type="button" key={v} onClick={() => setForm({ ...form, role: v })} className={clsx("text-left rounded-lg border p-3", form.role === v ? "border-accent bg-accent/10" : "border-border")}>
                      <p className={clsx("text-sm font-medium", form.role === v ? "text-accent" : "text-fg2")}>{t(labelKey)}</p>
                      <p className="text-xs text-muted">{t(descKey)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-down">{error}</p>}
            <button className="btn-primary">{t("common.save")}</button>
          </form>
        </div>
      )}
    </div>
  );
}
