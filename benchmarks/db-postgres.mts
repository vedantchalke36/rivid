/**
 * Real-database benchmark: does faster ID generation matter at the
 * application/database layer?
 *
 * Compares insertion throughput, table+index size and query behavior for
 * UUIDv4 (random), UUIDv7 (time-ordered) and ULID (time-ordered text).
 *
 * Requires PostgreSQL. Configure via env:
 *   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE  (defaults: localhost:54329 postgres/bench ids)
 *   DB_BENCH_ROWS=1000000
 *
 * Run: node --import tsx benchmarks/db-postgres.mts
 */
import { randomUUID } from 'node:crypto'
import { native } from '../src/index.js'

// `pg` is an optional peer for this benchmark only; install with:
//   npm install --no-save pg
type PgClientCtor = new (cfg: unknown) => {
  connect(): Promise<void>
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>
  end(): Promise<void>
}
let Client: PgClientCtor
try {
  // Non-literal specifier keeps tsc from hard-requiring the optional peer.
  const spec = 'pg'
  Client = ((await import(spec)) as { Client: PgClientCtor }).Client
} catch {
  console.error('This benchmark requires the `pg` package: npm install --no-save pg')
  process.exit(1)
}

const ROWS = Number(process.env.DB_BENCH_ROWS ?? 1_000_000)
const BATCH = 10_000

const client = new Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'bench',
  database: process.env.PGDATABASE ?? 'ids',
})

interface Result {
  label: string
  insertMs: number
  rowsPerSec: number
  tableMb: number
  indexMb: number
}

const results: Result[] = []

async function setup(name: string, ddl: string): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS ${name}`)
  await client.query(ddl)
}

async function benchInsert(
  name: string,
  makeRow: () => [string],
): Promise<void> {
  const t0 = process.hrtime.bigint()
  await client.query('BEGIN')
  for (let i = 0; i < ROWS; i += BATCH) {
    const values: unknown[] = []
    const params: string[] = []
    for (let j = 0; j < BATCH; j++) {
      values.push(...makeRow())
      const base = j * 1 + 1
      params.push(`($${base})`)
    }
    // single-column multi-row VALUES
    const sql = `INSERT INTO ${name} (id) VALUES ${params.join(',')}`
    await client.query(sql, values)
  }
  await client.query('COMMIT')
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const size = await client.query<{ size: string }>(`
    SELECT pg_total_relation_size('${name}') AS size`)
  const idxSize = await client.query<{ size: string }>(`
    SELECT COALESCE(SUM(pg_relation_size(indexrelid)),0) AS size
    FROM pg_index WHERE indrelid = '${name}'::regclass`)
  results.push({
    label: name,
    insertMs: Math.round(ms),
    rowsPerSec: Math.round((ROWS * 1e9) / (ms * 1e6)),
    tableMb: Number(BigInt(size.rows[0]!.size) / 1048576n),
    indexMb: Number(BigInt(idxSize.rows[0]!.size) / 1048576n),
  })
}

async function benchQueries(labels: string[]): Promise<void> {
  console.log('\n### Query performance (post-insert)\n')
  for (const label of labels) {
    // Point lookup via PK
    let sample: string
    if (label === 'uuid4') sample = randomUUID()
    else if (label === 'uuid7') sample = native.uuidv7().toUpperCase()
    else sample = native.ulid()

    const t1 = process.hrtime.bigint()
    for (let i = 0; i < 200; i++) {
      await client.query(`SELECT * FROM ${label} WHERE id = $1`, [sample])
    }
    const pointMs = Number(process.hrtime.bigint() - t1) / 1e6 / 200

    // Range scan over the last ~1% of the keyspace (time-ordered layouts)
    let rangeMs = NaN
    if (label !== 'uuid4') {
      const t2 = process.hrtime.bigint()
      if (label === 'ulid') {
        await client.query(`SELECT count(*) FROM ulid WHERE id >= $1`, [
          '7ZZZZZZZZZZZZZZZZZZZZZZZZY' ,
        ])
      } else {
        await client.query(`SELECT count(*) FROM uuid7 WHERE id >= $1`, [
          'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ])
      }
      rangeMs = Number(process.hrtime.bigint() - t2) / 1e6
    }
    void rangeMs
    console.log(`| ${label} | point lookup avg ${pointMs.toFixed(2)} ms |`)
  }
}

await client.connect()

console.log(`DB benchmark: ${ROWS.toLocaleString()} rows per layout, batches of ${BATCH.toLocaleString()}\n`)

// ── Layouts ────────────────────────────────────────────────────────────────

await setup('uuid4', `CREATE TABLE uuid4 (id UUID PRIMARY KEY)`)
await setup('uuid7', `CREATE TABLE uuid7 (id UUID PRIMARY KEY)`)
await setup('ulid', `CREATE TABLE ulid (id CHAR(26) PRIMARY KEY)`)

console.log('### Insertion\n')
console.log('| layout | insert ms | rows/sec | table MB | index MB |')
console.log('| --- | ---: | ---: | ---: | ---: |')

await benchInsert('uuid4', () => [randomUUID()])
for (const r of results) if (r.label === 'uuid4') console.log(`| UUIDv4 (random) | ${r.insertMs} | ${r.rowsPerSec.toLocaleString()} | ${r.tableMb} | ${r.indexMb} |`)

results.length = 0 // keep printing simple: one row at a time

await benchInsert('uuid7', () => [native.uuidv7().toUpperCase()])
{
  const r = results[0]!
  console.log(`| UUIDv7 (@rivid/core) | ${r.insertMs} | ${r.rowsPerSec.toLocaleString()} | ${r.tableMb} | ${r.indexMb} |`)
}
results.length = 0

await benchInsert('ulid', () => [native.ulid()])
{
  const r = results[0]!
  console.log(`| ULID (@rivid/core)   | ${r.insertMs} | ${r.rowsPerSec.toLocaleString()} | ${r.tableMb} | ${r.indexMb} |`)
}
const layoutLabels = ['uuid4', 'uuid7', 'ulid']
results.length = 0

await benchQueries(layoutLabels)

await client.end()
