import { prisma } from "../src/db.js";

// Tes di folder ini berjalan pada Postgres sungguhan dan MENGOSONGKAN seluruh
// tabel sebelum tiap kasus. Karena itu database-nya dijaga: namanya wajib
// mengandung "test", supaya DATABASE_URL yang tertinggal di shell tidak
// menghapus data produksi.
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL).pathname.slice(1);
  } catch {
    return "";
  }
})();
if (!/test/i.test(dbName)) {
  throw new Error(`Tes database menolak berjalan pada "${dbName || "?"}": nama database harus mengandung "test"`);
}

export { prisma };

export async function resetDb() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export const minutesAgo = (n, from = Date.now()) => new Date(from - n * 60_000);

export function createMonitor(data = {}) {
  return prisma.monitor.create({
    data: { name: "m", type: "http", url: "http://contoh.test", created_at: new Date("2025-01-01T00:00:00Z"), ...data },
  });
}
