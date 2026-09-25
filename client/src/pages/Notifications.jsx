import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, Pencil, Send, X, History, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { fmtTime, timeAgo } from "../lib/format.js";

// Definisi field per provider: [key, label, placeholder, inputType]
const TYPES = {
  telegram: {
    label: "Telegram",
    fields: [["botToken", "Bot token", "123456:ABC-DEF…", "password"], ["chatId", "Chat ID", "-1001234567890"], ["threadId", "Thread ID (opsional)", ""]],
  },
  discord: { label: "Discord", fields: [["webhookUrl", "Webhook URL", "https://discord.com/api/webhooks/…"], ["username", "Nama pengirim (opsional)", "Pulsewatch"]] },
  slack: {
    label: "Slack",
    fields: [["webhookUrl", "Incoming webhook URL", "https://hooks.slack.com/services/…"], ["channel", "Channel (opsional)", "#ops"], ["username", "Nama pengirim (opsional)", "Pulsewatch"]],
  },
  googlechat: { label: "Google Chat", fields: [["webhookUrl", "Webhook URL", "https://chat.googleapis.com/v1/spaces/…"]] },
  ntfy: {
    label: "ntfy",
    fields: [["serverUrl", "Server", "https://ntfy.sh"], ["topic", "Topic", "pulsewatch-alerts"], ["token", "Access token (opsional)", "", "password"], ["priority", "Prioritas (1–5, opsional)", "3"]],
  },
  email: {
    label: "Email (SMTP)",
    fields: [["smtpHost", "SMTP host", "smtp.gmail.com"], ["smtpPort", "SMTP port", "587"], ["smtpUser", "Username", ""], ["smtpPass", "Password", "", "password"], ["from", "From", "pulsewatch@example.com"], ["to", "To", "ops@example.com"]],
  },
  webhook: { label: "Webhook", fields: [["url", "URL", "https://example.com/hook"]] },
};

const emptyForm = { name: "", type: "telegram", config: {}, is_default: false };

// Event pada riwayat kirim ditampilkan dalam bahasa manusia
const EVENT_KEY = {
  "monitor.down": "notif.eventDown",
  "monitor.up": "notif.eventUp",
  "monitor.cert_expiry": "notif.eventCert",
  "monitor.escalation": "notif.eventEscalation",
  test: "notif.eventTest",
};

// Status pengiriman terakhir sebuah channel. Tiga keadaan yang berbeda
// artinya: gagal (alert tidak sampai), pulih tapi sempat gagal hari ini,
// dan sehat. Channel yang belum pernah dipakai tidak diberi tanda apa pun
// supaya tidak terbaca seperti peringatan.
function DeliveryChip({ delivery, t }) {
  const d = delivery || {};
  if (d.last_ok === null || d.last_ok === undefined) {
    return <span className="text-xs text-muted">{t("notif.deliveryNever")}</span>;
  }
  const failing = d.last_ok === false;
  const shaky = !failing && d.failures_24h > 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 border",
        failing && "text-down border-down/40 bg-down/10",
        shaky && "text-pending border-pending/40 bg-pending/10",
        !failing && !shaky && "text-up border-up/30 bg-up/10"
      )}
      title={d.last_error || ""}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", failing ? "bg-down" : shaky ? "bg-pending" : "bg-up")} />
      {failing ? t("notif.deliveryFailed") : shaky ? t("notif.deliveryRecovered") : t("notif.deliveryOk")}
      {d.last_sent_at && <span className="text-muted">· {timeAgo(d.last_sent_at)}</span>}
    </span>
  );
}

