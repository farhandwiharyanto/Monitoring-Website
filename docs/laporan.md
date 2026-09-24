# Laporan SLA

Uptime per periode, error budget, dan MTTR. Dibuka lewat menu **Laporan**
(semua role, termasuk viewer).

[← Kembali ke README](../README.md)

## Cara uptime dihitung

Angka di halaman laporan **berbasis waktu**, dihitung dari durasi incident:

```
uptime = (total detik periode − total detik downtime) / total detik periode
```

Ini berbeda dari angka uptime di dashboard, yang dihitung dari **rasio jumlah
heartbeat** (berapa banyak check yang berhasil dibanding seluruhnya). Keduanya
benar untuk keperluan masing-masing: rasio heartbeat murah dan cukup untuk
pemantauan sehari-hari, sedangkan laporan SLA perlu menjawab "berapa detik
layanan ini benar-benar mati".

Angkanya bisa berbeda tipis, dan itu memang disengaja. Kalau ada yang bertanya
kenapa dashboard menulis 99,80% sementara laporan menulis 99,76%, inilah
sebabnya.

Aturan lain yang berlaku:

- **Incident yang melewati batas periode dipotong.** Incident yang mulai bulan lalu
  dan selesai bulan ini hanya dihitung bagian yang jatuh di dalam periode.
- **Incident yang masih berjalan dipotong di "sekarang"**, bukan di akhir periode.
- **Monitor yang dibuat di tengah periode** hanya diukur sejak ia ada. Kalau tidak,
  waktu sebelum monitornya lahir akan terhitung sebagai "up" dan angkanya jadi
  terlalu bagus. Kolom `measured_from` di ekspor menunjukkan sejak kapan diukur.
- **Batas bulan memakai waktu lokal server**, jadi "September" berarti September
  menurut jam operator, bukan menurut UTC.

## Maintenance window

Bawaannya downtime yang terjadi saat maintenance window aktif **tidak** dihitung
melanggar SLA — ini praktik yang lazim: downtime terencana bukan kegagalan.

Centang **Hitung downtime saat maintenance** di halaman laporan untuk melihat
angka kalender apa adanya, atau set `SLA_EXCLUDE_MAINTENANCE=false` untuk
mengubah bawaannya. Di API, parameternya `?include_maintenance=true`.

## Error budget

Isi **Target SLO** di form monitor (mis. `99.9`) untuk mengaktifkan error budget.
Targetnya harus di antara 0 dan 100; 100% ditolak karena berarti jatah nol, yang
tidak berguna sebagai alat ukur.

```
jatah    = (100 − target) / 100 × total detik periode
terpakai = total detik downtime
sisa     = jatah − terpakai
```

Target 99,9% berarti jatah sekitar **43 menit per 30 hari**. Form monitor
menampilkan perkiraan ini begitu targetnya diketik, supaya angka seperti "99,9%"
terasa nyata dan bukan sekadar hiasan.

Bar error budget di halaman laporan berwarna hijau selama masih ada sisa, kuning
saat terpakai di atas 75%, dan merah begitu jatahnya habis. Sisa yang negatif
berarti target sudah terlewat pada periode itu.

Monitor tanpa target tetap dilaporkan uptime dan downtime-nya, hanya tanpa
kolom error budget.

## Yang belum tertangani

**Monitor yang dijeda saat sedang down akan terus menghitung downtime.** Menjeda
monitor tidak menutup incident yang sedang terbuka, sehingga incident itu tetap
dianggap berjalan sampai "sekarang" dan menggerus error budget-nya. Untuk saat ini,
tutup dulu incident-nya dengan menjalankan kembali monitornya sampai statusnya up,
baru dijeda. Perbaikannya perlu mengubah kapan incident ditutup, yang menyentuh
alur alert, jadi sengaja tidak dilakukan bersamaan dengan laporan ini.

**Waktu monitor dijeda tetap dihitung sebagai periode pengukuran.** Pulsewatch
tidak menyimpan riwayat jeda, jadi tidak ada cara membedakan "up" dari "tidak
dipantau" untuk periode yang sudah lewat.

## Endpoint

```bash
# Bulan berjalan
GET /api/reports/sla

# Bulan tertentu, atau rentang bebas
GET /api/reports/sla?month=2026-09
GET /api/reports/sla?from=2026-09-01&to=2026-09-15
GET /api/reports/sla?monitor_id=3&include_maintenance=true

# Tren 12 bulan terakhir, dan daftar bulan yang punya data
GET /api/reports/sla/monthly?months=12
GET /api/reports/sla/months
```

Rentang yang tidak terbaca dijawab `400` beserta alasannya, bukan diam-diam
diganti bulan berjalan — laporan salah rentang terlalu mudah dikira laporan
yang benar.

Respons `/sla` berbentuk `{ summary, rows, month }`. Satu baris:

```json
{
  "monitor_id": 3,
  "monitor": "Checkout",
  "measured_from": "2026-09-01T00:00:00.000Z",
  "measured_to": "2026-09-25T09:14:03.120Z",
  "total_seconds": 2077200,
  "down_seconds": 12600,
  "uptime": 99.3933,
  "incidents": 3,
  "ongoing_incidents": 1,
  "mttr_seconds": 6300,
  "longest_incident_seconds": 9000,
  "slo_target": 99.9,
  "error_budget": {
    "target": 99.9,
    "allowed_seconds": 2077,
    "used_seconds": 12600,
    "remaining_seconds": -10523,
    "used_percent": 606.6,
    "met": false
  }
}
```

`summary` memuat rata-rata uptime antar monitor (rata-rata sederhana, tiap
layanan dianggap sama pentingnya), total downtime, jumlah incident, dan berapa
monitor yang memenuhi maupun melewati targetnya.

## Ekspor

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/export/sla?format=csv&month=2026-09" \
  -o sla-september.csv
```

Durasi disertakan dua kali: `down_seconds` dalam detik supaya bisa dihitung ulang
di spreadsheet, dan `downtime` dalam bentuk terbaca (`1h 3j` = 1 hari 3 jam,
mengikuti penulisan durasi di seluruh aplikasi). `format=json` juga tersedia.

## Prometheus

Untuk memantau pembakaran error budget tanpa membuka UI:

| Metrik | Ket |
|---|---|
| `pulsewatch_monitor_uptime_month_ratio` | Uptime bulan berjalan (0–1), berbasis waktu |
| `pulsewatch_monitor_downtime_month_seconds` | Total detik downtime bulan berjalan |
| `pulsewatch_monitor_slo_target` | Target SLO dalam persen |
| `pulsewatch_monitor_error_budget_remaining_seconds` | Sisa jatah; negatif berarti target terlewat |
| `pulsewatch_monitor_error_budget_used_ratio` | Bagian jatah yang terpakai (1 = habis) |

```yaml
- alert: ErrorBudgetHampirHabis
  expr: pulsewatch_monitor_error_budget_used_ratio > 0.8
  for: 15m
  annotations:
    summary: "{{ $labels.monitor }} sudah memakai {{ $value | humanizePercentage }} error budget bulan ini"
```
