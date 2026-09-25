# Monitoring

Tipe monitor, pengecekan HTTP lanjutan, dan pemeriksaan dari beberapa lokasi.

[← Kembali ke README](../README.md)

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

## Status degraded & ambang latency

Sampai sebelum ini status monitor biner: hidup atau mati. Layanan yang
responsnya naik dari 200 ms ke 8 detik tetap dihitung **UP** dan tidak ada yang
memberi tahu siapa pun. Isi `latency_threshold_ms` pada sebuah monitor dan
respons di atas ambang itu menandainya **degraded** — masih hidup, tapi lebih
lambat dari yang dijanjikan.

Yang penting: **heartbeat-nya tetap berstatus UP.** Degraded disimpan sebagai
kolom tersendiri, bukan nilai status baru, sehingga uptime, laporan SLA, error
budget, dan seluruh riwayat lama tidak berubah artinya sedikit pun. Yang
bertambah hanya satu penanda kualitas di atasnya.

Alert dikirim sekali saat masuk degraded dan sekali saat kembali normal, ke
channel notifikasi monitor itu. Tidak ada incident yang dibuka dan rantai
eskalasi tidak ikut jalan — layanannya tidak mati. Maintenance window dan
dependency yang sedang menahan alert juga menahan alert latency, sama seperti
alert down.

**Histeresis.** Keluar dari degraded butuh turun di bawah ambang dikali
`LATENCY_RECOVERY_RATIO` (bawaan 0,9). Dengan ambang 500 ms, monitor masuk
degraded di atas 500 ms dan baru keluar di bawah 450 ms. Tanpa jeda itu,
layanan yang bertahan tepat di sekitar ambang akan mengirim alert bolak-balik
setiap interval.

Di UI: badge status oranye, batang heartbeat oranye pada periode melambat,
waktu respons berwarna di daftar monitor, dan jumlah yang melambat disebut di
kartu "Up" pada dashboard. Status page publik menampilkan "Sebagian sistem
berjalan lebih lambat dari biasanya" — ambangnya sendiri tidak dibuka ke publik.

Di Prometheus: `pulsewatch_monitor_degraded` dan
`pulsewatch_monitor_latency_threshold_ms`. `pulsewatch_monitor_up` tetap 1 untuk
monitor degraded, jadi alert ketersediaan yang sudah terpasang tidak ikut
berbunyi hanya karena sebuah layanan melambat.

## Monitor database

Tiga tipe check baru: **PostgreSQL**, **MySQL**, dan **Redis**. Targetnya berupa
connection string, bukan hostname:

```
postgres://user:password@host:5432/nama_db
mysql://user:password@host:3306/nama_db
redis://host:6379
```

Connection string disimpan terenkripsi seperti kredensial monitor lainnya dan
**tidak pernah dikirim balik ke browser**. Saat mengedit monitor, field-nya
kosong dan boleh dibiarkan kosong — yang tersimpan tetap dipakai.

Bawaannya `SELECT 1` (Postgres/MySQL) dan `PING` (Redis). Query sendiri boleh
diisi untuk memastikan sebuah tabel benar-benar terbaca, bukan sekadar server
hidup. Query wajib diawali `SELECT`, `SHOW`, atau `EXPLAIN`: query monitor
dijalankan berulang kali selamanya, dan yang mengubah data tidak pada tempatnya
di sana.

Tiap check membuka koneksi baru lalu menutupnya. Monitor yang memantau kesehatan
database justru tidak boleh meninggalkan koneksi menganggur di sana, dan koneksi
yang dipakai ulang bisa menyembunyikan persis kegagalan yang sedang dicari —
pool penuh, autentikasi kedaluwarsa, DNS berubah.

Pesan kegagalan dari driver disaring dulu: apa pun yang berbentuk
`://user:password@` disamarkan, karena pesan heartbeat terbaca oleh viewer dan
ikut ke export.

Untuk menguji ketiganya, ada `docker-compose.test.yml` di root repo.

## Monitor gRPC

Memakai protokol health checking standar gRPC (`grpc.health.v1.Health/Check`),
yang sama dengan yang dipakai Kubernetes dan service mesh. Karena protokolnya
baku, monitor tidak perlu tahu apa pun tentang API milik service yang dipantau —
cukup hostname dan portnya.

