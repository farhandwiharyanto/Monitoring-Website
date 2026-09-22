import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import clsx from "clsx";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import MonitorRow from "../components/MonitorRow.jsx";

const UNTAGGED = { id: 0, name: "Tanpa tag", color: "#64748b" };

// Halaman Monitors: dikelompokkan per tag, tiap grup bisa dilipat
export default function Monitors() {
  const { monitors, loading } = useMonitors();
  const { isAdmin } = useAuth();
  const [tags, setTags] = useState([]);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pw_groups_collapsed") || "{}"); } catch { return {}; }
  });

  useEffect(() => { api("/tags").then(setTags).catch(() => {}); }, [monitors.length]);

  const groups = useMemo(() => {
    const filtered = q ? monitors.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())) : monitors;
    const out = tags.map((t) => ({ tag: t, items: filtered.filter((m) => m.tags?.some((x) => x.id === t.id)) })).filter((g) => g.items.length);
    const untagged = filtered.filter((m) => !m.tags?.length);
    if (untagged.length) out.push({ tag: UNTAGGED, items: untagged });
    return out;
  }, [monitors, tags, q]);

  const toggle = (id) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try { localStorage.setItem("pw_groups_collapsed", JSON.stringify(next)); } catch {}
  };
  const summary = (items) => {
    const c = (s) => items.filter((m) => m.status === s).length;
    return [c(1) && `${c(1)} up`, c(0) && `${c(0)} down`, c(4) && `${c(4)} maint`, c(2) && `${c(2)} pending`, c(3) && `${c(3)} paused`].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Monitors</h1>
          <p className="text-sm text-muted mt-1">Dikelompokkan per tag / group</p>
        </div>
        {isAdmin && <Link to="/monitors/new" className="btn-primary hidden md:inline-flex"><Plus size={16} /> Monitor baru</Link>}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Cari monitor…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-muted text-sm">Memuat…</p>
      ) : groups.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">Belum ada monitor.</p>
      ) : (
        groups.map(({ tag, items }) => {
          const open = !collapsed[tag.id];
          const down = items.some((m) => m.status === 0);
          return (
            <section key={tag.id} className="card overflow-hidden">
              <button onClick={() => toggle(tag.id)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-panel2/60 transition-colors">
                {open ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                <span className="font-medium text-white">{tag.name}</span>
                <span className="text-xs text-muted">{items.length} monitor</span>
                <span className={clsx("ml-auto text-xs", down ? "text-down" : "text-muted")}>{summary(items)}</span>
              </button>
              {open && (
                <div className="border-t border-border">
                  {items.map((m) => <MonitorRow key={m.id} m={m} />)}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
