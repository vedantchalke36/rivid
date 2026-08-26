/**
 * Benchmark runner for @rivid/core.
 *
 * Usage:
 *   pnpm bench                 # full suite
 *   pnpm bench -- --quick      # reduced sizes, CI-friendly
 *   pnpm bench -- --suite=bulk # one suite: single|bulk|utils|encodings
 *
 * Results are printed as Markdown tables and written to
 * benchmarks/results/latest.json. All numbers come from live measurement
 * on the current machine; nothing is hard-coded.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fast from '../src/index.js'
import { native } from '../src/index.js'
import { measureOps, measureBulk, gc } from './harness.mts'
import { jsUlid, jsUlidMany } from './js-baseline.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const QUICK = args.has('--quick')
const SUITE = (process.argv.find((a) => a.startsWith('--suite=')) ?? '--suite=all')
  .split('=')[1]!

// Optional competitors — present as devDependencies.
type UlidModule = {
  ulid: (seedTime?: number) => string
  monotonicFactory: () => (seedTime?: number) => string
  encodeTime: (t: number) => string
  decodeTime: (id: string) => number
}
let refUlid: UlidModule | undefined
try {
  refUlid = ((await import('ulid')) as unknown) as UlidModule
} catch {
  /* not installed */
}
type UlixdModule = UlidModule & {}
let ulidx: UlixdModule | undefined
try {
  const m = (await import('ulidx')) as unknown as UlixdModule
  // ulidx exposes the same surface as `ulid` (monotonic via factory).
  ulidx = { ...m, monotonicFactory: m.monotonicFactory }
} catch {
  /* not installed */
}

interface Row {
  [k: string]: number | string | boolean | undefined
}
const tables: Record<string, Row[]> = {}

