import clsx from "clsx";
import { fmtTime } from "../lib/format.js";

const color = { 0: "bg-down", 1: "bg-up", 2: "bg-pending" };

// 20 heartbeat terakhir; slot kosong abu-abu; heartbeat saat maintenance berwarna indigo
export default function HeartbeatBar({ beats = [], size = 20, className }) {
  const padded = [...Array(Math.max(0, size - beats.length)).fill(null), ...beats.slice(-size)];
  return (
    <div className={clsx("flex items-center gap-[3px]", className)}>
      {padded.map((b, i) => (
        <span
          key={b?.id ?? `e${i}`}
          title={b ? `${b.maintenance ? "[maintenance] " : ""}${b.message || ""} — ${b.response_time ?? "-"} ms — ${fmtTime(b.created_at)}` : ""}
          className={clsx(
            "h-6 w-[7px] rounded-sm transition-colors",
            b ? (b.maintenance ? "bg-maint/70" : color[b.status]) : "bg-border",
            b && i === padded.length - 1 && b.status === 2 && "pulse-dot"
          )}
        />
      ))}
    </div>
  );
}
