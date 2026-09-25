import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { validateBackup, restoreBackup, BACKUP_VERSION } from "../lib/backup.js";
import { recordAudit } from "../lib/audit.js";
import { invalidateCache } from "../scheduler.js";

// Pemulihan konfigurasi dari berkas backup. Admin yang login saja — restore
// membuat channel notifikasi dan monitor, jadi bukan sesuatu yang boleh
// dilakukan API key.
export const backupRouter = Router();
backupRouter.use(requireAuth, requireAdmin);

backupRouter.post("/restore", async (req, res) => {
  const payload = req.body;
  const salah = validateBackup(payload);
  if (salah) return res.status(400).json({ error: salah });

  let hasil;
  try {
    hasil = await restoreBackup(payload);
  } catch (err) {
    console.error("[restore]", err);
    // Restore menggabung dan tidak pernah menghapus, jadi kegagalan di tengah
    // jalan meninggalkan sebagian entri yang sudah terbuat. Itu aman diulang:
    // yang sudah ada akan dilewati pada percobaan berikutnya.
    return res.status(500).json({
      error: `Pemulihan berhenti di tengah jalan: ${err.message}. Tidak ada yang terhapus — perbaiki berkasnya lalu ulangi, entri yang sudah masuk akan dilewati.`,
    });
  }

  const total = Object.values(hasil.dibuat).reduce((a, b) => a + b, 0);
  recordAudit(req, {
    action: "config.restore",
    entity: "settings",
    summary: `Konfigurasi dipulihkan dari backup: ${total} entri baru dibuat`,
    changes: { dibuat: { from: null, to: hasil.dibuat } },
  });

  // Monitor baru harus langsung masuk jadwal, tanpa menunggu restart
  invalidateCache();
  res.json({ ok: true, version: payload.version, supported_version: BACKUP_VERSION, ...hasil });
});
