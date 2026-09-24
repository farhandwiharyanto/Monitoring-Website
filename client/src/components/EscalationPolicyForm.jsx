import { useState } from "react";
import { X, Plus, Trash2, ArrowDown } from "lucide-react";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";

// Policy disunting sebagai satu urutan utuh, bukan tingkat per tingkat: yang
// menentukan benar-tidaknya justru urutannya — jeda tiap tingkat harus sama atau
// lebih lama dari tingkat sebelumnya, dan itu hanya terbaca kalau dilihat bersama.
export default function EscalationPolicyForm({ initial, schedules, notifications, onClose, onSaved }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: "", description: "", is_default: false, active: true,
    ...initial,
    steps: (initial.steps || []).map((s) => ({
      delay_minutes: s.delay_minutes ?? 0,
      target: s.target || "oncall",
      schedule_id: s.schedule?.id ?? s.schedule_id ?? "",
      notification_id: s.notification?.id ?? s.notification_id ?? "",
    })),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setStep = (i, patch) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, x) => (x === i ? { ...s, ...patch } : s)) }));

  const addStep = () => {
    const last = form.steps[form.steps.length - 1];
    setForm((f) => ({
      ...f,
      steps: [
        ...f.steps,
        {
          // Tingkat baru mulai dari jeda tingkat sebelumnya + 5 menit, supaya
          // urutannya sudah sah tanpa perlu diperbaiki manual
          delay_minutes: last ? Number(last.delay_minutes || 0) + 5 : 0,
          target: "oncall",
          schedule_id: schedules[0]?.id ?? "",
          notification_id: "",
        },
      ],
    }));
  };

  const removeStep = (i) => setForm((f) => ({ ...f, steps: f.steps.filter((_, x) => x !== i) }));

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (form.steps.length === 0) return setError(t("esc.needStep"));
    setBusy(true);
    const body = {
      name: form.name,
      description: form.description || null,
      is_default: !!form.is_default,
      active: !!form.active,
      steps: form.steps.map((s) => ({
        delay_minutes: Number(s.delay_minutes) || 0,
        target: s.target,
        schedule_id: s.target === "oncall" ? Number(s.schedule_id) || null : null,
        notification_id: s.target === "channel" ? Number(s.notification_id) || null : null,
      })),
    };
    try {
      if (form.id) await api(`/oncall/policies/${form.id}`, { method: "PUT", body });
      else await api("/oncall/policies", { method: "POST", body });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl p-6 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-fg">{form.id ? form.name : t("esc.addPolicy")}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg"><X size={18} /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">{t("esc.policyName")}</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
          <div><label className="label">{t("oncall.description")}</label><input className="input" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-accent" checked={!!form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            {t("esc.isDefault")}
          </label>
          <p className="text-xs text-muted mt-1 ml-6">{t("esc.isDefaultHint")}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="label !mb-0">{t("esc.steps")}</label>
            <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={addStep}><Plus size={13} /> {t("esc.addStep")}</button>
          </div>

          {form.steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-accent font-medium shrink-0">{t("esc.level", { n: i + 1 })}</span>
                {i > 0 && <ArrowDown size={12} className="text-muted" />}
                <span className="flex-1" />
                <button type="button" className="btn-danger !px-2 !py-1" onClick={() => removeStep(i)}><Trash2 size={12} /></button>
              </div>

              <div className="grid md:grid-cols-3 gap-2">
                <div>
                  <label className="label !text-[11px]">{t("esc.delay")} ({t("esc.delayUnit")})</label>
                  <input
                    className="input !py-1.5" type="number" min="0" max="10080"
                    value={s.delay_minutes}
                    onChange={(e) => setStep(i, { delay_minutes: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label !text-[11px]">{t("esc.target")}</label>
                  <select className="input !py-1.5" value={s.target} onChange={(e) => setStep(i, { target: e.target.value })}>
                    <option value="oncall">{t("esc.targetOncall")}</option>
                    <option value="channel">{t("esc.targetChannel")}</option>
                  </select>
                </div>
                <div>
                  <label className="label !text-[11px]">{s.target === "oncall" ? t("esc.pickSchedule") : t("esc.pickNotification")}</label>
                  {s.target === "oncall" ? (
                    <select className="input !py-1.5" value={s.schedule_id} onChange={(e) => setStep(i, { schedule_id: e.target.value })} required>
                      <option value="">—</option>
                      {schedules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  ) : (
                    <select className="input !py-1.5" value={s.notification_id} onChange={(e) => setStep(i, { notification_id: e.target.value })} required>
                      <option value="">—</option>
                      {notifications.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-muted">{t("esc.delayOrderHint")}</p>
        </div>

        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
      </form>
    </div>
  );
}
