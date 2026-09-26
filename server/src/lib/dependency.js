import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { STATUS } from "./status.js";

// Kedalaman rantai induk yang masih diperbolehkan. Selain menjaga jumlah query
// tetap kecil, ini juga pengaman kalau ada data lama yang terlanjur melingkar.
export const MAX_DEPTH = 5;

// Status heartbeat terakhir per monitor, dari lokasi primary saja — sama seperti
// perhitungan status di stats.js, supaya "induk down" berarti hal yang sama
// dengan yang dilihat di dashboard.
export async function lastStatusMap(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await prisma.$queryRaw`
    SELECT monitor_id, status FROM (
      SELECT h.monitor_id, h.status,
             row_number() OVER (PARTITION BY h.monitor_id ORDER BY h.created_at DESC, h.id DESC) AS rn
      FROM heartbeats h
      WHERE h.monitor_id IN (${Prisma.join(ids)})
        AND (h.location IS NULL OR h.location = ${config.primaryLocation})
    ) t WHERE rn = 1`;
  for (const r of rows) map.set(r.monitor_id, r.status);
  return map;
}

// Daftar monitor untuk menghitung rantai induk. dependencyInfo dipanggil tiap
// kali monitor di-decorate — termasuk tiap siaran heartbeat — jadi hasil query-nya
// disimpan sebentar. Rute yang mengubah monitor membuang cache ini, sehingga
// jeda CACHE_MS hanya terasa di proses lain (worker multi-location).
// Status induk sengaja TIDAK ikut di-cache: "induk sedang down" harus segar.
const CACHE_MS = 5000;
let cache = null; // { at, rows: Promise }

function allMonitors() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = prisma.monitor.findMany({ select: { id: true, name: true, parent_id: true, active: true } });
  cache = { at: Date.now(), rows };
  // Query yang gagal jangan sampai tersimpan
  rows.catch(() => { if (cache?.rows === rows) cache = null; });
  return rows;
}

export const invalidateDependencyCache = () => { cache = null; };

// Rantai induk dihitung di memori: daftar monitor (dari cache di atas), lalu
// satu query untuk status para induk.
// Hasilnya: untuk tiap id → induk langsung, induk terdekat yang sedang down,
// dan jumlah monitor yang bergantung padanya.
export async function dependencyInfo(ids) {
  const out = new Map(ids.map((id) => [id, { parent: null, blocked_by: null, children_count: 0 }]));
  if (!ids.length) return out;

  const all = await allMonitors();
  const byId = new Map(all.map((m) => [m.id, m]));
  const childCount = new Map();
  for (const m of all) if (m.parent_id) childCount.set(m.parent_id, (childCount.get(m.parent_id) || 0) + 1);

  const parentIds = [...new Set(all.map((m) => m.parent_id).filter(Boolean))];
  const statuses = await lastStatusMap(parentIds);

  for (const id of ids) {
    const self = byId.get(id);
    if (!self) continue;
    const info = out.get(id);
    info.children_count = childCount.get(id) || 0;

    const direct = self.parent_id ? byId.get(self.parent_id) : null;
    if (direct) info.parent = { id: direct.id, name: direct.name };

    // Naik ke atas sampai ketemu induk yang sedang down. Induk yang dipause
    // dilewati: statusnya tidak diperbarui, jadi tidak layak jadi acuan.
    let node = self;
    const seen = new Set([id]);
    for (let depth = 0; node?.parent_id && depth < MAX_DEPTH; depth += 1) {
      const parent = byId.get(node.parent_id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      if (parent.active && statuses.get(parent.id) === STATUS.DOWN) {
        info.blocked_by = { id: parent.id, name: parent.name };
        break;
      }
      node = parent;
    }
  }
  return out;
}

// Induk terdekat yang sedang down, atau null kalau alert boleh jalan seperti biasa
export async function blockingAncestor(monitorId) {
  const info = await dependencyInfo([Number(monitorId)]);
  return info.get(Number(monitorId))?.blocked_by || null;
}

// Rantai induk dari yang terdekat ke yang terjauh — dipakai validasi & UI
async function chainOf(monitorId) {
  const all = await prisma.monitor.findMany({ select: { id: true, name: true, parent_id: true } });
  const byId = new Map(all.map((m) => [m.id, m]));
  const chain = [];
  const seen = new Set([Number(monitorId)]);
  let node = byId.get(Number(monitorId));
  while (node?.parent_id && chain.length < MAX_DEPTH + 1) {
    const parent = byId.get(node.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    chain.push(parent);
    node = parent;
  }
  return chain;
}

// Menjadikan `parentId` sebagai induk `monitorId` akan membentuk lingkaran?
// (mis. A induk B, lalu B dijadikan induk A)
export async function wouldCycle(monitorId, parentId) {
  if (Number(monitorId) === Number(parentId)) return true;
  const chain = await chainOf(parentId);
  return chain.some((m) => m.id === Number(monitorId));
}

// Berapa tingkat di atas `parentId` (0 = dia sendiri sudah paling atas)
export async function chainDepth(parentId) {
  return (await chainOf(parentId)).length;
}
