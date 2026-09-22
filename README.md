# Pulsewatch

Self-hosted uptime monitoring — alternatif ringan dari Uptime Kuma.

**Stack:** Node.js (Express 5) + PostgreSQL (Prisma) · React + Tailwind · Socket.io · node-cron · Recharts

## Fitur
- Monitor **HTTP(s)** (status code + keyword), **TCP port**, **Ping**, **DNS**, dan **Push**
- **Push monitor**: cron job / script di sisi target memanggil `GET /api/push/<token>` tiap selesai jalan.
  Monitor ditandai down bila tidak ada push melewati `interval + grace period`.
- **Sertifikat TLS**: expiry, issuer, subject, dan validitas rantai dipantau otomatis untuk monitor https.
  Alert berjenjang pada sisa **30 / 14 / 7 / 3 hari** — satu kirim per ambang, bukan tiap check.
  Halaman detail menampilkan countdown dan badge peringatan saat sisa < 14 hari.
- **Multi-location check**: beberapa agen bisa memeriksa monitor yang sama dari lokasi berbeda.
  Kalau satu lokasi down sementara lokasi lain up, dashboard menandainya sebagai masalah jaringan
  lokal, bukan service-nya yang mati.
- **HTTP check lanjutan**: custom header, Basic Auth / Bearer token (tersimpan terenkripsi),
  body assertion JSON path (`$.status` = `"ok"`), dan range status code yang bisa diatur.
  Hasil assertion tersimpan di log heartbeat untuk penelusuran.
- **Prometheus exporter** di `/metrics` — status, response time, uptime ratio, sisa umur
  sertifikat, dan metrik per lokasi, siap di-scrape Grafana
- **API key** dengan scope read-only / read-write untuk akses programatik dari sistem lain,
  disimpan hashed dan dibatasi rate limit per kunci
- **Webhook dua arah**: outbound untuk memicu otomasi (restart service, buka ticket) lengkap
  dengan retry dan log panggilan, serta inbound agar Ansible/n8n bisa melapor balik ke
  timeline monitor
- **Incident update manual** yang tampil di status page publik ("Tim sedang investigasi",
  "Sudah teratasi") untuk berkomunikasi ke pengguna selama gangguan
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
| `CERT_ALERT_THRESHOLDS` | `30,14,7,3` | Ambang alert sertifikat (hari); satu alert per ambang yang dilewati |
| `CERT_CHECK_INTERVAL_HOURS` | `6` | Jeda antar handshake TLS untuk membaca sertifikat |
| `CERT_EXPIRY_WARN_DAYS` | `14` | Ambang badge "segera kedaluwarsa" di UI |
| `HEARTBEAT_RETENTION_DAYS` | `90` | Heartbeat lebih tua dari ini dihapus tiap hari jam 03:00 |
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

> **Kredensial monitor:** Basic Auth dan Bearer token milik monitor disimpan terenkripsi
> AES-256-GCM. Kuncinya diturunkan dari `JWT_SECRET` bila `ENCRYPTION_KEY` kosong, jadi
> **mengganti `JWT_SECRET` membuat kredensial monitor lama tidak terbaca** dan harus diisi ulang.
> Set `ENCRYPTION_KEY` sendiri kalau ingin memutar `JWT_SECRET` tanpa efek samping itu.
> Worker multi-location harus memakai nilai yang sama dengan instance web.

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

## HTTP check lanjutan

Untuk monitor tipe HTTP(s), bagian **HTTP lanjutan** pada form Add/Edit Monitor menyediakan:

**Custom header** — pasangan nama/nilai yang dikirim apa adanya. Header kontrol koneksi
(`Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Keep-Alive`, `Upgrade`) ditolak
karena diatur otomatis oleh HTTP client.

**Autentikasi** — Basic Auth (username + password) atau Bearer token. Nilainya dienkripsi
AES-256-GCM sebelum masuk database dan **tidak pernah dikirim kembali ke browser**; hanya
username Basic Auth yang ditampilkan lagi agar form bisa diisi ulang. Saat mengedit monitor,
biarkan field password/token kosong untuk mempertahankan kredensial yang tersimpan.

**Body assertion** — memeriksa satu nilai di dalam response JSON:

