import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { notifyEscalation } from "../notifications/index.js";
import { currentShift } from "./oncall.js";

// Eskalasi berjenjang: saat sebuah monitor down, alert biasa tetap disiarkan ke
// semua channel monitor seperti sebelumnya, lalu rantai ini berjalan di atasnya
// — tingkat demi tingkat, sampai ada yang meng-acknowledge atau monitor pulih.
//
// Seluruh tingkat dijadwalkan sekaligus saat rantai dibuat. Dua akibatnya
// disengaja: cron cukup satu query "mana yang sudah jatuh tempo", dan menyunting
// policy tidak mengubah rantai yang sedang berjalan.

export const newAckToken = () => randomBytes(24).toString("hex");
export const ackUrl = (token) => `${config.baseUrl}/api/oncall/ack/${token}`;

const STOP_REASONS = {
  acknowledged: "ditangani",
  recovered: "monitor pulih",
  paused: "monitor dijeda",
  resolved: "incident ditutup",
  exhausted: "seluruh tingkat & putaran sudah dikirim",
};
export const stopReasonText = (r) => STOP_REASONS[r] || r || null;

// Policy yang berlaku untuk sebuah monitor: pilihannya sendiri, atau policy yang
// ditandai default. Policy yang dipilih tapi sedang nonaktif TIDAK jatuh ke
// default — admin sudah menyatakan pilihannya, mematikannya berarti mematikan
// eskalasi untuk monitor itu.
export async function policyFor(monitor) {
  const where = monitor.escalation_policy_id ? { id: monitor.escalation_policy_id } : { is_default: true };
  const policy = await prisma.escalationPolicy.findFirst({
    where: { ...where, active: true },
    include: { steps: { orderBy: [{ step_order: "asc" }, { id: "asc" }] } },
  });
  return policy?.steps?.length ? policy : null;
}

// Satu putaran tingkat, jedanya dihitung dari `base`
function roundDeliveries(policy, base, round) {
  return policy.steps.map((step, i) => {
    const delay = Math.max(0, step.delay_minutes || 0);
    return {
      round,
      step_order: i + 1,
      delay_minutes: delay,
      due_at: new Date(base + delay * 60_000),
      target: step.target === "channel" ? "channel" : "oncall",
      schedule_id: step.target === "channel" ? null : step.schedule_id,
      notification_id: step.target === "channel" ? step.notification_id : null,
    };
  });
}

// Mulai rantai untuk satu incident. Dipanggil dari alur alert, tepat setelah
// alert "down" pertama dikirim — jadi incident yang alert-nya ditahan dependency
// atau maintenance window tidak pernah sampai ke sini.
export async function startEscalation(monitor, incident) {
  const policy = await policyFor(monitor);
  if (!policy) return null;

  // Jeda dihitung dari saat alert pertama keluar, bukan dari started_at incident.
  // Kalau memakai started_at, incident yang alert-nya tertunda (mis. baru selesai
  // maintenance window) akan langsung menembakkan seluruh tingkat sekaligus.
  const base = Date.now();

  try {
    const escalation = await prisma.escalation.create({
      data: {
        incident_id: incident.id,
        monitor_id: monitor.id,
        policy_id: policy.id,
        ack_token: newAckToken(),
        deliveries: { create: roundDeliveries(policy, base, 1) },
      },
    });
    // Tingkat berjeda 0 menit tidak perlu menunggu tick cron berikutnya
    runDueDeliveries().catch((e) => console.error("[escalation]", e));
    return escalation;
  } catch (err) {
    // incident_id unik: rantai sudah ada, mis. karena dipanggil dua kali
    if (err.code === "P2002") return null;
    throw err;
  }
}

