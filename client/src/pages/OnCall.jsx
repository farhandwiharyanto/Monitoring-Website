import { useEffect, useState } from "react";
import { Siren, Plus, Trash2, Pencil, CalendarClock, UserCheck, UserX, X, ChevronDown, ChevronRight, ListOrdered } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { fmtTime, toLocalInput } from "../lib/format.js";
import EscalationPolicyForm from "../components/EscalationPolicyForm.jsx";

// Jadwal rotasi dan escalation policy tinggal berdampingan: keduanya menjawab
// pertanyaan yang sama dari dua sisi — siapa yang bertugas, dan siapa lagi yang
// dipanggil kalau tidak ada yang menangani.
export default function OnCall() {
  const { isAdmin } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState("schedules");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg flex items-center gap-2">
          <Siren size={20} className="text-accent" /> {t("oncall.title")}
        </h1>
        <p className="text-sm text-muted mt-1">{t("oncall.subtitle")}</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {[["schedules", "oncall.tabSchedules"], ["policies", "oncall.tabPolicies"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2 text-sm -mb-px border-b-2 transition-colors",
              tab === key ? "border-accent text-accent" : "border-transparent text-fg3 hover:text-fg"
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {tab === "schedules" ? <Schedules isAdmin={isAdmin} /> : <Policies isAdmin={isAdmin} />}
    </div>
  );
}

// --- Jadwal rotasi ---

function Schedules({ isAdmin }) {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null); // id jadwal yang shift-nya sedang dibuka

  const load = () => api("/oncall/schedules").then(setList);
  useEffect(() => { load(); }, []);

  const remove = async (s) => {
    if (!confirm(t("oncall.confirmDeleteSchedule", { name: s.name }))) return;
    await api(`/oncall/schedules/${s.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted">{t("oncall.overlapHint")}</p>
        {isAdmin && (
          <button className="btn-primary shrink-0 self-start" onClick={() => setForm({ name: "", timezone: "Asia/Jakarta", description: "" })}>
            <Plus size={16} /> {t("oncall.addSchedule")}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {list.length === 0 && <p className="card p-8 text-center text-sm text-muted">{t("oncall.schedulesEmpty")}</p>}
        {list.map((s) => (
          <div key={s.id} className="card">
            <div className="flex items-center gap-4 px-5 py-4">
              <button
                className="h-9 w-9 rounded-lg bg-panel2 grid place-items-center text-muted hover:text-accent shrink-0"
                onClick={() => setOpen(open === s.id ? null : s.id)}
              >
                {open === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-fg flex items-center gap-2 flex-wrap">
                  {s.name}
                  <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{s.timezone}</span>
                  {!s.active && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{t("common.inactive")}</span>}
                </p>
                <OnDuty shift={s.current} next={s.next} />
              </div>
              {isAdmin && (
                <>
                  <button className="btn-ghost !px-2.5" onClick={() => setForm(s)}><Pencil size={14} /></button>
                  <button className="btn-danger !px-2.5" onClick={() => remove(s)}><Trash2 size={14} /></button>
                </>
              )}
            </div>
            {open === s.id && <Shifts schedule={s} isAdmin={isAdmin} onChanged={load} />}
          </div>
        ))}
      </div>

      {form && <ScheduleForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

// Baris "bertugas sekarang" — juga menandai orang yang belum punya kontak,
// karena tanpa kontak dia tidak akan pernah benar-benar dipanggil.
function OnDuty({ shift, next }) {
  const { t } = useI18n();
  return (
    <div className="text-xs mt-0.5 space-y-0.5">
      {shift ? (
        <p className={clsx("flex items-center gap-1.5", shift.has_contact ? "text-up" : "text-pending")}>
          {shift.has_contact ? <UserCheck size={12} /> : <UserX size={12} />}
          <span className="text-fg2">{t("oncall.onDutyNow")}: <span className="font-medium">{shift.username}</span></span>
          <span className="text-muted">
            {shift.has_contact ? t("oncall.contactVia", { name: shift.contact.name }) : t("oncall.noContact")}
            {" · "}{t("oncall.until", { time: fmtTime(shift.end_at) })}
          </span>
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-muted"><UserX size={12} /> {t("oncall.nobodyOnDuty")}</p>
      )}
      <p className="text-muted">
        {t("oncall.nextShift")}: {next ? `${next.username} · ${fmtTime(next.start_at)}` : t("oncall.noNextShift")}
      </p>
    </div>
  );
}

function Shifts({ schedule, isAdmin, onChanged }) {
  const { t } = useI18n();
  const [shifts, setShifts] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);

  const load = () => api(`/oncall/schedules/${schedule.id}/shifts`).then(setShifts);
  useEffect(() => {
    load();
    // Daftar user hanya terbaca admin; viewer tetap bisa melihat shift-nya
    if (isAdmin) api("/users").then(setUsers).catch(() => setUsers([]));
  }, [schedule.id]);

  const remove = async (s) => {
    if (!confirm(t("oncall.confirmDeleteShift", { username: s.username }))) return;
    await api(`/oncall/shifts/${s.id}`, { method: "DELETE" });
    load(); onChanged();
  };

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted">{t("oncall.shiftsOf", { name: schedule.name })}</p>
        {isAdmin && (
          <button
            className="btn-ghost !py-1 !px-2 text-xs"
            onClick={() => setForm({ user_id: users[0]?.id ?? "", start_at: toLocalInput(new Date()), end_at: toLocalInput(new Date(Date.now() + 7 * 86400_000)), note: "" })}
          >
            <Plus size={13} /> {t("oncall.addShift")}
          </button>
        )}
      </div>

      {shifts.length === 0 ? (
        <p className="text-sm text-muted">{t("oncall.shiftsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shifts.map((s) => (
            <li key={s.id} className="py-2 flex items-center gap-3 text-sm">
              <CalendarClock size={14} className="text-muted shrink-0" />
              <span className="font-medium text-fg2 shrink-0">{s.username}</span>
              <span className="text-xs text-muted flex-1 min-w-0 truncate">
                {fmtTime(s.start_at)} → {fmtTime(s.end_at)}
                {s.note && ` · ${s.note}`}
              </span>
              {!s.has_contact && <span className="text-[10px] text-pending border border-pending/40 rounded px-1.5 py-0.5 shrink-0">{t("oncall.noContact")}</span>}
              {isAdmin && <button className="btn-danger !px-2 !py-1" onClick={() => remove(s)}><Trash2 size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">{t("oncall.contactHint")}</p>

      {form && (
        <ShiftForm
          initial={form} users={users} scheduleId={schedule.id}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

// --- Modal ---

function Modal({ title, onClose, onSubmit, error, children }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-fg">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg"><X size={18} /></button>
        </div>
        {children}
        {error && <p className="text-sm text-down">{error}</p>}
        <button className="btn-primary">{t("common.save")}</button>
      </form>
    </div>
  );
}

function ScheduleForm({ initial, onClose, onSaved }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: "", timezone: "Asia/Jakarta", description: "", ...initial });
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault(); setError("");
    const body = { name: form.name, timezone: form.timezone, description: form.description || null };
    try {
      if (form.id) await api(`/oncall/schedules/${form.id}`, { method: "PUT", body });
      else await api("/oncall/schedules", { method: "POST", body });
      onSaved();
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={form.id ? form.name : t("oncall.addSchedule")} onClose={onClose} onSubmit={save} error={error}>
      <div><label className="label">{t("oncall.scheduleName")}</label><input className="input" value={form.name} onChange={set("name")} required autoFocus /></div>
      <div>
        <label className="label">{t("oncall.timezone")}</label>
        <input className="input font-mono" value={form.timezone} onChange={set("timezone")} placeholder="Asia/Jakarta" />
      </div>
      <div><label className="label">{t("oncall.description")}</label><input className="input" value={form.description || ""} onChange={set("description")} /></div>
    </Modal>
  );
}

function ShiftForm({ initial, users, scheduleId, onClose, onSaved }) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault(); setError("");
    try {
      await api(`/oncall/schedules/${scheduleId}/shifts`, {
        method: "POST",
        body: {
          user_id: Number(form.user_id),
          // datetime-local memberi waktu lokal tanpa zona; server menyimpan UTC
          start_at: new Date(form.start_at).toISOString(),
          end_at: new Date(form.end_at).toISOString(),
          note: form.note || null,
        },
      });
      onSaved();
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={t("oncall.addShift")} onClose={onClose} onSubmit={save} error={error}>
      <div>
        <label className="label">{t("oncall.shiftUser")}</label>
        <select className="input" value={form.user_id} onChange={set("user_id")} required>
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}{u.oncall_notification ? ` · ${u.oncall_notification.name}` : ` · ${t("oncall.noContact")}`}
            </option>
          ))}
        </select>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div><label className="label">{t("oncall.shiftStart")}</label><input className="input" type="datetime-local" value={form.start_at} onChange={set("start_at")} required /></div>
        <div><label className="label">{t("oncall.shiftEnd")}</label><input className="input" type="datetime-local" value={form.end_at} onChange={set("end_at")} required /></div>
      </div>
      <div><label className="label">{t("oncall.note")}</label><input className="input" value={form.note || ""} onChange={set("note")} /></div>
    </Modal>
  );
}

// --- Escalation policy ---

function Policies({ isAdmin }) {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api("/oncall/policies").then(setList);
  useEffect(() => {
    load();
    api("/oncall/schedules").then(setSchedules).catch(() => setSchedules([]));
    // Notifikasi berisi kredensial → hanya admin yang boleh membacanya
    if (isAdmin) api("/notifications").then(setNotifications).catch(() => setNotifications([]));
  }, []);

  const remove = async (p) => {
    if (!confirm(t("esc.confirmDelete", { name: p.name }))) return;
    await api(`/oncall/policies/${p.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted">{t("esc.subtitle")}</p>
        {isAdmin && (
          <button className="btn-primary shrink-0 self-start" onClick={() => setEditing({ name: "", is_default: list.length === 0, steps: [] })}>
            <Plus size={16} /> {t("esc.addPolicy")}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {list.length === 0 && <p className="card p-8 text-center text-sm text-muted">{t("esc.policiesEmpty")}</p>}
        {list.map((p) => (
          <div key={p.id} className="card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-lg bg-panel2 grid place-items-center shrink-0">
                <ListOrdered size={16} className="text-accent" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-fg flex items-center gap-2 flex-wrap">
                  {p.name}
                  {p.is_default && <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/40 rounded px-1.5 py-0.5">{t("esc.defaultBadge")}</span>}
                  {!p.active && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{t("common.inactive")}</span>}
                </p>
                <p className="text-xs text-muted">
                  {p.monitor_count
                    ? t("esc.usedBy", { n: p.monitor_count })
                    : p.is_default
                      ? t("esc.usedByDefault")
                      : t("esc.usedByNone")}
                  {p.description ? ` · ${p.description}` : ""}
                </p>
              </div>
              {isAdmin && (
                <>
                  <button className="btn-ghost !px-2.5" onClick={() => setEditing(p)}><Pencil size={14} /></button>
                  <button className="btn-danger !px-2.5" onClick={() => remove(p)}><Trash2 size={14} /></button>
                </>
              )}
            </div>

            <ol className="space-y-1.5 border-l-2 border-accent/30 pl-3 ml-4">
              {p.steps.map((s) => (
                <li key={s.id} className="text-sm flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs text-accent font-medium shrink-0">
                    {s.delay_minutes === 0 ? t("esc.immediately") : t("esc.afterMinutes", { n: s.delay_minutes })}
                  </span>
                  <span className="text-fg2">
                    {s.target === "oncall"
                      ? `${t("esc.targetOncall")}: ${s.schedule?.name || "—"}`
                      : `${s.notification?.name || "—"}`}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {editing && (
        <EscalationPolicyForm
          initial={editing} schedules={schedules} notifications={notifications}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
