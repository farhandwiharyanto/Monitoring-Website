import clsx from "clsx";

export default function StatCard({ label, value, sub, icon: Icon, tone = "text-white" }) {
  return (
    <div className="card p-5 flex items-start justify-between">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted font-medium">{label}</p>
        <p className={clsx("mt-2 text-3xl font-semibold tabular-nums", tone)}>{value}</p>
        {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      </div>
      {Icon && (
        <span className="h-10 w-10 rounded-lg bg-panel2 grid place-items-center">
          <Icon size={18} className={tone} />
        </span>
      )}
    </div>
  );
}
