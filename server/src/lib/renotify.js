import { prisma } from "../db.js";
import { config } from "../config.js";
import { STATUS } from "./status.js";
import { isInMaintenance } from "./maintenance.js";
import { blockingAncestor } from "./dependency.js";
import { notifyStillDown } from "../notifications/index.js";

// Pengingat berkala selama monitor masih down.
//
// Sebelum ini, gangguan jam dua pagi menghasilkan satu pesan lalu senyap sampai
// pulih. Pesan itu tenggelam, dan tidak ada apa pun yang mengingatkan lagi.
// Eskalasi tidak menutup celah ini: ia memanggil orang lain secara berjenjang
// lalu berhenti, sedangkan yang dibutuhkan kadang sekadar pengulangan kabar ke
// channel yang sama.
//
// Penyapu ini sengaja bekerja dari tabel incident, bukan dari timer di memori:
// proses yang mati dan digantikan tidak kehilangan jadwal pengingatnya.

// Incident yang sudah waktunya diingatkan lagi.
async function dueIncidents(now) {
  const open = await prisma.incident.findMany({
    where: {
      resolved_at: null,
      notified: true,      // alert pertamanya memang pernah terkirim
      suppressed: false,   // yang ditahan dependency tidak mengabari sejak awal
      maintenance: false,
      monitor: { renotify_minutes: { not: null }, active: true },
    },
    include: { monitor: true, escalation: true },
  });

  return open.filter((incident) => {
    const minutes = incident.monitor.renotify_minutes;
    if (!minutes || minutes <= 0) return false;
    // Rantai eskalasi yang sudah di-ack berarti ada yang menangani; pengingat
    // berhenti di situ, sama seperti tingkat eskalasi berikutnya dibatalkan.
    if (incident.escalation?.acknowledged_at) return false;
    const since = incident.last_notified_at || incident.started_at;
    return now - new Date(since).getTime() >= minutes * 60_000;
  });
}

// Dipanggil berkala oleh scheduler pada lokasi primary yang memegang lease.
export async function runDueRenotifications() {
  const now = Date.now();
  const due = await dueIncidents(now);

  for (const incident of due) {
    const monitor = incident.monitor;
    try {
      // Keadaan bisa berubah sejak incident dibuka: maintenance window baru
      // dimulai, atau induknya ikut down. Keduanya menahan pengingat tanpa
      // menggeser jadwalnya — begitu penahannya hilang, pengingat menyusul.
      if (await isInMaintenance(monitor.id)) continue;
      if (monitor.parent_id && (await blockingAncestor(monitor.id))) continue;

      // Pastikan monitornya memang masih down menurut heartbeat terakhir;
      // incident yang belum sempat ditutup tidak boleh mengirim kabar palsu.
      const last = await prisma.heartbeat.findFirst({
        where: { monitor_id: monitor.id, status: { in: [STATUS.DOWN, STATUS.UP] } },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
      });
      if (!last || last.status !== STATUS.DOWN) continue;

      const count = incident.renotify_count + 1;
      await prisma.incident.update({
        where: { id: incident.id },
        data: { last_notified_at: new Date(), renotify_count: count },
      });
      await notifyStillDown(monitor, incident, { reminder: count });
    } catch (err) {
      console.error(`[renotify] incident #${incident.id}:`, err.message);
    }
  }
}

// Batas jeda pengingat yang masuk akal: minimal semenit, maksimal sehari.
export function cleanRenotifyMinutes(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { error: "Jeda pengingat harus lebih dari 0 menit" };
  if (n > 1440) return { error: "Jeda pengingat maksimal 1440 menit (24 jam)" };
  return Math.round(n);
}

export const renotifyDefaultMinutes = () => config.renotifyDefaultMinutes;
