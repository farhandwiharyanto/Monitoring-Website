import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Trash2, Pause, Play, ArrowLeft, ExternalLink, Wrench, Plus, ShieldCheck, ShieldAlert, RefreshCw, Copy, Download, Webhook, Globe2, CheckCircle2, XCircle, AlertTriangle, Zap, Bot, MessageSquarePlus, X } from "lucide-react";
import clsx from "clsx";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, download } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { useChartColors } from "../lib/theme.jsx";
import TagChip from "../components/TagChip.jsx";
import MaintenanceForm from "../components/MaintenanceForm.jsx";
import { describeWindow } from "./Maintenance.jsx";
import HeartbeatBar from "../components/HeartbeatBar.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { fmtPct, fmtMs, fmtTime, fmtClock, fmtDate, fmtDuration, incidentDuration, monitorTarget, parseDate, timeAgo, daysUntil } from "../lib/format.js";

const RANGES = [{ h: 1, key: "detail.range1h" }, { h: 6, key: "detail.range6h" }, { h: 24, key: "detail.range24h" }, { h: 168, key: "detail.range7d" }];

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh, monitors } = useMonitors();
  const { isAdmin } = useAuth();
  const { t, lang } = useI18n();
  const chart = useChartColors();
  const [monitor, setMonitor] = useState(null);
  const [windows, setWindows] = useState([]);
  const [maintForm, setMaintForm] = useState(null);
  const [beats, setBeats] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [hours, setHours] = useState(24);
  // Grafik & tabel mengikuti lokasi terpilih; "" berarti lokasi primary (bawaan)
  const [locationView, setLocationView] = useState("");
  const [error, setError] = useState("");
  const [certBusy, setCertBusy] = useState(false);
  const [autoEvents, setAutoEvents] = useState([]);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [updateForm, setUpdateForm] = useState(null); // { incidentId, status, message }
  const [copied, setCopied] = useState(false);

  const load = () =>
    Promise.all([
      api(`/monitors/${id}`),
      api(`/monitors/${id}/heartbeats?hours=${hours}${locationView ? `&location=${encodeURIComponent(locationView)}` : ""}`),
      api(`/monitors/${id}/incidents`),
      api(`/monitors/${id}/events${locationView ? `?location=${encodeURIComponent(locationView)}` : ""}`),
      api(`/monitors/${id}/maintenance`),
      api(`/monitors/${id}/events-log`).catch(() => []),
      // Riwayat webhook admin-only; viewer cukup dapat daftar kosong
      isAdmin ? api(`/monitors/${id}/webhook-logs`).catch(() => []) : Promise.resolve([]),
      api(`/incidents?monitor_id=${id}&limit=100`).catch(() => []),
    ])
      .then(([m, b, i, e, w, ev, wl, inc]) => {
        setMonitor(m); setBeats(b); setEvents(e); setWindows(w);
        setAutoEvents(ev); setWebhookLogs(wl);
        // Pakai incident yang sudah membawa updates; fallback ke daftar polos
        setIncidents(Array.isArray(inc) && inc.length ? inc : i);
      })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, [id, hours, locationView]); // eslint-disable-line

  useEffect(() => {
    const socket = getSocket();
    const onBeat = ({ monitorId, heartbeat, monitor: m }) => {
      if (monitorId !== Number(id)) return;
      // push_token tidak ikut disiarkan lewat socket, jadi field lokal dipertahankan
      setMonitor((prev) => ({ ...prev, ...m, push_token: prev?.push_token, push_url: prev?.push_url, heartbeats: prev?.heartbeats ? [...prev.heartbeats.slice(-49), heartbeat] : m.heartbeats }));
      setBeats((prev) => [...prev, heartbeat]);
      if (heartbeat.important) { api(`/monitors/${id}/incidents`).then(setIncidents); api(`/monitors/${id}/events`).then(setEvents); }
    };
    const onEvent = ({ monitorId, event }) => {
      if (monitorId !== Number(id)) return;
      setAutoEvents((prev) => [event, ...prev].slice(0, 50));
    };
    socket.on("heartbeat", onBeat);
    socket.on("monitor:event", onEvent);
    return () => { socket.off("heartbeat", onBeat); socket.off("monitor:event", onEvent); };
  }, [id]);

  const chartData = useMemo(
    () => beats.map((b) => ({ t: parseDate(b.created_at).getTime(), ms: b.status === 1 ? b.response_time : null, status: b.status, msg: (b.maintenance ? "[maintenance] " : "") + (b.message || "") })),
    [beats]
  );

  const act = async (path) => { await api(`/monitors/${id}/${path}`, { method: "POST" }); await load(); refresh(); };
  const remove = async () => {
    if (!confirm(t("detail.confirmDelete", { name: monitor.name }))) return;
    await api(`/monitors/${id}`, { method: "DELETE" });
    await refresh();
    navigate("/");
  };
  const checkCert = async () => {
    setCertBusy(true);
    try { await api(`/monitors/${id}/cert`, { method: "POST" }); await load(); }
    catch (err) { setError(err.message); }
    finally { setCertBusy(false); }
  };
  const resetPushToken = async () => {
    if (!confirm(t("detail.pushResetConfirm"))) return;
    await act("reset-push-token");
  };
  const saveUpdate = async (e) => {
    e.preventDefault();
    try {
      await api(`/incidents/${updateForm.incidentId}/updates`, {
        method: "POST",
        body: { status: updateForm.status, message: updateForm.message },
      });
      setUpdateForm(null);
      await load();
    } catch (err) { setError(err.message); }
  };
  const removeUpdate = async (incidentId, updateId) => {
    if (!confirm(t("incident.deleteConfirm"))) return;
    await api(`/incidents/${incidentId}/updates/${updateId}`, { method: "DELETE" }).catch(() => {});
    await load();
  };

  const copyPush = () => {
    navigator.clipboard.writeText(monitor.push_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) return <p className="text-down">{error}</p>;
  if (!monitor) return <p className="text-muted">{t("common.loading")}</p>;

  const withMs = chartData.filter((d) => d.ms != null);
  const avgMs = withMs.length ? Math.round(withMs.reduce((s, d) => s + d.ms, 0) / withMs.length) : null;
  const maxMs = withMs.length ? Math.max(...withMs.map((d) => d.ms)) : null;
  const rangeLabel = t(RANGES.find((r) => r.h === hours)?.key || "detail.range24h");
  const certDays = daysUntil(monitor.cert_expires_at);
  const certExpired = certDays !== null && certDays < 0;
  const certWarn = certDays !== null && certDays <= 14;
  const locations = monitor.locations || [];
  const isHttps = monitor.type === "http" && /^https:/i.test(monitor.url || "");

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={15} /> {t("common.back")}</Link>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-fg truncate">{monitor.name}</h1>
            <StatusBadge status={monitor.status} />
            <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{monitor.type}</span>
            {monitor.tags?.map((tag) => <TagChip key={tag.id} tag={tag} />)}
          </div>
          <p className="mt-1 text-sm text-muted font-mono flex items-center gap-1.5">
            {monitorTarget(monitor)}
            {monitor.url && <a href={monitor.url} target="_blank" rel="noreferrer" className="hover:text-accent"><ExternalLink size={13} /></a>}
          </p>
          <p className="mt-2 text-xs text-muted">
            {monitor.type === "push"
              ? t("detail.pushExpect", { interval: monitor.interval_seconds, grace: monitor.push_grace_seconds, last: monitor.last_check ? timeAgo(monitor.last_check) : "—" })
              : t("detail.checkEvery", { interval: monitor.interval_seconds, retries: monitor.max_retries, timeout: monitor.timeout_seconds, last: monitor.last_check ? timeAgo(monitor.last_check) : "—" })}
            {monitor.last_message && <span className={clsx("ml-2", monitor.status === 0 ? "text-down" : "text-fg3")}>— {monitor.last_message}</span>}
          </p>
        </div>
        {isAdmin && <div className="flex gap-2 shrink-0 flex-wrap">
          {monitor.active ? (
            <button className="btn-ghost" onClick={() => act("pause")}><Pause size={15} /> {t("detail.pause")}</button>
          ) : (
            <button className="btn-ghost" onClick={() => act("resume")}><Play size={15} /> {t("detail.resume")}</button>
          )}
          <Link to={`/monitors/${id}/edit`} className="btn-ghost"><Pencil size={15} /> {t("common.edit")}</Link>
          <button className="btn-danger" onClick={remove}><Trash2 size={15} /> {t("common.delete")}</button>
        </div>}
      </div>

      {monitor.in_maintenance && (
        <div className="rounded-xl border border-maint/40 bg-maint/10 px-5 py-3 flex items-center gap-3 text-sm text-maint flex-wrap">
          <Wrench size={16} /> {t("detail.inMaintenance")} <span className="font-medium">{monitor.maintenance_window?.title}</span>
          <span className="text-maint/70">
            {t("detail.alertsOff", {
              until: fmtTime(monitor.maintenance_window?.end_at),
              recurring: monitor.maintenance_window?.recurring !== "none" ? t("detail.recurringSuffix") : "",
            })}
          </span>
        </div>
      )}

      {monitor.type === "push" && isAdmin && monitor.push_url && (
        <div className="card p-5 space-y-3">
          <h2 className="font-medium text-fg flex items-center gap-2"><Webhook size={15} className="text-accent" /> {t("detail.pushUrl")}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-bg px-3 py-2 text-xs font-mono text-fg2">{monitor.push_url}</code>
            <button className="btn-ghost !px-2.5" onClick={copyPush}><Copy size={14} className={copied ? "text-up" : ""} /></button>
            <button className="btn-ghost" onClick={resetPushToken}><RefreshCw size={14} /> {t("detail.pushReset")}</button>
          </div>
          <p className="text-xs text-muted">{t("detail.pushHint")}</p>
        </div>
      )}

      {isHttps && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className={clsx("h-9 w-9 rounded-lg grid place-items-center", certExpired ? "bg-down/15" : certWarn ? "bg-pending/15" : "bg-panel2")}>
              {certExpired || !monitor.cert_chain_valid && monitor.cert_chain_valid !== null
                ? <ShieldAlert size={16} className="text-down" />
                : certWarn ? <ShieldAlert size={16} className="text-pending" /> : <ShieldCheck size={16} className="text-up" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-fg text-sm flex items-center gap-2 flex-wrap">
                {t("detail.certificate")}
                {/* Badge peringatan saat sisa umur < 14 hari */}
                {certExpired && (
                  <span className="text-[10px] uppercase tracking-wider text-down border border-down/40 bg-down/10 rounded px-1.5 py-0.5">
                    {t("detail.certBadgeExpired")}
                  </span>
                )}
                {!certExpired && certWarn && (
                  <span className="text-[10px] uppercase tracking-wider text-pending border border-pending/40 bg-pending/10 rounded px-1.5 py-0.5">
                    {t("detail.certBadgeWarning")}
                  </span>
                )}
              </p>
              {monitor.check_cert === false ? (
                <p className="text-xs text-muted">{t("detail.certOff")}</p>
              ) : monitor.cert_expires_at ? (
                <p className="text-xs text-muted">
                  {t("detail.certExpires", { date: fmtDate(monitor.cert_expires_at) })}
                  {monitor.cert_issuer && <span className="ml-2">· {t("detail.certIssuer", { issuer: monitor.cert_issuer })}</span>}
                  {monitor.cert_checked_at && <span className="ml-2">· {t("detail.certCheckedAt", { when: timeAgo(monitor.cert_checked_at) })}</span>}
                </p>
              ) : (
                <p className="text-xs text-muted">{t("detail.certUnknown")}</p>
              )}
            </div>
            {monitor.cert_expires_at && (
              <div className="text-right">
                <p className={clsx("text-2xl font-semibold tabular-nums", certExpired ? "text-down" : certWarn ? "text-pending" : "text-up")}>
                  {certExpired ? Math.abs(certDays) : certDays}
                </p>
                <p className="text-[11px] text-muted">
                  {certExpired ? t("detail.certExpired", { n: Math.abs(certDays) }) : t("detail.certCountdown", { n: certDays })}
                </p>
              </div>
            )}
            {isAdmin && (
              <button className="btn-ghost !py-1.5" onClick={checkCert} disabled={certBusy}>
                <RefreshCw size={14} className={certBusy ? "animate-spin" : ""} /> {certBusy ? t("detail.certChecking") : t("detail.certCheckNow")}
              </button>
            )}
          </div>
          {monitor.cert_chain_valid !== null && monitor.cert_chain_valid !== undefined && (
            <p className={clsx("text-xs flex items-center gap-1.5", monitor.cert_chain_valid ? "text-up" : "text-down")}>
              {monitor.cert_chain_valid ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {monitor.cert_chain_valid ? t("detail.certChainValid") : t("detail.certChainInvalid", { error: monitor.cert_chain_error || "-" })}
            </p>
          )}
        </div>
      )}

      {/* Assertion body: hasil pengecekan terakhir, berguna saat menelusuri kegagalan */}
      {monitor.assertion_summary && (
        <div className="card p-5 flex items-start gap-4 flex-wrap">
          <span className={clsx("h-9 w-9 rounded-lg grid place-items-center", monitor.last_assertion_ok === false ? "bg-down/15" : "bg-panel2")}>
            {monitor.last_assertion_ok === false ? <XCircle size={16} className="text-down" /> : <CheckCircle2 size={16} className="text-up" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-fg text-sm">{t("detail.assertionTitle")}</p>
            <code className="text-xs font-mono text-fg2 break-all">{monitor.assertion_summary}</code>
            {monitor.last_assertion_message && (
              <p className={clsx("text-xs mt-1", monitor.last_assertion_ok ? "text-up" : "text-down")}>{monitor.last_assertion_message}</p>
            )}
          </div>
        </div>
      )}

      {/* Perbandingan antar lokasi pengecekan */}
      {locations.length > 0 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-medium text-fg text-sm flex items-center gap-2">
            <Globe2 size={15} className="text-accent" /> {t("detail.locations")}
          </h2>
          {monitor.location_split && (
            <p className="rounded-lg border border-pending/40 bg-pending/10 text-pending text-xs px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t("detail.locationSplitWarning")}
            </p>
          )}
          <ul className="divide-y divide-border">
            {locations.map((l) => (
              <li key={l.location} className="py-2.5 flex items-center gap-3 flex-wrap">
                <StatusBadge status={l.status} />
                <span className="font-medium text-fg2 text-sm">{l.location}</span>
                {l.is_primary && <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/40 rounded px-1.5 py-0.5">{t("detail.locationPrimary")}</span>}
                {l.stale && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{t("detail.locationStale")}</span>}
                <span className="text-xs text-muted truncate flex-1 min-w-0">{l.message}</span>
                <span className="text-xs text-muted tabular-nums shrink-0">{fmtMs(l.response_time)} · {timeAgo(l.last_check)}</span>
              </li>
            ))}
          </ul>
          {locations.length === 1 && <p className="text-xs text-muted">{t("detail.locationOnlyOne")}</p>}
        </div>
      )}

      <div className="card px-5 py-4 flex items-center justify-between gap-4 overflow-x-auto">
        <span className="text-xs uppercase tracking-wide text-muted">{t("detail.lastHeartbeats")}</span>
        <HeartbeatBar beats={monitor.heartbeats} size={50} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label={t("detail.lastResponse")} value={fmtMs(monitor.last_response_time)} tone={monitor.status === 0 ? "text-down" : "text-accent"} />
        <StatCard label={t("detail.average", { range: rangeLabel })} value={fmtMs(avgMs)} sub={maxMs != null ? t("detail.max", { n: maxMs }) : ""} />
        <StatCard label={t("detail.uptime24")} value={fmtPct(monitor.uptime_24h)} tone={monitor.uptime_24h != null && monitor.uptime_24h < 99 ? "text-pending" : "text-up"} />
        <StatCard label={t("detail.uptime30")} value={fmtPct(monitor.uptime_30d)} tone={monitor.uptime_30d != null && monitor.uptime_30d < 99 ? "text-pending" : "text-up"} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="font-medium text-fg">{t("detail.responseTime")}</h2>
          <div className="flex gap-2 items-center flex-wrap">
            {locations.length > 1 && (
              <select className="input !w-auto !py-1 text-xs" value={locationView} onChange={(e) => setLocationView(e.target.value)}>
                {locations.map((l) => <option key={l.location} value={l.is_primary ? "" : l.location}>{l.location}</option>)}
                <option value="all">{t("detail.locationAll")}</option>
              </select>
            )}
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r.h} onClick={() => setHours(r.h)} className={clsx("px-2.5 py-1 rounded-md text-xs", hours === r.h ? "bg-accent/15 text-accent" : "text-muted hover:text-fg")}>
                {t(r.key)}
              </button>
            ))}
          </div>
          </div>
        </div>
        <div className="h-64">
          {chartData.length === 0 ? (
            <p className="h-full grid place-items-center text-sm text-muted">{t("detail.noDataRange")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(x) => fmtClock(new Date(x).toISOString())} stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis stroke={chart.grid} tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v} ms`} />
                <Tooltip
                  contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: chart.axis }}
                  labelFormatter={(x) => fmtTime(new Date(x).toISOString())}
                  formatter={(v, n, p) => [v == null ? `DOWN — ${p.payload.msg}` : `${v} ms`, t("detail.tooltipResponse")]}
                />
                <Area type="monotone" dataKey="ms" stroke={chart.accent} strokeWidth={2} fill="url(#rt)" connectNulls={false} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-medium text-fg">{t("detail.incidentHistory")}</h2>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => download(`/export/incidents?format=csv&monitor_id=${id}`)}>
              <Download size={13} /> CSV
            </button>
          </div>
          {incidents.length === 0 ? (
            <p className="p-6 text-sm text-muted">{t("detail.neverDown")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2 font-medium">{t("detail.colStart")}</th>
                  <th className="text-left px-3 py-2 font-medium">{t("detail.colRecover")}</th>
                  <th className="text-right px-5 py-2 font-medium">{t("detail.colDuration")}</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr key={inc.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-2.5">
                      <p className="text-fg2">{fmtTime(inc.started_at)}</p>
                      <p className="text-xs text-muted truncate max-w-[220px]" title={inc.cause}>{inc.cause}</p>
                      {/* Kabar manual yang tampil di status page publik */}
                      {(inc.updates || []).length > 0 && (
                        <ul className="mt-2 space-y-1 border-l-2 border-accent/30 pl-2.5">
                          {inc.updates.map((u) => (
                            <li key={u.id} className="text-xs">
                              <span className="text-accent">{t(`incident.status${u.status.charAt(0).toUpperCase()}${u.status.slice(1)}`)}</span>
                              <span className="text-muted"> · {fmtTime(u.created_at)}</span>
                              {isAdmin && (
                                <button type="button" className="ml-1.5 text-muted hover:text-down align-middle" onClick={() => removeUpdate(inc.id, u.id)}>
                                  <X size={11} />
                                </button>
                              )}
                              <p className="text-fg2">{u.message}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                          onClick={() => setUpdateForm({ incidentId: inc.id, status: "investigating", message: "" })}
                        >
                          <MessageSquarePlus size={12} /> {t("incident.addUpdate")}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{inc.resolved_at ? <span className="text-up">{fmtTime(inc.resolved_at)}</span> : <span className="text-down pulse-dot">{t("detail.stillDown")}</span>}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{fmtDuration(incidentDuration(inc))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-medium text-fg">{t("detail.events")}</h2>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => download(`/export/heartbeats?format=csv&monitor_id=${id}&hours=${hours}`)}>
              <Download size={13} /> CSV
            </button>
          </div>
          {events.length === 0 ? (
            <p className="p-6 text-sm text-muted">{t("detail.noEvents")}</p>
          ) : (
            <ul className="divide-y divide-border max-h-96 overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3 flex items-start gap-3">
                  <StatusBadge status={e.status} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-fg2 truncate">{e.message}</p>
                    <p className="text-xs text-muted">{fmtTime(e.created_at)} · {fmtMs(e.response_time)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(autoEvents.length > 0 || monitor.action_webhook_url) && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="font-medium text-fg px-5 py-4 border-b border-border flex items-center gap-2">
              <Bot size={15} className="text-accent" /> {t("action.events")}
            </h2>
            {autoEvents.length === 0 ? (
              <div className="p-6 space-y-2">
                <p className="text-sm text-muted">{t("action.noEvents")}</p>
                <code className="block text-xs font-mono text-muted break-all">{t("action.eventsHint", { id: monitor.id })}</code>
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                {autoEvents.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <p className="text-sm text-fg2">{e.title}</p>
                    <p className="text-xs text-muted">
                      {fmtTime(e.created_at)}
                      {e.source && ` · ${t("action.fromSource", { source: e.source })}`}
                      {e.incident_id && ` · incident #${e.incident_id}`}
                    </p>
                    {e.message && <p className="text-xs text-fg3 mt-0.5">{e.message}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isAdmin && (
            <div className="card">
              <h2 className="font-medium text-fg px-5 py-4 border-b border-border flex items-center gap-2">
                <Zap size={15} className="text-accent" /> {t("action.logs")}
              </h2>
              {webhookLogs.length === 0 ? (
                <p className="p-6 text-sm text-muted">{t("action.noLogs")}</p>
              ) : (
                <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                  {webhookLogs.map((w) => (
                    <li key={w.id} className="px-5 py-3 flex items-center gap-3">
                      {w.ok ? <CheckCircle2 size={15} className="text-up shrink-0" /> : <XCircle size={15} className="text-down shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg2">
                          {w.event} · {t("action.attempt", { n: w.attempt })} · {w.ok ? t("action.logOk") : t("action.logFail")}
                        </p>
                        <p className="text-xs text-muted truncate">
                          {fmtTime(w.created_at)}
                          {w.status_code ? ` · HTTP ${w.status_code}` : ""}
                          {w.duration_ms != null ? ` · ${w.duration_ms} ms` : ""}
                          {w.error ? ` · ${w.error}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium text-fg flex items-center gap-2"><Wrench size={15} className="text-muted" /> {t("detail.maintenanceWindows")}</h2>
          {isAdmin && <button className="btn-ghost !py-1.5" onClick={() => setMaintForm({ monitor_id: monitor.id })}><Plus size={14} /> {t("detail.schedule")}</button>}
        </div>
        {windows.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t("detail.noWindows")} <Link to="/maintenance" className="text-accent">{t("common.viewAll")}</Link></p>
        ) : (
          <ul className="divide-y divide-border">
            {windows.map((w) => (
              <li key={w.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className={clsx("h-2 w-2 rounded-full", w.is_active ? "bg-maint pulse-dot" : w.active ? "bg-muted" : "bg-border")} />
                <div className="flex-1 min-w-0">
                  <p className="text-fg2">
                    {w.title}
                    {w.is_active && <span className="text-xs text-maint"> · {t("maint.activeNow")}</span>}
                    {!w.active && <span className="text-xs text-muted"> · {t("maint.disabled")}</span>}
                  </p>
                  <p className="text-xs text-muted">{describeWindow(w, lang)}</p>
                </div>
                {isAdmin && <button className="btn-ghost !px-2 !py-1" onClick={() => setMaintForm(w)}><Pencil size={13} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {updateForm && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setUpdateForm(null)}>
          <form onSubmit={saveUpdate} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-fg">{t("incident.addUpdate")}</h2>
              <button type="button" onClick={() => setUpdateForm(null)} className="text-muted hover:text-fg"><X size={18} /></button>
            </div>
            <div>
              <label className="label">{t("incident.selectIncident")} #{updateForm.incidentId}</label>
              <div className="grid grid-cols-2 gap-2">
                {[["investigating", "incident.statusInvestigating"], ["identified", "incident.statusIdentified"],
                  ["monitoring", "incident.statusMonitoring"], ["resolved", "incident.statusResolved"]].map(([v, key]) => (
                  <button type="button" key={v} onClick={() => setUpdateForm({ ...updateForm, status: v })}
                    className={clsx("rounded-lg border px-3 py-2 text-sm", updateForm.status === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
            <textarea className="input" rows={3} value={updateForm.message} required autoFocus
              placeholder={t("incident.messagePlaceholder")}
              onChange={(e) => setUpdateForm({ ...updateForm, message: e.target.value })} />
            <p className="text-xs text-muted">{t("incident.publishedHint")}</p>
            <button className="btn-primary">{t("common.save")}</button>
          </form>
        </div>
      )}

      {maintForm && (
        <MaintenanceForm initial={maintForm} monitors={monitors} onClose={() => setMaintForm(null)} onSaved={() => { setMaintForm(null); load(); refresh(); }} />
      )}
    </div>
  );
}
