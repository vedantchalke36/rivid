/**
 * Prisma 6 + @rivid/core integration tests.
 *
 * Mode A (app-generated ULID via Rivid) is the headline path; mode C
 * (db-generated gen_random_uuid) is the baseline comparison. Prisma has no
 * ORM-level custom-ID hook beyond client defaults, which IS mode A idiom —
 * documented in ORM_INTEGRATIONS.md, not faked here.
 *
 * Run: DATABASE_URL=... npx tsx --test test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { ulid, monotonicUlid, isValid, decodeTime } from "@rivid/core";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        "postgres://postgres:bench@localhost:54329/ids",
    },
  },
});

test("mode A: create with explicit Rivid ULID; fetch/update/delete", async () => {
  const id = ulid();
  const u = await prisma.userUlid.create({
    data: { id, email: "a@x.io", name: "A" },
  });
  assert.equal(u.id, id);
  assert.ok(isValid(u.id));

  const got = await prisma.userUlid.findUnique({ where: { id } });
  assert.equal(got?.email, "a@x.io");

  await prisma.userUlid.update({ where: { id }, data: { name: "A2" } });
  assert.equal((await prisma.userUlid.findUnique({ where: { id } }))?.name, "A2");

  await prisma.userUlid.delete({ where: { id } });
  assert.equal(await prisma.userUlid.findUnique({ where: { id } }), null);
});

test("mode A: omitted-but-required fails loudly (Prisma requires PK)", async () => {
  // Prisma has no $defaultFn equivalent for required String @id without a
  // schema default — application MUST supply the Rivid ID. Verify the
  // contract rather than inventing ORM behavior:
  await assert.rejects(
    () => prisma.userUlid.create({ data: { email: "x@x.io", name: "X" } }),
  );
});

test("ordering: ORDER BY id equals monotonic insertion order", async () => {
  const ids = Array.from({ length: 300 }, () => monotonicUlid());
  await prisma.userUlid.createMany({
    data: ids.map((id, i) => ({ id, email: `o${i}@x.io`, name: "O" })),
  });
  const rows = await prisma.userUlid.findMany({
    where: { email: { startsWith: "o" } },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(rows.map((r) => r.id), ids);
});

test("range + timestamp extraction", async () => {
  const now = Date.now();
  const rows = await prisma.userUlid.findMany({
    where: { id: { gte: ulid(now - 60_000), lte: ulid(now + 60_000) } },
    orderBy: { id: "asc" },
    take: 50,
  });
  for (const r of rows) {
    assert.ok(Math.abs(decodeTime(r.id) - now) < 120_000);
  }
});

test("keyset pagination: no dupes/skips across pages of 100", async () => {
  let cursor = "";
  const seen = new Set();
  for (;;) {
    const page = await prisma.userUlid.findMany({
      where: { email: { startsWith: "o" }, id: { gt: cursor || undefined } },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!page.length) break;
    for (const r of page) seen.add(r.id);
    cursor = page[page.length - 1].id;
  }
  assert.equal(seen.size, 300);
});

test("mode C baseline: db-generated gen_random_uuid()", async () => {
  const u = await prisma.userUuidV4Db.create({
    data: { email: "v4@x.io", name: "V4" },
  });
  assert.match(u.id, /^[0-9a-f-]{36}$/);
  await prisma.userUuidV4Db.delete({ where: { id: u.id } });
});

test("transaction rollback leaves no rows", async () => {
  // Interactive transaction: throwing inside rolls back.
  await prisma
    .$transaction(async (tx) => {
      await tx.userUlid.create({ data: { id: ulid(), email: "rb@x.io", name: "RB" } });
      throw new Error("rollback");
    })
    .catch(() => {});
  const n = await prisma.userUlid.count({ where: { email: "rb@x.io" } });
  assert.equal(n, 0);
});

test("cleanup", async () => {
  await prisma.userUlid.deleteMany({});
  await prisma.$disconnect();
});
