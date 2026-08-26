/**
 * Layer-separated ORM benchmark (ORM_IMPLEMENTATION_PLAN.md §7).
 *
 *   L0  rivid.ulid()                    ns      ID generation only
 *   L1  driver INSERT (raw pg client)   µs      driver+Postgres floor
 *   L2  ORM create                      µs      ORM overhead = L2 − L1
 *   L3  end-to-end batch                rows/s  realistic workload
 *
 * Never attribute L1–L3 to Rivid: those tables show where time is lost.
 *
 * Run: node --import tsx benchmarks/orm/run.mts [--rows=100000]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BENCH = dirname(fileURLToPath(import.meta.url));
const ROOT = join(BENCH, "../..");
const native = require(join(ROOT, "index.js"));
const { Client } = require("pg");

const rows = Number(process.argv.find((a) => a.startsWith("--rows="))?.split("=")[1] ?? 100_000);
const BATCH = 5_000;

const CFG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 54329),
  user: "postgres",
  password: "bench",
  database: "ids",
};

const client = new Client(CFG);
await client.connect();

// ── helpers ───────────────────────────────────────────────────────────────
async function timeStmt(label: string, stmtSql: null, valuesOf: (i: number) => unknown[], n: number) {
  const name = `tmp_${label}`;
  await client.query(`DROP TABLE IF EXISTS ${name}`);
  await client.query(`CREATE TABLE ${name} (LIKE users_ulid INCLUDING DEFAULTS)`);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i += BATCH) {
    const chunk = Math.min(BATCH, n - i);
    const vals = [];
    const params = [];
    for (let j = 0; j < chunk; j++) {
      const base = j * 4;
      const v = valuesOf(i + j);
      params.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
      vals.push(...v);
    }
    await client.query(
      `INSERT INTO ${name} (id,email,name,created_at) VALUES ${params.join(",")}`,
      vals,
    );
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  await client.query(`DROP TABLE ${name}`);
  return { layer: "L1", op: `bulk ${label} INSERT (${rows.toLocaleString()} rows, batches of ${BATCH})`, ms: +ms.toFixed(1), rows_per_sec: Math.round((n * 1e9) / (ms * 1e6)) };
}

// ── schema (canonical layout from benchmarks/db/init.sql) ────────────────
await client.query(`CREATE TABLE IF NOT EXISTS users_ulid (
  id CHAR(26) PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
await client.query("DELETE FROM users_ulid WHERE email LIKE '%orm-bench%'");

const out: {
  date: string;
  rows_target: number;
  layers: Array<Record<string, unknown>>;
} = { date: new Date().toISOString(), rows_target: rows, layers: [] };

// ── L0: generation only ──────────────────────────────────────────────────
{
  let n = 2000;
  for (let i = 0; i < n; i++) native.ulid();
  let batch = 1000;
  for (;;) {
    const t = process.hrtime.bigint();
    for (let i = 0; i < batch; i++) native.ulid();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms >= 4) break;
    batch *= 2;
  }
  const t = process.hrtime.bigint();
  for (let i = 0; i < batch; i++) native.ulid();
  const nsPer = Number(process.hrtime.bigint() - t) / batch;
  out.layers.push({ layer: "L0", op: "rivid.ulid() generation", ns_per_op: Math.round(nsPer) });
}

// ── L1: driver floor — raw pg multi-row INSERT ───────────────────────────
out.layers.push(
  await timeStmt(
    "driver",
    null,
    (i: number) => [native.ulid(), `u${i}@orm-bench`, "U", new Date()],
    rows,
  ),
);

// ── single-row latency: driver vs ORM (µs, p50 of 300) ───────────────────
{
  const drizzleMod = await import(`${ROOT}/integrations/drizzle/schema.ts`).then(() =>
    import("drizzle-orm/node-postgres"),
  );
  const { drizzle } = drizzleMod;
  const { usersUlid } = await import(`${ROOT}/integrations/drizzle/schema.ts`);
  const db = drizzle(client);

  async function p50(fn: (i: number) => Promise<unknown>, reps = 300) {
    // warmup
    for (let i = 0; i < 30; i++) await fn(i - 30);
    const xs: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t = process.hrtime.bigint();
      await fn(i);
      xs.push(Number(process.hrtime.bigint() - t) / 1e3); // µs
    }
    xs.sort((a, b) => a - b);
    return {
      p50: +(xs[reps >> 1] ?? 0).toFixed(1),
      p95: +(xs[(reps * 19) / 20 | 0] ?? 0).toFixed(1),
    };
  }

  let counter = 0;
  const l1 = await p50(async () => {
    await client.query(
      "INSERT INTO users_ulid (id,email,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [native.ulid(), `lat${counter++}@orm-bench`, "L1"],
    );
  });
  const l2 = await p50(async () => {
    await db.insert(usersUlid).values({
      id: native.ulid(),
      email: `lat${counter++}@orm-bench`,
      name: "L2",
    });
  });

  out.layers.push({ layer: "L1", op: "single INSERT via raw pg", ...l1, unit: "µs" });
  out.layers.push({
    layer: "L2",
    op: "single INSERT via Drizzle",
    ...l2,
    unit: "µs",
    orm_overhead_us: +(l2.p50 - l1.p50).toFixed(1),
  });

  // lookup by PK through the ORM
  const sample = (await db.select().from(usersUlid).limit(1))[0];
  if (sample != null) {
    const lk = await p50(async () => {
      await db.select().from(usersUlid).where(
        (await import("drizzle-orm")).eq(usersUlid.id, sample.id),
      );
    }, 500);
    out.layers.push({ layer: "L2", op: "SELECT by PK via Drizzle", ...lk, unit: "µs" });
  }
}

// ── cleanup + persist ─────────────────────────────────────────────────────
await client.query("DELETE FROM users_ulid WHERE email LIKE '%orm-bench%'");
await client.end();

mkdirSync(join(ROOT, "benchmarks/results"), { recursive: true });
writeFileSync(join(ROOT, "benchmarks/results/orm-layers.json"), JSON.stringify(out, null, 1));

console.log("\n### Layer-separated results");
console.log("| layer | operation | value |");
console.log("| --- | --- | ---: |");
for (const l of out.layers) {
  const v =
    l.ns_per_op != null ? `${l.ns_per_op} ns/op`
    : l.rows_per_sec != null ? `${l.rows_per_sec.toLocaleString()} rows/s (${l.ms} ms)`
    : `${l.p50} µs p50 / ${l.p95} p95`;
  console.log(`| ${l.layer} | ${l.op} | ${v} |`);
}
if (out.layers.find((l) => l.orm_overhead_us != null)) {
  const o = out.layers.find((l) => l.orm_overhead_us != null);
if (!o) throw new Error('missing L2 row');
  console.log(`\nDrizzle overhead vs raw driver: ${o.orm_overhead_us} µs per single insert`);
}