| Bagian | Contoh |
|---|---|
| Path | `$.status` · `$.data.items[0].id` · `$['nama dengan spasi']` |
| Operator | `eq` `ne` `gt` `lt` `gte` `lte` `contains` `regex` `exists` `notexists` |
| Nilai | `ok` · `200` · `true` |

Path memakai subset JSONPath (properti, indeks array, indeks negatif) tanpa wildcard atau filter.
Assertion dijalankan setelah response diterima dan status code lolos. Bila assertion gagal, monitor
dihitung **down** dan pesannya menyebutkan nilai sebenarnya, misalnya:

```
HTTP 200 · Assertion gagal: $.status eq "ok" — nilai sebenarnya "degraded"
```

Hasilnya (`assertion_ok` + `assertion_message`) ikut tersimpan di setiap heartbeat, jadi riwayatnya
bisa ditelusuri lewat halaman detail maupun export CSV.

## Multi-location check

Setiap heartbeat diberi label lokasi lewat `LOCATION_NAME`. Instance web adalah lokasi
**primary** (`PRIMARY_LOCATION`), dan lokasi lain dijalankan sebagai worker.

Pembagian tugasnya sengaja tegas supaya angka Phase 1–2 tidak berubah dan tidak ada alert ganda:

| | Lokasi primary | Lokasi lain |
|---|---|---|
| Menulis heartbeat | ya | ya |
| Status & uptime yang tampil di dashboard | ya | tidak |
| Incident & notifikasi | ya | tidak |
| Pemeriksaan sertifikat TLS | ya | tidak |
| Dipakai untuk perbandingan lokasi | ya | ya |

Kalau lokasi tidak sepakat — satu bilang up, satu bilang down — dashboard tetap melaporkan status
dari lokasi primary, tapi menandai monitor dengan badge **beda lokasi** dan menampilkan peringatan
di halaman detail. Itu pertanda masalah jaringan di salah satu lokasi, bukan service-nya yang mati.
Lokasi yang tidak mengirim kabar lebih dari 10 menit ditandai basi dan tidak ikut dihitung.

### Menjalankan worker lokasi kedua

Worker adalah image yang sama dengan `WORKER_ONLY=true`: hanya scheduler, tanpa API/UI. Ia menulis
ke database yang sama dengan instance web.

```bash
docker run -d --name pulsewatch-sg --restart unless-stopped \
  -e DATABASE_URL="postgresql://pulsewatch:PASSWORD@db.contoh.com:5432/pulsewatch" \
  -e JWT_SECRET="<sama persis dengan instance web>" \
  -e WORKER_ONLY=true \
  -e LOCATION_NAME=singapore \
  -e PRIMARY_LOCATION=primary \
  pulsewatch:latest node src/index.js
```

Yang perlu diperhatikan:

- **`JWT_SECRET` (atau `ENCRYPTION_KEY`) harus sama** dengan instance web, karena worker perlu
  membuka kredensial Basic Auth / Bearer milik monitor.
- Worker **tidak** menjalankan `prisma migrate deploy` — migration tetap tugas instance web.
  Karena itu `command` di atas langsung memanggil `node src/index.js`.
- Postgres harus bisa dihubungi dari lokasi worker. Batasi aksesnya (TLS, firewall, atau tunnel);
  worker butuh koneksi database penuh, bukan sekadar akses API.
- `LOCATION_NAME` tiap worker harus unik. Worker yang memakai nama sama dengan primary akan
  mencetak peringatan saat start.

Untuk mencoba mekanismenya di satu mesin, `docker-compose.yml` menyediakan service worker di
belakang profile:

```bash
docker compose --profile multi-location up -d
```

Perlu jujur soal ini: worker di mesin yang sama memeriksa dari jaringan yang sama, jadi hasilnya
akan selalu sepakat dengan primary. Gunanya cuma untuk menguji alurnya. Multi-location yang
sebenarnya berarti menjalankan worker di host atau region lain.

Lokasi yang aktif 7 hari terakhir bisa dilihat di `GET /api/monitors/locations`.

## Prometheus & Grafana

`GET /metrics` mengeluarkan format eksposisi Prometheus (`text/plain; version=0.0.4`).

