# On-call & eskalasi

Siapa yang bertugas, siapa lagi yang dipanggil kalau tidak ada yang menangani, dan
bagaimana seseorang menyatakan "saya tangani". Dibuka lewat menu **On-call**.

[← Kembali ke README](../README.md)

## Cara kerjanya

Saat sebuah monitor down, alert biasa tetap dikirim ke semua channel monitor itu,
persis seperti sebelumnya. Eskalasi **menumpang di atasnya**, bukan menggantikannya:
policy menentukan siapa lagi yang dipanggil, dan setelah berapa lama, selama belum
ada yang menangani.

Contoh policy yang lazim:

| Tingkat | Jeda | Dikabari |
|---|---|---|
| 1 | langsung | yang bertugas di jadwal "Piket Infra" |
| 2 | 5 menit | yang bertugas di jadwal "Piket Backup" |
| 3 | 15 menit | channel "Slack Tim" |

Rantai berhenti saat ada yang meng-acknowledge, saat monitor pulih, saat monitornya
dijeda, atau saat seluruh tingkat sudah dikirim.

## Jadwal rotasi

Jadwal berisi **shift bebas per rentang waktu** — bukan rotasi mingguan yang dihitung
dari urutan anggota. Pilihan ini disengaja: tukar jaga dan libur sehari cukup satu shift
baru, tanpa menggeser giliran orang lain.

Shift boleh bertindihan. Yang dianggap bertugas adalah shift dengan waktu mulai paling
akhir yang mencakup saat itu, jadi shift pengganti cukup **ditambahkan** — yang lama
tidak perlu dihapus atau dipotong.

Zona waktu jadwal hanya memengaruhi tampilan. Semua waktu tetap disimpan UTC seperti
kolom waktu lain.

## Kontak on-call

Orang yang bertugas hanya bisa dipanggil kalau punya **kontak on-call**: satu notifikasi
pribadi (mis. Telegram atau ntfy miliknya sendiri) yang disetel admin di halaman
**Users**. Tanpa kontak, namanya tetap muncul di jadwal tapi tingkat eskalasi yang
menunjuk jadwal itu akan dilewati — dicatat sebagai `skipped` beserta alasannya.

Karena konfigurasi notifikasi berisi kredensial dan hanya boleh dibaca admin, viewer
tidak bisa menyetel kontaknya sendiri. Admin yang menetapkannya.

## Acknowledge

Ada dua jalan, keduanya menghentikan sisa tingkat yang belum dikirim:

- **Tombol di UI** — pada kartu "Eskalasi on-call" di halaman detail monitor. Pelakunya
  tercatat sebagai username yang login.
- **Tautan di pesan notifikasi** — tiap pesan eskalasi membawa tautan `…/api/oncall/ack/<token>`.
  Tautannya membuka halaman konfirmasi; yang meng-ack adalah tombol di halaman itu,
  bukan membuka tautannya. Aplikasi chat sering memuat pratinjau tautan dengan GET, dan
  itu tidak boleh terhitung sebagai "sudah ditangani". Pelakunya dicatat sebagai
  "tautan notifikasi" karena tanpa login identitasnya tidak bisa dipastikan.

Token ack panjangnya 48 karakter heksadesimal, unik per incident, dan hanya berlaku
selama rantainya belum berhenti.

## Yang tidak memicu eskalasi

Rantai hanya dimulai bersamaan dengan alert "down" yang benar-benar terkirim. Artinya
alert yang **ditahan** tidak pernah memulai eskalasi:

- monitor yang induknya sedang down (dependency, lihat [monitoring.md](monitoring.md))
- monitor yang sedang dalam maintenance window
- lokasi sekunder pada pemasangan multi-location — hanya lokasi primary yang memegang
  incident, alert, dan eskalasi

## Menjeda monitor

Menjeda monitor yang sedang down akan **menutup incident-nya** dan menghentikan rantai
eskalasinya. Downtime yang dihitung berhenti saat dijeda, bukan saat monitor dijalankan
lagi — monitor yang dijeda tidak dicek, jadi tidak ada heartbeat yang bisa menutup
incident itu, dan membiarkannya terbuka akan terus menggerus error budget di
[laporan SLA](laporan.md).

## Endpoint

```bash
# Jadwal rotasi
GET    /api/oncall/schedules                # + siapa yang bertugas sekarang & berikutnya
POST   /api/oncall/schedules                # admin
PUT    /api/oncall/schedules/:id            # admin
DELETE /api/oncall/schedules/:id            # admin
GET    /api/oncall/current                  # ringkas: yang bertugas di tiap jadwal aktif

# Shift
GET    /api/oncall/schedules/:id/shifts?from=&to=
POST   /api/oncall/schedules/:id/shifts     # admin
DELETE /api/oncall/shifts/:id               # admin

# Escalation policy (tingkat dikirim sebagai satu daftar utuh)
GET    /api/oncall/policies
POST   /api/oncall/policies                 # admin
PUT    /api/oncall/policies/:id             # admin
DELETE /api/oncall/policies/:id             # admin

# Rantai eskalasi & acknowledge
GET    /api/oncall/escalations/:incidentId
POST   /api/oncall/escalations/:incidentId/ack   # admin yang login
GET    /api/oncall/ack/:token               # halaman konfirmasi, tanpa login
POST   /api/oncall/ack/:token               # yang benar-benar meng-ack
```

Seluruh `/api/oncall` menolak API key, sama seperti manajemen user dan kredensial
notifikasi: jadwal dan policy menentukan siapa dikabari lewat kontak apa.

Satu langkah policy berbentuk:

```json
{ "target": "oncall",  "delay_minutes": 0,  "schedule_id": 1 }
{ "target": "channel", "delay_minutes": 15, "notification_id": 2 }
```

Maksimal 10 tingkat per policy, jeda 0–10080 menit, dan jeda tiap tingkat harus sama
atau lebih lama dari tingkat sebelumnya.

## Catatan pemasangan

- Tingkat eskalasi dijadwalkan sekaligus saat rantai dibuat, dan jedanya dihitung dari
  saat alert pertama keluar. Menyunting policy karena itu **tidak** mengubah rantai yang
  sedang berjalan.
- Jatuh temponya diperiksa tiap 10 detik oleh scheduler lokasi primary.
- Menghapus jadwal ikut menghapus tingkat eskalasi yang menunjuknya. Menghapus policy
  mengembalikan monitor pemakainya ke policy default.
- Riwayat pengiriman tidak ikut terhapus saat jadwal atau notifikasinya dihapus —
  catatan siapa pernah dikabari sengaja dipertahankan.
