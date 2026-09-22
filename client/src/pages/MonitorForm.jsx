import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Save } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useMonitors } from "../lib/monitors.jsx";
import TagChip from "../components/TagChip.jsx";

const TYPES = [
  { v: "http", label: "HTTP(s)", desc: "Cek status code & keyword" },
  { v: "tcp", label: "TCP Port", desc: "Cek port terbuka" },
  { v: "ping", label: "Ping", desc: "ICMP echo ke host" },
  { v: "dns", label: "DNS", desc: "Resolve record DNS" },
];

const empty = {
  name: "", type: "http", url: "", hostname: "", port: "", method: "GET",
  interval_seconds: 60, timeout_seconds: 30, max_retries: 1,
  expected_status_codes: "200-299", keyword: "", dns_resolve_type: "A", dns_expected: "",
  notification_ids: [], tags: [],
};

export default function MonitorForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh } = useMonitors();
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
    setForm((f) => (f.tags.some((t) => t.name === n) ? f : { ...f, tags: [...f.tags, allTags.find((t) => t.name === n) || { name: n, color: "#38bdf8" }] }));
    setTagInput("");
  };
  const removeTag = (name) => setForm((f) => ({ ...f, tags: f.tags.filter((t) => t.name !== name) }));
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

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <Link to={id ? `/monitors/${id}` : "/"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft size={15} /> Kembali</Link>
      <h1 className="text-2xl font-semibold text-white">{id ? "Edit monitor" : "Monitor baru"}</h1>

      <section className="card p-6 space-y-5">
        <div>
          <label className="label">Tipe monitor</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TYPES.map((t) => (
              <button type="button" key={t.v} onClick={() => setForm((f) => ({ ...f, type: t.v }))}
                className={clsx("text-left rounded-lg border p-3 transition-colors", form.type === t.v ? "border-accent bg-accent/10" : "border-border hover:border-slate-600")}>
                <p className={clsx("text-sm font-medium", form.type === t.v ? "text-accent" : "text-slate-200")}>{t.label}</p>
                <p className="text-xs text-muted mt-0.5">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Nama</label>
          <input className="input" value={form.name} onChange={set("name")} placeholder="mis. Website utama" required />
        </div>

        {form.type === "http" ? (
          <div className="grid md:grid-cols-[1fr_120px] gap-4">
            <div><label className="label">URL</label><input className="input font-mono" value={form.url} onChange={set("url")} placeholder="https://example.com" /></div>
            <div><label className="label">Method</label>
              <select className="input" value={form.method} onChange={set("method")}>{["GET", "HEAD", "POST", "PUT", "OPTIONS"].map((m) => <option key={m}>{m}</option>)}</select>
            </div>
          </div>
        ) : (
          <div className={clsx("grid gap-4", form.type === "tcp" ? "md:grid-cols-[1fr_140px]" : form.type === "dns" ? "md:grid-cols-[1fr_120px]" : "")}>
            <div><label className="label">Hostname / IP</label><input className="input font-mono" value={form.hostname} onChange={set("hostname")} placeholder="example.com" /></div>
            {form.type === "tcp" && <div><label className="label">Port</label><input className="input" type="number" min="1" max="65535" value={form.port} onChange={set("port")} placeholder="443" /></div>}
            {form.type === "dns" && <div><label className="label">Record</label>
              <select className="input" value={form.dns_resolve_type} onChange={set("dns_resolve_type")}>{["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"].map((r) => <option key={r}>{r}</option>)}</select></div>}
          </div>
        )}
        {form.type === "dns" && <div><label className="label">Nilai yang diharapkan (opsional)</label><input className="input font-mono" value={form.dns_expected} onChange={set("dns_expected")} placeholder="mis. 1.2.3.4" /></div>}
      </section>

      <section className="card p-6 space-y-5">
        <h2 className="font-medium text-white">Pengecekan</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="label">Interval (detik)</label><input className="input" type="number" min="10" value={form.interval_seconds} onChange={set("interval_seconds")} /></div>
          <div><label className="label">Retries</label><input className="input" type="number" min="0" value={form.max_retries} onChange={set("max_retries")} /></div>
          <div><label className="label">Timeout (detik)</label><input className="input" type="number" min="1" value={form.timeout_seconds} onChange={set("timeout_seconds")} /></div>
        </div>
        <p className="text-xs text-muted -mt-2">Monitor dianggap <span className="text-down">down</span> setelah gagal berturut-turut lebih dari jumlah retries. Saat retry, cek diulang tiap ⅓ interval.</p>
        {form.type === "http" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="label">Expected status code</label><input className="input font-mono" value={form.expected_status_codes} onChange={set("expected_status_codes")} placeholder="200-299, 301" /></div>
            <div><label className="label">Keyword di body (opsional)</label><input className="input" value={form.keyword} onChange={set("keyword")} placeholder="mis. Welcome" /></div>
          </div>
        )}
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-medium text-white">Tag / group</h2>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg px-2 py-1.5 focus-within:border-accent/60">
          {form.tags.map((t) => <TagChip key={t.name} tag={t} onRemove={() => removeTag(t.name)} />)}
          <input
            className="flex-1 min-w-[140px] bg-transparent text-sm px-1 py-1 focus:outline-none placeholder:text-slate-600"
            placeholder="ketik tag lalu Enter…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } if (e.key === "Backspace" && !tagInput && form.tags.length) removeTag(form.tags[form.tags.length - 1].name); }}
          />
        </div>
        {allTags.filter((t) => !form.tags.some((x) => x.name === t.name)).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted self-center">Tag tersedia:</span>
            {allTags.filter((t) => !form.tags.some((x) => x.name === t.name)).map((t) => <TagChip key={t.id} tag={t} onClick={() => addTag(t.name)} />)}
          </div>
        )}
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-medium text-white">Notifikasi</h2>
        {notifs.length === 0 ? (
          <p className="text-sm text-muted">Belum ada channel. <Link to="/notifications" className="text-accent">Buat notifikasi</Link> dulu.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-2">
            {notifs.map((n) => (
              <label key={n.id} className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer", form.notification_ids.includes(n.id) ? "border-accent/60 bg-accent/5" : "border-border")}>
                <input type="checkbox" className="accent-sky-400" checked={form.notification_ids.includes(n.id)} onChange={() => toggleNotif(n.id)} />
                <span className="text-sm">{n.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted">{n.type}{n.is_default ? " · default" : ""}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {test && (
        <div className={clsx("rounded-lg border px-4 py-3 text-sm", test.loading ? "border-border text-muted" : test.ok ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down")}>
          {test.loading ? "Menguji…" : `${test.ok ? "OK" : "Gagal"} — ${test.message}${test.ms != null ? ` (${test.ms} ms)` : ""}`}
        </div>
      )}
      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}><Save size={15} /> {busy ? "Menyimpan…" : "Simpan"}</button>
        <button type="button" className="btn-ghost" onClick={runTest}><FlaskConical size={15} /> Uji sekarang</button>
      </div>
    </form>
  );
}
