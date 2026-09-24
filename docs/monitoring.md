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
