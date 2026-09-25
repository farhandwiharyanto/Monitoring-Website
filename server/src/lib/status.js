// Status heartbeat: apa hasil satu pemeriksaan.
export const STATUS = { DOWN: 0, UP: 1, PENDING: 2 };
export const STATUS_LABEL = { 0: "DOWN", 1: "UP", 2: "PENDING" };

// Status tampilan: apa yang dilihat orang di dashboard. Nilainya melanjutkan
// STATUS di atas, jadi 0/1/2 berarti sama persis; 3, 4, dan 5 tidak pernah
// tersimpan sebagai heartbeat melainkan disimpulkan saat monitor di-decorate.
//
// DEGRADED sengaja bukan status heartbeat: barisnya tetap UP supaya uptime,
// laporan SLA, dan seluruh riwayat lama tidak berubah artinya. Yang berbeda
// hanya cara menampilkannya.
export const DISPLAY_STATUS = { ...STATUS, PAUSED: 3, MAINTENANCE: 4, DEGRADED: 5 };

// Apakah respons sebuah check melewati ambang latency monitor?
//
// Keluar dari degraded memakai ambang yang sedikit lebih rendah (histeresis):
// tanpa itu, layanan yang bertahan tepat di sekitar ambang akan bergantian
// masuk-keluar degraded setiap interval dan mengirim alert tiap kali.
export function evaluateLatency({ thresholdMs, ms, wasDegraded, recoveryRatio = 0.9 }) {
  if (!thresholdMs || thresholdMs <= 0 || ms === null || ms === undefined) return false;
  return wasDegraded ? ms > thresholdMs * recoveryRatio : ms > thresholdMs;
}
