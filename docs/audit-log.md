# Audit log

Jejak siapa mengubah apa, kapan, dan dari IP mana. Dibuka lewat menu **Audit log**
(admin saja).

[← Kembali ke README](../README.md)

## Yang dicatat

| Objek | Aksi |
|---|---|
| `auth` | `login`, `login_failed`, dan `password_change` |
| `monitor` | `create`, `update`, `delete`, `pause`, `resume`, `reset_push_token` |
| `notification` | `create`, `update`, `delete` |
| `user` | `create`, `update` (termasuk reset password oleh admin), `delete` |
| `api_key` | `create`, `revoke`, `delete` |
| `status_page` | `create`, `update`, `delete` |
| `maintenance` | `create`, `update`, `delete` |
| `incident` | kabar publik: `create`, `edit`, `delete` |
| `settings` | `update` bahasa & tema default instance |

Tiap baris menyimpan pelaku (`actor`), jenis pelakunya (`user`, `apikey`, `anonymous`),
IP, ringkasan sebaris, dan — untuk perubahan — rincian per field: nilai sebelum dan sesudah.

Yang **tidak** dicatat: heartbeat, hasil check, dan perubahan status monitor. Itu data deret
waktu yang sudah punya tempatnya sendiri di tabel heartbeat dan incident.

## Kredensial tidak ikut tercatat

Field rahasia hanya dicatat "berubah", nilainya diganti `•••`: password, hash password,
`auth_secret` monitor, push token, hash API key, seluruh isi `config` notifikasi (token bot,
webhook URL, kredensial SMTP), serta custom header monitor dan header webhook aksi.

Jadi audit log aman dibaca siapa pun yang berhak membukanya, dan aman diekspor ke luar.

## Siapa yang boleh membaca

Hanya **admin yang login**. API key ditolak, sama seperti endpoint manajemen user dan
kredensial notifikasi — sebuah kunci tidak perlu bisa membaca jejak pemilik instance.

Tidak ada endpoint untuk mengubah atau menghapus satu baris audit log. Satu-satunya cara
baris hilang adalah lewat retensi otomatis (`AUDIT_RETENTION_DAYS`, bawaan 365 hari),
yang dibersihkan tiap hari jam 03:00 bersama heartbeat lama.

## Endpoint

```bash
# Daftar, dengan filter opsional yang bisa digabung
GET /api/audit-logs?entity=monitor&action=monitor.update&actor=admin
GET /api/audit-logs?q=gateway&from=2026-09-01&to=2026-09-25&limit=50&offset=0

# Nilai yang benar-benar ada di data, untuk mengisi dropdown filter
GET /api/audit-logs/filters

# Jejak satu entitas, mis. semua perubahan pada monitor #3
GET /api/audit-logs/monitor/3
```

Respons daftar berbentuk `{ rows, total, limit, offset }`. Satu baris:

```json
{
  "id": 42,
  "created_at": "2026-09-25T09:14:03.120Z",
  "actor": "budi",
  "actor_type": "user",
  "action": "monitor.update",
  "entity": "monitor",
  "entity_id": 3,
  "entity_name": "API produksi",
  "summary": "Monitor \"API produksi\" diubah",
  "changes": { "interval_seconds": { "from": 60, "to": 30 } },
  "ip": "10.0.0.7"
}
```

## Arsip ke luar aplikasi

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/export/audit?format=csv&from=2026-09-01" \
  -o audit-september.csv
```

`format=json` juga tersedia. Kolom `changes` diratakan jadi satu sel JSON supaya CSV tetap
satu baris per kejadian. Filter `from`, `to`, dan `entity` berlaku sama seperti di endpoint
daftar. Berguna kalau retensi 365 hari terasa kurang: jadwalkan ekspor bulanan ke object
storage, dan biarkan tabelnya tetap ramping.

## Catatan

Penulisan audit log sengaja tidak menahan respons API — tindakannya diproses lebih dulu,
jejaknya ditulis menyusul. Akibatnya, kalau database tumbang tepat di antara keduanya, sebuah
tindakan bisa berhasil tanpa meninggalkan jejak. Ini pertukaran yang disengaja: kegagalan
menulis audit tidak boleh menggagalkan tindakan yang sudah berjalan.