export default function Notifications() {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // null | form object
  const [msg, setMsg] = useState(null);
  const [openLog, setOpenLog] = useState(null); // id channel yang riwayatnya dibuka
  const [logs, setLogs] = useState([]);

  const load = () => api("/notifications").then(setList);
  useEffect(() => { load(); }, []);

  // Riwayat diambil saat dibuka saja — daftar channel tidak perlu menunggunya
  const toggleLog = async (n) => {
    if (openLog === n.id) return setOpenLog(null);
    setOpenLog(n.id);
    setLogs([]);
    setLogs(await api(`/notifications/logs?notification_id=${n.id}&limit=20`));
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing.id) await api(`/notifications/${editing.id}`, { method: "PUT", body: editing });
      else await api("/notifications", { method: "POST", body: editing });
      setEditing(null); setMsg(null); load();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  const remove = async (n) => {
    if (!confirm(t("notif.confirmDelete", { name: n.name }))) return;
    await api(`/notifications/${n.id}`, { method: "DELETE" }); load();
  };
  const test = async (n) => {
    setMsg({ ok: true, text: t("common.sending") });
    try { await api("/notifications/test", { method: "POST", body: n }); setMsg({ ok: true, text: t("notif.testSent") }); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    // Hasil uji ikut tercatat, jadi badge dan riwayat yang terbuka disegarkan
    load();
    if (n.id && openLog === n.id) setLogs(await api(`/notifications/logs?notification_id=${n.id}&limit=20`));
  };

  // Channel yang pengiriman terakhirnya gagal — dipakai banner di atas daftar
  const failing = list.filter((n) => n.delivery?.last_ok === false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{t("notif.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("notif.subtitle")}</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing({ ...emptyForm }); setMsg(null); }}><Plus size={16} /> {t("common.add")}</button>
      </div>

      {msg && !editing && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}

      {/* Channel yang mati adalah kegagalan paling berbahaya di alat monitoring:
          semuanya tampak hijau justru karena alertnya tidak pernah sampai. */}
      {failing.length > 0 && (
        <div className="card border-down/40 bg-down/5 px-5 py-3.5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-down shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-down font-medium">{t("notif.deliveryBanner", { n: failing.length })}</p>
            <p className="text-xs text-muted mt-0.5 truncate">
              {failing.map((n) => n.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="card divide-y divide-border">
        {list.length === 0 && <p className="p-8 text-center text-sm text-muted">{t("notif.empty")}</p>}
        {list.map((n) => (
          <div key={n.id} className="px-5 py-3.5">
            <div className="flex items-center gap-4">
              <span className="h-9 w-9 rounded-lg bg-panel2 grid place-items-center shrink-0"><Bell size={16} className="text-accent" /></span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-fg">{n.name} {n.is_default && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent border border-accent/40 rounded px-1.5 py-0.5">{t("common.default")}</span>}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                  <span className="text-xs text-muted">{TYPES[n.type]?.label || n.type}</span>
                  <DeliveryChip delivery={n.delivery} t={t} />
                  {n.delivery?.failures_24h > 0 && (
                    <span className="text-xs text-muted">{t("notif.deliveryFailures", { n: n.delivery.failures_24h })}</span>
                  )}
                </div>
              </div>
              <button className={clsx("btn-ghost !px-2.5", openLog === n.id && "text-accent")} title={t("notif.history")} onClick={() => toggleLog(n)}><History size={14} /></button>
              <button className="btn-ghost !px-2.5" title={t("common.sendTest")} onClick={() => test(n)}><Send size={14} /></button>
              <button className="btn-ghost !px-2.5" onClick={() => { setEditing({ ...n }); setMsg(null); }}><Pencil size={14} /></button>
              <button className="btn-danger !px-2.5" onClick={() => remove(n)}><Trash2 size={14} /></button>
            </div>

            {openLog === n.id && (
              <div className="mt-3 ml-0 sm:ml-13 rounded-lg border border-border bg-panel2/50 divide-y divide-border">
                {logs.length === 0 && <p className="px-3 py-3 text-xs text-muted">{t("notif.historyEmpty")}</p>}
                {logs.map((row) => (
                  <div key={row.id} className="flex items-start gap-3 px-3 py-2 text-xs">
                    <span className={clsx("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", row.ok ? "bg-up" : "bg-down")} />
                    <span className="text-fg w-20 shrink-0">{t(EVENT_KEY[row.event] || "notif.eventTest")}</span>
                    <span className="text-muted flex-1 min-w-0 break-words">
                      {row.monitor_name && <span className="text-fg">{row.monitor_name} · </span>}
                      {row.ok ? `${row.duration_ms ?? "—"} ms` : row.error}
                      {row.attempts > 1 && <span> · {t("notif.historyAttempts", { n: row.attempts })}</span>}
                    </span>
                    <span className="text-muted shrink-0">{fmtTime(row.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted">{t("notif.retryHint")}</p>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setEditing(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-fg">{editing.id ? t("notif.formEdit") : t("notif.formNew")}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-muted hover:text-fg"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t("notif.name")}</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></div>
              <div><label className="label">{t("notif.type")}</label>
                <select className="input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value, config: {} })}>
                  {Object.entries(TYPES).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
                </select>
              </div>
            </div>
            {(TYPES[editing.type]?.fields || []).map(([key, label, ph, type]) => (
              <div key={key}><label className="label">{label}</label>
                <input className="input font-mono" type={type || "text"} placeholder={ph} value={editing.config[key] || ""} onChange={(e) => setEditing({ ...editing, config: { ...editing.config, [key]: e.target.value } })} />
              </div>
            ))}
            {editing.type === "email" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={!!editing.config.secure} onChange={(e) => setEditing({ ...editing, config: { ...editing.config, secure: e.target.checked } })} /> {t("notif.smtpTls")}</label>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} /> {t("notif.isDefault")}</label>
            {msg && <p className={clsx("text-sm", msg.ok ? "text-up" : "text-down")}>{msg.text}</p>}
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary">{t("common.save")}</button>
              <button type="button" className="btn-ghost" onClick={() => test(editing)}><Send size={14} /> {t("common.sendTest")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