// Hentikan rantai sebuah incident. Aman dipanggil untuk incident yang tidak
// punya rantai maupun yang rantainya sudah berhenti.
export async function stopEscalation(incidentId, reason) {
  const esc = await prisma.escalation.findUnique({ where: { incident_id: Number(incidentId) } });
  if (!esc || esc.stopped_at) return null;
  const [updated] = await prisma.$transaction([
    prisma.escalation.update({ where: { id: esc.id }, data: { stopped_at: new Date(), stopped_reason: reason } }),
    prisma.escalationDelivery.updateMany({
      where: { escalation_id: esc.id, status: "pending" },
      data: { status: "cancelled" },
    }),
  ]);
  console.log(`[escalation] #${esc.id} berhenti: ${stopReasonText(reason)}`);
  return updated;
}

// "Saya tangani" — dari tombol di UI (dengan incidentId) atau dari tautan di
// pesan notifikasi (dengan token). Menghentikan sisa tingkat yang belum dikirim.
export async function acknowledge({ token, incidentId }, by) {
  const where = token ? { ack_token: String(token) } : { incident_id: Number(incidentId) };
  const esc = await prisma.escalation.findFirst({
    where,
    include: { monitor: { select: { id: true, name: true } }, incident: { select: { id: true, cause: true, started_at: true, resolved_at: true } } },
  });
  if (!esc) return { ok: false, status: 404, error: "Eskalasi tidak ditemukan" };
  if (esc.acknowledged_at) {
    return { ok: true, already: true, escalation: esc, by: esc.acknowledged_by };
  }
  // Rantai yang berhenti karena monitor pulih/dijeda sudah tidak perlu di-ack.
  // Yang berhenti karena seluruh tingkat habis masih boleh — menyatakan "saya
  // tangani" tetap berarti walau tidak ada lagi yang bisa dihentikan.
  if (esc.stopped_at && esc.stopped_reason !== "exhausted") {
    return { ok: false, status: 409, error: `Eskalasi sudah berhenti (${stopReasonText(esc.stopped_reason)})`, escalation: esc };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.escalation.update({
      where: { id: esc.id },
      data: { acknowledged_at: now, acknowledged_by: by || null, stopped_at: esc.stopped_at || now, stopped_reason: "acknowledged" },
    }),
    prisma.escalationDelivery.updateMany({ where: { escalation_id: esc.id, status: "pending" }, data: { status: "cancelled" } }),
  ]);
  console.log(`[escalation] #${esc.id} di-ack oleh ${by || "?"}`);
  return { ok: true, escalation: { ...esc, acknowledged_at: now, acknowledged_by: by || null }, by };
}

// Sasaran satu tingkat, baru diketahui saat jatuh tempo: siapa yang bertugas
// bisa berganti antara rantai dibuat dan tingkat ini dikirim.
async function resolveTarget(delivery) {
  if (delivery.target === "channel") {
    const notification = delivery.notification_id
      ? await prisma.notification.findUnique({ where: { id: delivery.notification_id } })
      : null;
    if (!notification) return { label: "Channel (sudah dihapus)", reason: "Notifikasi sasaran sudah dihapus" };
    return { notification, label: `Channel: ${notification.name}` };
  }

  const schedule = delivery.schedule_id
    ? await prisma.onCallSchedule.findUnique({ where: { id: delivery.schedule_id }, select: { id: true, name: true } })
    : null;
  if (!schedule) return { label: "On-call (jadwal sudah dihapus)", reason: "Jadwal on-call sasaran sudah dihapus" };

  const shift = await currentShift(schedule.id);
  if (!shift) return { label: `On-call ${schedule.name}: tidak ada yang bertugas`, reason: "Tidak ada shift yang berjalan saat ini" };

  const contact = shift.user?.oncall_notification;
  if (!contact) {
    return {
      label: `On-call ${schedule.name}: ${shift.user.username} (tanpa kontak)`,
      reason: `${shift.user.username} belum punya kontak on-call`,
    };
  }
  const notification = await prisma.notification.findUnique({ where: { id: contact.id } });
  if (!notification) {
    return { label: `On-call ${schedule.name}: ${shift.user.username}`, reason: "Kontak on-call sudah dihapus" };
  }
  return { notification, label: `On-call ${schedule.name}: ${shift.user.username} (${notification.name})` };
}

