import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Save } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useI18n } from "../lib/i18n.jsx";
import TagChip from "../components/TagChip.jsx";

const TYPES = [
  { v: "http", label: "form.typeHttp", desc: "form.typeHttpDesc" },
  { v: "tcp", label: "form.typeTcp", desc: "form.typeTcpDesc" },
  { v: "ping", label: "form.typePing", desc: "form.typePingDesc" },
  { v: "dns", label: "form.typeDns", desc: "form.typeDnsDesc" },
  { v: "push", label: "form.typePush", desc: "form.typePushDesc" },
];

const empty = {
  name: "", type: "http", url: "", hostname: "", port: "", method: "GET",
  interval_seconds: 60, timeout_seconds: 30, max_retries: 1,
  expected_status_codes: "200-299", keyword: "", dns_resolve_type: "A", dns_expected: "",
  push_grace_seconds: 60, check_cert: true,
  notification_ids: [], tags: [],
};

export default function MonitorForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useMonitors();
  const { t } = useI18n();
  const [form, setForm] = useState(empty);
  const [notifs, setNotifs] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/notifications").then(setNotifs).catch(() => {});
    api("/tags").then(setAllTags).catch(() => {});
    if (id) api(`/monitors/${id}`).then((m) => setForm({ ...empty, ...m, port: m.port ?? "", url: m.url ?? "", hostname: m.hostname ?? "", keyword: m.keyword ?? "", dns_expected: m.dns_expected ?? "" }));
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const addTag = (name) => {
    const n = String(name || tagInput).trim().toLowerCase().replace(/\s+/g, "-");
    if (!n) return;
    setForm((f) => (f.tags.some((x) => x.name === n) ? f : { ...f, tags: [...f.tags, allTags.find((x) => x.name === n) || { name: n, color: "#38bdf8" }] }));
    setTagInput("");
  };
  const removeTag = (name) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x.name !== name) }));
  const toggleNotif = (nid) =>
    setForm((f) => ({ ...f, notification_ids: f.notification_ids.includes(nid) ? f.notification_ids.filter((x) => x !== nid) : [...f.notification_ids, nid] }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const saved = id ? await api(`/monitors/${id}`, { method: "PUT", body: form }) : await api("/monitors", { method: "POST", body: form });
      await refresh();
      navigate(`/monitors/${saved.id}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const runTest = async () => {
    setTest({ loading: true });
    try { setTest(await api("/monitors/test", { method: "POST", body: form })); }
    catch (err) { setTest({ ok: false, message: err.message }); }
  };

  const isPush = form.type === "push";
  const isHttps = form.type === "http" && /^https:/i.test(form.url || "");

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <Link to={id ? `/monitors/${id}` : "/"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft size={15} /> {t("common.back")}</Link>
      <h1 className="text-2xl font-semibold text-fg">{id ? t("form.editTitle") : t("form.newTitle")}</h1>

      <section className="card p-6 space-y-5">
        <div>
          <label className="label">{t("form.type")}</label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {TYPES.map((x) => (
              <button type="button" key={x.v} onClick={() => setForm((f) => ({ ...f, type: x.v }))}
                className={clsx("text-left rounded-lg border p-3 transition-colors", form.type === x.v ? "border-accent bg-accent/10" : "border-border hover:border-muted/50")}>
                <p className={clsx("text-sm font-medium", form.type === x.v ? "text-accent" : "text-fg2")}>{t(x.label)}</p>
                <p className="text-xs text-muted mt-0.5">{t(x.desc)}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">{t("form.name")}</label>
          <input className="input" value={form.name} onChange={set("name")} placeholder={t("form.namePlaceholder")} required />
        </div>

        {form.type === "http" ? (
          <div className="grid md:grid-cols-[1fr_120px] gap-4">
            <div><label className="label">{t("form.url")}</label><input className="input font-mono" value={form.url} onChange={set("url")} placeholder="https://example.com" /></div>
            <div><label className="label">{t("form.method")}</label>
              <select className="input" value={form.method} onChange={set("method")}>{["GET", "HEAD", "POST", "PUT", "OPTIONS"].map((m) => <option key={m}>{m}</option>)}</select>
            </div>
          </div>
        ) : isPush ? (
          <p className="text-sm text-muted">{t("form.pushNoTarget")}</p>
        ) : (
          <div className={clsx("grid gap-4", form.type === "tcp" ? "md:grid-cols-[1fr_140px]" : form.type === "dns" ? "md:grid-cols-[1fr_120px]" : "")}>
            <div><label className="label">{t("form.hostname")}</label><input className="input font-mono" value={form.hostname} onChange={set("hostname")} placeholder="example.com" /></div>
            {form.type === "tcp" && <div><label className="label">{t("form.port")}</label><input className="input" type="number" min="1" max="65535" value={form.port} onChange={set("port")} placeholder="443" /></div>}
            {form.type === "dns" && <div><label className="label">{t("form.record")}</label>
              <select className="input" value={form.dns_resolve_type} onChange={set("dns_resolve_type")}>{["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"].map((r) => <option key={r}>{r}</option>)}</select></div>}
          </div>
        )}
        {form.type === "dns" && <div><label className="label">{t("form.dnsExpected")}</label><input className="input font-mono" value={form.dns_expected} onChange={set("dns_expected")} placeholder="mis. 1.2.3.4" /></div>}
      </section>

      <section className="card p-6 space-y-5">
        <h2 className="font-medium text-fg">{t("form.checks")}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="label">{t("form.interval")}</label><input className="input" type="number" min="10" value={form.interval_seconds} onChange={set("interval_seconds")} /></div>
          {isPush ? (
            <div><label className="label">{t("form.grace")}</label><input className="input" type="number" min="0" value={form.push_grace_seconds} onChange={set("push_grace_seconds")} /></div>
          ) : (
            <>
              <div><label className="label">{t("form.retries")}</label><input className="input" type="number" min="0" value={form.max_retries} onChange={set("max_retries")} /></div>
              <div><label className="label">{t("form.timeout")}</label><input className="input" type="number" min="1" value={form.timeout_seconds} onChange={set("timeout_seconds")} /></div>
            </>
          )}
        </div>
        <p className="text-xs text-muted -mt-2">{isPush ? t("form.pushHint") : t("form.retryHint")}</p>
        {form.type === "http" && (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div><label className="label">{t("form.expectedStatus")}</label><input className="input font-mono" value={form.expected_status_codes} onChange={set("expected_status_codes")} placeholder="200-299, 301" /></div>
              <div><label className="label">{t("form.keyword")}</label><input className="input" value={form.keyword} onChange={set("keyword")} placeholder="mis. Welcome" /></div>
            </div>
            {isHttps && (
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-accent" checked={!!form.check_cert} onChange={(e) => setForm({ ...form, check_cert: e.target.checked })} />
                  {t("form.checkCert")}
                </label>
                <p className="text-xs text-muted mt-1 ml-6">{t("form.certHint")}</p>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-medium text-fg">{t("form.tags")}</h2>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg px-2 py-1.5 focus-within:border-accent/60">
          {form.tags.map((tag) => <TagChip key={tag.name} tag={tag} onRemove={() => removeTag(tag.name)} />)}
          <input
            className="flex-1 min-w-[140px] bg-transparent text-sm px-1 py-1 focus:outline-none placeholder:text-muted/60"
            placeholder={t("form.tagPlaceholder")}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } if (e.key === "Backspace" && !tagInput && form.tags.length) removeTag(form.tags[form.tags.length - 1].name); }}
          />
        </div>
        {allTags.filter((x) => !form.tags.some((y) => y.name === x.name)).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted self-center">{t("form.availableTags")}</span>
            {allTags.filter((x) => !form.tags.some((y) => y.name === x.name)).map((tag) => <TagChip key={tag.id} tag={tag} onClick={() => addTag(tag.name)} />)}
          </div>
        )}
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-medium text-fg">{t("form.notifications")}</h2>
        {notifs.length === 0 ? (
          <p className="text-sm text-muted">{t("form.noChannels")} <Link to="/notifications" className="text-accent">{t("form.createChannel")}</Link> {t("form.channelSuffix")}</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-2">
            {notifs.map((n) => (
              <label key={n.id} className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer", form.notification_ids.includes(n.id) ? "border-accent/60 bg-accent/5" : "border-border")}>
                <input type="checkbox" className="accent-accent" checked={form.notification_ids.includes(n.id)} onChange={() => toggleNotif(n.id)} />
                <span className="text-sm">{n.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">{n.type}{n.is_default ? " · default" : ""}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {test && (
        <div className={clsx("rounded-lg border px-4 py-3 text-sm", test.loading ? "border-border text-muted" : test.ok ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down")}>
          {test.loading ? t("form.testing") : `${test.ok ? t("form.testOk") : t("form.testFail")} — ${test.message}${test.ms != null ? ` (${test.ms} ms)` : ""}`}
        </div>
      )}
      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}><Save size={15} /> {busy ? t("common.saving") : t("common.save")}</button>
        {!isPush && <button type="button" className="btn-ghost" onClick={runTest}><FlaskConical size={15} /> {t("form.testNow")}</button>}
      </div>
    </form>
  );
}