Nama service boleh diisi untuk menanyakan komponen tertentu (`myapp.Orders`);
kosong berarti kesehatan server secara keseluruhan. TLS menyala secara bawaan.

Pemetaan jawabannya:

| Jawaban | Status | Alasan |
|---|---|---|
| `SERVING` | UP | sehat |
| `NOT_SERVING` | DOWN | service melaporkan dirinya sakit |
| `SERVICE_UNKNOWN` | DOWN | nama service-nya salah ketik atau sudah tidak ada |
| `UNIMPLEMENTED` | **UP** | server hidup dan bicara gRPC, hanya tidak memasang health service |

Baris terakhir itu disengaja: banyak service tidak memasang health service sama
sekali, dan menandainya DOWN akan menghasilkan alert palsu untuk service yang
sebenarnya sehat. Pesannya menyebutkan hal itu supaya tidak membingungkan.

Sertifikat TLS tidak divalidasi pada check ini — yang diuji adalah "service ini
menjawab", bukan rantai sertifikatnya, dan sertifikat internal sering tidak
dikenal. Monitor HTTPS biasa punya pemeriksaan sertifikat tersendiri.

## Monitor Kafka

Diisi daftar broker (`host:port`, dipisah koma) dan, bila perlu, satu topik.

Tanpa topik, yang diperiksa hanya bahwa cluster menjawab dan berapa broker yang
terdaftar. Dengan topik, topik itu harus ada **dan setiap partisinya harus punya
leader**. Partisi tanpa leader adalah keadaan yang khas Kafka: cluster-nya
hidup dan port-nya terbuka, tapi produce dan consume ke partisi itu gagal.
Monitor TCP biasa tidak akan pernah menangkapnya.

Monitor ini tidak memproduksi maupun mengonsumsi pesan apa pun. Keberadaan topik
diperiksa lewat `listTopics`, bukan dengan meminta metadata topik itu: pada
broker dengan `auto.create.topics.enable`, meminta metadata topik yang belum ada
justru **membuat** topiknya. Monitor tidak boleh mengubah apa pun pada sistem
yang dipantaunya.

## Pengingat selama masih down

Isi `renotify_minutes` pada sebuah monitor dan kabar "masih down" diulang ke
channel yang sama tiap sekian menit selama gangguan berlangsung. Tanpa itu,
gangguan jam dua pagi menghasilkan satu pesan lalu senyap sampai pulih — pesan
itu tenggelam dan tidak ada apa pun yang mengingatkan lagi.

Berbeda dari eskalasi: eskalasi memanggil **orang lain** secara berjenjang lalu
berhenti di tingkat terakhir. Pengingat hanya mengulang kabar ke penerima yang
sama. Keduanya bisa dipakai bersamaan.

Pengingat berhenti sendiri saat monitor pulih, dan langsung berhenti bila rantai
eskalasi incident itu sudah di-acknowledge — tandanya sudah ada yang menangani.
Maintenance window yang baru dimulai dan induk yang ikut down menahan pengingat
tanpa menggeser jadwalnya: begitu penahannya hilang, pengingat menyusul.

Jadwalnya disimpan di tabel incident (`last_notified_at`, `renotify_count`),
bukan di timer dalam memori, jadi proses yang mati dan digantikan tidak
kehilangan jadwal pengingatnya.

## Ringkasan harian & p95

Heartbeat dibuang setelah `HEARTBEAT_RETENTION_DAYS` (bawaan 90 hari), jadi
grafik waktu respons yang lebih tua ikut hilang. Laporan SLA tidak terpengaruh
karena dihitung dari tabel incident, bukan dari heartbeat — yang hilang hanya
riwayat kecepatan.

