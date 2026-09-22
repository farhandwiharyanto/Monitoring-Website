import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Wrench } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import HeartbeatBar from "../components/HeartbeatBar.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { fmtPct, fmtMs, fmtTime, fmtDuration, incidentDuration, timeAgo } from "../lib/format.js";

const overallMeta = {
  up: { text: "Semua sistem beroperasi normal", icon: CheckCircle2, cls: "border-up/40 bg-up/10 text-up" },
  pending: { text: "Sebagian sistem sedang diperiksa", icon: AlertTriangle, cls: "border-pending/40 bg-pending/10 text-pending" },
  down: { text: "Sebagian sistem mengalami gangguan", icon: XCircle, cls: "border-down/40 bg-down/10 text-down" },
  maintenance: { text: "Sebagian sistem dalam maintenance terjadwal", icon: Wrench, cls: "border-maint/40 bg-maint/10 text-maint" },
};

export default function PublicStatus() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const load = () => api(`/public/status/${slug}`, { auth: false }).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, [slug]); // eslint-disable-line

  useEffect(() => {
    const socket = getSocket();
    const onBeat = ({ monitorId, status, maintenance, response_time, created_at }) => {
      setData((d) => {
        if (!d || !d.monitors.some((m) => m.id === monitorId)) return d;
        const monitors = d.monitors.map((m) =>
          m.id === monitorId ? { ...m, status, last_response_time: response_time, last_check: created_at, heartbeats: [...m.heartbeats.slice(-29), { status: maintenance ? m.heartbeats.at(-1)?.status ?? 1 : status, maintenance, response_time, created_at }] } : m
        );
        const overall = monitors.some((m) => m.status === 0) ? "down" : monitors.some((m) => m.status === 4) ? "maintenance" : monitors.some((m) => m.status === 2) ? "pending" : "up";
        return { ...d, monitors, overall };
      });
    };
    socket.on("public:heartbeat", onBeat);
    return () => socket.off("public:heartbeat", onBeat);
  }, []);

  useEffect(() => { if (tick) load(); }, [tick]); // eslint-disable-line

  if (error) return <div className="min-h-screen grid place-items-center text-muted">{error}</div>;
  if (!data) return <div className="min-h-screen grid place-items-center text-muted">Memuat…</div>;

  const meta = overallMeta[data.overall];
  const Icon = meta.icon;
  const incidents = data.monitors.flatMap((m) => m.incidents.map((i) => ({ ...i, monitor: m.name }))).sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, 10);

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <header className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-accent"><Activity size={22} /><span className="text-sm font-medium tracking-wide uppercase">Status</span></div>
          <h1 className="text-3xl font-semibold text-white">{data.page.title}</h1>
          {data.page.description && <p className="text-muted">{data.page.description}</p>}
        </header>

        <div className={clsx("rounded-xl border px-5 py-4 flex items-center gap-3 text-lg font-medium", meta.cls)}>
          <Icon size={22} /> {meta.text}
        </div>

        <div className="card divide-y divide-border">
          {data.monitors.map((m) => (
            <div key={m.id} className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={m.status} />
                  <span className="font-medium text-slate-100 truncate">{m.name}</span>
                </div>
                <div className="text-right text-xs text-muted shrink-0">
                  <span className="text-slate-200 tabular-nums">{fmtPct(m.uptime_30d)}</span> uptime 30 hari
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <HeartbeatBar beats={m.heartbeats} size={30} />
                <p className="text-xs text-muted">{fmtMs(m.last_response_time)} · {m.last_check ? timeAgo(m.last_check) : "—"}</p>
              </div>
            </div>
          ))}
          {data.monitors.length === 0 && <p className="p-8 text-center text-sm text-muted">Belum ada monitor pada halaman ini.</p>}
        </div>

        <section>
          <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Incident 7 hari terakhir</h2>
          {incidents.length === 0 ? (
            <p className="card p-5 text-sm text-muted">Tidak ada incident. ✓</p>
          ) : (
            <ul className="card divide-y divide-border">
              {incidents.map((i, idx) => (
                <li key={idx} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                  <div><p className="text-slate-100">{i.monitor}</p><p className="text-xs text-muted">{fmtTime(i.started_at)}{i.resolved_at ? ` → ${fmtTime(i.resolved_at)}` : ""}</p></div>
                  <span className={clsx("tabular-nums text-xs", i.resolved_at ? "text-muted" : "text-down")}>{i.resolved_at ? fmtDuration(incidentDuration(i)) : "berlangsung"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-center text-xs text-muted pt-6">Powered by Pulsewatch</footer>
      </div>
    </div>
  );
}
