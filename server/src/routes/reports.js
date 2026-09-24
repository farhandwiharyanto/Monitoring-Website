import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { config } from "../config.js";
import { slaReport, monthlySeries, monthRange, parseMonth, monthKey } from "../lib/sla.js";

// Laporan uptime & error budget. Dibaca siapa pun yang login (termasuk viewer)
// dan lewat API key read — isinya angka agregat, bukan konfigurasi.
export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Rentang laporan: ?month=2026-09, atau ?from=&to=, atau bulan berjalan.
// Rentang yang tidak terbaca ditolak, bukan diam-diam diganti bulan berjalan —
// laporan salah rentang terlalu mudah dikira laporan yang benar.
// Batas bulan memakai waktu lokal server, jadi "September" berarti September
// menurut jam operator, bukan menurut UTC.
function resolveRange(query) {
  if (query.month) {
    const byMonth = parseMonth(query.month);
    if (!byMonth) throw new RangeError("Format bulan harus YYYY-MM, mis. 2026-09");
    return byMonth;
  }
  if (!query.from && !query.to) return monthRange();

  const from = new Date(String(query.from || ""));
  if (Number.isNaN(from.getTime())) throw new RangeError("Tanggal `from` tidak terbaca");

  let to = new Date();
  if (query.to) {
    to = new Date(String(query.to));
    if (Number.isNaN(to.getTime())) throw new RangeError("Tanggal `to` tidak terbaca");
    // Tanggal tanpa jam berarti sampai akhir hari itu
    if (!/T/.test(String(query.to))) to.setHours(23, 59, 59, 999);
  }
  if (to <= from) throw new RangeError("`to` harus setelah `from`");
  return { from, to };
}

// Rentang yang ditolak dijawab 400 dengan alasannya, bukan 500
const withRange = (handler) => async (req, res, next) => {
  let range;
  try {
    range = resolveRange(req.query);
  } catch (err) {
    if (err instanceof RangeError) return res.status(400).json({ error: err.message });
    return next(err);
  }
  return handler(req, res, range);
};

const excludeMaintenance = (query) =>
  query.include_maintenance === "true" ? false : config.slaExcludeMaintenance;

reportsRouter.get("/sla", withRange(async (req, res, { from, to }) => {
  const report = await slaReport({
    from, to,
    monitorId: req.query.monitor_id || null,
    excludeMaintenance: excludeMaintenance(req.query),
  });
  res.json({ ...report, month: monthKey(from) });
}));

// Tren beberapa bulan terakhir — untuk grafik di halaman laporan
reportsRouter.get("/sla/monthly", async (req, res) => {
  res.json(
    await monthlySeries({
      months: req.query.months,
      monitorId: req.query.monitor_id || null,
      excludeMaintenance: excludeMaintenance(req.query),
    })
  );
});

// Bulan yang layak dipilih di UI: sejak monitor paling tua dibuat sampai sekarang
reportsRouter.get("/sla/months", async (req, res) => {
  const { prisma } = await import("../db.js");
  const oldest = await prisma.monitor.findFirst({ orderBy: { created_at: "asc" }, select: { created_at: true } });
  const start = oldest ? new Date(oldest.created_at) : new Date();
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const now = new Date();
  while (cursor <= now && months.length < 120) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  res.json(months.reverse());
});
