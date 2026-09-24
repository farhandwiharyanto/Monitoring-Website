import { useEffect, useState } from "react";
import { ScrollText, Search, X, Download, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { api, download } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import { fmtTime } from "../lib/format.js";

const PAGE = 50;
// Penanda yang dipakai server untuk nilai rahasia (lihat server/src/lib/audit.js)
const MASK = "•••";
const emptyFilters = { q: "", entity: "", action: "", actor: "", from: "", to: "" };

// Warna chip per jenis pelaku — sekadar agar baris API key & login gagal
// langsung terlihat berbeda dari perubahan biasa oleh admin.
const ACTOR_TONE = {
  user: "text-accent border-accent/40",
  apikey: "text-pending border-pending/40",
  anonymous: "text-down border-down/40",
  system: "text-muted border-border",
};

export default function Audit() {
  const { t } = useI18n();
  const [filters, setFilters] = useState(emptyFilters);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [options, setOptions] = useState({ actions: [], entities: [], actors: [], retention_days: null });
  const [open, setOpen] = useState(null); // id baris yang detail perubahannya dibuka
  const [error, setError] = useState("");

  const query = (extra = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) params.set(k, v);
    params.set("limit", String(PAGE));
    return params.toString();
  };

  useEffect(() => { api("/audit-logs/filters").then(setOptions).catch(() => {}); }, []);

  // Filter berubah → mulai lagi dari halaman pertama
  useEffect(() => {
    let cancelled = false;
    api(`/audit-logs?${query({ offset: 0 })}`)
      .then((d) => { if (!cancelled) { setRows(d.rows); setTotal(d.total); setOffset(d.rows.length); setError(""); } })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [filters]); // eslint-disable-line

  const loadMore = async () => {
    const d = await api(`/audit-logs?${query({ offset })}`);
    setRows((list) => [...list, ...d.rows]);
    setOffset((n) => n + d.rows.length);
    setTotal(d.total);
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const dirty = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg flex items-center gap-2"><ScrollText size={22} className="text-accent" /> {t("audit.title")}</h1>
          <p className="text-sm text-muted mt-1">{t("audit.subtitle")}</p>
        </div>
        <button className="btn-ghost" onClick={() => download(`/export/audit?format=csv&${query()}`)}>
          <Download size={15} /> {t("audit.exportCsv")}
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder={t("audit.search")} value={filters.q} onChange={set("q")} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="label">{t("audit.entity")}</label>
            <select className="input" value={filters.entity} onChange={set("entity")}>
              <option value="">{t("common.all")}</option>
              {options.entities.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t("audit.action")}</label>
            <select className="input" value={filters.action} onChange={set("action")}>
              <option value="">{t("common.all")}</option>
              {options.actions.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t("audit.actor")}</label>
            <select className="input" value={filters.actor} onChange={set("actor")}>
              <option value="">{t("common.all")}</option>
              {options.actors.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            </select>
          </div>
          <div><label className="label">{t("audit.from")}</label><input className="input" type="date" value={filters.from} onChange={set("from")} /></div>
          <div><label className="label">{t("audit.to")}</label><input className="input" type="date" value={filters.to} onChange={set("to")} /></div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>{t("audit.showing", { shown: rows.length, total })}</span>
          {dirty && (
            <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setFilters(emptyFilters)}>
              <X size={13} /> {t("audit.reset")}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-down">{error}</p>}

      <div className="card divide-y divide-border">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{dirty ? t("audit.noMatch") : t("audit.empty")}</p>
        ) : (
          rows.map((r) => {
            const expandable = r.changes && Object.keys(r.changes).length > 0;
            return (
              <div key={r.id} className="px-5 py-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="text-xs text-muted tabular-nums shrink-0 w-36">{fmtTime(r.created_at)}</span>
                  <span className={clsx("text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border shrink-0", ACTOR_TONE[r.actor_type] || ACTOR_TONE.system)}>
                    {t(`audit.type${r.actor_type.charAt(0).toUpperCase()}${r.actor_type.slice(1)}`)}
                  </span>
                  <span className="text-sm text-fg2 shrink-0">{r.actor}</span>
                  <code className="text-[11px] font-mono text-muted shrink-0">{r.action}</code>
                  <span className="text-sm text-fg flex-1 min-w-[12rem]">{r.summary}</span>
                  {r.ip && <span className="text-[11px] font-mono text-muted shrink-0">{r.ip}</span>}
                  {expandable && (
                    <button className="text-muted hover:text-fg shrink-0" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <ChevronRight size={15} className={clsx("transition-transform", open === r.id && "rotate-90")} />
                    </button>
                  )}
                </div>

                {expandable && open === r.id && (
                  <dl className="mt-2 ml-36 text-xs space-y-1">
                    {Object.entries(r.changes).map(([field, { from, to }]) => (
                      <div key={field} className="flex gap-2 flex-wrap">
                        <dt className="font-mono text-fg2">{field}</dt>
                        <dd className="text-muted" title={from === MASK || to === MASK ? t("audit.masked") : undefined}>
                          {t("audit.from_")} <span className="text-fg3">{String(from ?? "—")}</span>{" "}
                          {t("audit.to_")} <span className="text-fg2">{String(to ?? "—")}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })
        )}
      </div>

      {rows.length < total && (
        <button className="btn-ghost w-full justify-center" onClick={() => loadMore().catch((e) => setError(e.message))}>
          {t("audit.more")}
        </button>
      )}

      {options.retention_days && (
        <p className="text-xs text-muted text-center">{t("audit.retentionHint", { days: options.retention_days })}</p>
      )}
    </div>
  );
}
