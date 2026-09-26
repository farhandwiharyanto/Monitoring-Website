# Konfigurasi

Variabel environment, pengamanan bawaan, dan migrasi dari versi SQLite.

[← Kembali ke README](../README.md)

## Variabel environment

Semua opsional kecuali yang ditandai. Daftar lengkap ada di `.env.example`.

| Variabel | Default | Ket |
|---|---|---|
| `JWT_SECRET` | – | **Wajib di production**, minimal 32 karakter acak |
| `JWT_TTL` | `7d` | Umur token login |
| `TRUST_PROXY` | `false` | Set `true` di belakang reverse proxy agar rate limit membaca `X-Forwarded-For` |
| `RATE_LIMIT_STORE` | `memory` | `database` bila beberapa instance berbagi satu Postgres: batas API key, ack, dan push jadi berlaku bersama (satu upsert per permintaan) |
| `CORS_ORIGINS` | `BASE_URL` | Origin tambahan yang boleh memanggil API ber-auth (dipisah koma) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` / `LOGIN_LOCK_SECONDS` | `8` / `300` / `900` | Rate limit login |
| `CERT_ALERT_THRESHOLDS` | `30,14,7,3` | Ambang alert sertifikat (hari); satu alert per ambang yang dilewati |
| `CERT_CHECK_INTERVAL_HOURS` | `6` | Jeda antar handshake TLS untuk membaca sertifikat |
| `CERT_EXPIRY_WARN_DAYS` | `14` | Ambang badge "segera kedaluwarsa" di UI |
| `HEARTBEAT_RETENTION_DAYS` | `90` | Heartbeat lebih tua dari ini dihapus tiap hari jam 03:00 |
| `DB_METRICS_RETENTION_DAYS` | `30` | Metrik monitor database lebih tua dari ini ikut dihapus jam 03:00 |
| `AUDIT_RETENTION_DAYS` | `365` | Audit log lebih tua dari ini dihapus pada jam yang sama |
| `SLA_EXCLUDE_MAINTENANCE` | `true` | Downtime saat maintenance window aktif tidak dihitung melanggar SLA |
| `SLO_DEFAULT_TARGET` | – | Target SLO bawaan untuk monitor baru (persen). Kosong = tanpa target |
| `LOCATION_NAME` | `primary` | Nama lokasi instance ini; jadi label tiap heartbeat yang ditulisnya |
| `PRIMARY_LOCATION` | `primary` | Lokasi acuan untuk status, uptime, incident, dan alert |
| `WORKER_ONLY` | `false` | `true` menjalankan scheduler saja, tanpa API/UI |
| `METRICS_TOKEN` | – | Token scrape `/metrics`. Kosong = hanya token login yang diterima |
| `METRICS_PUBLIC` | `false` | `true` membuka `/metrics` tanpa auth |
| `ENCRYPTION_KEY` | dari `JWT_SECRET` | Kunci enkripsi kredensial monitor — lihat catatan di bawah |
| `API_KEY_RATE_LIMIT` | `60` | Maksimal request per jendela waktu, per API key |
| `API_KEY_RATE_WINDOW_SECONDS` | `60` | Panjang jendela rate limit API key |
| `ACTION_WEBHOOK_ATTEMPTS` | `3` | Percobaan pemanggilan webhook aksi (termasuk yang pertama) |
| `ACTION_WEBHOOK_TIMEOUT_SECONDS` | `15` | Timeout tiap pemanggilan webhook aksi |
| `RENOTIFY_DEFAULT_MINUTES` | – | Jeda pengingat bawaan untuk monitor baru (menit). Kosong = tidak mengingatkan |
| `RENOTIFY_SWEEP_SECONDS` | `30` | Seberapa sering penyapu mencari incident yang sudah waktunya diingatkan |
| `LATENCY_RECOVERY_RATIO` | `0.9` | Histeresis keluar dari status degraded: pulih saat respons turun di bawah ambang × rasio ini |
| `NOTIFICATION_LOG_RETENTION_DAYS` | `30` | Riwayat pengiriman notifikasi lebih tua dari ini dihapus tiap hari jam 03:00 |
| `SCHEDULER_LEASE_SECONDS` | `30` | Masa berlaku lease pemimpin scheduler sejak perpanjangan terakhir |
| `SCHEDULER_LEASE_RENEW_SECONDS` | `10` | Jarak antar perpanjangan lease |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Batas berhenti rapi sebelum proses dipaksa keluar |

> **Kredensial monitor:** Basic Auth dan Bearer token milik monitor disimpan terenkripsi
> AES-256-GCM. Kuncinya diturunkan dari `JWT_SECRET` bila `ENCRYPTION_KEY` kosong, jadi
> **mengganti `JWT_SECRET` membuat kredensial monitor lama tidak terbaca** dan harus diisi ulang.
> Set `ENCRYPTION_KEY` sendiri kalau ingin memutar `JWT_SECRET` tanpa efek samping itu.
> Worker multi-location harus memakai nilai yang sama dengan instance web.

### Backup & pulihkan konfigurasi

**Pengaturan → Export data → Backup konfigurasi (JSON)** mengunduh seluruh
penyiapan: monitor beserta dependency dan tag-nya, channel notifikasi, status
page, maintenance window, escalation policy, dan jadwal on-call. Yang tidak ikut
adalah data deret waktu (heartbeat, incident, audit log) dan pengguna.

> **Berkas ini rahasia.** Kredensial monitor — Basic Auth, Bearer token, dan
> connection string database — ikut di dalamnya dalam bentuk terenkripsi.
> Hanya instance dengan `ENCRYPTION_KEY` (atau `JWT_SECRET`) yang sama yang bisa
> membukanya, tapi berkasnya tetap bukan sesuatu yang boleh dibagikan bebas.

Pemulihannya di bawah tombol itu: pilih berkas backup, dan isinya digabungkan ke
instance ini. **Entri yang namanya sudah ada dilewati** — tidak ada yang ditimpa
atau dihapus. Karena itu restore aman diulang, dan memulihkan ke instance yang
sudah terisi tidak pernah menghapus pekerjaan orang lain. Yang dilewati dihitung
dan ditampilkan, supaya tidak ada yang mengira entrinya ikut diperbarui.

Relasi dipulihkan lewat **nama**, bukan id: monitor induk, tag, channel
notifikasi, dan isi status page dicari berdasarkan namanya di instance tujuan.

Tiga hal yang perlu ditangani sendiri setelah restore, dan ketiganya disebut di
ringkasan hasil:

- **Channel notifikasi dibuat tanpa kredensial.** Token bot dan webhook URL
  tidak diekspor karena tersimpan polos, tidak terenkripsi seperti kredensial
  monitor. Isi ulang sebelum channel-nya bisa mengirim.
- **Monitor push mendapat token baru**, jadi URL push di sisi pengirim harus
  diperbarui.
- **Custom domain status page tidak ikut dipulihkan**, karena domainnya unik
  lintas halaman dan bisa bentrok dengan instance lama yang masih hidup.

### Satu pemimpin per lokasi

Beberapa proses boleh menunjuk ke database yang sama, tapi untuk tiap
`LOCATION_NAME` hanya **satu** yang menjalankan check. Kepemimpinannya dipegang
lewat satu baris di tabel `scheduler_leases` yang diperpanjang tiap
`SCHEDULER_LEASE_RENEW_SECONDS`; proses lain melihat lease itu masih berlaku dan
menahan check-nya, sambil tetap melayani API dan UI seperti biasa.

Gunanya: replika, atau container baru yang tumpang tindih dengan yang lama saat
deploy, tidak meng-check monitor yang sama dua kali dan tidak mengirim alert
ganda. Kalau pemegangnya mati mendadak, lease kedaluwarsa sendiri dan proses
lain mengambil alih dalam hitungan `SCHEDULER_LEASE_SECONDS`.

Lokasi yang berbeda tetap berjalan sendiri-sendiri — multi-location tidak
terpengaruh, yang dicegah hanya dua proses pada lokasi yang sama.

### Berhenti dengan rapi

`SIGTERM` dan `SIGINT` tidak langsung mematikan proses: cron dihentikan, check
yang sedang berjalan ditunggu sampai `SHUTDOWN_TIMEOUT_SECONDS` supaya hasilnya
sempat tercatat, lease dilepas agar pengganti langsung mengambil alih, lalu
koneksi database ditutup. Di `docker-compose.yml`, `stop_grace_period: 30s`
memberi ruang untuk itu sebelum Docker mengirim `SIGKILL`.

### Health check

`GET /api/health` menyentuh database, bukan sekadar membuktikan proses hidup.
Bila database tidak menjawab dalam 3 detik, endpoint membalas **503** sehingga
`HEALTHCHECK` Docker dan probe Kubernetes ikut menandainya tidak sehat. Balasannya
juga menyebut lokasi dan apakah proses ini sedang memimpin scheduler:

```json
{ "ok": true, "location": "primary",
  "database": { "ok": true, "latency_ms": 3 },
  "scheduler": { "leading": true, "holder": "web-1:42:a1b2c3" } }
