import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpCircle, ArrowDownCircle, Gauge, Percent, Search, Plus } from "lucide-react";
import clsx from "clsx";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import StatCard from "../components/StatCard.jsx";
import MonitorRow from "../components/MonitorRow.jsx";
import TagFilter from "../components/TagFilter.jsx";
import { fmtPct, fmtMs } from "../lib/format.js";

const filters = [
  { key: "all", label: "Semua" },
  { key: 1, label: "Up" },
  { key: 0, label: "Down" },
  { key: 2, label: "Pending" },
  { key: 4, label: "Maint" },
  { key: 3, label: "Paused" },
];

export default function Dashboard() {
  const { monitors, stats, loading } = useMonitors();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [tag, setTag] = useState(null);

  const list = useMemo(
    () =>
      monitors.filter(
        (m) =>
          (filter === "all" || m.status === filter) &&
          (!tag || m.tags?.some((t) => t.name === tag)) &&
          (!q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.url || m.hostname || "").toLowerCase().includes(q.toLowerCase()))
      ),
    [monitors, q, filter, tag]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-muted mt-1">Ringkasan status semua monitor</p>
        </div>
        {isAdmin && <Link to="/monitors/new" className="btn-primary hidden md:inline-flex"><Plus size={16} /> Monitor baru</Link>}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Up" value={stats?.up ?? "—"} sub={`dari ${stats?.total ?? 0} monitor`} icon={ArrowUpCircle} tone="text-up" />
        <StatCard label="Down" value={stats?.down ?? "—"} sub={`${stats?.pending ?? 0} pending · ${stats?.maintenance ?? 0} maintenance · ${stats?.paused ?? 0} paused`} icon={ArrowDownCircle} tone={stats?.down ? "text-down" : "text-white"} />
        <StatCard label="Rata-rata respons" value={fmtMs(stats?.avg_response_24h)} sub="24 jam terakhir" icon={Gauge} tone="text-accent" />
        <StatCard label="Uptime 24 jam" value={fmtPct(stats?.uptime_24h)} sub={stats?.open_incidents ? `${stats.open_incidents} incident aktif` : "tidak ada incident aktif"} icon={Percent} tone="text-white" />
      </div>

      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-3 px-5 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Cari monitor…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx("px-3 py-1.5 rounded-md text-xs font-medium", filter === f.key ? "bg-accent/15 text-accent" : "text-muted hover:text-white")}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-2.5 border-b border-border">
          <TagFilter value={tag} onChange={setTag} monitors={monitors} />
        </div>
        <div className="hidden lg:grid grid-cols-[minmax(0,1.6fr)_auto_110px_110px_110px] gap-4 px-5 py-2 text-[11px] uppercase tracking-wider text-muted border-b border-border">
          <span>Monitor</span><span className="w-[197px] text-right">Heartbeat</span><span className="text-right">Respons</span><span className="text-right">Uptime 24j</span><span className="text-right">Uptime 30h</span>
        </div>
        {loading ? (
          <p className="p-8 text-center text-muted text-sm">Memuat…</p>
        ) : list.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-muted text-sm">{monitors.length ? "Tidak ada monitor yang cocok." : "Belum ada monitor."}</p>
            {isAdmin && !monitors.length && <Link to="/monitors/new" className="btn-primary mt-4"><Plus size={16} /> Tambah monitor pertama</Link>}
          </div>
        ) : (
          list.map((m) => <MonitorRow key={m.id} m={m} />)
        )}
      </div>
    </div>
  );
}