Scrape butuh salah satu dari: header `Authorization: Bearer <METRICS_TOKEN>`, token login biasa,
atau query `?token=<METRICS_TOKEN>`. Set `METRICS_PUBLIC=true` hanya bila endpoint sudah dibatasi
di level jaringan.

```bash
# .env
METRICS_TOKEN=$(openssl rand -hex 24)
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: pulsewatch
    metrics_path: /metrics
    scrape_interval: 60s
    static_configs:
      - targets: ["pulsewatch.contoh.com:3001"]
    authorization:
      type: Bearer
      credentials: "<isi METRICS_TOKEN>"
```

Metrik yang tersedia:

| Metrik | Label | Arti |
|---|---|---|
| `pulsewatch_monitor_status` | `monitor_id` `monitor` `type` | 0 down · 1 up · 2 pending · 3 paused · 4 maintenance |
| `pulsewatch_monitor_up` | sda | 1 bila up; maintenance & paused dihitung 0 |
| `pulsewatch_monitor_response_time_ms` | sda | Response time pengecekan terakhir |
| `pulsewatch_monitor_last_check_timestamp_seconds` | sda | Unix timestamp check terakhir |
| `pulsewatch_monitor_uptime_ratio` | sda + `window` (`24h`/`30d`) | Rasio uptime 0–1 |
| `pulsewatch_monitor_location_up` | sda + `location` | Status menurut tiap lokasi |
| `pulsewatch_monitor_location_response_time_ms` | sda + `location` | Response time per lokasi |
| `pulsewatch_monitor_location_split` | sda | 1 bila lokasi tidak sepakat |
| `pulsewatch_monitor_cert_expiry_timestamp_seconds` | sda + `issuer` | Unix timestamp expiry sertifikat |
| `pulsewatch_monitor_cert_days_remaining` | sda | Sisa hari sertifikat |
| `pulsewatch_monitor_cert_chain_valid` | sda | 1 bila rantai sertifikat valid |
| `pulsewatch_monitor_assertion_ok` | sda | 1 bila body assertion terakhir lulus |
| `pulsewatch_monitors_total` | `status` | Jumlah monitor per status |
| `pulsewatch_open_incidents` | `instance` | Incident yang belum selesai |
| `pulsewatch_scrape_duration_seconds` | `instance` | Lama penyusunan metrik |

Contoh alert rule:

```yaml
groups:
  - name: pulsewatch
    rules:
      - alert: SertifikatSegeraKedaluwarsa
        expr: pulsewatch_monitor_cert_days_remaining < 14
        for: 1h
        annotations:
          summary: "Sertifikat {{ $labels.monitor }} tersisa {{ $value }} hari"

      - alert: LokasiTidakSepakat
        expr: pulsewatch_monitor_location_split == 1
        for: 10m
        annotations:
          summary: "{{ $labels.monitor }} terlihat berbeda antar lokasi — periksa jaringan"
```

## Export data

| Endpoint | Isi |
|---|---|
| `/api/export/csv?monitorId=&from=&to=&location=` | Uptime & response time per heartbeat, dengan kolom `up` (0/1) siap dijumlahkan |
| `/api/export/monitors` | Daftar monitor beserta status, uptime, dan info sertifikat |
| `/api/export/heartbeats?hours=` | Riwayat heartbeat mentah |
| `/api/export/incidents` | Riwayat incident beserta durasinya |
| `/api/export/config` | Backup konfigurasi (tanpa kredensial notifikasi & token push) |

Semua menerima `?format=csv` (bawaan) atau `?format=json`. Parameter `location` bawaannya lokasi
primary; isi `all` untuk semua lokasi. Contoh:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/export/csv?monitorId=3&from=2026-09-01&to=2026-09-30&location=all" \
  -o uptime-september.csv
```

## API key

Untuk dipakai sistem lain — platform low-code internal, script, dashboard pihak ketiga —
tanpa membagikan password akun.

Buat dari **Pengaturan → API key**. Kunci penuh hanya ditampilkan **sekali** saat dibuat;
database menyimpan SHA-256-nya saja, jadi kunci yang hilang tidak bisa dipulihkan — cabut
lalu buat yang baru.

| Scope | Boleh |
|---|---|
| `read` | Hanya `GET`. Setara role viewer |
| `write` | Semua method. Setara role admin pada endpoint yang diizinkan |

Kunci dikirim persis seperti token login:

```bash
export PULSEWATCH_KEY="pw_xxxxxxxx…"

