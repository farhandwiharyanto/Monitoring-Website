import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, resetDb } from "./helpers.js";
import { hitLimit } from "../src/lib/ratelimit.js";
import { config } from "../src/config.js";

// Mode RATE_LIMIT_STORE=database: penghitungnya di Postgres, jadi dua instance
// yang berbagi database berbagi batas yang sama.

beforeEach(async () => {
  await resetDb();
  config.rateLimitStore = "database";
});
after(async () => {
  config.rateLimitStore = "memory";
  await prisma.$disconnect();
});

test("batas berlaku lewat tabel rate_limits dan menyebut waktu tunggu", async () => {
  const opts = { max: 3, windowSeconds: 60 };
  for (let i = 0; i < 3; i++) assert.equal((await hitLimit("uji:a", opts)).allowed, true);
  const blocked = await hitLimit("uji:a", opts);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
  // Kunci lain tidak ikut terkena
  assert.equal((await hitLimit("uji:b", opts)).remaining, 2);
});

test("permintaan serentak dihitung tepat, tanpa kehilangan hitungan", async () => {
  const opts = { max: 1000, windowSeconds: 60 };
  await Promise.all(Array.from({ length: 50 }, () => hitLimit("uji:serentak", opts)));
  const [row] = await prisma.$queryRaw`SELECT count FROM rate_limits WHERE key = 'uji:serentak'`;
  assert.equal(row.count, 50);
});

test("database yang gagal tidak memblokir permintaan", async () => {
  await prisma.$executeRawUnsafe(`ALTER TABLE rate_limits RENAME TO rate_limits_x`);
  try {
    assert.equal((await hitLimit("uji:c", { max: 1, windowSeconds: 60 })).allowed, true);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE rate_limits_x RENAME TO rate_limits`);
  }
});
