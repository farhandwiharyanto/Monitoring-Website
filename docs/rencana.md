# Rencana & serah terima

Keadaan Pulsewatch saat ini, apa yang belum dikerjakan, dan cara cepat
menjalankannya untuk diuji. Ditulis untuk sesi kerja berikutnya.

[← Kembali ke README](../README.md)

Terakhir diperbarui: 25 September 2026 · commit `9ab321d`

## Sudah selesai

| Phase | Isi | Commit |
|---|---|---|
| 1–2 | Baseline: monitor HTTP/TCP/Ping/DNS, scheduler, incident, maintenance window, tag, status page, RBAC, 4 provider notifikasi | `af61706` |
| 3 | Hardening, monitor push, sertifikat TLS, Slack/Google Chat/ntfy, export, tema gelap-terang, dwibahasa | `3ff207e` `c0af37a` |
| 3 lanjutan | Alert sertifikat berjenjang, multi-location, HTTP check lanjutan, `/metrics` | `73edbb7` `635b57b` |
| 4 | API key, webhook dua arah, status page berbasis tag, incident update | `3217a4a` `2cc0c10` |
| 5 | Dependency antar-monitor, audit log | `4bd3c79` `d681eed` |
| 6 | Laporan SLA, error budget, target SLO | `8ce36cf` `375d52f` |
| 7 | Jadwal on-call, escalation policy berjenjang, acknowledge | `9ab321d` |

Polanya: tiap phase jadi dua commit — server dulu, lalu klien & dokumentasi.

## Belum dikerjakan

### Phase 8 — Monitor gRPC, Kafka, dan database (sedang–berat)

Tiga jenis check baru di `server/src/checks/`, masing-masing menambah dependency
npm (`@grpc/grpc-js`, `kafkajs`, dan driver database). Sebaiknya dikerjakan
terpisah dari tema lain supaya mudah di-rollback kalau salah satu bermasalah.

Pola yang diikuti: tiap check mengembalikan `{ ok, message, ms }`, didaftarkan di
`server/src/checks/index.js`, lalu tipe barunya ditambahkan ke `MONITOR_TYPES`
dan ke daftar `TYPES` di `client/src/pages/MonitorForm.jsx`.

## Utang teknis yang diketahui

1. **Halaman lama belum diperiksa secara visual di browser.** Halaman Laporan
   dan halaman Audit log lolos build dan datanya benar, tapi tata letaknya belum
   pernah dilihat. Halaman Phase 7 (On-call, kartu eskalasi, kontak on-call di
   Users, field policy di form monitor) sudah diperiksa di Chrome, termasuk
   lebar ponsel.
2. **`dependencyInfo()` membaca seluruh tabel monitor tiap kali monitor
   di-decorate**, termasuk pada tiap siaran heartbeat. Murah selama jumlah
   monitor puluhan; perlu ditinjau ulang kalau nanti ratusan.
3. **Penulisan audit log tidak menahan respons API.** Kalau database tumbang di
   antara tindakan dan pencatatannya, tindakan bisa berhasil tanpa jejak. Ini
   pertukaran yang disengaja, dicatat di [audit-log.md](audit-log.md).
4. **Rate limit API key dihitung per proses**, jadi perlu ditinjau bila instance
   kelak direplikasi. Berlaku juga untuk rate limit endpoint ack.
5. **Bundle klien 818 kB** (peringatan Vite). Belum pernah di-code-split.
6. **Kontak on-call hanya bisa disetel admin.** Konfigurasi notifikasi berisi
   kredensial sehingga router-nya admin-only, jadi viewer yang ikut piket tidak
   bisa mengatur kontaknya sendiri. Kalau nanti perlu, jalannya adalah endpoint
   swalayan yang hanya mengembalikan id/nama/tipe notifikasi, bukan config-nya.
7. **Eskalasi berhenti setelah tingkat terakhir dikirim** (`exhausted`), tidak
   ada pengulangan rantai. Kalau seluruh tingkat lewat tanpa ada yang menangani,
   tidak ada lagi yang mengingatkan.

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

Memeriksa migration tidak melenceng dari schema:

```bash
cd server && npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

Membandingkan kelengkapan dua kamus i18n: lihat `client/src/lib/i18n.jsx`,
kedua kamus harus punya kunci yang sama persis (saat ini 567 kunci).

## Hal yang gampang terlewat

- Batas bulan di laporan SLA memakai **waktu lokal server**, sedangkan Postgres
  menyimpan UTC. Data uji yang di-seed dengan `date_trunc('month', NOW())` tidak
  akan sejajar dengan batas periode laporan.
- Kolom waktu Prisma bertipe `timestamp` tanpa zona berisi UTC, sedangkan `NOW()`
  bertipe `timestamptz`. Di raw SQL, samakan dengan `NOW() AT TIME ZONE 'UTC'`.
- Menambah field monitor berarti menyentuh empat tempat: `schema.prisma`,
  `validate()` di `server/src/routes/monitors.js`, form di
  `client/src/pages/MonitorForm.jsx`, dan kamus i18n (dua bahasa).
- Jangan menjalankan `npx prisma format`: perataan `schema.prisma` yang sekarang
  dijaga manual, dan format otomatis merapikan ulang seluruh berkas sehingga
  diff-nya penuh baris yang tak ada hubungannya. `npx prisma validate` cukup.
- Untuk memeriksa halaman secara visual, jalankan `npm run build` di `client`
  lalu start server uji dengan `CLIENT_DIST="../client/dist"` — seluruh aplikasi
  ikut dilayani di port yang sama, jadi tidak perlu vite dev server.
