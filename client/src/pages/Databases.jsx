import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Database, AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { useChartColors } from "../lib/theme.jsx";
import { fmtPct, fmtClock, fmtDate, timeAgo } from "../lib/format.js";
import StatusBadge from "../components/StatusBadge.jsx";

// Menu Database: ringkasan semua monitor database dan detail per monitor.
// Metrik dibaca paling sering tiap 5 menit, jadi halaman ini tidak ikut
// siaran realtime — cukup dimuat saat dibuka.

const RANGES = ["24h", "7d", "30d"];

function fmtBytes(v) {
  if (v == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = v;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
const fmtNum = (v, digits = 1) => (v == null ? "—" : Number(v).toFixed(digits));
const connPct = (m) => (m?.conn_used != null && m?.conn_max ? (m.conn_used / m.conn_max) * 100 : null);

function Findings({ items }) {
  const { t } = useI18n();
  if (!items?.length) {
    return <p className="text-sm text-up flex items-center gap-2"><CheckCircle2 size={15} /> {t("db.noFindings")}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={f.key} className="text-sm text-fg flex items-start gap-2">
          <AlertTriangle size={15} className="text-pending mt-0.5 shrink-0" />
          <span>{t(`db.finding.${f.key}`, { value: f.value, threshold: f.threshold })}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium text-fg tabular-nums">{value}</p>
    </div>
  );
}

function List() {
  const { t } = useI18n();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/db-analytics").then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg flex items-center gap-2"><Database size={22} className="text-accent" /> {t("db.title")}</h1>
        <p className="text-sm text-muted mt-1">{t("db.subtitle")}</p>
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      {rows && !rows.length && <div className="card p-8 text-center text-sm text-muted">{t("db.empty")}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows?.map((m) => (
          <Link key={m.id} to={`/databases/${m.id}`} className="card p-5 space-y-4 hover:border-accent/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-fg truncate">{m.name}</p>
                <p className="text-xs text-muted truncate">{m.metrics?.version || t(`form.type${m.type[0].toUpperCase()}${m.type.slice(1)}`)}</p>
              </div>
              {m.status != null && <StatusBadge status={m.status} />}
            </div>
            {m.metrics ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat label={t("db.connections")} value={fmtPct(connPct(m.metrics))} />
                <Stat label={t("db.cacheHit")} value={fmtPct(m.metrics.cache_hit)} />
                <Stat label={t("db.size")} value={fmtBytes(m.metrics.size_bytes)} />
                <Stat label={t("db.qps")} value={fmtNum(m.point?.qps)} />
              </div>
            ) : (
              <p className="text-sm text-muted">{t("db.noMetrics")}</p>
            )}
            <p className={clsx("text-xs flex items-center gap-1.5", m.findings.length ? "text-pending" : "text-muted")}>
              {m.findings.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
              {t("db.findingCount", { n: m.findings.length })}
              {m.collected_at && <span className="text-muted ml-auto">{timeAgo(m.collected_at)}</span>}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Chart({ title, data, dataKey, format, domain }) {
  const { t } = useI18n();
  const chart = useChartColors();
  const hasData = data.some((d) => d[dataKey] != null);
  return (
    <div className="card p-5">
      <h2 className="font-medium text-fg text-sm mb-3">{title}</h2>
      {!hasData ? (
        <p className="text-sm text-muted">{t("db.unavailable")}</p>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="t" stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtClock(v)} minTickGap={40} />
              <YAxis domain={domain || ["auto", "auto"]} stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={format} />
              <Tooltip
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => `${fmtDate(v)} ${fmtClock(v)}`}
                formatter={(v) => [format(v), title]}
              />
              <Line type="monotone" dataKey={dataKey} stroke={chart.accent} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Detail({ id }) {
  const { t } = useI18n();
  const [range, setRange] = useState("24h");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api(`/db-analytics/${id}?range=${range}`).then(setData).catch((e) => setError(e.message));
  }, [id, range]);

  const m = data?.metrics;
  const na = t("db.unavailable");
  const or = (v, f) => (v == null ? na : f(v));

  return (
    <div className="space-y-6">
      <Link to="/databases" className="text-sm text-muted hover:text-fg inline-flex items-center gap-1"><ArrowLeft size={14} /> {t("db.title")}</Link>
      {error && <p className="text-sm text-down">{error}</p>}
      {data && (
        <>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-fg flex items-center gap-2">
                <Database size={22} className="text-accent" /> {data.monitor.name}
                {data.monitor.status != null && <StatusBadge status={data.monitor.status} />}
              </h1>
              <p className="text-sm text-muted mt-1">{m?.version || t("db.noMetrics")}</p>
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button key={r} className={clsx(r === range ? "btn-primary" : "btn-ghost")} onClick={() => setRange(r)}>{t(`db.range.${r}`)}</button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label={t("db.connections")} value={m ? `${m.conn_used ?? "—"} / ${m.conn_max ?? "—"}` : na} />
              <Stat label={t("db.cacheHit")} value={or(m?.cache_hit, fmtPct)} />
              <Stat label={t("db.size")} value={or(m?.size_bytes, fmtBytes)} />
              <Stat label={t("db.longQueries")} value={or(m?.long_queries, String)} />
              <Stat label={t("db.lockWaits")} value={or(m?.lock_waits, String)} />
              <Stat label={t("db.replLag")} value={or(m?.repl_lag_s, (v) => `${Math.round(v)} s`)} />
              <Stat label={t("db.startedAt")} value={or(m?.started_at, (v) => `${fmtDate(v)} ${fmtClock(v)}`)} />
              <Stat label={t("db.collectedAt")} value={or(data.collected_at, timeAgo)} />
            </div>
            <div className="card p-5">
              <h2 className="font-medium text-fg text-sm mb-3">{t("db.findings")}</h2>
              <Findings items={data.findings} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Chart title={t("db.connectionsPct")} data={data.series} dataKey="conn_pct" format={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} />
            <Chart title={t("db.qps")} data={data.series} dataKey="qps" format={(v) => fmtNum(v)} />
            <Chart title={t("db.cacheHit")} data={data.series} dataKey="cache_hit" format={(v) => `${Number(v).toFixed(1)}%`} domain={["auto", 100]} />
            <Chart title={t("db.size")} data={data.series} dataKey="size_bytes" format={fmtBytes} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Databases() {
  const { id } = useParams();
  return id ? <Detail id={id} /> : <List />;
}
