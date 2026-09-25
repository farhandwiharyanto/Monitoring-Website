// Dijalankan sebelum berkas tes dimuat (node --import).
//
// Tes unit di sini sengaja tidak menyentuh database: yang diuji adalah logika
// murni — assertion, jendela maintenance, ambang sertifikat, enkripsi, rate
// limit. Tapi modul-modul itu mengimpor config dan Prisma, yang menolak dibuat
// tanpa DATABASE_URL dan JWT_SECRET. Nilai di bawah hanya memenuhi syarat itu;
// tidak ada koneksi yang pernah dibuka.
process.env.DATABASE_URL ||= "postgresql://localhost:5432/pulsewatch-test";
process.env.JWT_SECRET ||= "hanya-untuk-tes-minimal-32-karakter-0123456789";
// Zona waktu dikunci supaya tes batas bulan dan jendela maintenance memberi
// hasil yang sama di laptop maupun di CI.
process.env.TZ ||= "Asia/Jakarta";
