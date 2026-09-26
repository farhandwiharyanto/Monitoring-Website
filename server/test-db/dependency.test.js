import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, resetDb, createMonitor, minutesAgo } from "./helpers.js";
import { blockingAncestor, dependencyInfo, wouldCycle, chainDepth } from "../src/lib/dependency.js";
import { config } from "../src/config.js";
import { STATUS } from "../src/lib/status.js";

beforeEach(resetDb);
after(() => prisma.$disconnect());

const beat = (monitor_id, status, minutes = 1, location = null) =>
  prisma.heartbeat.create({ data: { monitor_id, status, location, created_at: minutesAgo(minutes) } });

// router ← server ← app
async function chain() {
  const router = await createMonitor({ name: "router" });
  const server = await createMonitor({ name: "server", parent_id: router.id });
  const app = await createMonitor({ name: "app", parent_id: server.id });
  return { router, server, app };
}

test("induk langsung yang down menahan alert anaknya", async () => {
  const { server, app } = await chain();
  await beat(server.id, STATUS.DOWN);
  assert.deepEqual(await blockingAncestor(app.id), { id: server.id, name: "server" });
});

test("hanya heartbeat terakhir induk yang dipakai", async () => {
  const { server, app } = await chain();
  await beat(server.id, STATUS.DOWN, 5);
  await beat(server.id, STATUS.UP, 1);
  assert.equal(await blockingAncestor(app.id), null);
});

test("induk jauh yang down tetap menahan walau induk dekat up", async () => {
  const { router, server, app } = await chain();
  await beat(server.id, STATUS.UP);
  await beat(router.id, STATUS.DOWN);
  assert.deepEqual(await blockingAncestor(app.id), { id: router.id, name: "router" });
});

test("induk yang dijeda dilewati", async () => {
  const { router, app } = await chain();
  await prisma.monitor.update({ where: { id: router.id }, data: { active: false } });
  await beat(router.id, STATUS.DOWN);
  assert.equal(await blockingAncestor(app.id), null);
});

test("heartbeat dari lokasi selain primary tidak dihitung", async () => {
  const { server, app } = await chain();
  await beat(server.id, STATUS.UP, 5, config.primaryLocation);
  await beat(server.id, STATUS.DOWN, 1, "lokasi-lain");
  assert.equal(await blockingAncestor(app.id), null);
});

test("dependencyInfo memberi induk langsung dan jumlah anak", async () => {
  const { router, server, app } = await chain();
  const info = await dependencyInfo([router.id, server.id, app.id]);
  assert.equal(info.get(router.id).parent, null);
  assert.equal(info.get(router.id).children_count, 1);
  assert.deepEqual(info.get(app.id).parent, { id: server.id, name: "server" });
  assert.equal(info.get(app.id).children_count, 0);
});

test("lingkaran terdeteksi dan kedalaman rantai dihitung", async () => {
  const { router, server, app } = await chain();
  assert.equal(await wouldCycle(router.id, app.id), true);
  assert.equal(await wouldCycle(app.id, app.id), true);
  assert.equal(await wouldCycle(app.id, router.id), false);
  assert.equal(await chainDepth(app.id), 2);
  assert.equal(await chainDepth(router.id), 0);
});

test("data lama yang terlanjur melingkar tidak membuat loop tanpa akhir", async () => {
  const a = await createMonitor({ name: "a" });
  const b = await createMonitor({ name: "b", parent_id: a.id });
  await prisma.monitor.update({ where: { id: a.id }, data: { parent_id: b.id } });
  await beat(b.id, STATUS.UP);
  assert.equal(await blockingAncestor(a.id), null);
});
