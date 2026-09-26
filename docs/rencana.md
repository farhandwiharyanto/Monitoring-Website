# Rencana & serah terima

Keadaan Pulsewatch saat ini, apa yang belum dikerjakan, dan cara cepat
menjalankannya untuk diuji. Ditulis untuk sesi kerja berikutnya.

[← Kembali ke README](../README.md)

Terakhir diperbarui: 27 September 2026

## Sudah selesai

| Phase | Isi | Commit |
|---|---|---|
| 1–2 | Baseline: monitor HTTP/TCP/Ping/DNS, scheduler, incident, maintenance window, tag, status page, RBAC, 4 provider notifikasi | `af61706` |
| 3 | Hardening, monitor push, sertifikat TLS, Slack/Google Chat/ntfy, export, tema gelap-terang, dwibahasa | `3ff207e` `c0af37a` |
| 3 lanjutan | Alert sertifikat berjenjang, multi-location, HTTP check lanjutan, `/metrics` | `73edbb7` `635b57b` |
| 4 | API key, webhook dua arah, status page berbasis tag, incident update | `3217a4a` `2cc0c10` |
| 5 | Dependency antar-monitor, audit log | `4bd3c79` `d681eed` |
| 6 | Laporan SLA, error budget, target SLO | `8ce36cf` `375d52f` |
| 7 | Jadwal on-call, escalation policy berjenjang, acknowledge | `9ab321d` `ea1601e` |
| 8 (fondasi) | Lease scheduler, health cek DB, shutdown rapi, riwayat pengiriman notifikasi, tes unit & CI | `27e5581` `b6355fa` `40f36b2` |
| 8 (fitur) | Status degraded & ambang latency per monitor | `76ede23` |
| 8 (fitur) | Pengingat "masih down", feed Atom status page, ringkasan harian & p95 | `1e1d1f8` |
| 9 | Monitor database (PostgreSQL/MySQL/Redis), gRPC, dan Kafka | `4a2692a` `88b4c4e` `32d6994` |
| 10 | Tes database (SLA, dependency, eskalasi) + perbaikan batas rentang SLA | `c642ca6` |
| 10 | 2FA (TOTP) dengan kode cadangan & reset admin | `0401920` |
| 10 | Eskalasi berulang, cache dependency, kontak on-call swalayan, cek visual, rate limit bersama | `e8f83b7` `c223b14` `39a200a` `9a38482` + commit ini |

Polanya: tiap phase jadi dua commit — server dulu, lalu klien & dokumentasi.

## Belum dikerjakan

- **Modul monitor & analitik database** (Oracle, SQL Server, metrik, menu
  Database). Rinciannya di [rencana-database.md](rencana-database.md).

Selain itu tidak ada pekerjaan terencana yang tersisa selain utang teknis di bawah. Kalau
menambah fitur baru, pertahankan urutan lama: fondasi (tes, CI) lebih dulu, lalu
fitur, tipe monitor baru paling akhir.

### Menambah tipe monitor

Monitor gRPC, Kafka, dan database (PostgreSQL/MySQL/Redis) sudah ada; lihat
[monitoring.md](monitoring.md). Target ujinya di `docker-compose.test.yml`.

Catatan lama yang masih berlaku untuk tipe check berikutnya:

Pola yang diikuti: tiap check mengembalikan `{ ok, message, ms }`, didaftarkan di
`server/src/checks/index.js`, lalu tipe barunya ditambahkan ke `MONITOR_TYPES`
dan ke daftar `TYPES` di `client/src/pages/MonitorForm.jsx`.

Sejak Phase 9, `conn_secret` (terenkripsi) dan `check_config` (JSON) sudah ada,
jadi tipe check baru biasanya tidak perlu migration lagi.

Biaya tersembunyi terbesarnya bukan menulis check-nya, melainkan target uji.
`docker-compose.test.yml` sudah menyediakan Postgres, MySQL, Redis, dan Kafka —
tambahkan service baru di sana, jangan menguji dengan tangan.

**Berkas itu wajib punya `name` sendiri.** Tanpa itu Compose memakai nama
direktori sebagai nama proyek, dan service bernama sama dengan yang ada di
`docker-compose.yml` akan menggantikan container produksinya beserta volume
datanya. Itu pernah terjadi sekali saat Phase 9 dikerjakan.

## Utang teknis yang diketahui

1. **Penulisan audit log tidak menahan respons API.** Kalau database tumbang di
   antara tindakan dan pencatatannya, tindakan bisa berhasil tanpa jejak. Ini
   pertukaran yang disengaja, dicatat di [audit-log.md](audit-log.md).

## Yang perlu dilakukan di instance yang sedang berjalan

Container produksi yang dibangun sebelum Phase 8 **tidak otomatis ikut berubah**
saat repo diperbarui. Untuk membawa seluruh pekerjaan Phase 8-10 ke sana:

```bash
docker compose up -d --build
```