# Daftar monitor
curl -H "Authorization: Bearer $PULSEWATCH_KEY" \
  https://pulsewatch.contoh.com/api/monitors

# Ringkasan dashboard
curl -H "Authorization: Bearer $PULSEWATCH_KEY" \
  https://pulsewatch.contoh.com/api/monitors/stats

# Riwayat heartbeat 24 jam terakhir
curl -H "Authorization: Bearer $PULSEWATCH_KEY" \
  "https://pulsewatch.contoh.com/api/monitors/3/heartbeats?hours=24"

# Status publik sebuah status page (tidak butuh kunci sama sekali)
curl https://pulsewatch.contoh.com/api/public/status/internal-platform

# Membuat monitor — butuh scope write
curl -X POST -H "Authorization: Bearer $PULSEWATCH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"API baru","type":"http","url":"https://api.contoh.com/health","interval_seconds":60}' \
  https://pulsewatch.contoh.com/api/monitors
```

**Batasan yang sengaja dipasang:**

- Kunci `read` yang memakai method selain `GET` mendapat `403 API key ini read-only`.
- `/api/users`, `/api/api-keys`, dan `/api/notifications` **tidak bisa** diakses API key sama
  sekali, apa pun scope-nya. Tanpa batas ini, satu kunci read-write bisa membuat kunci lain,
  membuat user admin, atau membaca kredensial notifikasi.
- Rate limit `API_KEY_RATE_LIMIT` request per `API_KEY_RATE_WINDOW_SECONDS` per kunci.
  Setiap respons membawa `X-RateLimit-Limit` dan `X-RateLimit-Remaining`; saat terlampaui
  balasannya `429` dengan header `Retry-After`.

```bash
$ curl -i -H "Authorization: Bearer $PULSEWATCH_KEY" .../api/monitors/stats
HTTP/1.1 429 Too Many Requests
Retry-After: 50
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0

{"error":"Rate limit API key terlampaui, coba lagi dalam 50 detik."}
```

Mencabut kunci berlaku seketika — request berikutnya langsung ditolak.

## Webhook dua arah

### Outbound: memicu otomasi

Diatur per monitor di bagian **Webhook aksi** pada form Add/Edit Monitor. Berbeda dari
notifikasi: notifikasi memberi kabar ke manusia, webhook aksi **menjalankan sesuatu**.

Payload yang dikirim:

```json
{
  "event": "monitor.down",
  "triggered_at": "2026-09-23T02:10:01.000Z",
  "monitor": { "id": 2, "name": "Backend API", "type": "http",
               "target": "https://api.contoh.com/health", "interval_seconds": 60 },
  "incident": { "id": 12, "started_at": "2026-09-23T02:10:01.000Z", "cause": "ECONNREFUSED" },
  "heartbeat": { "status": 0, "message": "ECONNREFUSED", "response_time": null,
                 "created_at": "2026-09-23T02:10:01.000Z" },
  "callback": "https://pulsewatch.contoh.com/api/webhook/trigger/2"
}
```

Pemanggilan yang gagal diulang otomatis (1 detik, lalu 3 detik — atur lewat
`ACTION_WEBHOOK_ATTEMPTS`). **Setiap percobaan** tercatat di halaman detail monitor,
bagian *Riwayat panggilan webhook*, lengkap dengan status code, durasi, dan pesan error.
Tombol **Uji webhook** memanggilnya sekarang juga tanpa menunggu monitor benar-benar down.

### Inbound: melapor balik

Setelah otomasi selesai, panggil `callback` di atas supaya tercatat pada timeline monitor:

```bash
curl -X POST \
  -H "Authorization: Bearer $PULSEWATCH_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "source": "ansible",
        "title": "Service di-restart otomatis",
        "message": "playbook restart-service.yml selesai, exit code 0",
        "host": "app-01"
      }' \
  https://pulsewatch.contoh.com/api/webhook/trigger/2
