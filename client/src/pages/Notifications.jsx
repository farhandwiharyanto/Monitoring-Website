import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, Pencil, Send, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";

const TYPES = {
  telegram: { label: "Telegram", fields: [["botToken", "Bot token", "123456:ABC-DEF…"], ["chatId", "Chat ID", "-1001234567890"]] },
  discord: { label: "Discord", fields: [["webhookUrl", "Webhook URL", "https://discord.com/api/webhooks/…"]] },
  email: { label: "Email (SMTP)", fields: [["smtpHost", "SMTP host", "smtp.gmail.com"], ["smtpPort", "SMTP port", "587"], ["smtpUser", "Username", ""], ["smtpPass", "Password", "", "password"], ["from", "From", "pulsewatch@example.com"], ["to", "To", "ops@example.com"]] },
  webhook: { label: "Webhook", fields: [["url", "URL", "https://example.com/hook"]] },
};

const emptyForm = { name: "", type: "telegram", config: {}, is_default: false };

export default function Notifications() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // null | form object
  const [msg, setMsg] = useState(null);

  const load = () => api("/notifications").then(setList);
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/notifications/${editing.id}`, { method: "PUT", body: editing });
      else await api("/notifications", { method: "POST", body: editing });
      setEditing(null); setMsg(null); load();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  const remove = async (n) => {
    if (!confirm(`Hapus notifikasi "${n.name}"?`)) return;
    await api(`/notifications/${n.id}`, { method: "DELETE" }); load();
  };
  const test = async (n) => {
    setMsg({ ok: true, text: "Mengirim…" });
    try { await api("/notifications/test", { method: "POST", body: n }); setMsg({ ok: true, text: "Pesan uji terkirim ✓" }); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Notifikasi</h1>
          <p className="text-sm text-muted mt-1">Channel yang dipakai saat monitor down / recover</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing({ ...emptyForm }); setMsg(null); }}><Plus size={16} /> Tambah</button>
      </div>

      {msg && !editing && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}

      <div className="card divide-y divide-border">
        {list.length === 0 && <p className="p-8 text-center text-sm text-muted">Belum ada channel notifikasi.</p>}
        {list.map((n) => (
          <div key={n.id} className="flex items-center gap-4 px-5 py-3.5">
            <span className="h-9 w-9 rounded-lg bg-panel2 grid place-items-center"><Bell size={16} className="text-accent" /></span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-100">{n.name} {n.is_default && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent border border-accent/40 rounded px-1.5 py-0.5">default</span>}</p>
              <p className="text-xs text-muted">{TYPES[n.type]?.label}</p>
            </div>
            <button className="btn-ghost !px-2.5" title="Kirim uji" onClick={() => test(n)}><Send size={14} /></button>
            <button className="btn-ghost !px-2.5" onClick={() => { setEditing({ ...n }); setMsg(null); }}><Pencil size={14} /></button>
            <button className="btn-danger !px-2.5" onClick={() => remove(n)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setEditing(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-white">{editing.id ? "Edit" : "Tambah"} notifikasi</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-muted hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Nama</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></div>
              <div><label className="label">Tipe</label>
                <select className="input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value, config: {} })}>
                  {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {TYPES[editing.type].fields.map(([key, label, ph, type]) => (
              <div key={key}><label className="label">{label}</label>
                <input className="input font-mono" type={type || "text"} placeholder={ph} value={editing.config[key] || ""} onChange={(e) => setEditing({ ...editing, config: { ...editing.config, [key]: e.target.value } })} />
              </div>
            ))}
            {editing.type === "email" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-sky-400" checked={!!editing.config.secure} onChange={(e) => setEditing({ ...editing, config: { ...editing.config, secure: e.target.checked } })} /> Gunakan TLS implicit (port 465)</label>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-sky-400" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} /> Default — otomatis dipakai semua monitor</label>
            {msg && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary">Simpan</button>
              <button type="button" className="btn-ghost" onClick={() => test(editing)}><Send size={14} /> Kirim uji</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