function fmt(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '-'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

type Col = [string, (r: Row) => number | string, (v: number | string) => string]

function printTable(title: string, rows: Row[], columns: Col[]): void {
  console.log(`\n### ${title}\n`)
  console.log(`| Library | ${columns.map(([name]) => name).join(' | ')} |`)
  console.log(`| --- |${columns.map(() => ' --- |').join('')}`)
  for (const r of rows) {
    const cells = columns.map(([, get, format]) => format(get(r)))
    console.log(`| ${String(r.library)} | ${cells.join(' | ')} |`)
  }
}

// ---------------------------------------------------------------------------
// Suite: single-call latency
// ---------------------------------------------------------------------------

if (SUITE === 'all' || SUITE === 'single') {
  const rows: Row[] = []
  const target = QUICK ? 150 : 400

  function add(label: string, library: string, fn: () => unknown): void {
    gc()
    const r = measureOps(`${library}: ${label}`, fn, { targetMs: target })
    rows.push({
      library,
      operation: label,
      opsPerSec: r.opsPerSec,
      nsPerOp: Math.round(r.nsPerOp),
      p50ns: Math.round(r.p50),
      p95ns: Math.round(r.p95),
      p99ns: Math.round(r.p99),
    })
  }

  add('ulid()', '@rivid/core', () => fast.ulid())
  add('ulid() [generator]', '@rivid/core', (() => {
    const g = new fast.UlidGenerator()
    return () => g.next()
  })())
  add('monotonicUlid()', '@rivid/core', () => fast.monotonicUlid())
  add('uuidv7()', '@rivid/core', () => fast.uuidv7())

  if (refUlid) {
    add('ulid()', 'ulid (JS)', () => refUlid!.ulid())
    const mono = refUlid!.monotonicFactory()
    add('monotonicUlid()', 'ulid (JS)', () => mono())
  }
  if (ulidx) {
    add('ulid()', 'ulidx (JS)', () => ulidx!.ulid())
    const umono = ulidx!.monotonicFactory()
    add('monotonicUlid()', 'ulidx (JS)', () => umono())
  }
  add('ulid()', 'js-baseline (Math.random)', () => jsUlid())
  add('noop() [boundary probe]', '@rivid/core', () => native.noop())

  tables.single = rows
  printTable(
    `Single-call performance (${QUICK ? 'quick mode' : 'full mode'})`,
    rows,
    [
      ['operation', (r) => String(r.operation), (v) => String(v)],
      ['ops/sec', (r) => Number(r.opsPerSec), fmt],
      ['ns/op', (r) => Number(r.nsPerOp), fmt],
      ['p50 (ns)', (r) => Number(r.p50ns), fmt],
      ['p95 (ns)', (r) => Number(r.p95ns), fmt],
      ['p99 (ns)', (r) => Number(r.p99ns), fmt],
    ],
  )
}

// ---------------------------------------------------------------------------
// Suite: bulk generation
// ---------------------------------------------------------------------------

if (SUITE === 'all' || SUITE === 'bulk') {
  const sizes = QUICK ? [1_000, 100_000] : [1_000, 100_000, 1_000_000, 10_000_000]
  const reps = (n: number) => (n <= 100_000 ? 5 : n <= 1_000_000 ? 3 : 1)

  for (const n of sizes) {
    const rows: Row[] = []
    gc()

    let m = measureBulk('@rivid/core', n, reps(n), (c) => fast.generateMany(c).length)
    rows.push({ library: '@rivid/core', method: 'generateMany(n)', ms: +m.ms.toFixed(1), perSec: m.itemsPerSec, rssMb: +m.rssDeltaMb.toFixed(1) })

    m = measureBulk('@rivid/core', n, reps(n), (c) => fast.generateBytes(c).length)
    rows.push({ library: '@rivid/core', method: 'generateBytes(n)', ms: +m.ms.toFixed(1), perSec: m.itemsPerSec, rssMb: +m.rssDeltaMb.toFixed(1) })

    if (!QUICK || n <= 100_000) {
      m = measureBulk('@rivid/core', n, reps(n), (c) => {
        const buf = new Uint8Array(c * 16)
        return fast.generateInto(buf)
      })
      rows.push({ library: '@rivid/core', method: 'generateInto(prealloc)', ms: +m.ms.toFixed(1), perSec: m.itemsPerSec, rssMb: +m.rssDeltaMb.toFixed(1) })

      m = measureBulk('js-baseline', n, Math.min(reps(n), 3), (c) => jsUlidMany(c).length)
      rows.push({ library: 'js-baseline', method: 'loop + hoisted time', ms: +m.ms.toFixed(1), perSec: m.itemsPerSec, rssMb: +m.rssDeltaMb.toFixed(1) })
    }

    // Competitor per-ID loops are O(n * 40us); beyond 1M they dominate the
    // whole run. Numbers at <=1M scale are reported instead.
    if (refUlid && n <= 1_000_000 && !(QUICK && n > 100_000)) {
      const r = reps(n)
      gc()
      const rssBefore = process.memoryUsage.rss()
      const t0 = process.hrtime.bigint()
      for (let i = 0; i < n; i++) refUlid.ulid()
      const el = Number(process.hrtime.bigint() - t0) / 1e6
      gc()
      rows.push({
        library: 'ulid (JS)',
        method: 'per-ID call loop',
        ms: +el.toFixed(1),
        perSec: (n * 1e9) / (el * 1e6),
        rssMb: +((process.memoryUsage.rss() - rssBefore) / 1048576).toFixed(1),
      })
      void r
    }

    tables[`bulk-${n}`] = rows
    printTable(
      `Generate ${fmt(n)} IDs`,
      rows,
      [
        ['method', (r) => String(r.method), (v) => String(v)],
        ['ms', (r) => Number(r.ms), (v) => String(v)],
        ['IDs/sec', (r) => Number(r.perSec), fmt],
        ['RSS Δ (MB)', (r) => Number(r.rssMb), (v) => String(v)],
      ],
    )
  }
}

// ---------------------------------------------------------------------------
// Suite: utilities vs JS-native equivalents
// ---------------------------------------------------------------------------

if (SUITE === 'all' || SUITE === 'utils') {
  const ids = fast.generateMany(10_000)
  const sample = ids[5_000]!
  const bytes = fast.decode(sample)
  const other = ids[5_001]!
  const sortedish = [...ids].sort()

  const rows: Row[] = []
  const t = (label: string, library: string, fn: () => unknown) => {
    const r = measureOps(`${library}: ${label}`, fn, { targetMs: QUICK ? 120 : 300 })
    rows.push({ library, operation: label, opsPerSec: r.opsPerSec, nsPerOp: Math.round(r.nsPerOp) })
  }

  t('encodeTime(now)', '@rivid/core', () => fast.encodeTime(Date.now()))
  if (refUlid) t('encodeTime(now)', 'ulid (JS)', () => refUlid!.encodeTime(Date.now()))

  t('decodeTime(id)', '@rivid/core', () => fast.decodeTime(sample))
  if (refUlid) t('decodeTime(id)', 'ulid (JS)', () => refUlid!.decodeTime(sample))

  t('isValid(id)', '@rivid/core', () => fast.isValid(sample))

  t('compare(a,b)', '@rivid/core', () => fast.compare(sample, other))
  t('a < b compare', 'js native', () => (sample < other ? -1 : sample > other ? 1 : 0))

  t('sortInPlace(10k)', '@rivid/core', () => fast.sortInPlace(ids.slice()))
  t('Array#sort(10k)', 'js native', () => sortedish.slice().sort())
  t('sort(10k) copy', '@rivid/core', () => fast.sort(ids))

  t('decode(id)', '@rivid/core', () => fast.decode(sample))
  t('encode(bytes16)', '@rivid/core', () => fast.encode(bytes))

  t('ulidToUuid(id)', '@rivid/core', () => fast.ulidToUuid(sample))

  tables.utils = rows
  printTable('Utility operations', rows, [
    ['operation', (r) => String(r.operation), (v) => String(v)],
    ['ops/sec', (r) => Number(r.opsPerSec), fmt],
    ['ns/op', (r) => Number(r.nsPerOp), fmt],
  ])
}

// ---------------------------------------------------------------------------
// Suite: encodings
// ---------------------------------------------------------------------------

if (SUITE === 'all' || SUITE === 'encodings') {
  const bytes = fast.ulidBytes()
  const crock = fast.encodeCrockford(bytes)
  const b58 = fast.encodeBase58(bytes)
  const b64u = fast.encodeBase64Url(bytes)
  const sort = fast.encodeSortable(bytes)

  const rows: Row[] = []
  const t = (label: string, library: string, fn: () => unknown) => {
    const r = measureOps(`${library}: ${label}`, fn, { targetMs: QUICK ? 120 : 300 })
    rows.push({ library, operation: label, opsPerSec: r.opsPerSec, nsPerOp: Math.round(r.nsPerOp) })
  }

  t('encodeCrockford(bytes)', '@rivid/core', () => fast.encodeCrockford(bytes))
  t('decodeCrockford(str)', '@rivid/core', () => fast.decodeCrockford(crock))
  t('encodeBase58(bytes)', '@rivid/core', () => fast.encodeBase58(bytes))
  t('decodeBase58(str)', '@rivid/core', () => fast.decodeBase58(b58))
  t('encodeBase64Url(bytes)', '@rivid/core', () => fast.encodeBase64Url(bytes))
  t('decodeBase64Url(str)', '@rivid/core', () => fast.decodeBase64Url(b64u))
  t('encodeSortable(bytes)', '@rivid/core', () => fast.encodeSortable(bytes))
  t('decodeSortable(str)', '@rivid/core', () => fast.decodeSortable(sort))

  // Node's own Buffer.toString('base64url') comparison.
  const buf = Buffer.from(bytes)
  t("Buffer#toString('base64url')", 'node builtin', () => buf.toString('base64url'))

  tables.encodings = rows
  printTable('128-bit encodings', rows, [
    ['operation', (r) => String(r.operation), (v) => String(v)],
    ['ops/sec', (r) => Number(r.opsPerSec), fmt],
    ['ns/op', (r) => Number(r.nsPerOp), fmt],
  ])
}

// ---------------------------------------------------------------------------

mkdirSync(join(ROOT, 'benchmarks/results'), { recursive: true })
function cpuModel(): string {
  try {
    if (process.platform === 'linux') {
      const lines = readFileSync('/proc/cpuinfo', 'utf8').split('\n')
      const line = lines.find((l) => l.startsWith('model name'))
      return line ? line.split(':')[1]!.trim() : 'unknown'
    }
    if (process.platform === 'darwin') {
      return execSync('sysctl -n machdep.cpu.brand_string').toString().trim()
    }
    if (process.platform === 'win32') {
      return execSync('wmic cpu get name').toString().trim()
    }
  } catch {
    /* best effort */
  }
  return process.env.PROCESSOR_IDENTIFIER ?? 'unknown'
}

const env = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  cpu: cpuModel(),
  date: new Date().toISOString(),
  quick: QUICK,
  suite: SUITE,
}
writeFileSync(
  join(ROOT, 'benchmarks/results/latest.json'),
  JSON.stringify({ env, tables }, null, 2) + '\n',
)
console.log('\nResults written to benchmarks/results/latest.json')
console.log(JSON.stringify(env))