Migration dijalankan otomatis saat start dan semuanya bersifat menambah kolom
atau tabel — tidak ada yang menghapus data. Memeriksa apakah instance sudah
memakai kode terbaru:

```bash
docker exec pulsewatch grep -o 'MONITOR_TYPES = \[[^]]*\]' src/checks/index.js
```

Kalau hasilnya hanya lima tipe (`http, tcp, ping, dns, push`), image-nya masih
yang lama dan tipe monitor baru belum akan muncul di UI.

## Cara menjalankan untuk diuji

Container `docker compose` yang sedang berjalan memakai Postgres yang **tidak
dipublikasikan ke host**, dan `server/.env` menunjuk port `5433` yang tidak ada.
Jadi untuk menguji, paling cepat pakai Postgres sekali pakai di port lain —
instance yang sedang jalan tidak perlu disentuh sama sekali:

```bash
docker run -d --rm --name pwtest \
  -e POSTGRES_USER=pw -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=pwtest \
  -p 55432:5432 postgres:16-alpine

cd server
export DATABASE_URL="postgresql://pw:pw@localhost:55432/pwtest"
npx prisma migrate deploy
PORT=3099 BASE_URL="http://localhost:3099" \
  JWT_SECRET="uji-saja-minimal-32-karakter-0123456789" ADMIN_PASSWORD="admin12345" \
  node src/index.js

# selesai
docker rm -f pwtest
```

Login `admin` / `admin12345`, lalu ambil token dari `POST /api/auth/login`.

Tes unit tidak butuh database sama sekali:

```bash
cd server && npm test        # 97 tes, ~1 detik
```

Tes yang menyentuh database (`slaReport`, dependency, rantai eskalasi) ada di
`server/test-db/` dan butuh Postgres sungguhan yang sudah di-migrate. Tes itu
**mengosongkan seluruh tabel**, jadi menolak berjalan kalau nama database-nya
tidak mengandung `test`:

```bash
cd server && DATABASE_URL="postgresql://pw:pw@localhost:55432/pwtest" npm run test:db
```

Tanpa Docker, Postgres dari Homebrew juga cukup: `initdb` ke folder sementara
(pakai `LC_ALL=C`), lalu `pg_ctl ... -o "-p 55432 -k ''"`.

Isinya logika yang sulit diuji dengan tangan: assertion JSONPath, jendela
maintenance berulang yang melintasi tengah malam, ambang alert sertifikat,
penyaring multi-location, enkripsi kredensial, dan rate limit login. Zona waktu
dikunci ke `Asia/Jakarta` lewat `server/test-setup.mjs` supaya hasilnya sama di
laptop dan di CI.

Memeriksa migration tidak melenceng dari schema:

```bash
cd server && npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

Membandingkan kelengkapan dua kamus i18n (saat ini 681 kunci):

```bash
node scripts/check-i18n.mjs
```

Semuanya dijalankan otomatis oleh [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
pada tiap push ke `main` dan tiap pull request.

## Hal yang gampang terlewat

- Batas bulan di laporan SLA memakai **waktu lokal server**, sedangkan Postgres
  menyimpan UTC. Data uji yang di-seed dengan `date_trunc('month', NOW())` tidak
  akan sejajar dengan batas periode laporan.
- Kolom waktu Prisma bertipe `timestamp` tanpa zona berisi UTC, sedangkan `NOW()`
  bertipe `timestamptz`. Di raw SQL, samakan dengan `NOW() AT TIME ZONE 'UTC'`.
  Parameter `Date` dari JS juga tiba sebagai `timestamptz`: tulis
  `${d}::timestamptz AT TIME ZONE 'UTC'`, jangan `${d}::timestamp` — yang
  terakhir bergeser mengikuti zona waktu sesi database.
- Menambah field monitor berarti menyentuh empat tempat: `schema.prisma`,
  `validate()` di `server/src/routes/monitors.js`, form di
  `client/src/pages/MonitorForm.jsx`, dan kamus i18n (dua bahasa).
- Jangan menjalankan `npx prisma format`: perataan `schema.prisma` yang sekarang
  dijaga manual, dan format otomatis merapikan ulang seluruh berkas sehingga
  diff-nya penuh baris yang tak ada hubungannya. `npx prisma validate` cukup.
- Untuk memeriksa halaman secara visual, jalankan `npm run build` di `client`
  lalu start server uji dengan `CLIENT_DIST="../client/dist"` — seluruh aplikasi
  ikut dilayani di port yang sama, jadi tidak perlu vite dev server.
- Memotret halaman tanpa membuka browser sendiri: jalankan Chrome dengan
  `--headless=new --remote-debugging-port=9222`, suntikkan token login ke
  `localStorage` (kunci `pulsewatch_token`) lewat `Runtime.evaluate`, lalu
  `Page.captureScreenshot`. Seluruh halaman sudah pernah diperiksa dengan cara ini.
