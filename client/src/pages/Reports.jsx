import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Download, Target, TrendingDown, CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, download } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { useChartColors } from "../lib/theme.jsx";
import { fmtDuration, fmtPct } from "../lib/format.js";
import StatCard from "../components/StatCard.jsx";

// Warna bar error budget: hijau selama masih ada sisa, kuning saat menipis,
// merah begitu jatahnya habis.
const budgetTone = (usedPercent) =>
  usedPercent >= 100 ? "bg-down" : usedPercent >= 75 ? "bg-pending" : "bg-up";

export default function Reports() {
  const { t } = useI18n();
  // Warna grafik dibaca dari token tema aktif, sama seperti grafik lain
  const chart = useChartColors();
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState("");
  const [includeMaint, setIncludeMaint] = useState(false);
  const [report, setReport] = useState(null);
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/reports/sla/months")
      .then((list) => { setMonths(list); setMonth((m) => m || list[0] || ""); })
      .catch(() => {});
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (month) p.set("month", month);
    if (includeMaint) p.set("include_maintenance", "true");
    return p.toString();
  }, [month, includeMaint]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setError("");
    api(`/reports/sla?${params}`)
      .then((d) => !cancelled && setReport(d))
      .catch((e) => !cancelled && setError(e.message));
    api(`/reports/sla/monthly?months=12${includeMaint ? "&include_maintenance=true" : ""}`)
      .then((d) => !cancelled && setTrend(d.filter((r) => r.uptime !== null)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [params, month, includeMaint]);

  const summary = report?.summary;
  const rows = report?.rows || [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-fg flex items-center gap-2"><BarChart3 size={22} className="text-accent" /> {t("report.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("report.subtitle")}</p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">{t("report.month")}</label>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="btn-ghost" onClick={() => download(`/export/sla?format=csv&${params}`)}>
            <Download size={15} /> {t("report.exportCsv")}
          </button>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-fg2">
        <input type="checkbox" className="accent-accent mt-0.5" checked={includeMaint} onChange={(e) => setIncludeMaint(e.target.checked)} />
        <span>
          {t("report.includeMaintenance")}
          <span className="block text-xs text-muted">{t("report.includeMaintenanceHint")}</span>
        </span>
      </label>

      {error && <p className="text-sm text-down">{error}</p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label={t("report.avgUptime")} value={fmtPct(summary?.uptime)} sub={t("report.avgUptimeSub", { n: summary?.monitors ?? 0 })} icon={Target} tone="text-accent" />
        <StatCard label={t("report.totalDowntime")} value={fmtDuration(summary?.total_down_seconds ?? 0)} sub={t("report.totalDowntimeSub", { n: summary?.incidents ?? 0 })} icon={TrendingDown} tone={summary?.total_down_seconds ? "text-down" : "text-fg"} />
        <StatCard label={t("report.meeting")} value={summary?.meeting_target ?? "—"} sub={t("report.meetingSub", { n: summary?.with_target ?? 0 })} icon={CheckCircle2} tone="text-up" />
        <StatCard label={t("report.breaching")} value={summary?.breaching_target ?? "—"} sub={t("report.breachingSub")} icon={AlertTriangle} tone={summary?.breaching_target ? "text-down" : "text-fg"} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">{t("report.colMonitor")}</th>
              <th className="px-5 py-3 font-medium text-right">{t("report.colUptime")}</th>
              <th className="px-5 py-3 font-medium text-right">{t("report.colTarget")}</th>
              <th className="px-5 py-3 font-medium w-48">{t("report.colBudget")}</th>
              <th className="px-5 py-3 font-medium text-right">{t("report.colDowntime")}</th>
              <th className="px-5 py-3 font-medium text-right">{t("report.colIncidents")}</th>
              <th className="px-5 py-3 font-medium text-right">{t("report.colMttr")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-muted">{t("report.empty")}</td></tr>
            ) : (
              rows.map((r) => {
                const b = r.error_budget;
                return (
                  <tr key={r.monitor_id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <Link to={`/monitors/${r.monitor_id}`} className="text-fg hover:text-accent">{r.monitor}</Link>
                    </td>
                    <td className={clsx("px-5 py-3 text-right tabular-nums", b && !b.met && "text-down")}>{fmtPct(r.uptime)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted">{r.slo_target !== null ? `${r.slo_target}%` : t("report.noTarget")}</td>
                    <td className="px-5 py-3">
                      {b ? (
                        <>
                          <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
                            <div className={clsx("h-full rounded-full", budgetTone(b.used_percent))} style={{ width: `${Math.min(100, b.used_percent)}%` }} />
                          </div>
                          <span className={clsx("text-[11px]", b.remaining_seconds < 0 ? "text-down" : "text-muted")}>
                            {b.remaining_seconds >= 0
                              ? t("report.budgetLeft", { duration: fmtDuration(b.remaining_seconds) })
                              : t("report.budgetOver", { duration: fmtDuration(-b.remaining_seconds) })}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted text-xs">{t("report.noTarget")}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-fg2">{fmtDuration(r.down_seconds)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-fg2">
                      {r.incidents}
                      {r.ongoing_incidents > 0 && <span className="block text-[11px] text-pending">{t("report.ongoing", { n: r.ongoing_incidents })}</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-fg2">{r.mttr_seconds !== null ? fmtDuration(r.mttr_seconds) : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-fg text-sm mb-3">{t("report.trend")}</h2>
        {trend.length < 2 ? (
          <p className="text-sm text-muted">{t("report.trendEmpty")}</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={["dataMin - 0.5", 100]} stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <Tooltip
                  contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [`${Number(v).toFixed(4)}%`, t("report.colUptime")]}
                />
                <Line type="monotone" dataKey="uptime" stroke={chart.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="text-xs text-muted text-center">{t("report.methodHint")}</p>
    </div>
  );
}
