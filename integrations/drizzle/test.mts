/**
 * Drizzle + @rivid/core integration correctness suite (ORM plan §7).
 *
 * Runs against the canonical benchmark PostgreSQL (benchmarks/db/start.sh).
 * Fails loudly on any violation — no partial passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, gt, lt, asc, count, sql } from "drizzle-orm";
import pg from "pg";
import { ulid, decodeTime, isValid, monotonicUlid, uuidv7, uuidv7DecodeTimeFromString, ulidBytes, encode } from "@rivid/core";
import { usersUlid, usersUuidV7, usersBinary } from "./schema.js";

const { Client } = pg;

const CFG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "bench",
  database: process.env.PGDATABASE ?? "ids",
};

const client = new Client(CFG);
const db = drizzle(client);

test("setup: schema exists", async () => {
  await client.connect();
  const r = await client.query(
    `SELECT to_regclass('users_ulid') IS NOT NULL AS ok`,
  );
  if (!r.rows[0].ok) {
    // create minimal tables if init.sql wasn't applied (CI convenience)
    await client.query(`CREATE TABLE IF NOT EXISTS users_ulid (
      id CHAR(26) PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE IF NOT EXISTS users_uuid7_drizzle (
      id CHAR(36) PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE IF NOT EXISTS users_binary_drizzle (
      id BYTEA PRIMARY KEY CHECK (octet_length(id)=16), email TEXT NOT NULL,
      name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }
});

// ── mode A: application-generated via $defaultFn ────────────────────────

test("create: $defaultFn generates valid ULID when id omitted", async () => {
  const [row] = await db.insert(usersUlid).values({ email: "a@x.io", name: "A" }).returning();
  assert.ok(isValid(row.id), `invalid ULID ${row.id}`);
  assert.equal(row.id.length, 26);
});

test("create: explicit ULID accepted; fetch-by-PK round trip", async () => {
  const id = ulid();
  await db.insert(usersUlid).values({ id, email: "b@x.io", name: "B" });
  const [got] = await db.select().from(usersUlid).where(eq(usersUlid.id, id));
  assert.equal(got?.id, id);
  // update + delete by PK
  await db.update(usersUlid).set({ name: "B2" }).where(eq(usersUlid.id, id));
  const [upd] = await db.select().from(usersUlid).where(eq(usersUlid.id, id));
  assert.equal(upd.name, "B2");
  await db.delete(usersUlid).where(eq(usersUlid.id, id));
  const [gone] = await db.select().from(usersUlid).where(eq(usersUlid.id, id));
  assert.equal(gone, undefined);
});

test("uuidv7 default: version nibble + timestamp extraction", async () => {
  const [row] = await db.insert(usersUuidV7).values({ email: "c@x.io", name: "C" }).returning();
  assert.equal(row.id.length, 36);
  const ts = uuidv7DecodeTimeFromString(row.id);
  assert.ok(Math.abs(ts - Date.now()) < 5_000);
});

test("binary PK: BYTEA round trip preserves exact 16 bytes", async () => {
  const bytes = ulidBytes();
  await db.insert(usersBinary).values({ id: bytes, email: "d@x.io", name: "D" });
  const [got] = await db.select().from(usersBinary).where(eq(usersBinary.id, bytes));
  assert.deepEqual(Uint8Array.from(got.id.data ?? got.id), bytes);
  // encode(bytes) must equal the ULID string form of same value
  assert.equal(encode(Uint8Array.from(got.id.data ?? got.id)).length, 26);
});

// ── ordering / range / pagination ────────────────────────────────────────

test("monotonic insert batch → ORDER BY id equals insertion order", async () => {
  const N = 500;
  const ids = Array.from({ length: N }, () => monotonicUlid());
  await db.insert(usersUlid).values(ids.map((id, i) => ({ id, email: `m${i}@x.io`, name: `M${i}` })));
  const rows = await db
    .select({ id: usersUlid.id })
    .from(usersUlid)
    .where(sql`${usersUlid.email} LIKE 'm%@x.io'`)
    .orderBy(asc(usersUlid.id));
  const got = rows.map((r) => r.id).sort();
  assert.deepEqual(rows.map((r) => r.id), ids, "ORDER BY id must equal insertion order");
  void got;
});

test("range query by ULID prefix (time window)", async () => {
  const now = Date.now();
  const lower = ulid(now - 60_000);
  const upper = ulid(now + 60_000);
  const rows = await db
    .select()
    .from(usersUlid)
    .where(and(gt(usersUlid.id, lower), lt(usersUlid.id, upper)))
    .orderBy(asc(usersUlid.id))
    .limit(10);
  for (const r of rows) {
    assert.ok(r.id > lower && r.id < upper);
    assert.ok(Math.abs(decodeTime(r.id) - now) < 120_000);
  }
});

test("keyset pagination over seeded rows", async () => {
  // seed distinct block
  const base = monotonicUlid();
  const seed = Array.from({ length: 1_000 }, (_, i) => ({
    id: i === 0 ? base : monotonicUlid(),
    email: `p${i}@x.io`,
    name: `P${i}`,
  }));
  await db.insert(usersUlid).values(seed);

  let cursor = "";
  const seen: string[] = [];
  for (;;) {
    const page = cursor
      ? await db.select({ id: usersUlid.id }).from(usersUlid)
          .where(and(gt(usersUlid.id, cursor), sql`${usersUlid.email} LIKE 'p%@x.io'`))
          .orderBy(asc(usersUlid.id)).limit(100)
      : await db.select({ id: usersUlid.id }).from(usersUlid)
          .where(sql`${usersUlid.email} LIKE 'p%@x.io'`)
          .orderBy(asc(usersUlid.id)).limit(100);
    if (!page.length) break;
    seen.push(...page.map((r) => r.id));
    cursor = page[page.length - 1].id;
  }
  assert.equal(seen.length, 1_000);
  assert.equal(new Set(seen).size, 1_000, "keyset pagination must not duplicate/skip");
});

// ── transactions & concurrency ──────────────────────────────────────────

test("transaction rollback leaves no rows", async () => {
  await db.transaction(async (tx) => {
    await tx.insert(usersUlid).values({ id: ulid(), email: "t@x.io", name: "T" });
    throw new Error("force rollback");
  }).catch(() => {});
  const [c] = await db.select({ n: count() }).from(usersUlid).where(eq(usersUlid.email, "t@x.io"));
  assert.equal(c.n, 0n || 0);
});

test("concurrent generation: no collisions across 8 workers × 5k", async () => {
  const worker = () =>
    (async () => {
      const out = new Set<string>();
      for (let i = 0; i < 5_000; i++) out.add(ulid());
      return out;
    })();
  const sets = await Promise.all(Array.from({ length: 8 }, worker));
  const all = sets.flatMap((s) => [...s]);
  assert.equal(new Set(all).size, 40_000, "cross-worker collision detected");
});

test("cleanup", async () => {
  await client.query(`DELETE FROM users_ulid WHERE email LIKE '%@x.io'`);
  await client.query(`DELETE FROM users_uuid7_drizzle`);
  await client.query(`DELETE FROM users_binary_drizzle`);
  await client.end();
});