async function deliverOne(delivery, levelCount) {
  const esc = delivery.escalation;

  // Rantai bisa berhenti antara query "yang jatuh tempo" dan pengiriman ini
  const fresh = await prisma.escalation.findUnique({ where: { id: esc.id }, select: { stopped_at: true } });
  if (fresh?.stopped_at) {
    await prisma.escalationDelivery.update({ where: { id: delivery.id }, data: { status: "cancelled" } });
    return;
  }

  const resolved = await resolveTarget(delivery);
  if (!resolved.notification) {
    // Sasaran kosong bukan alasan menghentikan rantai: tingkat berikutnya justru
    // jaring pengamannya. Dicatat supaya kelihatan di UI kenapa tidak terkirim.
    await prisma.escalationDelivery.update({
      where: { id: delivery.id },
      data: { status: "skipped", sent_at: new Date(), target_label: resolved.label, error: resolved.reason },
    });
    console.warn(`[escalation] #${esc.id} tingkat ${delivery.step_order} dilewati: ${resolved.reason}`);
    return;
  }

  try {
    await notifyEscalation(resolved.notification, {
      monitor: esc.monitor,
      incident: esc.incident,
      level: delivery.step_order,
      levelCount,
      round: delivery.round,
      delayMinutes: delivery.delay_minutes,
      targetLabel: resolved.label,
      ackUrl: ackUrl(esc.ack_token),
    });
    await prisma.escalationDelivery.update({
      where: { id: delivery.id },
      data: { status: "sent", sent_at: new Date(), target_label: resolved.label, notification_id: resolved.notification.id },
    });
    console.log(`[escalation] #${esc.id} tingkat ${delivery.step_order} → ${resolved.label}`);
  } catch (err) {
    await prisma.escalationDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", sent_at: new Date(), target_label: resolved.label, notification_id: resolved.notification.id, error: String(err.message).slice(0, 500) },
    });
    console.error(`[escalation] #${esc.id} tingkat ${delivery.step_order} gagal: ${err.message}`);
  }
}

// Rantai yang seluruh tingkatnya sudah dijalankan diulang dari tingkat pertama
// bila policy-nya meminta, atau ditandai selesai supaya tidak ikut terbawa di
// query "yang masih berjalan" selamanya.
//
// Berbeda dari saat rantai dibuat, putaran ulang membaca policy yang BERLAKU
// SEKARANG: kalau admin sudah mengubah atau menonaktifkannya, putaran berikutnya
// mengikuti perubahan itu.
async function closeExhausted(now = new Date()) {
  const open = await prisma.escalation.findMany({
    where: { stopped_at: null },
    select: { id: true, round: true, policy_id: true, deliveries: { where: { status: "pending" }, select: { id: true }, take: 1 } },
  });
  for (const esc of open.filter((e) => e.deliveries.length === 0)) {
    const policy = esc.policy_id
      ? await prisma.escalationPolicy.findFirst({
          where: { id: esc.policy_id, active: true },
          include: { steps: { orderBy: [{ step_order: "asc" }, { id: "asc" }] } },
        })
      : null;
    if (policy?.steps.length && esc.round <= policy.repeat_times) {
      const round = esc.round + 1;
      const base = now.getTime() + Math.max(1, policy.repeat_minutes) * 60_000;
      // Bersyarat pada putaran lama supaya dua proses tidak sama-sama menambah putaran
      const { count } = await prisma.escalation.updateMany({ where: { id: esc.id, round: esc.round, stopped_at: null }, data: { round } });
      if (count) {
        await prisma.escalationDelivery.createMany({ data: roundDeliveries(policy, base, round).map((d) => ({ ...d, escalation_id: esc.id })) });
        console.log(`[escalation] #${esc.id} diulang: putaran ${round}`);
      }
      continue;
    }
    await prisma.escalation.updateMany({ where: { id: esc.id, stopped_at: null }, data: { stopped_at: now, stopped_reason: "exhausted" } });
  }
}

