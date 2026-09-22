import clsx from "clsx";

export default function TagChip({ tag, active, onClick, onRemove, className }) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium border transition-colors",
        active ? "text-white" : "text-slate-300",
        onClick && "hover:text-white",
        className
      )}
      style={{ borderColor: tag.color + (active ? "" : "66"), background: tag.color + (active ? "40" : "1a") }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
      {tag.name}
      {onRemove && (
        <span role="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-0.5 text-slate-400 hover:text-white">×</span>
      )}
    </Comp>
  );
}
