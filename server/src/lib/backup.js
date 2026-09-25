import { prisma } from "../db.js";
import { newPushToken } from "../routes/push.js";

// Backup & restore konfigurasi.
//
// Gunanya satu: memindahkan seluruh penyiapan ke instance lain — server baru,
// lingkungan staging, atau pemulihan setelah kehilangan database — tanpa
// menyusun ulang puluhan monitor dengan tangan.
//
// Yang TIDAK ikut: data deret waktu (heartbeat, incident, audit log) dan
// pengguna beserta passwordnya. Backup ini soal konfigurasi, bukan riwayat.

export const BACKUP_VERSION = 3;

// Kolom yang tidak boleh ikut dipulihkan: hasil pengamatan, bukan konfigurasi.
// Kalau ikut dibawa, instance baru akan mengaku sudah pernah memeriksa
// sertifikat dan memberi peringatan yang salah sejak menit pertama.
const RUNTIME_FIELDS = [
  "id", "created_at", "updated_at", "push_token",
  "cert_expires_at", "cert_issuer", "cert_subject", "cert_checked_at",
  "cert_chain_valid", "cert_chain_error", "cert_notified_threshold",
];

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

export async function buildBackup() {
  const [monitors, tags, statusPages, maintenance, notifications, policies, schedules] = await Promise.all([
    prisma.monitor.findMany({ include: { tags: { include: { tag: true } }, notifications: true }, orderBy: { id: "asc" } }),
    prisma.tag.findMany({ orderBy: { id: "asc" } }),
    prisma.statusPage.findMany({
      include: { monitors: { orderBy: { sort_order: "asc" } }, tags: { include: { tag: true } } },
      orderBy: { id: "asc" },
    }),
    prisma.maintenanceWindow.findMany({ orderBy: { id: "asc" } }),
    prisma.notification.findMany({ orderBy: { id: "asc" } }),
    prisma.escalationPolicy.findMany({ include: { steps: { orderBy: { step_order: "asc" } } }, orderBy: { id: "asc" } }),
    prisma.onCallSchedule.findMany({ include: { shifts: { include: { user: { select: { username: true } } } } }, orderBy: { id: "asc" } }),
  ]);

  // Relasi dirujuk lewat NAMA, bukan id. Id tidak ada artinya di instance
  // tujuan, sedangkan nama itulah yang dikenali manusia saat memeriksa hasil
  // pemulihan.
  const notifName = new Map(notifications.map((n) => [n.id, n.name]));
  const monitorName = new Map(monitors.map((m) => [m.id, m.name]));
  const scheduleName = new Map(schedules.map((s) => [s.id, s.name]));

  return {
    exported_at: new Date().toISOString(),
    version: BACKUP_VERSION,
    note:
      "Berisi kredensial monitor (Basic Auth, Bearer token, connection string database) dalam bentuk TERENKRIPSI. " +
      "Hanya bisa dibuka oleh instance dengan ENCRYPTION_KEY atau JWT_SECRET yang sama. Perlakukan berkas ini sebagai rahasia. " +
      "Tidak berisi: konfigurasi notifikasi (token/webhook URL), push token, pengguna, dan data deret waktu.",

    monitors: monitors.map((m) => ({
      ...omit(m, [...RUNTIME_FIELDS, "tags", "notifications", "parent_id", "escalation_policy_id"]),
      // Induk dan policy juga dirujuk lewat nama
      parent: m.parent_id ? monitorName.get(m.parent_id) || null : null,
      escalation_policy: m.escalation_policy_id ? null : null,
      has_push_token: m.type === "push",
      tags: m.tags.map((x) => x.tag.name),
      notifications: m.notifications.map((x) => notifName.get(x.notification_id)).filter(Boolean),
    })),

    tags: tags.map((t) => omit(t, ["id", "created_at"])),

    // config sengaja tidak diekspor: berisi bot token, webhook URL, dan
    // password SMTP dalam bentuk polos, tidak terenkripsi seperti kredensial
    // monitor. Setelah dipulihkan, tiap channel harus diisi ulang.
    notifications: notifications.map((n) => ({ ...omit(n, ["id", "created_at", "config"]), config_required: true })),

    status_pages: statusPages.map((p) => ({
      ...omit(p, ["id", "created_at", "monitors", "tags"]),
      monitors: p.monitors.map((x) => monitorName.get(x.monitor_id)).filter(Boolean),
      tags: p.tags.map((x) => x.tag.name),
    })),

    maintenance_windows: maintenance.map((w) => ({
      ...omit(w, ["id", "created_at", "monitor_id"]),
      monitor: monitorName.get(w.monitor_id) || null,
    })),

    escalation_policies: policies.map((p) => ({
      ...omit(p, ["id", "created_at", "updated_at", "steps"]),
      steps: p.steps.map((s) => ({
        ...omit(s, ["id", "policy_id", "schedule_id", "notification_id"]),
        schedule: s.schedule_id ? scheduleName.get(s.schedule_id) || null : null,
        notification: s.notification_id ? notifName.get(s.notification_id) || null : null,
      })),
    })),

    oncall_schedules: schedules.map((s) => ({
      ...omit(s, ["id", "created_at", "updated_at", "shifts"]),
      shifts: s.shifts.map((sh) => ({
        ...omit(sh, ["id", "created_at", "schedule_id", "user_id", "user"]),
        username: sh.user?.username || null,
      })),
    })),
  };
}