// Satu putaran tidak boleh tumpang tindih dengan putaran sebelumnya: pengiriman
// notifikasi bisa memakan belasan detik karena retry-nya, sedangkan cron-nya
// jauh lebih rapat dari itu.
let running = false;

export async function runDueDeliveries(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const due = await prisma.escalationDelivery.findMany({
      where: { status: "pending", due_at: { lte: now }, escalation: { stopped_at: null } },
      include: {
        escalation: {
          include: {
            monitor: true,
            incident: { select: { id: true, cause: true, started_at: true, resolved_at: true } },
          },
        },
      },
      orderBy: [{ due_at: "asc" }, { id: "asc" }],
      take: 50,
    });

    // Jumlah tingkat per putaran untuk teks "tingkat 2/3" di pesan
    const counts = new Map();
    for (const key of new Set(due.map((d) => `${d.escalation_id}:${d.round}`))) {
      const [id, round] = key.split(":").map(Number);
      counts.set(key, await prisma.escalationDelivery.count({ where: { escalation_id: id, round } }));
    }

    for (const d of due) {
      await deliverOne(d, counts.get(`${d.escalation_id}:${d.round}`) || d.step_order).catch((e) =>
        console.error(`[escalation] delivery #${d.id}:`, e)
      );
    }
    await closeExhausted(now);
  } finally {
    running = false;
  }
}

// --- Bentuk untuk API/UI ---

export const shapeDelivery = (d) => ({
  id: d.id,
  level: d.step_order,
  round: d.round,
  delay_minutes: d.delay_minutes,
  due_at: d.due_at,
  status: d.status,
  sent_at: d.sent_at,
  target: d.target,
  target_label: d.target_label,
  error: d.error,
});

export function shapeEscalation(esc) {
  if (!esc) return null;
  const deliveries = (esc.deliveries || []).map(shapeDelivery);
  const next = deliveries.find((d) => d.status === "pending") || null;
  return {
    id: esc.id,
    incident_id: esc.incident_id,
    monitor_id: esc.monitor_id,
    policy: esc.policy ? { id: esc.policy.id, name: esc.policy.name } : null,
    started_at: esc.started_at,
    round: esc.round,
    acknowledged_at: esc.acknowledged_at,
    acknowledged_by: esc.acknowledged_by,
    stopped_at: esc.stopped_at,
    stopped_reason: esc.stopped_reason,
    stopped_reason_text: stopReasonText(esc.stopped_reason),
    active: !esc.stopped_at,
    levels: deliveries,
    // Tingkat berikutnya yang akan dikirim — dipakai UI untuk "15 menit lagi"
    next_level: next,
  };
}

const escalationInclude = {
  policy: { select: { id: true, name: true } },
  deliveries: { orderBy: [{ round: "asc" }, { step_order: "asc" }] },
};

export async function escalationForIncident(incidentId) {
  const esc = await prisma.escalation.findUnique({
    where: { incident_id: Number(incidentId) },
    include: escalationInclude,
  });
  return shapeEscalation(esc);
}

// Rantai untuk banyak incident sekaligus (daftar incident di UI)
export async function escalationMap(incidentIds) {
  const map = new Map();
  if (!incidentIds.length) return map;
  const rows = await prisma.escalation.findMany({
    where: { incident_id: { in: incidentIds } },
    include: escalationInclude,
  });
  for (const r of rows) map.set(r.incident_id, shapeEscalation(r));
  return map;
}

// Ringkasan untuk dashboard: berapa rantai yang masih berjalan & belum di-ack
export async function escalationStats() {
  const [active, acknowledged] = await Promise.all([
    prisma.escalation.count({ where: { stopped_at: null } }),
    prisma.escalation.count({ where: { acknowledged_at: { not: null }, incident: { resolved_at: null } } }),
  ]);
  return { active, acknowledged };
}
