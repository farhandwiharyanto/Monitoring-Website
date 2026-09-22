import { useEffect, useState } from "react";
import { Globe, Plus, Trash2, Pencil, ExternalLink, X, Copy } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useAuth } from "../lib/auth.jsx";
import TagChip from "../components/TagChip.jsx";
import { useI18n } from "../lib/i18n.jsx";

const emptyForm = {
  title: "", slug: "", description: "", published: true, monitor_ids: [], tag_ids: [],
  logo_url: "", accent_color: "#38bdf8", theme: "dark",
  show_uptime: true, show_bars: true, show_incidents: true,
  footer_text: "", announcement: "", announcement_style: "info", custom_domain: "",
};

// Field boolean dikirim apa adanya; field teks kosong dikirim sebagai string kosong
// (server mengubahnya jadi null).
const toBody = (f) => ({ ...f, logo_url: f.logo_url || "", footer_text: f.footer_text || "", announcement: f.announcement || "", custom_domain: f.custom_domain || "" });

export default function StatusPages() {
  const { monitors } = useMonitors();
  const { isAdmin } = useAuth();
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);
  const [tags, setTags] = useState([]);

  const load = () => api("/status-pages").then(setList);
  useEffect(() => { load(); api("/tags").then(setTags).catch(() => {}); }, []);

  const save = async (e) => {
    e.preventDefault(); setError("");
    try {
      const body = toBody(editing);
      if (editing.id) await api(`/status-pages/${editing.id}`, { method: "PUT", body });
      else await api("/status-pages", { method: "POST", body });
      setEditing(null); load();
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!confirm(t("pages.confirmDelete", { title: p.title }))) return;
    await api(`/status-pages/${p.id}`, { method: "DELETE" }); load();
  };
  const toggle = (id) => setEditing((f) => ({ ...f, monitor_ids: f.monitor_ids.includes(id) ? f.monitor_ids.filter((x) => x !== id) : [...f.monitor_ids, id] }));
  const toggleTag = (id) => setEditing((f) => ({ ...f, tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter((x) => x !== id) : [...f.tag_ids, id] }));
  const publicUrl = (p) => (p.custom_domain ? `https://${p.custom_domain}` : `${window.location.origin}/status/${p.slug}`);
  const copy = (p) => { navigator.clipboard.writeText(publicUrl(p)); setCopied(p.id); setTimeout(() => setCopied(null), 1500); };
  const setField = (k, v) => setEditing((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{t("pages.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("pages.subtitle")}</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => { setEditing({ ...emptyForm }); setError(""); }}><Plus size={16} /> {t("common.create")}</button>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {list.length === 0 && <p className="card p-8 text-center text-sm text-muted md:col-span-2">{t("pages.empty")}</p>}
        {list.map((p) => (
          <div key={p.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-fg flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.accent_color }} />
                  {p.logo_url
                    ? <img src={p.logo_url} alt="" className="h-4 w-4 rounded object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                    : <Globe size={15} className="text-accent" />}
                  {p.title}
                  {!p.published && <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-1.5">{t("common.draft")}</span>}
                </p>
                <a href={`/status/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-muted font-mono hover:text-accent inline-flex items-center gap-1 mt-1">
                  /status/{p.slug} <ExternalLink size={11} />
                </a>
                {p.custom_domain && <p className="text-xs text-muted font-mono mt-0.5">{p.custom_domain}</p>}
                <p className="text-xs text-muted mt-2">
                  {t("monitors.count", { n: p.monitor_ids.length })}
                  {(p.tag_ids || []).length > 0 && ` + ${p.tag_ids.length} tag`}
                  {p.announcement && <span className="ml-2 text-pending">· {t("pages.announcement")}</span>}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button className="btn-ghost !px-2.5" title={copied === p.id ? t("common.copied") : t("common.copy")} onClick={() => copy(p)}><Copy size={14} className={copied === p.id ? "text-up" : ""} /></button>
                {isAdmin && <button className="btn-ghost !px-2.5" onClick={() => { setEditing({ ...emptyForm, ...p, tag_ids: p.tag_ids || [], logo_url: p.logo_url || "", footer_text: p.footer_text || "", announcement: p.announcement || "", custom_domain: p.custom_domain || "", description: p.description || "" }); setError(""); }}><Pencil size={14} /></button>}
                {isAdmin && <button className="btn-danger !px-2.5" onClick={() => remove(p)}><Trash2 size={14} /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => setEditing(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card w-full max-w-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-fg">{editing.id ? t("pages.formEdit") : t("pages.formNew")}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-muted hover:text-fg"><X size={18} /></button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="label">{t("pages.fieldTitle")}</label><input className="input" value={editing.title} onChange={(e) => setField("title", e.target.value)} required /></div>
              <div><label className="label">{t("pages.slug")}</label><input className="input font-mono" value={editing.slug} onChange={(e) => setField("slug", e.target.value)} placeholder={t("pages.slugPlaceholder")} /></div>
            </div>
            <div><label className="label">{t("pages.description")}</label><textarea className="input" rows={2} value={editing.description || ""} onChange={(e) => setField("description", e.target.value)} /></div>

            {tags.length > 0 && (
              <div>
                <label className="label">{t("pages.byTag")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <TagChip key={tag.id} tag={tag} active={editing.tag_ids.includes(tag.id)} onClick={() => toggleTag(tag.id)} />
                  ))}
                </div>
                <p className="text-xs text-muted mt-1.5">{t("pages.byTagHint")}</p>
              </div>
            )}

            <div>
              <label className="label">{t("pages.monitorsShown")}</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {monitors.map((m) => (
                  <label key={m.id} className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer", editing.monitor_ids.includes(m.id) ? "border-accent/60 bg-accent/5" : "border-border")}>
                    <input type="checkbox" className="accent-accent" checked={editing.monitor_ids.includes(m.id)} onChange={() => toggle(m.id)} />
                    <span className="text-sm">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <h3 className="text-sm font-medium text-fg">{t("pages.appearance")}</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div><label className="label">{t("pages.logoUrl")}</label><input className="input font-mono" value={editing.logo_url} onChange={(e) => setField("logo_url", e.target.value)} placeholder="https://…/logo.png" /></div>
                <div>
                  <label className="label">{t("pages.accentColor")}</label>
                  <div className="flex gap-2">
                    <input type="color" className="h-[38px] w-12 rounded-lg border border-border bg-bg p-1" value={editing.accent_color} onChange={(e) => setField("accent_color", e.target.value)} />
                    <input className="input font-mono" value={editing.accent_color} onChange={(e) => setField("accent_color", e.target.value)} />
                  </div>
                </div>
              </div>
              <div>
                <label className="label">{t("pages.theme")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[["dark", "settings.themeDark"], ["light", "settings.themeLight"], ["auto", "settings.themeAuto"]].map(([v, key]) => (
                    <button type="button" key={v} onClick={() => setField("theme", v)} className={clsx("rounded-lg border px-3 py-2 text-sm", editing.theme === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>{t(key)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {[["show_uptime", "pages.showUptime"], ["show_bars", "pages.showBars"], ["show_incidents", "pages.showIncidents"]].map(([k, key]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-accent" checked={!!editing[k]} onChange={(e) => setField(k, e.target.checked)} /> {t(key)}
                  </label>
                ))}
              </div>
              <div><label className="label">{t("pages.footerText")}</label><input className="input" value={editing.footer_text} onChange={(e) => setField("footer_text", e.target.value)} /></div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <h3 className="text-sm font-medium text-fg">{t("pages.announcement")}</h3>
              <textarea className="input" rows={2} value={editing.announcement} onChange={(e) => setField("announcement", e.target.value)} placeholder={t("pages.announcementPlaceholder")} />
              <div>
                <label className="label">{t("pages.announcementStyle")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[["info", "pages.styleInfo"], ["warning", "pages.styleWarning"], ["critical", "pages.styleCritical"]].map(([v, key]) => (
                    <button type="button" key={v} onClick={() => setField("announcement_style", v)} className={clsx("rounded-lg border px-3 py-2 text-sm", editing.announcement_style === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}>{t(key)}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <label className="label">{t("pages.customDomain")}</label>
              <input className="input font-mono" value={editing.custom_domain} onChange={(e) => setField("custom_domain", e.target.value)} placeholder={t("pages.customDomainPlaceholder")} />
              <p className="text-xs text-muted mt-1.5">{t("pages.customDomainHint")}</p>
            </div>

            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-accent" checked={editing.published} onChange={(e) => setField("published", e.target.checked)} /> {t("pages.publish")}</label>
            {error && <p className="text-sm text-down">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary">{t("common.save")}</button>
              {editing.id && <a className="btn-ghost" href={`/status/${editing.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t("pages.preview")}</a>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