// --- Restore ---
//
// Selalu MENGGABUNG, tidak pernah menghapus. Entri yang namanya sudah ada
// dilewati, bukan ditimpa: memulihkan backup ke instance yang sudah terisi
// karena itu tidak pernah bisa menghapus pekerjaan orang lain, dan menjalankan
// restore dua kali menghasilkan keadaan yang sama.
//
// Konsekuensinya disebut terang-terangan di ringkasan hasil: yang dilewati
// dihitung dan dinamai, supaya tidak ada yang mengira sesuatu telah diperbarui.

const asArray = (v) => (Array.isArray(v) ? v : []);

export function validateBackup(payload) {
  if (!payload || typeof payload !== "object") return "Berkas backup tidak terbaca sebagai JSON";
  if (!Number.isInteger(payload.version)) return "Berkas ini bukan backup Pulsewatch (tidak ada nomor versi)";
  if (payload.version > BACKUP_VERSION) {
    return `Backup versi ${payload.version} dibuat oleh Pulsewatch yang lebih baru dari instance ini (versi ${BACKUP_VERSION})`;
  }
  const bagian = ["monitors", "tags", "notifications", "status_pages", "maintenance_windows"];
  if (!bagian.some((k) => Array.isArray(payload[k]))) return "Backup tidak berisi satu pun bagian yang dikenali";
  return null;
}

