import { useEffect, useState } from "react";
import { Globe, Plus, Trash2, Pencil, ExternalLink, X, Copy } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";

const emptyForm = { title: "", slug: "", description: "", published: true, monitor_ids: [] };

export default function StatusPages() {
  const { monitors } = useMonitors();
  const { isAdmin } = useAuth();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = () => api("/status-pages").then(setList);
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault(); setError("");
    try {
      if (editing.id) await api(`/status-pages/${editing.id}`, { method: "PUT", body: editing });
      else await api("/status-pages", { method: "POST", body: editing });
      setEditing(null); load();
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!confirm(`Hapus status page "${p.title}"?`)) return;
    await api(`/status-pages/${p.id}`, { method: "DELETE" }); load();
  };
  const toggle = (id) => setEditing((f) => ({ ...f, monitor_ids: f.monitor_ids.includes(id) ? f.monitor_ids.filter((x) => x !== id) : [...f.monitor_ids, id] }));
  const publicUrl = (slug) => `${window.location.origin}/status/${slug}`;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Status Pages</h1>
          <p className="text-sm text-muted mt-1">Halaman publik untuk dibagikan ke user / klien</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setEditing({ ...emptyForm })}><Plus size={16} /> Buat</button>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {list.length === 0 && <p className="card p-8 text-center text-sm text-muted md:col-span-2">Belum ada status page.</p>}
        {list.map((p) => (
          <div key={p.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white flex items-center gap-2"><Globe size={15} className="text-accent" /> {p.title}
                  {!p.published && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5">draft</span>}
                </p>
                <a href={`/status/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-muted font-mono hover:text-accent inline-flex items-center gap-1 mt-1">
                  /status/{p.slug} <ExternalLink size={11} />
                </a>
                <p className="text-xs text-muted mt-2">{p.monitor_ids.length} monitor</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button className="btn-ghost !px-2.5" title="Salin link" onClick={() => navigator.clipboard.writeText(publicUrl(p.slug))}><Copy size={14} /></button>
                {isAdmin && <button className="btn-ghost !px-2.5" onClick={() => setEditing({ ...p })}><Pencil size={14} /></button>}
                {isAdmin && <button className="btn-danger !px-2.5" onClick={() => remove(p)}><Trash2 size={14} /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setEditing(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-white">{editing.id ? "Edit" : "Buat"} status page</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-muted hover:text-white"><X size={18} /></button>
            </div>
            <div><label className="label">Judul</label><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required /></div>
            <div><label className="label">Slug (URL)</label><input className="input font-mono" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="otomatis dari judul" /></div>
            <div><label className="label">Deskripsi</label><textarea className="input" rows={2} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
            <div>
              <label className="label">Monitor yang ditampilkan</label>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {monitors.map((m) => (
                  <label key={m.id} className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer", editing.monitor_ids.includes(m.id) ? "border-accent/60 bg-accent/5" : "border-border")}>
                    <input type="checkbox" className="accent-sky-400" checked={editing.monitor_ids.includes(m.id)} onChange={() => toggle(m.id)} />
                    <span className="text-sm">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-sky-400" checked={editing.published} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} /> Publikasikan</label>
            {error && <p className="text-sm text-down">{error}</p>}
            <button className="btn-primary">Simpan</button>
          </form>
        </div>
      )}
    </div>
  );
}
