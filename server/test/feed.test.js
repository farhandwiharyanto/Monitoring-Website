import test from "node:test";
import assert from "node:assert/strict";
import { atomFeed } from "../src/lib/feed.js";

const page = { slug: "uji", title: "Status Uji", description: null, show_incidents: true };
const names = new Map([[1, "API"]]);

const build = (incidents, p = page) => atomFeed({ page: p, incidents, monitorNames: names });

test("feed kosong tetap dokumen Atom yang utuh", () => {
  const xml = build([]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<\/feed>$/);
  assert.equal(xml.includes("<entry>"), false);
});

test("satu entri per incident, dengan judul sesuai keadaannya", () => {
  const xml = build([
    { id: 7, monitor_id: 1, started_at: "2026-09-01T10:00:00.000Z", resolved_at: null, updates: [] },
    { id: 8, monitor_id: 1, started_at: "2026-09-02T10:00:00.000Z", resolved_at: "2026-09-02T11:00:00.000Z", updates: [] },
  ]);
  assert.equal((xml.match(/<entry>/g) || []).length, 2);
  assert.match(xml, /<title>Berlangsung: API<\/title>/);
  assert.match(xml, /<title>Selesai: API<\/title>/);
});

test("id entri tetap sama setelah incident ditutup", () => {
  // Kalau id berubah, pembaca feed menampilkannya sebagai item baru dan
  // pelanggan mendapat notifikasi kedua untuk gangguan yang sama.
  const open = { id: 7, monitor_id: 1, started_at: "2026-09-01T10:00:00.000Z", resolved_at: null, updates: [] };
  const closed = { ...open, resolved_at: "2026-09-01T12:00:00.000Z" };
  const idOf = (xml) => xml.match(/<id>(.*incidents\/7)<\/id>/)[1];
  assert.equal(idOf(build([open])), idOf(build([closed])));
});

test("karakter XML di judul halaman dan pesan di-escape", () => {
  const xml = build(
    [{ id: 1, monitor_id: 1, started_at: "2026-09-01T10:00:00.000Z", resolved_at: null,
       updates: [{ status: "identified", message: 'kuota <db> & "cache" penuh', created_at: "2026-09-01T10:05:00.000Z" }] }],
    { ...page, title: 'Status <script>alert(1)</script> & "lainnya"' }
  );
  assert.equal(xml.includes("<script>"), false, "tag mentah tidak boleh lolos ke feed");
  assert.match(xml, /&lt;script&gt;/);
  assert.match(xml, /&amp;/);
  // Isi entri berupa HTML yang sudah di-escape sekali sebagai teks XML
  assert.match(xml, /&lt;p&gt;/);
});

test("updated feed mengikuti kabar terbaru, bukan waktu incident mulai", () => {
  const xml = build([
    { id: 1, monitor_id: 1, started_at: "2026-09-01T10:00:00.000Z", resolved_at: null,
      updates: [{ status: "monitoring", message: "dipantau", created_at: "2026-09-01T14:00:00.000Z" }] },
  ]);
  const feedUpdated = xml.match(/<updated>(.*?)<\/updated>/)[1];
  assert.equal(feedUpdated, "2026-09-01T14:00:00.000Z");
});

test("monitor yang namanya tidak dikenal tidak menggagalkan feed", () => {
  const xml = build([{ id: 1, monitor_id: 99, started_at: "2026-09-01T10:00:00.000Z", resolved_at: null, updates: [] }]);
  assert.match(xml, /<title>Berlangsung: Monitor<\/title>/);
});
