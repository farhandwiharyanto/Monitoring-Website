# Rencana: modul monitor & analitik database

Rencana kerja untuk sesi berikutnya. Setelah selesai, pindahkan ringkasannya ke
tabel "Sudah selesai" di [rencana.md](rencana.md) lalu hapus berkas ini.

[← Kembali ke rencana](rencana.md)

## Tujuan

1. Tipe monitor baru **Oracle** dan **SQL Server**, di samping PostgreSQL dan MySQL
   yang sudah ada.
2. Tiap monitor database ikut mengumpulkan **metrik**, bukan hanya hidup/mati.
3. Menu **Database** baru: ringkasan semua monitor database, grafik tren, dan
   **temuan otomatis**.

Estimasi total: ~1.500 baris, ~40–45% sesi, ~4 jam, 5–6 commit.

## Titik awal (sudah ada)

- `server/src/checks/database.js`: `RUNNERS = { postgres, mysql, redis }`, tiap
  runner membuka koneksi, menjalankan query, lalu menutupnya. Connection string
  ada di `monitor.conn_secret` (terenkripsi, dibaca lewat `connectionUri()`),
  opsi lain di `monitor.check_config` (JSON). Hasil check `{ ok, message, ms }`.
- Tipe didaftarkan di `DATABASE_TYPES` (`server/src/checks/index.js`) dan di
  `TYPES` (`client/src/pages/MonitorForm.jsx`).
- Target uji di `docker-compose.test.yml` (wajib tetap punya `name` sendiri, lihat
  rencana.md).
- Pola commit: server dulu, lalu klien & dokumentasi. Tes DB di `server/test-db/`.

## Langkah

### A. Oracle & SQL Server (~450 baris, ~12%)

- Dependensi: `oracledb` (mode thin, tanpa Oracle Instant Client) dan `mssql`.
  Impor dinamis seperti runner lain.
- Runner `checkOracle` dan `checkMssql`, query bawaan `SELECT 1 FROM DUAL` dan
  `SELECT 1`. Format connection string:
  `oracle://user:pass@host:1521/SERVICE` dan
  `mssql://user:pass@host:1433/db?encrypt=true&trustServerCertificate=true`.
- Tambah ke `DATABASE_TYPES`, `TYPES` di form, placeholder, i18n dua bahasa.
- Target uji: `gvenzl/oracle-free:slim` (ada image arm64) dan
  `mcr.microsoft.com/mssql/server:2022-latest` (amd64 saja, di Apple Silicon butuh
  Rosetta di Docker Desktop). Kalau SQL Server gagal start, uji dengan tes unit
  saja dan catat di sini.

### B. Pengumpul metrik (~500 baris, ~15%)

- Tabel baru `db_metrics` (`monitor_id`, `created_at`, `metrics` JSON), indeks
  `(monitor_id, created_at desc)`, retensi `DB_METRICS_RETENTION_DAYS` (bawaan 30),
  ikut dibersihkan bersama heartbeat.
- Diambil di koneksi yang sama dengan check, **paling sering tiap 5 menit per
  monitor** (bukan tiap check) supaya tidak membebani database yang dipantau.
- Gagal membaca metrik tidak boleh membuat monitor down: metrik yang tidak bisa
  dibaca disimpan `null` dan UI menampilkan "tidak tersedia".
- Penghitung kumulatif (jumlah query, commit, deadlock) disimpan mentah. Nilai
  per detik dihitung dari selisih dua sampel berurutan saat dibaca, dan sampel
  yang penghitungnya turun (server restart) dilewati.

Bentuk metrik yang sama untuk keempat database:

| Metrik | PostgreSQL | MySQL | Oracle | SQL Server |
|---|---|---|---|---|
| Koneksi terpakai / maks | `pg_stat_activity`, `max_connections` | `Threads_connected`, `max_connections` | `v$session`, `v$parameter` (sessions) | `sys.dm_exec_sessions`, `@@MAX_CONNECTIONS` |
| Ukuran database | `pg_database_size()` | `information_schema.tables` | `dba_data_files` | `sys.master_files` |
| Cache hit ratio | `pg_stat_database` blks_hit/read | `Innodb_buffer_pool_read_requests/reads` | `v$sysstat` logical/physical reads | `sys.dm_os_performance_counters` Buffer cache hit ratio |
| Query total (kumulatif) | `xact_commit + xact_rollback` | `Questions` | `v$sysstat` user calls | Batch Requests/sec (counter) |
| Query berjalan > 30 detik | `pg_stat_activity` | `information_schema.processlist` | `v$session` last_call_et | `sys.dm_exec_requests` |
| Lock menunggu / deadlock | `pg_locks` not granted, `deadlocks` | `Innodb_row_lock_current_waits`, deadlock dari `SHOW ENGINE INNODB STATUS` (opsional) | `v$session` blocking_session | `sys.dm_exec_requests` blocking_session_id |
| Replication lag | `pg_last_xact_replay_timestamp()` (hanya replica) | `SHOW REPLICA STATUS` Seconds_Behind_Source | `v$dataguard_stats` (opsional) | null |
| Versi & uptime server | `version()`, `pg_postmaster_start_time()` | `VERSION()`, `Uptime` | `v$instance` | `@@VERSION`, `sqlserver_start_time` |

- Izin minimal untuk user monitoring, ditulis di dokumentasi: `pg_monitor`,
  `PROCESS` + `SELECT` pada `performance_schema`, `SELECT_CATALOG_ROLE`,
  `VIEW SERVER STATE`.
- API: `GET /api/db-analytics` (ringkasan semua monitor database) dan
  `GET /api/db-analytics/:monitorId?range=24h|7d|30d` (deret waktu + temuan).
- Tes: normalisasi hasil tiap dialek (tes unit dengan data tiruan), perhitungan
  selisih penghitung termasuk saat restart, dan satu tes DB untuk penyimpanan
  serta retensi.

### C. Halaman analitik (~500 baris, ~12%)

- Menu **Database** di sidebar (route `/databases`, lazy seperti halaman lain).
- Daftar: satu kartu per monitor database berisi status, versi, koneksi %, cache
  hit, ukuran, QPS, dan jumlah temuan.
- Detail per monitor: grafik koneksi, QPS, cache hit, dan ukuran (recharts, sama
  seperti Laporan), dengan pilihan rentang 24 jam / 7 hari / 30 hari.
- Temuan otomatis, dihitung di server dengan ambang yang ditulis sebagai konstanta:
  koneksi > 80% maks, cache hit < 90%, ada query > 30 detik, ada lock menunggu,
  replication lag > 60 detik, ukuran naik > 20% dalam 7 hari.
- i18n dua bahasa (`node scripts/check-i18n.mjs`), lalu cek visual lewat Chrome
  headless (cara di rencana.md).

### D. Dokumentasi (~60 baris, ~3%)

Bagian baru yang ringkas di [monitoring.md](monitoring.md): format connection
string keempat database, izin user monitoring, daftar metrik, dan arti tiap temuan.

## Urutan commit

1. Oracle & SQL Server (server + target uji)
2. Form, i18n, dan dokumentasi tipe baru
3. Pengumpul metrik + tabel + API + tes
4. Halaman Database + temuan otomatis
5. Dokumentasi analitik + perbarui rencana.md (hapus berkas ini)
