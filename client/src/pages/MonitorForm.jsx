import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Save, Plus, X, ShieldCheck, Zap, Network, Siren } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api.js";
import { useMonitors } from "../lib/monitors.jsx";
import { useI18n } from "../lib/i18n.jsx";
import TagChip from "../components/TagChip.jsx";
import { fmtDuration } from "../lib/format.js";

const TYPES = [
  { v: "http", label: "form.typeHttp", desc: "form.typeHttpDesc" },
  { v: "tcp", label: "form.typeTcp", desc: "form.typeTcpDesc" },
  { v: "ping", label: "form.typePing", desc: "form.typePingDesc" },
  { v: "dns", label: "form.typeDns", desc: "form.typeDnsDesc" },
  { v: "push", label: "form.typePush", desc: "form.typePushDesc" },
  { v: "postgres", label: "form.typePostgres", desc: "form.typeDbDesc" },
  { v: "mysql", label: "form.typeMysql", desc: "form.typeDbDesc" },
  { v: "oracle", label: "form.typeOracle", desc: "form.typeDbDesc" },
  { v: "mssql", label: "form.typeMssql", desc: "form.typeDbDesc" },
  { v: "redis", label: "form.typeRedis", desc: "form.typeRedisDesc" },
  { v: "grpc", label: "form.typeGrpc", desc: "form.typeGrpcDesc" },
  { v: "kafka", label: "form.typeKafka", desc: "form.typeKafkaDesc" },
];

// Tipe yang targetnya berupa connection string, bukan hostname/URL
const DB_TYPES = ["postgres", "mysql", "oracle", "mssql", "redis"];
// Contoh yang ditampilkan di placeholder, sekaligus mengisyaratkan skema yang sah
const CONN_PLACEHOLDER = {
  postgres: "postgres://user:password@host:5432/nama_db",
  mysql: "mysql://user:password@host:3306/nama_db",
  oracle: "oracle://user:password@host:1521/SERVICE",
  mssql: "mssql://user:password@host:1433/nama_db?trustServerCertificate=true",
  redis: "redis://host:6379",
};

const OPERATORS = [
  ["eq", "form.opEq"], ["ne", "form.opNe"], ["gt", "form.opGt"], ["lt", "form.opLt"],
  ["gte", "form.opGte"], ["lte", "form.opLte"], ["contains", "form.opContains"],
  ["regex", "form.opRegex"], ["exists", "form.opExists"], ["notexists", "form.opNotexists"],
];
const VALUELESS_OPERATORS = new Set(["exists", "notexists"]);

const empty = {
  name: "", type: "http", url: "", hostname: "", port: "", method: "GET",
  interval_seconds: 60, timeout_seconds: 30, max_retries: 1,
  expected_status_codes: "200-299", keyword: "", dns_resolve_type: "A", dns_expected: "",
  push_grace_seconds: 60, check_cert: true,
  // Dependency: "" = tidak punya induk
  parent_id: "",
  // Escalation policy: "" = ikut policy default
  escalation_policy_id: "",
  // Target SLO dalam persen; "" = tanpa target
  slo_target: "",
  conn_uri: "",
  has_conn: false,
  check_config: {},
  latency_threshold_ms: "",
  renotify_minutes: "",
  // HTTP lanjutan
  auth_type: "none", auth_username: "", auth_password: "", auth_token: "",
  assertion_path: "", assertion_operator: "", assertion_value: "",
  // Webhook aksi (berlaku untuk semua tipe monitor)
  action_webhook_url: "", action_webhook_method: "POST",
  action_on_down: true, action_on_recover: false,
  notification_ids: [], tags: [],
};

// http_headers disimpan sebagai object; form memakai array agar barisnya bisa diurutkan
const headersToRows = (obj) =>
  obj && typeof obj === "object" ? Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? "") })) : [];
const rowsToHeaders = (rows) => {
  const out = {};
  for (const { key, value } of rows) {
    const name = String(key || "").trim();
    if (name) out[name] = String(value ?? "");
  }
  return out;
};

