import { prisma } from "../db.js";

// Jadwal on-call memakai shift bebas per rentang waktu, bukan rotasi mingguan
// yang dihitung dari urutan anggota. Konsekuensinya: tukar jaga dan libur
// sehari cukup satu baris baru, tanpa menggeser giliran orang lain.
//
// Aturan tumpang tindih: bila dua shift sama-sama mencakup suatu saat, yang
// dipakai adalah shift dengan start_at paling akhir. Shift pengganti karena itu
// cukup dibuat belakangan — tidak perlu menghapus atau memotong yang lama.

// Kontak pribadi orang yang bertugas ikut dibawa: langkah eskalasi bertarget
// jadwal mengirim ke sana, bukan ke channel tim.
const withUser = {
  user: {
    select: {
      id: true, username: true, role: true,
      oncall_notification_id: true,
      oncall_notification: { select: { id: true, name: true, type: true } },
    },
  },
};

export const shapeShift = (s) =>
  s && {
    id: s.id,
    schedule_id: s.schedule_id,
    user_id: s.user_id,
    username: s.user?.username ?? null,
    start_at: s.start_at,
    end_at: s.end_at,
    note: s.note ?? null,
    // Orang yang bertugas tanpa kontak pribadi tetap tercatat di jadwal, tapi
    // langkah eskalasi yang menunjuk jadwal ini tidak punya sasaran.
    has_contact: !!s.user?.oncall_notification_id,
    contact: s.user?.oncall_notification
      ? { id: s.user.oncall_notification.id, name: s.user.oncall_notification.name, type: s.user.oncall_notification.type }
      : null,
  };

// Shift yang sedang berjalan pada `at`, lengkap dengan user & kontaknya.
// null berarti tidak ada yang bertugas — bukan kesalahan, mis. jadwal baru
// dibuat dan shift-nya belum diisi.
export async function currentShift(scheduleId, at = new Date()) {
  const shift = await prisma.onCallShift.findFirst({
    where: { schedule_id: Number(scheduleId), start_at: { lte: at }, end_at: { gt: at } },
    include: withUser,
    orderBy: [{ start_at: "desc" }, { id: "desc" }],
  });
  return shift || null;
}

// Shift berikutnya setelah `at` — dipakai UI untuk "berikutnya: budi, Senin 09:00"
export async function nextShift(scheduleId, at = new Date()) {
  const shift = await prisma.onCallShift.findFirst({
    where: { schedule_id: Number(scheduleId), start_at: { gt: at } },
    include: withUser,
    orderBy: [{ start_at: "asc" }, { id: "asc" }],
  });
  return shift || null;
}

// Jadwal + keadaannya sekarang, untuk daftar di UI
export async function decorateSchedule(schedule, at = new Date()) {
  const [now, next, shiftCount] = await Promise.all([
    currentShift(schedule.id, at),
    nextShift(schedule.id, at),
    prisma.onCallShift.count({ where: { schedule_id: schedule.id } }),
  ]);
  return {
    ...schedule,
    shift_count: shiftCount,
    current: shapeShift(now),
    next: shapeShift(next),
  };
}

export async function decorateSchedules(schedules, at = new Date()) {
  return Promise.all(schedules.map((s) => decorateSchedule(s, at)));
}

// Zona waktu hanya memengaruhi tampilan (kolom waktu tetap UTC), tapi nilai
// ngawur tetap ditolak supaya UI tidak melempar saat memformat.
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