Tabel `heartbeat_daily` menyimpan ringkasannya: jumlah up/down/degraded, serta
min, rata-rata, **p95**, dan maks waktu respons per monitor per hari per lokasi.
Diisi tiap jam untuk hari berjalan, dan sekali lagi jam 03:00 **sebelum**
pemangkasan — urutan itu yang membuat grafiknya tidak berlubang. Instance yang
baru dimutakhirkan mengisi seluruh riwayatnya sekali saat start.

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/monitors/3/daily?days=365"
```

p95 disimpan berdampingan dengan rata-rata, bukan menggantikannya: layanan
dengan rata-rata 200 ms tapi p95 3 detik terasa lambat bagi sebagian pengguna,
dan rata-rata sendiri tidak pernah memperlihatkannya. Angka p95 24 jam juga
ikut di `GET /api/monitors` sebagai `p95_response_24h`.

## Riwayat pengiriman notifikasi

Setiap pengiriman dicatat — berhasil maupun gagal — beserta jumlah percobaan,
lamanya, dan pesan error dari provider. Sebelumnya kegagalan hanya muncul di
stdout, jadi saluran alert yang mati (bot dicabut, SMTP menolak, webhook 404)
tidak terlihat dari mana pun di aplikasi. Untuk alat monitoring, itu justru
kegagalan yang paling perlu terlihat: semuanya tampak hijau bukan karena
layanan sehat, melainkan karena alertnya tidak pernah sampai.

Di halaman **Notifikasi**, tiap channel menampilkan status pengiriman
terakhirnya, dan channel yang sedang gagal diangkat sebagai banner di atas
daftar. Tombol riwayat membuka 20 pengiriman terakhir channel itu.

Lewat API:

```bash
# 50 pengiriman terakhir
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/notifications/logs"

# yang gagal saja, untuk satu channel
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/notifications/logs?notification_id=3&only=failed"
```

`GET /api/notifications` ikut menyertakan ringkasan per channel:

```json
{ "id": 3, "name": "Telegram Ops",
  "delivery": { "last_ok": false, "last_error": "Telegram 401: unauthorized",
                "last_sent_at": "2026-09-26T02:10:11.000Z", "failures_24h": 4 } }
```

Pesan uji dari channel yang sudah tersimpan ikut tercatat atas nama channel
itu, sehingga menguji ulang setelah memperbaiki token langsung memperbarui
statusnya. Riwayat dibersihkan tiap hari mengikuti
`NOTIFICATION_LOG_RETENTION_DAYS` (bawaan 30 hari).

## Dependency antar-monitor

Satu router mati bisa membuat sepuluh monitor di belakangnya ikut down, dan sepuluh alert
terkirim untuk satu masalah yang sama. Tentukan **monitor induk** di form monitor (bagian
*Dependency*) supaya hanya penyebabnya yang berbunyi.

Selama induk berstatus down, untuk monitor anaknya:

| Tetap jalan | Ditahan |
|---|---|
| Pengecekan, heartbeat, grafik, uptime | Notifikasi (Telegram, Slack, email, …) |
| Incident tetap dibuat dan ditutup | Webhook aksi (`on_down` / `on_recover`) |

Jadi datanya tidak berlubang — yang berubah hanya siapa yang dikabari. Incident yang alert-nya
ditahan diberi penanda `suppressed` beserta nama induk yang menahannya, dan terlihat di halaman
detail monitor.

**Saat induk pulih tapi anaknya masih down**, alert anak langsung dikirim pada pengecekan
berikutnya: berarti masalahnya memang miliknya sendiri, bukan bawaan dari induk. Sebaliknya,
incident yang alert down-nya tidak pernah terkirim juga tidak mengirim kabar "pulih" —
tidak ada kabar baik untuk kabar buruk yang tidak pernah ada.

Aturan lain yang berlaku:

- Rantai induk boleh bertingkat (mis. `internet → router → database → API`), maksimal **5 tingkat**.
- Lingkaran ditolak saat menyimpan; monitor yang sudah menjadi keturunan tidak muncul di pilihan induk.
- Induk yang sedang **dijeda** tidak menahan alert siapa pun — statusnya tidak diperbarui, jadi
  tidak layak dijadikan acuan.
- Menghapus induk membuat anak-anaknya jadi mandiri, bukan ikut terhapus.

Yang sedang ditahan bisa dilihat sekaligus lewat:

- badge **alert ditahan** di daftar monitor dan kartu *Dependency* di halaman detail
- kartu Down di dashboard, yang menyebut berapa alert sedang ditahan
- metrik `pulsewatch_monitor_alert_suppressed` (lihat [Integrasi](integrasi.md#prometheus--grafana))
- `GET /api/monitors/:id/children` untuk daftar monitor yang bergantung pada sebuah monitor

Alert yang ditahan juga tidak memulai rantai eskalasi on-call — lihat [on-call.md](on-call.md).
