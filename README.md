# Pulsewatch

Self-hosted uptime monitoring — alternatif ringan dari Uptime Kuma.

**Stack:** Node.js (Express 5) + PostgreSQL (Prisma) · React + Tailwind · Socket.io · node-cron · Recharts

## Fitur
- Monitor **HTTP(s)** (status code + keyword), **TCP port**, **Ping**, **DNS**, dan **Push**
- **Push monitor**: cron job / script di sisi target memanggil `GET /api/push/<token>` tiap selesai jalan.
  Monitor ditandai down bila tidak ada push melewati `interval + grace period`.
- **Sertifikat TLS**: tanggal kedaluwarsa & penerbit dipantau otomatis tiap 6 jam untuk monitor https,
  dengan notifikasi saat sisa umurnya menipis (`CERT_EXPIRY_WARN_DAYS`, default 14 hari)
- Interval, timeout, dan retries per monitor (pending → down setelah retries habis)
- Dashboard: up/down/pending/maintenance, rata-rata respons, uptime 24 jam, filter per tag
- Heartbeat bar 20 ping terakhir, uptime 24 jam & 30 hari, update realtime via Socket.io
- Detail monitor: grafik response time (1j/6j/24j/7h), riwayat incident, event penting, jadwal maintenance
- **Tag / group**: monitor bisa punya banyak tag; halaman *Monitors* mengelompokkan per tag (collapsible)
- **Maintenance window**: sekali / harian / mingguan per monitor. Selama aktif, down **tidak** memicu alert
  tapi tetap tercatat berlabel *maintenance* (dikecualikan dari hitungan uptime). Alert down dikirim otomatis
  jika window berakhir dan monitor masih down.
- Notifikasi **Telegram / Discord / Slack / Google Chat / ntfy / Email (SMTP) / Webhook** saat down & recover,
  dengan retry otomatis (1 detik, lalu 3 detik) untuk kegagalan sementara
- **Status page publik** (`/status/<slug>`) dengan kustomisasi: logo, warna aksen, tema gelap/terang/auto,
  banner pengumuman, teks footer, custom domain, dan saklar tampilkan uptime / heartbeat bar / incident
- **Tema gelap & terang** plus **dwibahasa (Indonesia / English)** di seluruh dashboard
- **Export CSV/JSON**: daftar monitor, heartbeat, riwayat incident, dan backup konfigurasi
- **Role-based access**: `admin` (akses penuh) dan `viewer` (read-only)

## Jalankan dengan Docker
```bash
cp .env.example .env     # ubah JWT_SECRET, ADMIN_PASSWORD, POSTGRES_PASSWORD
docker compose up -d     # postgres + app; migration Prisma dijalankan otomatis saat start
```
Buka http://localhost:3001 — login default `admin` / `admin123` (dari `.env`, hanya dipakai saat DB pertama kali dibuat).
Data Postgres tersimpan di volume `pulsewatch-pgdata`.

> **Production:** `JWT_SECRET` wajib diisi string acak minimal 32 karakter (`openssl rand -hex 32`).
> Server sengaja menolak start jika masih memakai nilai bawaan saat `NODE_ENV=production`.

### Migrasi dari versi SQLite (v1)
```bash
mkdir -p legacy && cp /path/lama/pulsewatch.db legacy/
docker compose exec pulsewatch npm install better-sqlite3      # sekali, di dalam container
docker compose exec pulsewatch npm run migrate:sqlite -- /legacy/pulsewatch.db --wipe
```
Atau dari mesin dev: `cd server && npm install && DATABASE_URL=... npm run migrate:sqlite -- ./data/pulsewatch.db`.
ID monitor/incident dipertahankan; `--wipe` mengosongkan DB tujuan lebih dulu (script menolak jika DB sudah berisi data tanpa flag ini).

## Development
```bash
docker compose up -d postgres        # atau Postgres lokal apa pun
npm run install:all
cp .env.example server/.env          # isi DATABASE_URL=postgresql://pulsewatch:pulsewatch@localhost:5432/pulsewatch
npm run db:migrate                   # prisma migrate deploy
npm run dev                          # server :3001 + vite :5173 (proxy /api & /socket.io)
```
Ubah schema: edit `server/prisma/schema.prisma` lalu `cd server && npx prisma migrate dev --name <nama>`.

## Konfigurasi
Semua opsional kecuali yang ditandai. Daftar lengkap ada di `.env.example`.

