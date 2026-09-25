import path from "node:path";
import { fileURLToPath } from "node:url";

// Check gRPC lewat protokol health checking standar
// (grpc.health.v1.Health/Check), yang dipakai Kubernetes, Envoy, dan
// kebanyakan service mesh. Karena protokolnya baku, monitor ini tidak perlu
// tahu apa pun tentang API milik service yang dipantau — cukup alamatnya.
//
// Service yang TIDAK memasang health service akan menjawab UNIMPLEMENTED.
// Itu tetap membuktikan servernya hidup dan menjawab gRPC, jadi diperlakukan
// sebagai UP dengan catatan — membuatnya DOWN akan menghasilkan alert palsu
// untuk service yang sebenarnya sehat.

const HEALTH_PROTO = path.join(path.dirname(fileURLToPath(import.meta.url)), "health.proto");

// grpc-js dan proto-loader berat dan hanya dipakai tipe ini, jadi dimuat saat
// dibutuhkan — instance yang tidak memantau gRPC tidak membayar ongkosnya.
let cached = null;
async function healthClientFactory() {
  if (cached) return cached;
  const [grpc, protoLoader] = await Promise.all([import("@grpc/grpc-js"), import("@grpc/proto-loader")]);
  const definition = protoLoader.loadSync(HEALTH_PROTO, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition);
  cached = { grpc, Health: proto.grpc.health.v1.Health };
  return cached;
}

const STATUS_TEXT = {
  SERVING: "melayani",
  NOT_SERVING: "tidak melayani",
  UNKNOWN: "tidak diketahui",
  SERVICE_UNKNOWN: "service tidak dikenal",
};

export function grpcTarget(monitor) {
  const host = String(monitor.hostname || "").trim();
  if (!host) return null;
  const port = Number(monitor.port) || 443;
  return `${host}:${port}`;
}

const configOf = (m) => (m.check_config && typeof m.check_config === "object" ? m.check_config : {});

// grpc-js membungkus kegagalan koneksi jadi kalimat panjang seperti
// "No connection established. Last error: Error: connect ECONNREFUSED x. Resolution note: ".
// Yang berguna hanya penyebab terakhirnya; sisanya memenuhi pesan heartbeat.
export function tidyError(err) {
  let text = String(err?.details || err?.message || "gagal");
  const marker = "Last error: ";
  if (text.includes(marker)) text = text.slice(text.indexOf(marker) + marker.length);
  text = text.replace(/\s*Resolution note:.*$/s, "").replace(/^Error:\s*/, "").trim();
  return text.replace(/\.$/, "").slice(0, 300) || "gagal";
}

export async function checkGrpc(monitor) {
  const target = grpcTarget(monitor);
  if (!target) return { ok: false, ms: 0, message: "Hostname belum diisi" };

  const timeoutSeconds = Math.min(Math.max(Number(monitor.timeout_seconds) || 10, 1), 120);
  const cfg = configOf(monitor);
  // Nama service yang ditanyakan. Kosong berarti kesehatan server secara
  // keseluruhan — itu yang dijawab kebanyakan implementasi.
  const service = String(cfg.grpc_service || "");
  const useTls = cfg.grpc_tls !== false && Number(monitor.port) !== 80;

  const start = performance.now();
  let client;
  try {
    const { grpc, Health } = await healthClientFactory();
    const credentials = useTls
      // Sertifikat internal sering tidak dikenal; yang diuji di sini adalah
      // "service ini menjawab", bukan rantai sertifikatnya. Monitor HTTPS yang
      // sudah ada punya pemeriksaan sertifikat tersendiri.
      ? grpc.credentials.createSsl(null, null, null, { checkServerIdentity: () => undefined })
      : grpc.credentials.createInsecure();
    client = new Health(target, credentials);

    const deadline = new Date(Date.now() + timeoutSeconds * 1000);
    const response = await new Promise((resolve, reject) => {
      client.Check({ service }, { deadline }, (err, res) => (err ? reject(err) : resolve(res)));
    });

    const ms = Math.round(performance.now() - start);
    const status = String(response?.status || "UNKNOWN");
    const label = STATUS_TEXT[status] || status;
    const named = service ? ` (${service})` : "";
    return status === "SERVING"
      ? { ok: true, ms, message: `gRPC SERVING${named}` }
      : { ok: false, ms, message: `gRPC ${status}${named} — ${label}` };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    // UNIMPLEMENTED (kode 12) = servernya hidup dan bicara gRPC, hanya tidak
    // memasang health service. Itu bukan gangguan.
    if (err?.code === 12) {
      return { ok: true, ms, message: "gRPC menjawab, tanpa health service (UNIMPLEMENTED)" };
    }
    return { ok: false, ms, message: tidyError(err) };
  } finally {
    client?.close?.();
  }
}
