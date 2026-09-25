import test from "node:test";
import assert from "node:assert/strict";
import { validateBackup, BACKUP_VERSION } from "../src/lib/backup.js";

test("berkas yang bukan backup ditolak dengan alasan yang bisa dibaca", () => {
  assert.match(validateBackup(null), /tidak terbaca/);
  assert.match(validateBackup("bukan object"), /tidak terbaca/);
  assert.match(validateBackup({}), /bukan backup Pulsewatch/);
  assert.match(validateBackup({ version: "3" }), /bukan backup Pulsewatch/);
});

test("backup dari versi yang lebih baru ditolak, bukan dicoba paksa", () => {
  // Memulihkan berkas dari Pulsewatch yang lebih baru berisiko diam-diam
  // membuang field yang belum dikenali instance ini.
  const pesan = validateBackup({ version: BACKUP_VERSION + 1, monitors: [] });
  assert.match(pesan, /lebih baru/);
});

test("backup versi lama tetap diterima", () => {
  assert.equal(validateBackup({ version: 1, monitors: [] }), null);
  assert.equal(validateBackup({ version: BACKUP_VERSION, tags: [] }), null);
});

test("backup tanpa satu pun bagian yang dikenali ditolak", () => {
  assert.match(validateBackup({ version: 3, sesuatu: [] }), /tidak berisi satu pun bagian/);
  // Satu bagian saja sudah cukup — backup parsial tetap berguna
  assert.equal(validateBackup({ version: 3, monitors: [] }), null);
});
