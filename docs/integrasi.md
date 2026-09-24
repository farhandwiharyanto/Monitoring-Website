# Integrasi

API key, webhook dua arah, export data, Prometheus, dan daftar endpoint.

[← Kembali ke README](../README.md)

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
hidup/matinya sebuah target, pakai [monitor push](monitoring.md#push-monitor).

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
| `pulsewatch_monitor_alert_suppressed` | sda + `blocked_by` | 1 bila alert ditahan karena monitor induk sedang down |
| `pulsewatch_monitor_uptime_month_ratio` | sda | Uptime bulan berjalan (0–1), berbasis durasi incident |
| `pulsewatch_monitor_downtime_month_seconds` | sda | Total detik downtime bulan berjalan |
| `pulsewatch_monitor_slo_target` | sda | Target SLO dalam persen |
| `pulsewatch_monitor_error_budget_remaining_seconds` | sda | Sisa error budget; negatif berarti target terlewat |
| `pulsewatch_monitor_error_budget_used_ratio` | sda | Bagian error budget yang terpakai (1 = habis) |
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

      - alert: AlertDitahanTerlaluLama
        expr: pulsewatch_monitor_alert_suppressed == 1
        for: 30m
        annotations:
          summary: "{{ $labels.monitor }} down tapi alert ditahan oleh {{ $labels.blocked_by }}"

      - alert: LokasiTidakSepakat
        expr: pulsewatch_monitor_location_split == 1
        for: 10m
        annotations:
          summary: "{{ $labels.monitor }} terlihat berbeda antar lokasi — periksa jaringan"
```

## Daftar endpoint
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
| GET | /api/monitors/:id/children | any | monitor yang bergantung pada monitor ini |
| GET | /api/audit-logs[?entity=&action=&actor=&q=&from=&to=] | admin (login) | jejak perubahan; `{rows,total,limit,offset}` |
| GET | /api/audit-logs/filters · /api/audit-logs/:entity/:id | admin (login) | nilai filter · jejak satu entitas |
| GET | /api/export/audit?format=&from=&to=&entity= | admin | arsip audit log ke CSV/JSON |
| GET | /api/reports/sla?month=\|from=&to=&monitor_id=&include_maintenance= | any | uptime & error budget per periode |
| GET | /api/reports/sla/monthly?months= · /api/reports/sla/months | any | tren bulanan · bulan yang punya data |
| GET | /api/export/sla?format=&month=\|from=&to= | any | laporan SLA ke CSV/JSON |

Status monitor: `0` down · `1` up · `2` pending · `3` paused · `4` maintenance.
Heartbeat punya flag `maintenance`, kolom `location`, serta `assertion_ok` / `assertion_message`.
Endpoint mengubah data mengembalikan `403` untuk role `viewer`.

Seluruh endpoint Phase 1–3 tetap sama bentuknya; field baru hanya ditambahkan, tidak ada yang dihapus
atau diubah arti.

Endpoint ber-auth menerima **token login maupun API key** lewat header yang sama, kecuali
`/api/users`, `/api/api-keys`, `/api/notifications`, dan `/api/audit-logs` yang hanya untuk
manusia yang login.
