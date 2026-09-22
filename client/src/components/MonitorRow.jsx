import { Link } from "react-router-dom";
import clsx from "clsx";
import { Wrench, Globe2 } from "lucide-react";
import HeartbeatBar from "./HeartbeatBar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import TagChip from "./TagChip.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { fmtPct, fmtMs, monitorTarget, timeAgo } from "../lib/format.js";

export default function MonitorRow({ m }) {
  const { t } = useI18n();
  return (
    <Link
      to={`/monitors/${m.id}`}
      className="grid grid-cols-[1fr_auto] lg:grid-cols-[minmax(0,1.6fr)_auto_110px_110px_110px] items-center gap-4 px-5 py-3.5 border-b border-border last:border-0 hover:bg-panel2/60 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <StatusBadge status={m.status} />
          <span className="font-medium text-fg truncate">{m.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5 py-0.5">{m.type}</span>
          {m.in_maintenance && (
            <span className="inline-flex items-center gap-1 text-[10px] text-maint" title={m.maintenance_window?.title}>
              <Wrench size={11} /> {m.maintenance_window?.title}
            </span>
          )}
          {m.location_split && (
            <span className="inline-flex items-center gap-1 text-[10px] text-pending border border-pending/40 bg-pending/10 rounded px-1.5 py-0.5" title={m.locations?.map((l) => `${l.location}: ${l.status === 1 ? "up" : "down"}`).join(" · ")}>
              <Globe2 size={11} /> {t("dash.splitBadge")}
            </span>
          )}
          {m.tags?.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        </div>
        <p className="mt-1 text-xs text-muted truncate font-mono">{monitorTarget(m)}</p>
      </div>
      <HeartbeatBar beats={m.heartbeats} className="justify-self-end" />
      <div className="hidden lg:block text-right">
        <p className={clsx("text-sm tabular-nums", m.status === 0 ? "text-down" : "text-fg2")}>{fmtMs(m.last_response_time)}</p>
        <p className="text-[11px] text-muted">{m.last_check ? timeAgo(m.last_check) : t("monitors.notChecked")}</p>
      </div>
      <div className="hidden lg:block text-right">
        <p className="text-sm tabular-nums">{fmtPct(m.uptime_24h)}</p>
        <p className="text-[11px] text-muted">{t("monitors.last24h")}</p>
      </div>
      <div className="hidden lg:block text-right">
        <p className="text-sm tabular-nums">{fmtPct(m.uptime_30d)}</p>
        <p className="text-[11px] text-muted">{t("monitors.last30d")}</p>
      </div>
    </Link>
  );
}
