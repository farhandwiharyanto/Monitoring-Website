import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Trash2, Pause, Play, ArrowLeft, ExternalLink, Wrench, Plus } from "lucide-react";
import clsx from "clsx";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import TagChip from "../components/TagChip.jsx";
import MaintenanceForm from "../components/MaintenanceForm.jsx";
import { describeWindow } from "./Maintenance.jsx";
import HeartbeatBar from "../components/HeartbeatBar.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { fmtPct, fmtMs, fmtTime, fmtClock, fmtDuration, incidentDuration, monitorTarget, parseDate, timeAgo } from "../lib/format.js";

const ranges = [{ h: 1, label: "1 jam" }, { h: 6, label: "6 jam" }, { h: 24, label: "24 jam" }, { h: 168, label: "7 hari" }];

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh, monitors } = useMonitors();
  const { isAdmin } = useAuth();
  const [monitor, setMonitor] = useState(null);
  const [windows, setWindows] = useState([]);
  const [maintForm, setMaintForm] = useState(null);
  const [beats, setBeats] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState("");

  const load = () =>
    Promise.all([api(`/monitors/${id}`), api(`/monitors/${id}/heartbeats?hours=${hours}`), api(`/monitors/${id}/incidents`), api(`/monitors/${id}/events`), api(`/monitors/${id}/maintenance`)])
      .then(([m, b, i, e, w]) => { setMonitor(m); setBeats(b); setIncidents(i); setEvents(e); setWindows(w); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, [id, hours]); // eslint-disable-line

  useEffect(() => {
    const socket = getSocket();
    const onBeat = ({ monitorId, heartbeat, monitor: m }) => {
      if (monitorId !== Number(id)) return;
      setMonitor((prev) => ({ ...prev, ...m, heartbeats: prev?.heartbeats ? [...prev.heartbeats.slice(-49), heartbeat] : m.heartbeats }));
      setBeats((prev) => [...prev, heartbeat]);
      if (heartbeat.important) { api(`/monitors/${id}/incidents`).then(setIncidents); api(`/monitors/${id}/events`).then(setEvents); }
    };
    socket.on("heartbeat", onBeat);
    return () => socket.off("heartbeat", onBeat);
  }, [id]);

  const chartData = useMemo(
    () => beats.map((b) => ({ t: parseDate(b.created_at).getTime(), ms: b.status === 1 ? b.response_time : null, status: b.status, msg: (b.maintenance ? "[maintenance] " : "") + (b.message || "") })),
    [beats]
  );

  const act = async (path) => { await api(`/monitors/${id}/${path}`, { method: "POST" }); await load(); refresh(); };
  const remove = async () => {
    if (!confirm(`Hapus monitor "${monitor.name}"?`)) return;
    await api(`/monitors/${id}`, { method: "DELETE" });
    await refresh();
    navigate("/");
  };

  if (error) return <p className="text-down">{error}</p>;
  if (!monitor) return <p className="text-muted">Memuat…</p>;

  const avg = chartData.filter((d) => d.ms != null);
  const avgMs = avg.length ? Math.round(avg.reduce((s, d) => s + d.ms, 0) / avg.length) : null;
  const maxMs = avg.length ? Math.max(...avg.map((d) => d.ms)) : null;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft size={15} /> Kembali</Link>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-white truncate">{monitor.name}</h1>
            <StatusBadge status={monitor.status} />
            <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{monitor.type}</span>
            {monitor.tags?.map((t) => <TagChip key={t.id} tag={t} />)}
          </div>
          <p className="mt-1 text-sm text-muted font-mono flex items-center gap-1.5">
            {monitorTarget(monitor)}
            {monitor.url && <a href={monitor.url} target="_blank" rel="noreferrer" className="hover:text-accent"><ExternalLink size={13} /></a>}
          </p>
          <p className="mt-2 text-xs text-muted">
            Cek tiap {monitor.interval_seconds}s · retries {monitor.max_retries} · timeout {monitor.timeout_seconds}s · terakhir {monitor.last_check ? timeAgo(monitor.last_check) : "—"}
            {monitor.last_message && <span className={clsx("ml-2", monitor.status === 0 ? "text-down" : "text-slate-400")}>— {monitor.last_message}</span>}
          </p>
        </div>
        {isAdmin && <div className="flex gap-2 shrink-0">
          {monitor.active ? (
            <button className="btn-ghost" onClick={() => act("pause")}><Pause size={15} /> Pause</button>
          ) : (
            <button className="btn-ghost" onClick={() => act("resume")}><Play size={15} /> Resume</button>
          )}
          <Link to={`/monitors/${id}/edit`} className="btn-ghost"><Pencil size={15} /> Edit</Link>
          <button className="btn-danger" onClick={remove}><Trash2 size={15} /> Hapus</button>
        </div>}
      </div>

      {monitor.in_maintenance && (
        <div className="rounded-xl border border-maint/40 bg-maint/10 px-5 py-3 flex items-center gap-3 text-sm text-maint">
          <Wrench size={16} /> Sedang dalam maintenance: <span className="font-medium">{monitor.maintenance_window?.title}</span>
          <span className="text-maint/70">— alert dinonaktifkan sampai {fmtTime(monitor.maintenance_window?.end_at)}{monitor.maintenance_window?.recurring !== "none" ? " (berulang)" : ""}</span>
        </div>
      )}

      <div className="card px-5 py-4 flex items-center justify-between gap-4 overflow-x-auto">
        <span className="text-xs uppercase tracking-wide text-muted">Heartbeat terakhir</span>
        <HeartbeatBar beats={monitor.heartbeats} size={50} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Respons terakhir" value={fmtMs(monitor.last_response_time)} tone={monitor.status === 0 ? "text-down" : "text-accent"} />
        <StatCard label={`Rata-rata (${ranges.find((r) => r.h === hours)?.label})`} value={fmtMs(avgMs)} sub={maxMs != null ? `maks ${maxMs} ms` : ""} />
        <StatCard label="Uptime 24 jam" value={fmtPct(monitor.uptime_24h)} tone={monitor.uptime_24h != null && monitor.uptime_24h < 99 ? "text-pending" : "text-up"} />
        <StatCard label="Uptime 30 hari" value={fmtPct(monitor.uptime_30d)} tone={monitor.uptime_30d != null && monitor.uptime_30d < 99 ? "text-pending" : "text-up"} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-white">Response time</h2>
          <div className="flex gap-1">
            {ranges.map((r) => (
              <button key={r.h} onClick={() => setHours(r.h)} className={clsx("px-2.5 py-1 rounded-md text-xs", hours === r.h ? "bg-accent/15 text-accent" : "text-muted hover:text-white")}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          {chartData.length === 0 ? (
            <p className="h-full grid place-items-center text-sm text-muted">Belum ada data pada rentang ini</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtClock(new Date(t).toISOString())} stroke="#4b5563" tick={{ fill: "#8b95a7", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis stroke="#4b5563" tick={{ fill: "#8b95a7", fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v} ms`} />
                <Tooltip
                  contentStyle={{ background: "#151d2c", border: "1px solid #1f2937", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#8b95a7" }}
                  labelFormatter={(t) => fmtTime(new Date(t).toISOString())}
                  formatter={(v, n, p) => [v == null ? `DOWN — ${p.payload.msg}` : `${v} ms`, "Respons"]}
                />
                <Area type="monotone" dataKey="ms" stroke="#38bdf8" strokeWidth={2} fill="url(#rt)" connectNulls={false} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-medium text-white px-5 py-4 border-b border-border">Riwayat incident</h2>
          {incidents.length === 0 ? (
            <p className="p-6 text-sm text-muted">Belum pernah down. 🎉</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr className="border-b border-border"><th className="text-left px-5 py-2 font-medium">Mulai</th><th className="text-left px-3 py-2 font-medium">Recover</th><th className="text-right px-5 py-2 font-medium">Durasi</th></tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr key={inc.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <p className="text-slate-200">{fmtTime(inc.started_at)}</p>
                      <p className="text-xs text-muted truncate max-w-[220px]" title={inc.cause}>{inc.cause}</p>
                    </td>
                    <td className="px-3 py-2.5">{inc.resolved_at ? <span className="text-up">{fmtTime(inc.resolved_at)}</span> : <span className="text-down pulse-dot">masih down</span>}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{fmtDuration(incidentDuration(inc))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2 className="font-medium text-white px-5 py-4 border-b border-border">Event penting</h2>
          {events.length === 0 ? (
            <p className="p-6 text-sm text-muted">Belum ada perubahan status.</p>
          ) : (
            <ul className="divide-y divide-border max-h-96 overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3 flex items-start gap-3">
                  <StatusBadge status={e.status} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 truncate">{e.message}</p>
                    <p className="text-xs text-muted">{fmtTime(e.created_at)} · {fmtMs(e.response_time)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium text-white flex items-center gap-2"><Wrench size={15} className="text-muted" /> Maintenance window</h2>
          {isAdmin && <button className="btn-ghost !py-1.5" onClick={() => setMaintForm({ monitor_id: monitor.id })}><Plus size={14} /> Jadwalkan</button>}
        </div>
        {windows.length === 0 ? (
          <p className="p-6 text-sm text-muted">Tidak ada jadwal maintenance. <Link to="/maintenance" className="text-accent">Lihat semua</Link></p>
        ) : (
          <ul className="divide-y divide-border">
            {windows.map((w) => (
              <li key={w.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className={clsx("h-2 w-2 rounded-full", w.is_active ? "bg-maint pulse-dot" : w.active ? "bg-slate-500" : "bg-border")} />
                <div className="flex-1 min-w-0">
                  <p className="text-slate-200">{w.title} {w.is_active && <span className="text-xs text-maint">· aktif</span>}{!w.active && <span className="text-xs text-muted">· nonaktif</span>}</p>
                  <p className="text-xs text-muted">{describeWindow(w)}</p>
                </div>
                {isAdmin && <button className="btn-ghost !px-2 !py-1" onClick={() => setMaintForm(w)}><Pencil size={13} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {maintForm && (
        <MaintenanceForm initial={maintForm} monitors={monitors} onClose={() => setMaintForm(null)} onSaved={() => { setMaintForm(null); load(); refresh(); }} />
      )}
    </div>
  );
}
