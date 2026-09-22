import clsx from "clsx";
import { statusMeta } from "../lib/format.js";

export default function StatusBadge({ status, className }) {
  const m = statusMeta[status] || statusMeta[2];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", m.color, m.ring, `bg-current/10`, className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", m.dot, status === 2 && "pulse-dot")} />
      {m.label}
    </span>
  );
}