```

### Keamanan yang aktif secara bawaan
- Rate limit login per IP **dan** per username; setelah batas terlampaui akun dikunci sementara
- Ganti password membatalkan seluruh token lama (termasuk di perangkat lain) lewat `users.password_changed_at`
- Header `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`;
  `Strict-Transport-Security` ikut aktif bila `BASE_URL` memakai https
- CORS tertutup untuk API ber-auth; hanya `/api/public/*` yang terbuka
- Socket.io memverifikasi token ke database, dan `push_token` tidak pernah disiarkan lewat socket
- Pesan error internal tidak dibocorkan ke client saat `NODE_ENV=production`

### 2FA (TOTP)
Tiap user bisa mengaktifkan 2FA sendiri di **Pengaturan**: password → pindai QR
dengan aplikasi authenticator → masukkan satu kode. Setelah itu:

- Login meminta kode 6 digit atau salah satu dari 10 kode cadangan (sekali pakai).
  Kode yang salah ikut dihitung ke rate limit login; kode yang sama tidak bisa dipakai dua kali.
- Mengaktifkan 2FA membatalkan sesi lain, sama seperti ganti password.
- Mematikannya butuh password **dan** kode. Kode cadangan bisa dibuat ulang.
- Kehilangan ponsel sekaligus kode cadangan: admin lain menekan **Reset 2FA** di halaman Users.
  Kalau yang terkunci satu-satunya admin, matikan langsung di database:
  `UPDATE users SET totp_enabled=false, totp_secret=NULL, totp_recovery=NULL, totp_last_step=NULL WHERE username='admin';`

Secret disimpan terenkripsi dengan kunci yang sama dengan kredensial monitor; kode cadangan hanya hash-nya.

## Migrasi dari versi SQLite (v1)
```bash
mkdir -p legacy && cp /path/lama/pulsewatch.db legacy/
docker compose exec pulsewatch npm install better-sqlite3      # sekali, di dalam container
docker compose exec pulsewatch npm run migrate:sqlite -- /legacy/pulsewatch.db --wipe
```
Atau dari mesin dev: `cd server && npm install && DATABASE_URL=... npm run migrate:sqlite -- ./data/pulsewatch.db`.
ID monitor/incident dipertahankan; `--wipe` mengosongkan DB tujuan lebih dulu (script menolak jika DB sudah berisi data tanpa flag ini).

## Catatan

**Bahasa pesan check.** Pesan hasil pengecekan yang disimpan di heartbeat (mis. `Timeout setelah 30s`,
`Assertion gagal: …`) ditulis server dalam bahasa Indonesia dan tidak ikut diterjemahkan saat UI
diatur ke English — teks tersebut adalah data historis di database, bukan label antarmuka.

**Heartbeat lama tanpa lokasi.** Baris yang ditulis sebelum multi-location ada punya `location = NULL`
dan diperlakukan sebagai milik lokasi primary, sehingga grafik dan uptime lama tetap utuh.

**Assertion butuh body JSON.** Bila response bukan JSON yang valid, assertion dihitung gagal dengan
pesan yang menjelaskan hal itu. Untuk mencocokkan teks biasa, pakai field *Keyword di body*.

**API key hilang tidak bisa dipulihkan.** Database hanya menyimpan hash-nya. Cabut kunci lama
lalu buat yang baru.

**Rate limit API key bersifat per proses.** Hitungannya disimpan di memori instance, jadi kalau
suatu saat Pulsewatch dijalankan lebih dari satu replika di belakang load balancer, tiap replika
punya hitungannya sendiri.