| Variabel | Default | Ket |
|---|---|---|
| `JWT_SECRET` | – | **Wajib di production**, minimal 32 karakter acak |
| `JWT_TTL` | `7d` | Umur token login |
| `TRUST_PROXY` | `false` | Set `true` di belakang reverse proxy agar rate limit membaca `X-Forwarded-For` |
| `CORS_ORIGINS` | `BASE_URL` | Origin tambahan yang boleh memanggil API ber-auth (dipisah koma) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` / `LOGIN_LOCK_SECONDS` | `8` / `300` / `900` | Rate limit login |
| `CERT_EXPIRY_WARN_DAYS` | `14` | Ambang peringatan sertifikat TLS |
| `HEARTBEAT_RETENTION_DAYS` | `90` | Heartbeat lebih tua dari ini dihapus tiap hari jam 03:00 |

### Keamanan yang aktif secara bawaan
- Rate limit login per IP **dan** per username; setelah batas terlampaui akun dikunci sementara
- Ganti password membatalkan seluruh token lama (termasuk di perangkat lain) lewat `users.password_changed_at`
- Header `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`;
  `Strict-Transport-Security` ikut aktif bila `BASE_URL` memakai https
- CORS tertutup untuk API ber-auth; hanya `/api/public/*` yang terbuka
- Socket.io memverifikasi token ke database, dan `push_token` tidak pernah disiarkan lewat socket
- Pesan error internal tidak dibocorkan ke client saat `NODE_ENV=production`

## Push monitor
Buat monitor bertipe **Push**, lalu salin URL-nya dari halaman detail:

```bash
# di akhir cron job / script
curl -fsS "https://pulsewatch.example.com/api/push/<token>?msg=Backup%20selesai&ping=421"

# melaporkan kegagalan
curl -fsS "https://pulsewatch.example.com/api/push/<token>?status=down&msg=Backup%20gagal"
```
Parameter: `status` (`up`/`down`, default `up`), `msg`, `ping` (ms). Method `GET` maupun `POST` diterima.
Token bisa dibuat ulang dari halaman detail bila bocor — URL lama langsung berhenti berlaku.

## Custom domain untuk status page
Isi field *Custom domain* pada status page, lalu arahkan CNAME domain tersebut ke Pulsewatch.
Saat domain itu dibuka di root (`/`), Pulsewatch otomatis menampilkan status page yang cocok.

## Struktur
```
server/
  prisma/schema.prisma      model Postgres (users, monitors, heartbeats, incidents, notifications,
                            status_pages, tags, maintenance_windows, settings, …)
  prisma/migrations/        SQL migration (dijalankan `prisma migrate deploy`)
  scripts/migrate-from-sqlite.js   migrasi data v1 (SQLite) → Postgres
  src/index.js              Express + Socket.io + static client
  src/config.js             env, validasi JWT_SECRET, daftar origin
  src/db.js                 PrismaClient, seed admin, prune heartbeat
  src/scheduler.js          node-cron tick 1s → check, retry, incident, push freshness, cek sertifikat
  src/lib/auth.js           JWT + requireAuth / requireAdmin (RBAC) + pembatalan token
  src/lib/ratelimit.js      rate limit login & endpoint publik
  src/lib/security.js       header keamanan & kebijakan CORS
  src/lib/maintenance.js    evaluasi window aktif (sekali/harian/mingguan)
  src/lib/stats.js          decorate monitor (status, uptime, tag, maintenance) & stats dashboard
  src/checks/               http, tcp, ping, dns, cert
  src/notifications/        telegram, discord, slack, googlechat, ntfy, email, webhook
  src/routes/               auth, users, monitors, tags, maintenance, notifications,
                            statusPages (+ public), push, settings, export
client/src/
  pages/        Dashboard, Monitors (grouped), MonitorDetail, MonitorForm, Maintenance, Users,
                Notifications, StatusPages, PublicStatus, Login, Settings
  components/   Layout, HeartbeatBar, MonitorRow, StatCard, StatusBadge, TagChip, TagFilter,
                MaintenanceForm, ThemeToggle
  lib/          api (+ download), socket, auth (role context), monitors (realtime context),
                format, i18n (id/en), theme (gelap/terang/auto)
```

## API ringkas
| Method | Path | Role | Ket |
|---|---|---|---|
| POST | /api/auth/login | – | `{username,password}` → `{token,user}`; dibatasi rate limit |
| GET | /api/auth/me | any | user & role saat ini |
| POST | /api/auth/change-password | any | membatalkan token lama, mengembalikan token baru |
| GET | /api/monitors?tag=nama | any | list (+ filter tag) |
| POST/PUT/DELETE | /api/monitors[/:id] | admin | body boleh berisi `tags: ["a","b"]`, `notification_ids` |
| POST | /api/monitors/:id/pause · /resume · /test | admin | |
| POST | /api/monitors/:id/cert | admin | periksa sertifikat TLS sekarang juga |
| POST | /api/monitors/:id/reset-push-token | admin | buat ulang token push |
| GET | /api/monitors/:id/heartbeats?hours · /incidents · /events · /maintenance | any | |
| GET | /api/monitors/stats | any | angka dashboard |
| GET/POST | /api/push/:token | publik | heartbeat dari target; `?status=&msg=&ping=` |
| GET | /api/tags | any | + `monitor_count` |
| POST/PUT/DELETE | /api/tags[/:id] | admin | |
| GET | /api/maintenance?monitor_id= | any | `is_active` dihitung server |
| POST/PUT/DELETE | /api/maintenance[/:id] | admin | `{monitor_id,title,start_at,end_at,recurring:none\|daily\|weekly,days_of_week:[0-6]}` |
| CRUD | /api/users | admin | `{username,password,role}` |
| CRUD | /api/notifications (+ POST /test) | admin | |
| GET | /api/status-pages | any | |
| POST/PUT/DELETE | /api/status-pages[/:id] | admin | termasuk field kustomisasi tampilan |
| GET | /api/public/status/:slug | publik | tanpa auth |
| GET | /api/public/status/resolve | publik | slug untuk custom domain pada request ini |
| GET | /api/settings · /api/settings/public | any / publik | bahasa & tema default instance |
| PUT | /api/settings | admin | |
| GET | /api/export/monitors · /heartbeats · /incidents | any | `?format=csv\|json` |
| GET | /api/export/config | admin | backup JSON tanpa kredensial |

Status monitor: `0` down · `1` up · `2` pending · `3` paused · `4` maintenance. Heartbeat punya flag `maintenance`.
Endpoint mengubah data mengembalikan `403` untuk role `viewer`.

## Catatan
Pesan hasil pengecekan yang disimpan di heartbeat (mis. `Timeout setelah 30s`) ditulis server dalam
bahasa Indonesia dan tidak ikut diterjemahkan saat UI diatur ke English — teks tersebut adalah data
historis di database, bukan label antarmuka.
