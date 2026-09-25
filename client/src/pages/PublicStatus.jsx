import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Wrench, Info, Megaphone, Rss } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { getSocket } from "../lib/socket.js";
import { useI18n } from "../lib/i18n.jsx";
import { applyTheme } from "../lib/theme.jsx";
import HeartbeatBar from "../components/HeartbeatBar.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { fmtPct, fmtMs, fmtTime, fmtDuration, incidentDuration, timeAgo } from "../lib/format.js";

const overallMeta = {
  up: { key: "public.up", icon: CheckCircle2, cls: "border-up/40 bg-up/10 text-up" },
  pending: { key: "public.pending", icon: AlertTriangle, cls: "border-pending/40 bg-pending/10 text-pending" },
  down: { key: "public.down", icon: XCircle, cls: "border-down/40 bg-down/10 text-down" },
  maintenance: { key: "public.maintenance", icon: Wrench, cls: "border-maint/40 bg-maint/10 text-maint" },
  degraded: { key: "public.degraded", icon: AlertTriangle, cls: "border-degraded/40 bg-degraded/10 text-degraded" },
};

const announcementMeta = {
  info: { icon: Info, cls: "border-accent/40 bg-accent/10 text-accent" },
  warning: { icon: Megaphone, cls: "border-pending/40 bg-pending/10 text-pending" },
  critical: { icon: AlertTriangle, cls: "border-down/40 bg-down/10 text-down" },
};

