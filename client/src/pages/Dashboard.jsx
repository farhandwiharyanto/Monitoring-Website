import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpCircle, ArrowDownCircle, Gauge, Percent, Search, Plus } from "lucide-react";
import clsx from "clsx";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import { useI18n } from "../lib/i18n.jsx";
import StatCard from "../components/StatCard.jsx";
import MonitorRow from "../components/MonitorRow.jsx";
import TagFilter from "../components/TagFilter.jsx";
import { fmtPct, fmtMs, statusLabel } from "../lib/format.js";

export default function Dashboard() {
  const { monitors, stats, loading } = useMonitors();
  const { isAdmin } = useAuth();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [tag, setTag] = useState(null);

  const filters = [
    { key: "all", label: t("common.all") },
    { key: 1, label: statusLabel(1) },
    { key: 0, label: statusLabel(0) },
    { key: 2, label: statusLabel(2) },
    { key: 4, label: t("dash.filterMaint") },
    { key: 3, label: statusLabel(3) },
  ];

  const list = useMemo(
    () =>
      monitors.filter(
        (m) =>
          (filter === "all" || m.status === filter) &&
          (!tag || m.tags?.some((x) => x.name === tag)) &&
          (!q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.url || m.hostname || "").toLowerCase().includes(q.toLowerCase()))
      ),
    [monitors, q, filter, tag]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{t("dash.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("dash.subtitle")}</p>
        </div>
        {isAdmin && <Link to="/monitors/new" className="btn-primary hidden md:inline-flex"><Plus size={16} /> {t("nav.newMonitor")}</Link>}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label={t("dash.up")} value={stats?.up ?? "—"} sub={t("dash.ofMonitors", { n: stats?.total ?? 0 })} icon={ArrowUpCircle} tone="text-up" />
        <StatCard
          label={t("dash.down")}
          value={stats?.down ?? "—"}
          sub={t("dash.downSub", { pending: stats?.pending ?? 0, maint: stats?.maintenance ?? 0, paused: stats?.paused ?? 0 })}
          icon={ArrowDownCircle}
          tone={stats?.down ? "text-down" : "text-fg"}
        />
        <StatCard label={t("dash.avgResponse")} value={fmtMs(stats?.avg_response_24h)} sub={t("dash.last24h")} icon={Gauge} tone="text-accent" />
        <StatCard
          label={t("dash.uptime24")}
          value={fmtPct(stats?.uptime_24h)}
          sub={stats?.open_incidents ? t("dash.openIncidents", { n: stats.open_incidents }) : t("dash.noIncidents")}
          icon={Percent}
          tone="text-fg"
        />
      </div>

      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-3 px-5 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder={t("dash.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx("px-3 py-1.5 rounded-md text-xs font-medium", filter === f.key ? "bg-accent/15 text-accent" : "text-muted hover:text-fg")}
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
          <span>{t("dash.colMonitor")}</span>
          <span className="w-[197px] text-right">{t("dash.colHeartbeat")}</span>
          <span className="text-right">{t("dash.colResponse")}</span>
          <span className="text-right">{t("dash.colUptime24")}</span>
          <span className="text-right">{t("dash.colUptime30")}</span>
        </div>
        {loading ? (
          <p className="p-8 text-center text-muted text-sm">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-muted text-sm">{monitors.length ? t("dash.noMatch") : t("dash.empty")}</p>
            {isAdmin && !monitors.length && <Link to="/monitors/new" className="btn-primary mt-4"><Plus size={16} /> {t("dash.addFirst")}</Link>}
          </div>
        ) : (
          list.map((m) => <MonitorRow key={m.id} m={m} />)
        )}
      </div>
    </div>
  );
}
