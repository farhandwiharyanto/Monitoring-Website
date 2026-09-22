// Evaluasi assertion terhadap body JSON sebuah response HTTP.
// Subset JSONPath yang disengaja kecil: cukup untuk menunjuk satu nilai,
// tanpa wildcard/filter, sehingga tidak butuh dependency dan mudah diprediksi.
//
//   $                     seluruh body
//   $.status              properti
//   $.data.items[0].id    properti bersarang + indeks array
//   $['nama dengan spasi'] properti dengan karakter khusus

export const ASSERTION_OPERATORS = ["eq", "ne", "gt", "lt", "gte", "lte", "contains", "regex", "exists", "notexists"];

// Operator yang tidak membutuhkan nilai pembanding
const VALUELESS = new Set(["exists", "notexists"]);
export const operatorNeedsValue = (op) => !VALUELESS.has(op);

const MISSING = Symbol("missing");

// "$.data.items[0].id" -> ["data", "items", 0, "id"]
export function parsePath(path) {
  const raw = String(path || "").trim();
  if (!raw || raw === "$") return [];
  if (!raw.startsWith("$")) throw new Error('Path harus diawali "$"');

  const parts = [];
  let i = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === ".") {
      i++;
      let name = "";
      while (i < raw.length && !".[".includes(raw[i])) name += raw[i++];
      if (!name) throw new Error("Nama properti kosong setelah titik");
      parts.push(name);
    } else if (ch === "[") {
      const close = raw.indexOf("]", i);
      if (close === -1) throw new Error('Kurung "[" tidak ditutup');
      let inner = raw.slice(i + 1, close).trim();
      if (/^-?\d+$/.test(inner)) parts.push(Number(inner));
      else if (/^'.*'$/.test(inner) || /^".*"$/.test(inner)) parts.push(inner.slice(1, -1));
      else throw new Error(`Indeks tidak valid: [${inner}]`);
      i = close + 1;
    } else {
      throw new Error(`Karakter tak terduga pada posisi ${i}: "${ch}"`);
    }
  }
  return parts;
}

// Ambil nilai pada path; MISSING bila salah satu segmen tidak ada.
function pick(value, parts) {
  let cur = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return MISSING;
    if (typeof part === "number") {
      if (!Array.isArray(cur)) return MISSING;
      const idx = part < 0 ? cur.length + part : part;
      if (idx < 0 || idx >= cur.length) return MISSING;
      cur = cur[idx];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur) || !(part in cur)) return MISSING;
      cur = cur[part];
    }
  }
  return cur;
}

const show = (v) => {
  if (v === MISSING) return "(tidak ada)";
  if (typeof v === "string") return JSON.stringify(v);
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 120 ? s.slice(0, 117) + "…" : s;
};

// Nilai dari form selalu string; samakan tipenya dengan nilai aktual bila masuk akal.
function coerce(actual, expected) {
  if (typeof actual === "number") {
    const n = Number(expected);
    return Number.isNaN(n) ? expected : n;
  }
  if (typeof actual === "boolean") {
    if (/^true$/i.test(expected)) return true;
    if (/^false$/i.test(expected)) return false;
  }
  return expected;
}

function compare(op, actual, rawExpected) {
  const expected = coerce(actual, String(rawExpected ?? ""));
  switch (op) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "contains":
      if (Array.isArray(actual)) return actual.some((x) => x === expected || String(x) === String(rawExpected ?? ""));
      return String(actual).includes(String(rawExpected ?? ""));
    case "regex":
      try { return new RegExp(String(rawExpected ?? "")).test(String(actual)); }
      catch { throw new Error("Regex tidak valid"); }
    default:
      throw new Error(`Operator tidak dikenal: ${op}`);
  }
}

// Ringkasan assertion untuk ditampilkan di form/detail: `$.status eq "ok"`
export function describeAssertion({ assertion_path, assertion_operator, assertion_value }) {
  if (!assertion_path || !assertion_operator) return null;
  return operatorNeedsValue(assertion_operator)
    ? `${assertion_path} ${assertion_operator} ${JSON.stringify(String(assertion_value ?? ""))}`
    : `${assertion_path} ${assertion_operator}`;
}

export const hasAssertion = (m) => !!(m?.assertion_path && m?.assertion_operator);

// Jalankan assertion terhadap teks body. Selalu mengembalikan
// { ok, message } — kegagalan parsing dianggap assertion gagal, bukan exception.
export function runAssertion(monitor, bodyText) {
  const expr = describeAssertion(monitor);
  let parts;
  try {
    parts = parsePath(monitor.assertion_path);
  } catch (err) {
    return { ok: false, message: `Assertion: path tidak valid — ${err.message}` };
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, message: "Assertion: response bukan JSON yang valid" };
  }

  const actual = pick(body, parts);
  const op = monitor.assertion_operator;

  if (op === "exists") {
    return actual === MISSING
      ? { ok: false, message: `Assertion gagal: ${monitor.assertion_path} tidak ada` }
      : { ok: true, message: `Assertion OK: ${monitor.assertion_path} ada (${show(actual)})` };
  }
  if (op === "notexists") {
    return actual === MISSING
      ? { ok: true, message: `Assertion OK: ${monitor.assertion_path} tidak ada` }
      : { ok: false, message: `Assertion gagal: ${monitor.assertion_path} seharusnya tidak ada, dapat ${show(actual)}` };
  }
  if (actual === MISSING) {
    return { ok: false, message: `Assertion gagal: ${monitor.assertion_path} tidak ada di response` };
  }

  let passed;
  try {
    passed = compare(op, actual, monitor.assertion_value);
  } catch (err) {
    return { ok: false, message: `Assertion: ${err.message}` };
  }
  return passed
    ? { ok: true, message: `Assertion OK: ${expr}` }
    : { ok: false, message: `Assertion gagal: ${expr} — nilai sebenarnya ${show(actual)}` };
}
