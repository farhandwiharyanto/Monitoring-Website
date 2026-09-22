import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wrench, Plus, Pencil, Trash2, Repeat } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useMonitors } from "../lib/monitors.jsx";
import MaintenanceForm from "../components/MaintenanceForm.jsx";
import { fmtTime, fmtClock, DAY_NAMES } from "../lib/format.js";

export function describeWindow(w) {
  if (w.recurring === "daily") return `Setiap hari ${fmtClock(w.start_at)}–${fmtClock(w.end_at)}`;
  if (w.recurring === "weekly") {
    const days = String(w.days_of_week || "").split(",").filter(Boolean).map((d) => DAY_NAMES[Number(d)]).join(", ");
    return `Mingguan (${days || DAY_NAMES[new Date(w.start_at).getDay()]}) ${fmtClock(w.start_at)}–${fmtClock(w.end_at)}`;
  }
  return `${fmtTime(w.start_at)} → ${fmtTime(w.end_at)}`;
}

export default function Maintenance() {
  const { isAdmin } = useAuth();
  const { monitors, refresh } = useMonitors();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api("/maintenance").then(setList);
  useEffect(() => { load(); }, []);

  const remove = async (w) => {
    if (!confirm(`Hapus maintenance "${w.title}"?`)) return;
    await api(`/maintenance/${w.id}`, { method: "DELETE" }); load(); refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Maintenance</h1>
          <p className="text-sm text-muted mt-1">Selama window aktif, status down tidak memicu alert (tetap tercatat berlabel maintenance)</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Jadwalkan</button>}
      </div>

      <div className="card divide-y divide-border">
        {list.length === 0 && <p className="p-8 text-center text-sm text-muted">Belum ada maintenance window.</p>}
        {list.map((w) => (
          <div key={w.id} className="flex items-center gap-4 px-5 py-3.5">
            <span className={clsx("h-9 w-9 rounded-lg grid place-items-center", w.is_active ? "bg-maint/20" : "bg-panel2")}>
              <Wrench size={16} className={w.is_active ? "text-maint" : "text-muted"} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-100 flex items-center gap-2 flex-wrap">
                {w.title}
                {w.is_active && <span className="text-[10px] uppercase tracking-wider text-maint border border-maint/40 rounded px-1.5 py-0.5">aktif sekarang</span>}
                {!w.active && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">nonaktif</span>}
                {w.recurring !== "none" && <Repeat size={12} className="text-muted" />}
              </p>
              <p className="text-xs text-muted">
                <Link to={`/monitors/${w.monitor_id}`} className="text-accent hover:underline">{w.monitor?.name}</Link> · {describeWindow(w)}
              </p>
            </div>
            {isAdmin && (
              <>
                <button className="btn-ghost !px-2.5" onClick={() => setEditing(w)}><Pencil size={14} /></button>
                <button className="btn-danger !px-2.5" onClick={() => remove(w)}><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <MaintenanceForm initial={editing} monitors={monitors} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); refresh(); }} />
      )}
    </div>
  );
}
