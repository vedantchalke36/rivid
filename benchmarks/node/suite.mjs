#!/usr/bin/env node
/**
 * Cross-language benchmark — Node.js adapter.
 *
 * Delegates to the established benchmarks/run.mts harness (methodology
 * preserved so historical results stay comparable — see BENCHMARK_METHODOLOGY.md §9)
 * and additionally runs the correctness gate before timing.
 *
 * Output: BEGIN_RESULTS / END_RESULTS framed JSON (normalized rows from
 * latest.json tables + metadata).
 */
import { spawnSync } from 'node:child_process'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const args = new Set(process.argv.slice(2))
const QUICK = args.has('--quick')

// ── correctness gate: must pass before any timing ────────────────────────
const native = require(join(ROOT, 'index.js'))
const gate = []
{
  const ids = native.generateMany(50_000)
  if (ids.length !== 50_000) gate.push('generateMany length')
  if (new Set(ids).size !== 50_000) gate.push('uniqueness')
  for (const id of ids.slice(0, 1000)) if (!native.isValid(id)) gate.push('validity')
  const t = native.decodeTime(ids[49999])
  if (!(1_400_000_000_000 < t && t < 4_000_000_000_000)) gate.push('timestamp plausibility')
  // monotonic ordering
  let prev = ''
  for (let i = 0; i < 10_000; i++) {
    const m = native.monotonicUlid()
    if (m <= prev) { gate.push(`monotonic at ${i}`); break }
    prev = m
  }
  // round trip
  const rt = native.encode(native.decode(ids[0]))
  if (rt !== ids[0]) gate.push('encode(decode(x)) round trip')
}
if (gate.length) {
  console.error('CORRECTNESS GATE FAILED:', gate.join('; '))
  process.exit(1)
}

// ── run the established suite ────────────────────────────────────────────
const r = spawnSync(process.execPath, [
  '--import', 'tsx', '--expose-gc', 'benchmarks/run.mts', QUICK ? '--quick' : '',
].filter(Boolean), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
if (r.status !== 0) process.exit(r.status ?? 1)

const raw = JSON.parse(readFileSync(join(ROOT, 'benchmarks/results/latest.json'), 'utf8'))

function commit() {
  try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'no-git' }
}

const CAT = { single: 'A', utils: 'F', encodings: 'F' }
// Normalize established harness labels → central spec workload IDs.
const OP_MAP = {
  'ulid()': 'generate.single.ulid',
  'ulid() [generator]': 'generate.single.ulid',
  'monotonicUlid()': 'generate.single.ulid-mono',
  'uuidv7()': 'generate.single.uuidv7',
  'encodeTime(now)': 'encode.time.ulid',
  'decodeTime(id)': 'codec.timeextract.ulid',
  'isValid(id)': 'codec.validate.ulid',
  'compare(a,b)': 'codec.compare.ulid',
  'a < b compare': 'codec.compare.native',
  'sortInPlace(10k)': 'sort.ulid.10k',
  'Array#sort(10k)': 'sort.ulid.10k.native',
  'sort(10k) copy': 'sort.ulid.10k',
  'decode(id)': 'codec.decode.ulid',
  'encode(bytes16)': 'codec.encode.ulid',
  'ulidToUuid(id)': 'codec.convert.ulid.uuid',
  "Buffer#toString('base64url')": 'codec.encode.base64url.node',
  'noop() [boundary probe]': 'noop.framework',
}
const METHOD_FROM = {
  'generateMany(n)': 'gen.bulk.string',
  'generateBytes(n)': 'gen.bulk.binary',
  'generateInto(prealloc)': 'gen.prealloc.binary',
  'loop + hoisted time': 'gen.bulk.string.insecure',
  'per-ID call loop': 'gen.single.loop',
}

const rows = []
for (const [table, entries] of Object.entries(raw.tables)) {
  const cat = table.startsWith('bulk') ? 'B' : (CAT[table] ?? '?')
  const count = table.startsWith('bulk') ? Number(table.split('-')[1]) : 1
  for (const e of entries) {
    const label = String(e.operation ?? '')
    rows.push({
      timestamp: raw.env.date,
      commit: commit(),
      language: 'node',
      package: String(e.library ?? '@rivid/core'),
      package_version: '0.1.0',
      runtime_version: raw.env.node,
      category: cat,
      // bulk rows carry method; single/utils rows map through OP_MAP
      operation: isBulkLabel(table) ? (METHOD_FROM[e.method] ?? `bulk.${e.method}`) : (OP_MAP[label] ?? label),
      method: e.method,
      identifier: /uuid/i.test(label) ? 'uuidv7' : 'ulid',
      native: e.library === '@rivid/core',
      secure: !/baseline/.test(String(e.library)),
      count,
      ms: e.ms,
      ns_per_op: e.nsPerOp,
      ops_per_sec: e.opsPerSec,
      items_per_sec: e.perSec,
      p50_ns: e.p50ns,
      p95_ns: e.p95ns,
      p99_ns: e.p99ns,
      rss_delta_mb: e.rssMb,
      os: `${raw.env.platform}`,
      arch: process.arch,
      cpu: raw.env.cpu,
      quick: raw.env.quick,
    })
  }
}
function isBulkLabel(table) {
  return /^bulk-\d+$/.test(table)
}

console.log('BEGIN_RESULTS')
console.log(JSON.stringify(rows, null, 1))
console.log('END_RESULTS')
if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(rows, null, 1))
