import os from "node:os";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";

// Kepemimpinan scheduler berbasis lease di database.
//
// Sebelum ini, setiap proses yang hidup menjalankan scheduler-nya sendiri.
// Dua proses dengan LOCATION_NAME sama — replika, atau container baru yang
// tumpang tindih dengan yang lama saat deploy — akan meng-check monitor yang
// sama dua kali dan mengirim alert dua kali.
//
// Lease dipilih ketimbang `pg_try_advisory_lock` karena advisory lock terikat
// pada satu koneksi, sedangkan Prisma memakai pool: perintah berikutnya belum
// tentu jatuh di koneksi yang memegang lock. Lease cukup satu baris tabel,
// tidak peduli koneksi mana yang menulisnya.
//
// Lokasi yang berbeda punya barisnya sendiri, jadi multi-location tetap jalan
// seperti biasa — yang dicegah hanya dua proses pada lokasi yang SAMA.

// Pengenal proses ini. Tidak perlu unik secara global, cukup unik di antara
// proses yang berebut lokasi yang sama.
export const instanceId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

// Sampai kapan lease yang kita pegang berlaku (epoch ms). 0 = tidak memegang.
let leaseUntil = 0;
let lastLogged = null;
let timer = null;

// Memimpin berarti: lease terakhir berhasil diambil DAN belum kedaluwarsa.
// Sengaja dihitung dari waktu, bukan dari boolean hasil percakapan terakhir —
// kalau proses ini membeku atau kehilangan database, kepemimpinannya luruh
// sendiri tanpa perlu ada yang mencabutnya.
export const isLeading = () => Date.now() < leaseUntil;

export const leaseState = () => ({
  leading: isLeading(),
  holder: instanceId,
  lease_expires_at: leaseUntil ? new Date(leaseUntil).toISOString() : null,
});

// Ambil atau perpanjang lease dalam SATU pernyataan, supaya dua proses yang
// mencoba bersamaan tidak mungkin sama-sama merasa menang.
//
// Baris hanya ditulis bila salah satu benar:
//   - kita sendiri pemegangnya (perpanjangan biasa), atau
//   - lease pemegang lama sudah lewat waktunya (pengambilalihan).
// Kalau tidak ada baris yang kembali, berarti proses lain memegangnya.
async function claim() {
  const ttl = Math.max(5, config.schedulerLeaseSeconds);
  const rows = await prisma.$queryRaw`
    INSERT INTO scheduler_leases ("location", "holder", "expires_at", "updated_at")
    VALUES (
      ${config.locationName},
      ${instanceId},
      (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${ttl}),
      NOW() AT TIME ZONE 'UTC'
    )
    ON CONFLICT ("location") DO UPDATE
      SET "holder"     = EXCLUDED."holder",
          "expires_at" = EXCLUDED."expires_at",
          "updated_at" = EXCLUDED."updated_at"
      WHERE scheduler_leases."holder" = EXCLUDED."holder"
         OR scheduler_leases."expires_at" < (NOW() AT TIME ZONE 'UTC')
    RETURNING "holder"`;
  return rows.length > 0;
}

async function refresh() {
  const ttl = Math.max(5, config.schedulerLeaseSeconds);
  try {
    leaseUntil = (await claim()) ? Date.now() + ttl * 1000 : 0;
  } catch (err) {
    // Database sedang tidak bisa dihubungi. Lease yang sudah dipegang tetap
    // berlaku sampai waktunya habis: proses lain pun tidak bisa mengambil alih
    // tanpa database, jadi menyerah lebih awal hanya membuat check berhenti
    // untuk gangguan koneksi sesaat.
    if (Date.now() >= leaseUntil) leaseUntil = 0;
    console.error("[leader] gagal memperbarui lease:", err.message);
  }
  logTransition();
}

// Hanya dicetak saat statusnya berubah — renew terjadi tiap beberapa detik.
function logTransition() {
  const now = isLeading();
  if (now === lastLogged) return;
  lastLogged = now;
  console.log(
    now
      ? `[leader] memimpin lokasi "${config.locationName}" (${instanceId})`
      : `[leader] proses lain memimpin lokasi "${config.locationName}" — check ditahan di proses ini`
  );
}

// Dipanggil sekali saat scheduler mulai. Percobaan pertama ditunggu supaya
// proses tidak sempat menjalankan check sebelum tahu dirinya memimpin.
export async function startLeaseLoop() {
  await refresh();
  const every = Math.max(1, Math.min(config.schedulerLeaseRenewSeconds, config.schedulerLeaseSeconds - 1));
  timer = setInterval(() => refresh(), every * 1000);
  timer.unref?.();
}

// Dilepas saat shutdown supaya pengganti tidak perlu menunggu lease habis.
// Kegagalannya tidak apa-apa: lease akan kedaluwarsa sendiri.
export async function releaseLease() {
  if (timer) clearInterval(timer);
  timer = null;
  const held = leaseUntil > 0;
  leaseUntil = 0;
  if (!held) return;
  try {
    await prisma.$executeRaw`DELETE FROM scheduler_leases WHERE "location" = ${config.locationName} AND "holder" = ${instanceId}`;
  } catch {
    /* lease kedaluwarsa sendiri */
  }
}
