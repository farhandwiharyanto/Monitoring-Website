import { config } from "../config.js";

// Feed Atom untuk status page publik.
//
// Sebelum ini pengguna tidak punya cara berlangganan kabar gangguan sama
// sekali — satu-satunya jalan adalah membuka halamannya dan menyegarkan.
// Atom dipilih ketimbang RSS 2.0 karena tanggalnya ISO 8601 apa adanya dan
// aturan escaping-nya lebih tegas; pembaca feed mana pun memahami keduanya.

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const xml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);
const iso = (d) => new Date(d).toISOString();

// Satu entri per incident. Judulnya memuat nama monitor dan keadaan akhirnya,
// isinya riwayat kabar yang ditulis admin selama gangguan berlangsung.
function entry(incident, { pageUrl, monitorName }) {
  const resolved = !!incident.resolved_at;
  const title = `${resolved ? "Selesai" : "Berlangsung"}: ${monitorName}`;
  // id harus tetap sama sepanjang umur entri, termasuk setelah incident
  // ditutup — kalau berubah, pembaca feed menampilkannya sebagai item baru.
  const id = `${pageUrl}/incidents/${incident.id}`;

  const lines = [];
  lines.push(`<p>${xml(monitorName)} mulai terganggu ${xml(iso(incident.started_at))}.</p>`);
  if (resolved) lines.push(`<p>Selesai ${xml(iso(incident.resolved_at))}.</p>`);
  for (const u of incident.updates || []) {
    lines.push(`<p><strong>${xml(u.status)}</strong> — ${xml(u.message)} <em>(${xml(iso(u.created_at))})</em></p>`);
  }

  return [
    "  <entry>",
    `    <id>${xml(id)}</id>`,
    `    <title>${xml(title)}</title>`,
    `    <link rel="alternate" href="${xml(pageUrl)}"/>`,
    // updated menentukan urutan di pembaca feed: kabar terbaru menaikkan entri
    `    <updated>${xml(iso(incident.updates?.[0]?.created_at || incident.resolved_at || incident.started_at))}</updated>`,
    `    <published>${xml(iso(incident.started_at))}</published>`,
    `    <content type="html">${xml(lines.join(""))}</content>`,
    "  </entry>",
  ].join("\n");
}

export function atomFeed({ page, incidents, monitorNames }) {
  const pageUrl = `${config.baseUrl}/status/${page.slug}`;
  const feedUrl = `${config.baseUrl}/api/public/status/${page.slug}/feed.xml`;
  const updated = incidents.length
    ? iso(incidents[0].updates?.[0]?.created_at || incidents[0].resolved_at || incidents[0].started_at)
    : new Date().toISOString();

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${xml(feedUrl)}</id>`,
    `  <title>${xml(page.title)}</title>`,
    page.description ? `  <subtitle>${xml(page.description)}</subtitle>` : "",
    `  <link rel="self" type="application/atom+xml" href="${xml(feedUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(pageUrl)}"/>`,
    `  <updated>${xml(updated)}</updated>`,
    "  <generator>Pulsewatch</generator>",
    ...incidents.map((i) => entry(i, { pageUrl, monitorName: monitorNames.get(i.monitor_id) || "Monitor" })),
    "</feed>",
  ]
    .filter(Boolean)
    .join("\n");
}