```

Butuh API key scope **write** (atau admin yang login). Event otomatis ditautkan ke incident
yang sedang terbuka, lalu muncul di *Timeline otomasi* pada halaman detail monitor.

Ini **bukan** heartbeat: status dan uptime monitor tidak berubah karenanya. Untuk melaporkan
hidup/matinya sebuah target, pakai [monitor push](#push-monitor).

Contoh potongan playbook Ansible:

```yaml
- name: Restart service
  ansible.builtin.systemd:
    name: backend
    state: restarted

- name: Lapor ke Pulsewatch
  ansible.builtin.uri:
    url: "https://pulsewatch.contoh.com/api/webhook/trigger/2"
    method: POST
    headers:
      Authorization: "Bearer {{ pulsewatch_api_key }}"
    body_format: json
    body:
      source: ansible
      title: "Service di-restart otomatis"
      message: "playbook {{ ansible_play_name }} selesai"

## Status page publik

Buat dari menu **Status Pages**. Monitor bisa dipilih dua cara dan keduanya digabung:

- **Lewat tag/group** — semua monitor bertag itu ikut tampil, termasuk yang ditambahkan nanti.
- **Satu per satu** — tampil lebih dulu, sesuai urutan pilihannya.

Halaman diakses tanpa login lewat `/status/<slug>` atau lewat custom domain.

### Yang TIDAK ikut tampil ke publik

Payload publik sengaja dibatasi. URL asli, hostname, port, konfigurasi check (interval,
timeout, expected status code, keyword, assertion), kredensial, push token, pesan heartbeat,
dan penyebab teknis incident **tidak** disertakan. Yang tampil hanya nama monitor, tipe,
status, uptime, heartbeat bar, waktu incident, dan kabar yang ditulis admin.

### Incident update

Selama gangguan, admin bisa menulis kabar dari halaman detail monitor (tombol **Tulis kabar**
pada baris incident). Tersedia empat status: *Sedang diperiksa*, *Penyebab ditemukan*,
*Sedang dipantau*, dan *Sudah teratasi*.

Kabar ini murni untuk komunikasi — status incident sendiri tetap ditentukan heartbeat, jadi
menulis "Sudah teratasi" tidak menutup incident bila monitornya masih down.

Lewat API:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"investigating","message":"Tim sedang investigasi, perkiraan pulih 30 menit"}' \
  https://pulsewatch.contoh.com/api/incidents/12/updates
```

## Custom domain untuk status page

Isi field *Custom domain* pada status page, lalu arahkan domain itu ke Pulsewatch. Saat
domain dibuka di root (`/`), Pulsewatch mencocokkan host dengan status page dan langsung
menampilkannya.

**Set `TRUST_PROXY=true`** bila Pulsewatch berada di belakang reverse proxy. Tanpa itu,
header `X-Forwarded-Host` sengaja diabaikan supaya tidak bisa dipalsukan klien yang menembak
Pulsewatch langsung.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name status.contoh.com;

    ssl_certificate     /etc/letsencrypt/live/status.contoh.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.contoh.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;

        # Host asli inilah yang dipakai Pulsewatch memilih status page
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.io butuh upgrade websocket agar status page ikut realtime
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Traefik (label docker-compose)

```yaml
services:
  pulsewatch:
    labels:
      - "traefik.enable=true"
      # Dashboard admin
      - "traefik.http.routers.pulsewatch.rule=Host(`pulsewatch.contoh.com`)"
      - "traefik.http.routers.pulsewatch.entrypoints=websecure"
      - "traefik.http.routers.pulsewatch.tls.certresolver=letsencrypt"
      # Status page publik di domain sendiri, diarahkan ke service yang sama
      - "traefik.http.routers.pulsewatch-status.rule=Host(`status.contoh.com`)"
      - "traefik.http.routers.pulsewatch-status.entrypoints=websecure"
      - "traefik.http.routers.pulsewatch-status.tls.certresolver=letsencrypt"
      - "traefik.http.services.pulsewatch.loadbalancer.server.port=3001"
```

Traefik meneruskan `X-Forwarded-Host` secara bawaan, jadi cukup pastikan `TRUST_PROXY=true`
di environment Pulsewatch.

### DNS

Arahkan `status.contoh.com` ke server yang sama — `CNAME` ke host Pulsewatch, atau `A`/`AAAA`
ke IP-nya. Satu domain hanya boleh dipakai satu status page; domain yang sudah terpakai
ditolak saat disimpan.

Memastikan pemetaannya benar:

```bash
curl -H "X-Forwarded-Host: status.contoh.com" \
  https://pulsewatch.contoh.com/api/public/status/resolve
