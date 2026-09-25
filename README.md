# Pulsewatch

Uptime monitoring yang di-host sendiri — alternatif ringan dari Uptime Kuma.

Pantau website, port, ping, dan DNS; dapat notifikasi saat down; bagikan status page
publik ke pengguna. Semuanya jalan dari satu `docker compose up`.

**Stack:** Express 5 + PostgreSQL (Prisma) · React + Tailwind · Socket.io

---

## Jalankan

```bash
cp .env.example .env
# ganti JWT_SECRET dengan: openssl rand -hex 32
docker compose up -d
```

Buka **http://localhost:3001**, login `admin` / `admin123`.

> `JWT_SECRET` wajib diganti. Server menolak start di production kalau masih nilai bawaan.
> Ganti juga password admin lewat menu Pengaturan setelah login pertama.

Sudah termasuk Postgres, dan migration dijalankan otomatis saat start.

---

## Fitur

**Monitoring**
- HTTP(s), TCP port, Ping, DNS, **Push** (cron job melapor sendiri), **database** (PostgreSQL/MySQL/Redis), **gRPC**, dan **Kafka**
- Interval, timeout, dan retries per monitor
- Custom header, Basic Auth / Bearer token (tersimpan terenkripsi), dan assertion body JSON
- Ambang latency per monitor: layanan yang melambat ditandai **degraded**, uptime tidak terpengaruh
- Sertifikat TLS dipantau otomatis, alert berjenjang 30 / 14 / 7 / 3 hari
- Pemeriksaan dari beberapa lokasi sekaligus untuk membedakan layanan mati vs jaringan bermasalah

**Pemberitahuan**
- Telegram, Discord, Slack, Google Chat, ntfy, Email (SMTP), Webhook
- Maintenance window (sekali / harian / mingguan) — down saat window aktif tidak memicu alert
- Webhook aksi untuk memicu otomasi di sistem lain (restart service, buka ticket)
- Dependency antar-monitor: selama monitor induk down, alert anaknya ditahan — satu gangguan
  tidak jadi sepuluh notifikasi
- Jadwal on-call & eskalasi berjenjang, dengan tombol "saya tangani" yang menghentikan rantai

**Berbagi & integrasi**
- Status page publik dengan logo, warna, tema, dan custom domain
- Incident update manual untuk mengabari pengguna saat gangguan
- API key read-only / read-write untuk akses dari sistem lain
- Export CSV/JSON dan endpoint `/metrics` untuk Prometheus
- Audit log: jejak siapa mengubah apa, kapan, dan dari IP mana
- Laporan SLA bulanan: uptime, error budget per target SLO, MTTR, dan ekspornya

**Antarmuka**
- Tema gelap & terang, dwibahasa Indonesia / English
- Realtime tanpa refresh, role admin & viewer

---

## Dokumentasi

| | Isi |
|---|---|
| **[Konfigurasi](docs/konfigurasi.md)** | Variabel environment, pengamanan bawaan, migrasi dari versi SQLite |
| **[Monitoring](docs/monitoring.md)** | Monitor push, HTTP check lanjutan, multi-location, dependency antar-monitor |
| **[Integrasi](docs/integrasi.md)** | API key, webhook dua arah, export, Prometheus, daftar endpoint |
| **[Status page](docs/status-page.md)** | Halaman publik, incident update, custom domain (nginx & Traefik) |
| **[Laporan SLA](docs/laporan.md)** | Cara uptime dihitung, error budget, maintenance, ekspor |
| **[Audit log](docs/audit-log.md)** | Apa yang dicatat, penopengan kredensial, endpoint, arsip |
| **[On-call](docs/on-call.md)** | Jadwal rotasi, escalation policy berjenjang, acknowledge |
| **[Rencana](docs/rencana.md)** | Status tiap phase, yang belum dikerjakan, utang teknis, cara menguji |

---

## Development

```bash
docker compose up -d postgres        # atau Postgres lokal apa pun
npm run install:all
cp .env.example server/.env          # isi DATABASE_URL=postgresql://pulsewatch:pulsewatch@localhost:5432/pulsewatch
npm run db:migrate
npm run dev                          # server :3001 + vite :5173
```

Ubah schema: edit `server/prisma/schema.prisma`, lalu `cd server && npx prisma migrate dev --name <nama>`.

---

## Struktur

```
server/
  prisma/schema.prisma   model database
  src/index.js           Express + Socket.io + static client
  src/scheduler.js       tick 1 detik: check, retry, incident, alert
  src/checks/            http, tcp, ping, dns, cert
  src/notifications/     telegram, discord, slack, googlechat, ntfy, email, webhook
  src/routes/            endpoint REST
  src/lib/               auth, apikey, crypto, assertion, stats, ratelimit, security, dependency, audit, sla
client/src/
  pages/                 halaman dashboard & status page publik
  components/            komponen yang dipakai bersama
  lib/                   api, socket, i18n, theme, format
```

Status monitor: `0` down · `1` up · `2` pending · `3` paused · `4` maintenance.