export async function restoreBackup(payload) {
  const hasil = {
    dibuat: { monitors: 0, tags: 0, notifications: 0, status_pages: 0, maintenance_windows: 0, escalation_policies: 0, oncall_schedules: 0, shifts: 0 },
    dilewati: { monitors: [], tags: [], notifications: [], status_pages: [], escalation_policies: [], oncall_schedules: [] },
    peringatan: [],
  };

  // --- Tag ---
  const tagId = new Map((await prisma.tag.findMany()).map((t) => [t.name, t.id]));
  for (const t of asArray(payload.tags)) {
    if (!t?.name || tagId.has(t.name)) { if (t?.name) hasil.dilewati.tags.push(t.name); continue; }
    const dibuat = await prisma.tag.create({ data: { name: String(t.name).slice(0, 100), color: t.color || "#38bdf8" } });
    tagId.set(dibuat.name, dibuat.id);
    hasil.dibuat.tags++;
  }

  // --- Notifikasi (tanpa config: harus diisi ulang) ---
  const notifId = new Map((await prisma.notification.findMany()).map((n) => [n.name, n.id]));
  for (const n of asArray(payload.notifications)) {
    if (!n?.name || notifId.has(n.name)) { if (n?.name) hasil.dilewati.notifications.push(n.name); continue; }
    const dibuat = await prisma.notification.create({
      data: { name: String(n.name).slice(0, 100), type: String(n.type || "webhook"), config: {}, is_default: !!n.is_default },
    });
    notifId.set(dibuat.name, dibuat.id);
    hasil.dibuat.notifications++;
  }
  if (hasil.dibuat.notifications) {
    hasil.peringatan.push(
      `${hasil.dibuat.notifications} channel notifikasi dibuat tanpa kredensial — isi ulang token/URL-nya sebelum bisa mengirim.`
    );
  }

  // --- Jadwal on-call (shift dipetakan lewat username) ---
  const scheduleId = new Map((await prisma.onCallSchedule.findMany()).map((s) => [s.name, s.id]));
  const userId = new Map((await prisma.user.findMany({ select: { id: true, username: true } })).map((u) => [u.username, u.id]));
  for (const s of asArray(payload.oncall_schedules)) {
    if (!s?.name || scheduleId.has(s.name)) { if (s?.name) hasil.dilewati.oncall_schedules.push(s.name); continue; }
    const dibuat = await prisma.onCallSchedule.create({
      data: { name: String(s.name).slice(0, 120), description: s.description || null, timezone: s.timezone || "Asia/Jakarta", active: s.active !== false },
    });
    scheduleId.set(dibuat.name, dibuat.id);
    hasil.dibuat.oncall_schedules++;

    for (const sh of asArray(s.shifts)) {
      // Pengguna tidak ikut dalam backup, jadi shift milik orang yang belum ada
      // di instance ini dilewati — dengan namanya disebut, bukan diam-diam.
      const uid = userId.get(sh?.username);
      if (!uid) { if (sh?.username) hasil.peringatan.push(`Shift untuk "${sh.username}" dilewati: penggunanya belum ada di instance ini.`); continue; }
      await prisma.onCallShift.create({
        data: { schedule_id: dibuat.id, user_id: uid, start_at: new Date(sh.start_at), end_at: new Date(sh.end_at), note: sh.note || null },
      });
      hasil.dibuat.shifts++;
    }
  }

  // --- Escalation policy ---
  const policyId = new Map((await prisma.escalationPolicy.findMany()).map((p) => [p.name, p.id]));
  for (const p of asArray(payload.escalation_policies)) {
    if (!p?.name || policyId.has(p.name)) { if (p?.name) hasil.dilewati.escalation_policies.push(p.name); continue; }
    const dibuat = await prisma.escalationPolicy.create({
      data: {
        name: String(p.name).slice(0, 120), description: p.description || null,
        is_default: !!p.is_default, active: p.active !== false,
        steps: {
          create: asArray(p.steps).map((st, i) => ({
            step_order: Number.isFinite(st.step_order) ? st.step_order : i,
            delay_minutes: Math.max(0, Number(st.delay_minutes) || 0),
            target: st.target === "channel" ? "channel" : "oncall",
            schedule_id: st.schedule ? scheduleId.get(st.schedule) ?? null : null,
            notification_id: st.notification ? notifId.get(st.notification) ?? null : null,
          })),
        },
      },
    });
    policyId.set(dibuat.name, dibuat.id);
    hasil.dibuat.escalation_policies++;
  }

  // --- Monitor (induk dipasang di lintasan kedua) ---
  const monitorId = new Map((await prisma.monitor.findMany({ select: { id: true, name: true } })).map((m) => [m.name, m.id]));
  const menungguInduk = [];
  for (const m of asArray(payload.monitors)) {
    if (!m?.name || monitorId.has(m.name)) { if (m?.name) hasil.dilewati.monitors.push(m.name); continue; }
    const { tags, notifications, parent, escalation_policy, has_push_token, ...kolom } = m;
    const bersih = omit(kolom, RUNTIME_FIELDS);
    const dibuat = await prisma.monitor.create({
      data: {
        ...bersih,
        // Push token adalah kredensial dan tidak ikut dalam backup; monitor
        // push mendapat token BARU, jadi target yang lama harus dikabari.
        push_token: m.type === "push" ? newPushToken() : null,
        escalation_policy_id: escalation_policy ? policyId.get(escalation_policy) ?? null : null,
        tags: { create: asArray(tags).map((nama) => tagId.get(nama)).filter(Boolean).map((tag_id) => ({ tag_id })) },
        notifications: { create: asArray(notifications).map((nama) => notifId.get(nama)).filter(Boolean).map((notification_id) => ({ notification_id })) },
      },
    });
    monitorId.set(dibuat.name, dibuat.id);
    hasil.dibuat.monitors++;
    if (parent) menungguInduk.push([dibuat.id, parent]);
    if (m.type === "push") hasil.peringatan.push(`Monitor push "${m.name}" mendapat token baru — perbarui URL push di sisi pengirimnya.`);
  }
  for (const [anakId, namaInduk] of menungguInduk) {
    const induk = monitorId.get(namaInduk);
    if (induk) await prisma.monitor.update({ where: { id: anakId }, data: { parent_id: induk } });
    else hasil.peringatan.push(`Monitor induk "${namaInduk}" tidak ditemukan; anaknya dipulihkan tanpa dependency.`);
  }

  // --- Status page ---
  const pageSlug = new Set((await prisma.statusPage.findMany({ select: { slug: true } })).map((p) => p.slug));
  for (const p of asArray(payload.status_pages)) {
    if (!p?.slug || pageSlug.has(p.slug)) { if (p?.slug) hasil.dilewati.status_pages.push(p.slug); continue; }
    const { monitors: namaMonitor, tags: namaTag, custom_domain, ...kolom } = p;
    const dibuat = await prisma.statusPage.create({
      data: {
        ...omit(kolom, ["id", "created_at"]),
        // Domain khusus unik lintas halaman; menyalinnya bisa bentrok dengan
        // instance lama yang masih hidup, jadi sengaja tidak ikut dipulihkan.
        custom_domain: null,
        monitors: {
          create: asArray(namaMonitor)
            .map((nama) => monitorId.get(nama))
            .filter(Boolean)
            .map((monitor_id, i) => ({ monitor_id, sort_order: i })),
        },
        tags: { create: asArray(namaTag).map((nama) => tagId.get(nama)).filter(Boolean).map((tag_id) => ({ tag_id })) },
      },
    });
    pageSlug.add(dibuat.slug);
    hasil.dibuat.status_pages++;
    if (custom_domain) hasil.peringatan.push(`Custom domain "${custom_domain}" tidak ikut dipulihkan — setel ulang bila instance lama sudah dimatikan.`);
  }

  // --- Maintenance window ---
  for (const w of asArray(payload.maintenance_windows)) {
    const mid = monitorId.get(w?.monitor);
    if (!mid) continue;
    await prisma.maintenanceWindow.create({
      data: {
        monitor_id: mid, title: String(w.title || "Maintenance").slice(0, 200),
        start_at: new Date(w.start_at), end_at: new Date(w.end_at),
        recurring: w.recurring || "none", days_of_week: w.days_of_week || null, active: w.active !== false,
      },
    });
    hasil.dibuat.maintenance_windows++;
  }

  return hasil;
}
