/**
 * Database patterns. These are ESM-flavoured sketches; adapt for your stack.
 *
 * • PostgreSQL / MySQL / SQLite: TEXT or CHAR(26) stores the canonical ULID
 *   with lexicographic primary-key ordering already correct. For range
 *   scans by time, index on `time = EXTRACT(TIMESTAMPTZ FROM decodeTime(id))`
 *   is rarely needed — byte ordering already is time ordering.
 * • `generateInto` / `generateBytes` shine for high-throughput ETL: allocate
 *   one typed array and bulk-INSERT from it with your driver's bulk API.
 * • `decode(id)` → 16 bytes is what binary columns want (`BYTEA`, `BLOB`, …).
 * • Redis sorted sets: `ZADD ns SET score decodeTime(id) member id`.
 *
 * None of this adds an ORM dependency — the driver calls below are plain
 * strings/buffers your favourite client already speaks.
 *
 * Run:  node --import tsx examples/database.mts   (prints SQL only; needs no DB)
 */
import { ulid, generateMany, generateInto, decode, encodeTime } from '../src/index.js'

// ── Postgres sketch ─────────────────────────────────────────────────────────

const ids = generateMany(100_000)

// A. Bulk INSERT with text IDs (one array of strings param style is common
//    for the `pg` client + UNNEST).
const pgSql = `
  INSERT INTO events (id, created_at)
  SELECT id, to_timestamp((decodeTime((string_to_array($1, ','))[row_number()])) / 1000)
  FROM generate_series(1, $1::text) t(row_number) -- (illustrative; adapt for UNNEST)
`
void pgSql
console.log('Postgres: INSERT expects', ids.length, 'IDs')
console.log('  example id :', ids[0])
console.log('  timestamp  :', new Date(Date.now()).toISOString(), '(<=> encodeTime()')

// B. Streaming inserts with preallocated buffers — no GC surprise at 1M RPS.
const buf = new Uint8Array(10_000 * 16)
generateInto(buf)
// Driver call: pg.query(copyFrom(data)) etc — buf is the payload.

// C. Range scan by time without an extra column (ULID is time-ordered).
const start = encodeTime(Date.now() - 60_000) // last minute
const end = encodeTime(Date.now())
console.log(`  range:   "id" BETWEEN '${start}0000000000000000' AND '${end}ZZZZZZZZZZZZZZZZ'`)
console.log('  range-start prefix:', start, '…')
console.log('  range-end   prefix:', end, '…')

// D. Decode for binary stores.
const bytes = decode(ids[0]!)
console.log(`\n  ${ids[0]!} -> bytes[0..6] timestamp BE = 0x${Buffer.from(bytes.slice(0, 6)).toString('hex')}`)

// ── Redis sketch ────────────────────────────────────────────────────────────

console.log(`
Redis sorted set sketch (every member scored by its embedded timestamp):

  ZADD events ${Date.now()} "${ulid()}"
  ZRANGE events ${start}0000000000000000 ${end}ZZZZZZZZZZZZZZZZ BYSCORE
`)
