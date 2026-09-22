# Pulsewatch

Self-hosted uptime monitoring — alternatif ringan dari Uptime Kuma.

**Stack:** Node.js (Express 5) + PostgreSQL (Prisma) · React + Tailwind · Socket.io · node-cron · Recharts

## Fitur
- Monitor **HTTP(s)** (status code + keyword), **TCP port**, **Ping**, **DNS**
- Interval, timeout, dan retries per monitor (pending → down setelah retries habis)
- Dashboard: up/down/pending/maintenance, rata-rata respons, uptime 24 jam, filter per tag
- Heartbeat bar 20 ping terakhir, uptime 24 jam & 30 hari, update realtime via Socket.io
- Detail monitor: grafik response time (1j/6j/24j/7h), riwayat incident, event penting, jadwal maintenance
- **Tag / group**: monitor bisa punya banyak tag; halaman *Monitors* mengelompokkan per tag (collapsible)
- **Maintenance window**: sekali / harian / mingguan per monitor. Selama aktif, down **tidak** memicu alert tapi tetap tercatat berlabel *maintenance* (dikecualikan dari hitungan uptime). Alert down dikirim otomatis jika window berakhir dan monitor masih down.
- Notifikasi **Telegram / Discord / Email (SMTP) / Webhook** saat down & recover (bisa di-set default untuk semua monitor)
- **Status page publik** tanpa login (`/status/<slug>`)
- **Role-based access**: `admin` (akses penuh) dan `viewer` (read-only). Manajemen user di menu *Users*.

## Jalankan dengan Docker
```bash
cp .env.example .env     # ubah JWT_SECRET, ADMIN_PASSWORD, POSTGRES_PASSWORD
docker compose up -d     # postgres + app; migration Prisma dijalankan otomatis saat start
```
Buka http://localhost:3001 — login default `admin` / `admin123` (dari `.env`, hanya dipakai saat DB pertama kali dibuat).
Data Postgres tersimpan di volume `pulsewatch-pgdata`.

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

## Struktur
```
server/
  prisma/schema.prisma      model Postgres (users, monitors, heartbeats, incidents, notifications,
                            status_pages, tags, maintenance_windows, …)
  prisma/migrations/        SQL migration (dijalankan `prisma migrate deploy`)
  scripts/migrate-from-sqlite.js   migrasi data v1 (SQLite) → Postgres
  src/index.js              Express + Socket.io + static client
  src/db.js                 PrismaClient & seed admin
  src/scheduler.js          node-cron tick 1s → check, retry, incident, maintenance-aware alert
  src/lib/auth.js           JWT + requireAuth / requireAdmin (RBAC)
  src/lib/maintenance.js    evaluasi window aktif (sekali/harian/mingguan)
  src/lib/stats.js          decorate monitor (status, uptime, tag, maintenance) & stats dashboard
  src/checks/               http, tcp, ping, dns
  src/notifications/        telegram, discord, email, webhook
  src/routes/               auth, users, monitors, tags, maintenance, notifications, statusPages (+ public)
client/src/
  pages/        Dashboard, Monitors (grouped), MonitorDetail, MonitorForm, Maintenance, Users,
                Notifications, StatusPages, PublicStatus, Login, Settings
  components/   Layout, HeartbeatBar, MonitorRow, StatCard, StatusBadge, TagChip, TagFilter, MaintenanceForm
  lib/          api, socket, auth (role context), monitors (realtime context), format
```

## API ringkas
| Method | Path | Role | Ket |
|---|---|---|---|
| POST | /api/auth/login | – | `{username,password}` → `{token,user}` |
| GET | /api/auth/me | any | user & role saat ini |
| GET | /api/monitors?tag=nama | any | list (+ filter tag) |
| POST/PUT/DELETE | /api/monitors[/:id] | admin | body boleh berisi `tags: ["a","b"]`, `notification_ids` |
| POST | /api/monitors/:id/pause · /resume · /test | admin | |
| GET | /api/monitors/:id/heartbeats?hours · /incidents · /events · /maintenance | any | |
| GET | /api/monitors/stats | any | angka dashboard |
| GET | /api/tags | any | + `monitor_count` |
| POST/PUT/DELETE | /api/tags[/:id] | admin | |
| GET | /api/maintenance?monitor_id= | any | `is_active` dihitung server |
| POST/PUT/DELETE | /api/maintenance[/:id] | admin | `{monitor_id,title,start_at,end_at,recurring:none|daily|weekly,days_of_week:[0-6]}` |
| CRUD | /api/users | admin | `{username,password,role}` |
| CRUD | /api/notifications (+ POST /test) | admin | |
| GET | /api/status-pages | any | |
| POST/PUT/DELETE | /api/status-pages[/:id] | admin | |
| GET | /api/public/status/:slug | publik | tanpa auth |

Status monitor: `0` down · `1` up · `2` pending · `3` paused · `4` maintenance. Heartbeat punya flag `maintenance`.
Endpoint mengubah data mengembalikan `403` untuk role `viewer`.