// "#38bdf8" -> "56 189 248" agar bisa dipakai sebagai nilai CSS variable
function hexToRgbTriplet(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// `slug` boleh datang dari prop (custom domain) atau dari route /status/:slug
export default function PublicStatus({ slug: slugProp }) {
  const params = useParams();
  const slug = slugProp || params.slug;
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const load = () => api(`/public/status/${slug}`, { auth: false }).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); const timer = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(timer); }, [slug]); // eslint-disable-line

  // Halaman publik memakai tema & warna aksen miliknya sendiri, bukan tema admin
  useEffect(() => {
    if (!data?.page) return;
    applyTheme(data.page.theme || "dark");
    const rgb = hexToRgbTriplet(data.page.accent_color);
    if (rgb) document.documentElement.style.setProperty("--c-accent", rgb);
    return () => document.documentElement.style.removeProperty("--c-accent");
  }, [data?.page?.theme, data?.page?.accent_color]);

  // Tautan feed di <head> supaya pembaca feed dan browser menemukannya sendiri
  // dari alamat halaman, tanpa pengguna perlu tahu pola URL-nya.
  useEffect(() => {
    if (!data?.page || !data.page.show_incidents) return;
    const link = document.createElement("link");
    link.rel = "alternate";
    link.type = "application/atom+xml";
    link.title = data.page.title;
    link.href = `/api/public/status/${data.page.slug}/feed.xml`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [data?.page?.slug, data?.page?.show_incidents, data?.page?.title]);

  useEffect(() => {
    const socket = getSocket();
    const onBeat = ({ monitorId, status, maintenance, degraded, response_time, created_at }) => {
      setData((d) => {
        if (!d || !d.monitors.some((m) => m.id === monitorId)) return d;
        const monitors = d.monitors.map((m) =>
          m.id === monitorId ? { ...m, status, degraded, last_response_time: response_time, last_check: created_at, heartbeats: [...m.heartbeats.slice(-29), { status: maintenance ? m.heartbeats.at(-1)?.status ?? 1 : status, maintenance, degraded, response_time, created_at }] } : m
        );
        // Urutan keparahan harus sama dengan yang dihitung server di
        // routes/statusPages.js, supaya banner tidak berubah arti saat halaman
        // diperbarui lewat socket alih-alih dimuat ulang.
        const has = (code) => monitors.some((m) => m.status === code);
        const overall = has(0) ? "down" : has(4) ? "maintenance" : has(5) ? "degraded" : has(2) ? "pending" : "up";
        return { ...d, monitors, overall };
      });
    };
    socket.on("public:heartbeat", onBeat);
    return () => socket.off("public:heartbeat", onBeat);
  }, []);

  useEffect(() => { if (tick) load(); }, [tick]); // eslint-disable-line

  if (error) return <div className="min-h-screen grid place-items-center text-muted">{error}</div>;
  if (!data) return <div className="min-h-screen grid place-items-center text-muted">{t("common.loading")}</div>;

  const page = data.page;
  const meta = overallMeta[data.overall];
  const Icon = meta.icon;
  const ann = page.announcement ? announcementMeta[page.announcement_style] || announcementMeta.info : null;
  const AnnIcon = ann?.icon;
  const incidents = data.monitors
    .flatMap((m) => m.incidents.map((i) => ({ ...i, monitor: m.name })))
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <header className="text-center space-y-2">
          {page.logo_url ? (
            <img src={page.logo_url} alt={page.title} className="h-12 mx-auto object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <div className="inline-flex items-center gap-2 text-accent">
              <Activity size={22} /><span className="text-sm font-medium tracking-wide uppercase">{t("public.statusLabel")}</span>
            </div>
          )}
          <h1 className="text-3xl font-semibold text-fg">{page.title}</h1>
          {page.description && <p className="text-muted">{page.description}</p>}
        </header>

        {ann && (
          <div className={clsx("rounded-xl border px-5 py-4 flex items-start gap-3 text-sm", ann.cls)}>
            <AnnIcon size={18} className="mt-0.5 shrink-0" />
            <p className="whitespace-pre-line">{page.announcement}</p>
          </div>
        )}

        <div className={clsx("rounded-xl border px-5 py-4 flex items-center gap-3 text-lg font-medium", meta.cls)}>
          <Icon size={22} /> {t(meta.key)}
        </div>

        <div className="card divide-y divide-border">
          {data.monitors.map((m) => (
            <div key={m.id} className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={m.status} />
                  <span className="font-medium text-fg truncate">{m.name}</span>
                </div>
                {page.show_uptime && (
                  <div className="text-right text-xs text-muted shrink-0">
                    <span className="text-fg2 tabular-nums">{fmtPct(m.uptime_30d)}</span> {t("public.uptime30")}
                  </div>
                )}
              </div>
              {(page.show_bars || m.last_check) && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {page.show_bars && <HeartbeatBar beats={m.heartbeats} size={30} />}
                  <p className="text-xs text-muted">{fmtMs(m.last_response_time)} · {m.last_check ? timeAgo(m.last_check) : "—"}</p>
                </div>
              )}
            </div>
          ))}
          {data.monitors.length === 0 && <p className="p-8 text-center text-sm text-muted">{t("public.noMonitors")}</p>}
        </div>

        {page.show_incidents && (
          <section>
            <h2 className="text-sm uppercase tracking-wide text-muted mb-3">{t("public.incidents7d")}</h2>
            {incidents.length === 0 ? (
              <p className="card p-5 text-sm text-muted">{t("public.noIncidents")}</p>
            ) : (
              <ul className="card divide-y divide-border">
                {incidents.map((i, idx) => (
                  <li key={idx} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-fg">{i.monitor}</p>
                        <p className="text-xs text-muted">{fmtTime(i.started_at)}{i.resolved_at ? ` → ${fmtTime(i.resolved_at)}` : ""}</p>
                      </div>
                      <span className={clsx("tabular-nums text-xs shrink-0", i.resolved_at ? "text-muted" : "text-down")}>
                        {i.resolved_at ? fmtDuration(incidentDuration(i)) : t("public.ongoing")}
                      </span>
                    </div>
                    {/* Kabar manual dari admin — satu-satunya teks incident yang tampil ke publik */}
                    {(i.updates || []).length > 0 && (
                      <ul className="mt-2.5 space-y-2 border-l-2 border-accent/30 pl-3">
                        {i.updates.map((u, ui) => (
                          <li key={ui}>
                            <p className="text-xs">
                              <span className="text-accent font-medium">{t(`incident.status${u.status.charAt(0).toUpperCase()}${u.status.slice(1)}`)}</span>
                              <span className="text-muted"> · {fmtTime(u.created_at)}</span>
                            </p>
                            <p className="text-sm text-fg2">{u.message}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <footer className="text-center text-xs text-muted pt-6 space-y-1">
          {page.footer_text && <p className="text-fg3">{page.footer_text}</p>}
          {page.show_incidents && (
            <p>
              <a
                className="inline-flex items-center gap-1.5 hover:text-accent transition-colors"
                href={`/api/public/status/${page.slug}/feed.xml`}
                target="_blank"
                rel="noreferrer"
              >
                <Rss size={12} /> {t("public.subscribe")}
              </a>
            </p>
          )}
          <p>{t("public.poweredBy")}</p>
        </footer>
      </div>
    </div>
  );
}
