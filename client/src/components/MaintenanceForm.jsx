import { useState } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { toLocalInput } from "../lib/format.js";

// Modal buat/edit maintenance window. `initial` boleh berisi monitor_id (dari halaman detail).
export default function MaintenanceForm({ initial, monitors, onClose, onSaved }) {
  const { t, dayNames } = useI18n();
  const [f, setF] = useState(() => ({
    monitor_id: initial?.monitor_id || monitors[0]?.id || "",
    title: initial?.title || "",
    start_at: toLocalInput(initial?.start_at),
    end_at: toLocalInput(initial?.end_at || Date.now() + 3600_000),
    recurring: initial?.recurring || "none",
    days_of_week: initial?.days_of_week ? String(initial.days_of_week).split(",").filter(Boolean).map(Number) : [],
    active: initial?.active ?? true,
  }));
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleDay = (d) => setF((x) => ({ ...x, days_of_week: x.days_of_week.includes(d) ? x.days_of_week.filter((y) => y !== d) : [...x.days_of_week, d] }));

  const submit = async (e) => {
    e.preventDefault(); setError("");
    const body = { ...f, start_at: new Date(f.start_at).toISOString(), end_at: new Date(f.end_at).toISOString() };
    try {
      const saved = initial?.id ? await api(`/maintenance/${initial.id}`, { method: "PUT", body }) : await api("/maintenance", { method: "POST", body });
      onSaved(saved);
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-fg">{initial?.id ? t("maint.formEdit") : t("maint.formNew")}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div><label className="label">{t("maint.monitor")}</label>
          <select className="input" value={f.monitor_id} onChange={set("monitor_id")} disabled={!!initial?.monitor_id && !initial?.id}>
            {monitors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div><label className="label">{t("maint.titleField")}</label><input className="input" value={f.title} onChange={set("title")} placeholder={t("maint.titlePlaceholder")} required /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">{t("maint.start")}</label><input className="input" type="datetime-local" value={f.start_at} onChange={set("start_at")} required /></div>
          <div><label className="label">{t("maint.end")}</label><input className="input" type="datetime-local" value={f.end_at} onChange={set("end_at")} required /></div>
        </div>
        <div>
          <label className="label">{t("maint.recurring")}</label>
          <div className="grid grid-cols-3 gap-2">
            {[["none", "maint.once"], ["daily", "maint.daily"], ["weekly", "maint.weekly"]].map(([v, key]) => (
              <button type="button" key={v} onClick={() => setF({ ...f, recurring: v })} className={clsx("rounded-lg border px-3 py-2 text-sm", f.recurring === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>{t(key)}</button>
            ))}
          </div>
          {f.recurring !== "none" && <p className="text-xs text-muted mt-2">{t("maint.recurringHint")}</p>}
        </div>
        {f.recurring === "weekly" && (
          <div>
            <label className="label">{t("maint.days")}</label>
            <div className="flex gap-1.5">
              {dayNames.map((n, d) => (
                <button type="button" key={d} onClick={() => toggleDay(d)} className={clsx("h-9 w-11 rounded-lg border text-xs", f.days_of_week.includes(d) ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>{n}</button>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t("maint.activeField")}</label>
        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary">{t("common.save")}</button>
      </form>
    </div>
  );
}