export default function MonitorForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { monitors, refresh } = useMonitors();
  const { t } = useI18n();
  const [form, setForm] = useState(empty);
  const [notifs, setNotifs] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [headerRows, setHeaderRows] = useState([]);
  const [actionHeaderRows, setActionHeaderRows] = useState([]);
  const [actionTest, setActionTest] = useState(null);
  const [error, setError] = useState("");
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/notifications").then(setNotifs).catch(() => {});
    api("/tags").then(setAllTags).catch(() => {});
    api("/oncall/policies").then(setPolicies).catch(() => setPolicies([]));
    if (id)
      api(`/monitors/${id}`).then((m) => {
        setForm({
          ...empty, ...m,
          port: m.port ?? "", url: m.url ?? "", hostname: m.hostname ?? "",
          keyword: m.keyword ?? "", dns_expected: m.dns_expected ?? "",
          parent_id: m.parent_id ?? "",
          escalation_policy_id: m.escalation_policy_id ?? "",
          slo_target: m.slo_target ?? "",
          // Connection string tidak pernah dikirim balik server; field-nya
          // dibiarkan kosong dan hanya diisi bila memang mau diganti.
          conn_uri: "",
          has_conn: !!m.has_conn,
          check_config: m.check_config || {},
          latency_threshold_ms: m.latency_threshold_ms ?? "",
          renotify_minutes: m.renotify_minutes ?? "",
          auth_type: m.auth_type || "none",
          auth_username: m.auth_username ?? "",
          // Password & token tidak pernah dikirim server; kosong = pertahankan yang tersimpan
          auth_password: "", auth_token: "",
          assertion_path: m.assertion_path ?? "",
          assertion_operator: m.assertion_operator ?? "",
          assertion_value: m.assertion_value ?? "",
        });
        setHeaderRows(headersToRows(m.http_headers));
        setActionHeaderRows(headersToRows(m.action_webhook_headers));
      });
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Calon induk: semua monitor kecuali dirinya sendiri dan keturunannya —
  // keduanya pasti ditolak server karena membentuk lingkaran.
  const selfId = id ? Number(id) : null;
  const descendants = new Set();
  if (selfId) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of monitors || []) {
        const parentId = m.parent?.id;
        if (parentId && (parentId === selfId || descendants.has(parentId)) && !descendants.has(m.id)) {
          descendants.add(m.id);
          grew = true;
        }
      }
    }
  }
  const parentOptions = (monitors || []).filter((m) => m.id !== selfId && !descendants.has(m.id));

  // "99.9%" sulit dibayangkan; ditampilkan juga sebagai jatah downtime per 30 hari
  const sloValue = Number(form.slo_target);
  const sloBudget =
    form.slo_target !== "" && Number.isFinite(sloValue) && sloValue > 0 && sloValue < 100
      ? t("slo.budgetPreview", { target: sloValue, duration: fmtDuration(Math.round(((100 - sloValue) / 100) * 30 * 86400)) })
      : null;
  const parentOf = (monitors || []).find((m) => m.id === Number(form.parent_id));
  const policyOf = policies.find((p) => p.id === Number(form.escalation_policy_id));
  const addTag = (name) => {
    const n = String(name || tagInput).trim().toLowerCase().replace(/\s+/g, "-");
    if (!n) return;
    setForm((f) => (f.tags.some((x) => x.name === n) ? f : { ...f, tags: [...f.tags, allTags.find((x) => x.name === n) || { name: n, color: "#38bdf8" }] }));
    setTagInput("");
  };
  const removeTag = (name) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x.name !== name) }));
  const toggleNotif = (nid) =>
    setForm((f) => ({ ...f, notification_ids: f.notification_ids.includes(nid) ? f.notification_ids.filter((x) => x !== nid) : [...f.notification_ids, nid] }));

  // Bentuk payload untuk server: header jadi object, id disertakan agar
  // endpoint test bisa memakai kredensial tersimpan.
  const payload = () => ({
    ...form,
    id: id ? Number(id) : undefined,
    http_headers: rowsToHeaders(headerRows),
    action_webhook_headers: rowsToHeaders(actionHeaderRows),
  });

  // Uji webhook aksi memakai konfigurasi yang TERSIMPAN, jadi monitor harus
  // disimpan lebih dulu sebelum tombol ini berguna.
  const runActionTest = async () => {
    setActionTest({ loading: true });
    try {
      const res = await api(`/monitors/${id}/test-action-webhook`, { method: "POST" });
      setActionTest({ ok: true, ...res });
    } catch (err) {
      setActionTest({ ok: false, message: err.message });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = payload();
      const saved = id ? await api(`/monitors/${id}`, { method: "PUT", body }) : await api("/monitors", { method: "POST", body });
      await refresh();
      navigate(`/monitors/${saved.id}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const runTest = async () => {
    setTest({ loading: true });
    try { setTest(await api("/monitors/test", { method: "POST", body: payload() })); }
    catch (err) { setTest({ ok: false, message: err.message }); }
  };

  const isPush = form.type === "push";
  const isDb = DB_TYPES.includes(form.type);
  // Pratinjau ekspresi yang akan dijalankan server, mis. $.status eq "ok"
  const assertionPreview =
    form.assertion_path && form.assertion_operator
      ? VALUELESS_OPERATORS.has(form.assertion_operator)
        ? `${form.assertion_path} ${form.assertion_operator}`
        : `${form.assertion_path} ${form.assertion_operator} ${JSON.stringify(form.assertion_value ?? "")}`
      : null;
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
        ) : form.type === "kafka" ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t("form.kafkaBrokers")}</label>
              <input
                className="input font-mono"
                value={form.check_config?.kafka_brokers || ""}
                onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, kafka_brokers: e.target.value } }))}
                placeholder="broker1:9092, broker2:9092"
              />
              <p className="text-xs text-muted mt-1.5">{t("form.kafkaBrokersHint")}</p>
            </div>
            <div>
              <label className="label">{t("form.kafkaTopic")}</label>
              <input
                className="input font-mono"
                value={form.check_config?.kafka_topic || ""}
                onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, kafka_topic: e.target.value } }))}
                placeholder="pesanan.masuk"
              />
              <p className="text-xs text-muted mt-1.5">{t("form.kafkaTopicHint")}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-accent"
                checked={form.check_config?.kafka_ssl === true}
                onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, kafka_ssl: e.target.checked } }))}
              />
              {t("form.kafkaSsl")}
            </label>
          </div>
        ) : isDb ? (
          <div className="space-y-4">
            <div>
              <label className="label">{t("form.connUri")}</label>
              <input
                className="input font-mono"
                type="password"
                autoComplete="new-password"
                value={form.conn_uri}
                onChange={set("conn_uri")}
                placeholder={CONN_PLACEHOLDER[form.type]}
              />
              {/* Connection string tidak pernah dikirim balik oleh server, jadi
                  saat mengedit field ini kosong dan boleh dibiarkan kosong */}
              <p className="text-xs text-muted mt-1.5">{id && form.has_conn ? t("form.connKeep") : t("form.connHint")}</p>
            </div>
            {form.type !== "redis" && (
              <div>
                <label className="label">{t("form.dbQuery")}</label>
                <input
                  className="input font-mono"
                  value={form.check_config?.query || ""}
                  onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, query: e.target.value } }))}
                  placeholder="SELECT 1"
                />
                <p className="text-xs text-muted mt-1.5">{t("form.dbQueryHint")}</p>
              </div>
            )}
          </div>
        ) : (
          <div className={clsx("grid gap-4", form.type === "tcp" || form.type === "grpc" ? "md:grid-cols-[1fr_140px]" : form.type === "dns" ? "md:grid-cols-[1fr_120px]" : "")}>
            <div><label className="label">{t("form.hostname")}</label><input className="input font-mono" value={form.hostname} onChange={set("hostname")} placeholder="example.com" /></div>
            {(form.type === "tcp" || form.type === "grpc") && <div><label className="label">{t("form.port")}</label><input className="input" type="number" min="1" max="65535" value={form.port} onChange={set("port")} placeholder={form.type === "grpc" ? "50051" : "443"} /></div>}
            {form.type === "dns" && <div><label className="label">{t("form.record")}</label>
              <select className="input" value={form.dns_resolve_type} onChange={set("dns_resolve_type")}>{["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"].map((r) => <option key={r}>{r}</option>)}</select></div>}
          </div>
        )}
        {form.type === "grpc" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t("form.grpcService")}</label>
              <input
                className="input font-mono"
                value={form.check_config?.grpc_service || ""}
                onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, grpc_service: e.target.value } }))}
                placeholder={t("form.grpcServicePlaceholder")}
              />
              <p className="text-xs text-muted mt-1.5">{t("form.grpcServiceHint")}</p>
            </div>
            <div className="flex items-end pb-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={form.check_config?.grpc_tls !== false}
                  onChange={(e) => setForm((f) => ({ ...f, check_config: { ...f.check_config, grpc_tls: e.target.checked } }))}
                />
                {t("form.grpcTls")}
              </label>
            </div>
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

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">{t("slo.label")}</label>
            <input
              className="input max-w-[12rem]" type="number" step="0.001" min="0" max="99.999"
              value={form.slo_target} onChange={set("slo_target")} placeholder={t("slo.placeholder")}
            />
            <p className="text-xs text-muted mt-1.5">{t("slo.hint")}</p>
            {sloBudget && <p className="text-xs text-accent mt-1">{sloBudget}</p>}
          </div>
          <div>
            <label className="label">{t("latency.label")}</label>
            <input
              className="input max-w-[12rem]" type="number" step="1" min="1" max="300000"
              value={form.latency_threshold_ms} onChange={set("latency_threshold_ms")} placeholder={t("latency.placeholder")}
            />
            <p className="text-xs text-muted mt-1.5">{t("latency.hint")}</p>
          </div>
        </div>

        <div>
          <label className="label">{t("renotify.label")}</label>
          <input
            className="input max-w-[12rem]" type="number" step="1" min="1" max="1440"
            value={form.renotify_minutes} onChange={set("renotify_minutes")} placeholder={t("renotify.placeholder")}
          />
          <p className="text-xs text-muted mt-1.5">{t("renotify.hint")}</p>
        </div>
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

      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-medium text-fg flex items-center gap-2"><Network size={15} className="text-accent" /> {t("dep.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("dep.subtitle")}</p>
        </div>
        <div>
          <label className="label">{t("dep.parent")}</label>
          <select className="input" value={form.parent_id ?? ""} onChange={set("parent_id")}>
            <option value="">{t("dep.noParent")}</option>
            {parentOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <p className="text-xs text-muted mt-2">
            {form.parent_id
              ? t("dep.parentHint", { parent: parentOf?.name || "" })
              : t("dep.noParentHint")}
          </p>
        </div>
      </section>

      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-medium text-fg flex items-center gap-2"><Siren size={15} className="text-accent" /> {t("esc.monitorLabel")}</h2>
          <p className="text-sm text-muted mt-1">{t("esc.subtitle")}</p>
        </div>
        <div>
          <select className="input" value={form.escalation_policy_id ?? ""} onChange={set("escalation_policy_id")}>
            <option value="">{t("esc.noPolicy")}</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.is_default ? ` (${t("esc.defaultBadge")})` : ""}</option>
            ))}
          </select>
          <p className="text-xs text-muted mt-2">
            {form.escalation_policy_id
              ? t("esc.policyHint", { name: policyOf?.name || "" })
              : t("esc.noPolicyHint")}
          </p>
        </div>
      </section>

      {form.type === "http" && (
        <section className="card p-6 space-y-6">
          <h2 className="font-medium text-fg">{t("form.advanced")}</h2>

          <div className="space-y-2">
            <label className="label">{t("form.headers")}</label>
            {headerRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input font-mono flex-1" placeholder={t("form.headerName")} value={row.key}
                  onChange={(e) => setHeaderRows((rows) => rows.map((r, x) => (x === i ? { ...r, key: e.target.value } : r)))}
                />
                <input
                  className="input font-mono flex-[2]" placeholder={t("form.headerValue")} value={row.value}
                  onChange={(e) => setHeaderRows((rows) => rows.map((r, x) => (x === i ? { ...r, value: e.target.value } : r)))}
                />
                <button type="button" className="btn-ghost !px-2.5" onClick={() => setHeaderRows((rows) => rows.filter((_, x) => x !== i))}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="btn-ghost !py-1.5" onClick={() => setHeaderRows((rows) => [...rows, { key: "", value: "" }])}>
              <Plus size={14} /> {t("form.addHeader")}
            </button>
            <p className="text-xs text-muted">{t("form.headersHint")}</p>
          </div>

          <div className="space-y-3">
            <label className="label">{t("form.auth")}</label>
            <div className="grid grid-cols-3 gap-2">
              {[["none", "form.authNone"], ["basic", "form.authBasic"], ["bearer", "form.authBearer"]].map(([v, key]) => (
                <button
                  type="button" key={v} onClick={() => setForm((f) => ({ ...f, auth_type: v }))}
                  className={clsx("rounded-lg border px-3 py-2 text-sm", form.auth_type === v ? "border-accent bg-accent/10 text-accent" : "border-border text-fg2")}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            {form.auth_type === "basic" && (
              <div className="grid md:grid-cols-2 gap-4">
                <div><label className="label">{t("form.authUsername")}</label><input className="input" value={form.auth_username} onChange={set("auth_username")} autoComplete="off" /></div>
                <div><label className="label">{t("form.authPassword")}</label><input className="input" type="password" value={form.auth_password} onChange={set("auth_password")} autoComplete="new-password" placeholder={id ? "••••••••" : ""} /></div>
              </div>
            )}
            {form.auth_type === "bearer" && (
              <div><label className="label">{t("form.authToken")}</label><input className="input font-mono" type="password" value={form.auth_token} onChange={set("auth_token")} autoComplete="new-password" placeholder={id ? "••••••••" : ""} /></div>
            )}
            {form.auth_type !== "none" && (
              <p className="text-xs text-muted flex items-start gap-1.5">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-up" />
                {t("form.authStoredHint")}{id ? ` ${t("form.authKeepHint")}` : ""}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <label className="label">{t("form.assertion")}</label>
            <div className="grid md:grid-cols-[1fr_170px] gap-2">
              <input className="input font-mono" placeholder={t("form.assertionPathPlaceholder")} value={form.assertion_path} onChange={set("assertion_path")} />
              <select className="input" value={form.assertion_operator} onChange={set("assertion_operator")}>
                <option value="">—</option>
                {OPERATORS.map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}
              </select>
            </div>
            {form.assertion_operator && !VALUELESS_OPERATORS.has(form.assertion_operator) && (
              <input className="input font-mono" placeholder={t("form.assertionValuePlaceholder")} value={form.assertion_value} onChange={set("assertion_value")} />
            )}
            {assertionPreview && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted">{t("form.assertionPreview")}</span>
                <code className="rounded bg-panel2 px-2 py-1 font-mono text-fg2">{assertionPreview}</code>
                <button type="button" className="text-muted hover:text-down" onClick={() => setForm((f) => ({ ...f, assertion_path: "", assertion_operator: "", assertion_value: "" }))}>
                  {t("form.assertionClear")}
                </button>
              </div>
            )}
            <p className="text-xs text-muted">{t("form.assertionHint")}</p>
          </div>
        </section>
      )}

      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-medium text-fg flex items-center gap-2"><Zap size={15} className="text-accent" /> {t("action.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("action.subtitle")}</p>
        </div>

        <div className="grid md:grid-cols-[1fr_120px] gap-4">
          <div><label className="label">{t("action.url")}</label><input className="input font-mono" value={form.action_webhook_url} onChange={set("action_webhook_url")} placeholder="https://n8n.contoh.com/webhook/restart" /></div>
          <div><label className="label">{t("action.method")}</label>
            <select className="input" value={form.action_webhook_method} onChange={set("action_webhook_method")}>
              {["POST", "GET", "PUT"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {form.action_webhook_url && (
          <>
            <div className="space-y-2">
              <label className="label">{t("action.headers")}</label>
              {actionHeaderRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input font-mono flex-1" placeholder={t("form.headerName")} value={row.key}
                    onChange={(e) => setActionHeaderRows((rows) => rows.map((r, x) => (x === i ? { ...r, key: e.target.value } : r)))} />
                  <input className="input font-mono flex-[2]" placeholder={t("form.headerValue")} value={row.value}
                    onChange={(e) => setActionHeaderRows((rows) => rows.map((r, x) => (x === i ? { ...r, value: e.target.value } : r)))} />
                  <button type="button" className="btn-ghost !px-2.5" onClick={() => setActionHeaderRows((rows) => rows.filter((_, x) => x !== i))}><X size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn-ghost !py-1.5" onClick={() => setActionHeaderRows((rows) => [...rows, { key: "", value: "" }])}>
                <Plus size={14} /> {t("form.addHeader")}
              </button>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-accent" checked={!!form.action_on_down} onChange={(e) => setForm({ ...form, action_on_down: e.target.checked })} />
                {t("action.onDown")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-accent" checked={!!form.action_on_recover} onChange={(e) => setForm({ ...form, action_on_recover: e.target.checked })} />
                {t("action.onRecover")}
              </label>
            </div>

            {id && (
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" className="btn-ghost" onClick={runActionTest} disabled={actionTest?.loading}>
                  <FlaskConical size={14} /> {actionTest?.loading ? t("action.testing") : t("action.test")}
                </button>
                {actionTest && !actionTest.loading && (
                  <span className={clsx("text-sm", actionTest.ok ? "text-up" : "text-down")}>
                    {actionTest.ok
                      ? `${t("action.testOk")} (HTTP ${actionTest.status_code} · ${actionTest.duration_ms} ms)`
                      : `${t("action.testFail")}: ${actionTest.message || actionTest.error}`}
                  </span>
                )}
              </div>
            )}
          </>
        )}
        <p className="text-xs text-muted">{t("action.hint")}</p>
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