# {"slug":"internal-platform"}
```

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
  src/scheduler.js          node-cron tick 1s → check, retry, incident, push freshness,
                            label lokasi, dan alert sertifikat berjenjang
  src/lib/auth.js           JWT + requireAuth / requireAdmin (RBAC) + pembatalan token
  src/lib/apikey.js         pembuatan, hashing, dan rate limit API key
  src/lib/actionWebhook.js  webhook aksi keluar: retry + pencatatan tiap percobaan
  src/lib/crypto.js         enkripsi AES-256-GCM untuk kredensial monitor
  src/lib/assertion.js      subset JSONPath + evaluasi body assertion
  src/lib/ratelimit.js      rate limit login & endpoint publik
  src/lib/security.js       header keamanan & kebijakan CORS
  src/lib/maintenance.js    evaluasi window aktif (sekali/harian/mingguan)
  src/lib/stats.js          decorate monitor (status, uptime, tag, maintenance, lokasi) & stats
  src/checks/               http (header/auth/assertion), tcp, ping, dns, cert
  src/notifications/        telegram, discord, slack, googlechat, ntfy, email, webhook
  src/routes/               auth, users, monitors, tags, maintenance, notifications,
                            statusPages (+ public), push, settings, export, metrics,
                            apiKeys, webhook (inbound), incidents (update publik)
client/src/
  pages/        Dashboard, Monitors (grouped), MonitorDetail, MonitorForm, Maintenance, Users,
                Notifications, StatusPages, PublicStatus, Login, Settings
  components/   Layout, HeartbeatBar, MonitorRow, StatCard, StatusBadge, TagChip, TagFilter,
                MaintenanceForm, ThemeToggle, ApiKeys
  lib/          api (+ download), socket, auth (role context), monitors (realtime context),
                format, i18n (id/en), theme (gelap/terang/auto + warna grafik)
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
| GET | /api/monitors/locations | any | lokasi agen yang aktif 7 hari terakhir |
| POST | /api/monitors/:id/reset-push-token | admin | buat ulang token push |
| GET | /api/monitors/:id/heartbeats?hours&location · /incidents · /events?location · /maintenance | any | `location` bawaannya primary, `all` untuk semua |
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
| GET | /api/export/csv?monitorId=&from=&to=&location= | any | uptime & response time per heartbeat |
| GET | /api/export/monitors · /heartbeats · /incidents | any | `?format=csv\|json` |
| GET | /api/export/config | admin | backup JSON tanpa kredensial |
| GET | /metrics | token scrape / login | exposisi Prometheus |
| GET/POST | /api/api-keys | admin (login) | daftar & buat API key; kunci penuh sekali saja |
| POST | /api/api-keys/:id/revoke · DELETE /api/api-keys/:id | admin (login) | cabut / hapus |
| POST | /api/webhook/trigger/:monitorId | write | catat laporan otomasi di timeline monitor |
| GET | /api/webhook/events/:monitorId | any | timeline event monitor |
| GET | /api/monitors/:id/events-log · /webhook-logs | any / admin | event otomasi & log webhook aksi |
| POST | /api/monitors/:id/test-action-webhook | admin | panggil webhook aksi sekarang juga |
| GET | /api/incidents?open=&monitor_id= | any | incident beserta update-nya |
| CRUD | /api/incidents/:id/updates | admin | kabar publik selama incident |

Status monitor: `0` down · `1` up · `2` pending · `3` paused · `4` maintenance.
Heartbeat punya flag `maintenance`, kolom `location`, serta `assertion_ok` / `assertion_message`.
Endpoint mengubah data mengembalikan `403` untuk role `viewer`.

Seluruh endpoint Phase 1–3 tetap sama bentuknya; field baru hanya ditambahkan, tidak ada yang dihapus
atau diubah arti.

Endpoint ber-auth menerima **token login maupun API key** lewat header yang sama, kecuali
`/api/users`, `/api/api-keys`, dan `/api/notifications` yang hanya untuk manusia yang login.

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
