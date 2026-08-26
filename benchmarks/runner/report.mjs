#!/usr/bin/env node
/**
 * Generates benchmarks/reports/benchmark-report.md from the immutable
 * results/YYYY-MM-DD/ tree. Separates API categories per
 * BENCHMARK_METHODOLOGY.md §7 — never one combined leaderboard.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..')

function latestDay() {
  const days = readdirSync(join(BENCH, 'results')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  return days.at(-1)
}

const day = process.argv[2] ?? latestDay()
if (!day) {
  console.error('no results found')
  process.exit(1)
}
const dir = join(BENCH, 'results', day)

const rows = []
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue
  try {
    rows.push(...JSON.parse(readFileSync(join(dir, f), 'utf8')))
  } catch (e) {
    console.error(`[skip] ${f}: ${e.message}`)
  }
}

const fmtN = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }))
const fmtMs = (v) => (v == null ? '—' : `${Number(v).toFixed(v < 10 ? 1 : 0)} ms`)
const pkgLabel = (r) =>
  `${r.language}/${r.package}` +
  (r.secure ? '' : ' ⚠️insecure') + (r.native ? ' [native]' : '')

function table(title, filter, cols) {
  const sel = rows.filter(filter)
  if (!sel.length) return `### ${title}\n\n_(no data)_\n`
  let md = `### ${title}\n\n| ${cols.map((c) => c.h).join(' | ')} |\n`
  md += `| ${cols.map(() => '---').join(' | ')} |\n`
  for (const r of sel.sort((a, b) => (b.items_per_sec ?? b.ops_per_sec ?? 0) - (a.items_per_sec ?? a.ops_per_sec ?? 0))) {
    md += `| ${cols.map((c) => c.f(r)).join(' | ')} |\n`
  }
  return md + '\n'
}

let report = `# Cross-Language Benchmark Report — ${day}

Environment and pinned versions: see platform-matrix.json alongside this file.
Security column: all entries are CSP-seeded unless marked ⚠️. \`[native]\` =
Rust/C-backed implementation. Categories follow spec/workloads.json.

`

report += table(
  'Category A — single string generation',
  (r) => r.category === 'A' && /generate\.single|ulid\(\)|monotonic|uuidv/.test(r.operation ?? ''),
  [
    { h: 'Language/Library', f: pkgLabel },
    { h: 'op', f: (r) => String(r.operation ?? '') },
    { h: 'ns/op', f: (r) => fmtN(r.ns_per_op ?? r.nsPerOp) },
    { h: 'ops/sec', f: (r) => fmtN(r.ops_per_sec ?? r.opsPerSec) },
    { h: 'p50', f: (r) => fmtN(r.p50_ns ?? r.p50ns) },
    { h: 'p99', f: (r) => fmtN(r.p99_ns ?? r.p99ns) },
  ],
)

for (const size of [1000, 10000, 100000, 1000000, 10000000]) {
  const has = rows.some((r) => r.category === 'B' && Number(r.count) === size)
  if (!has) continue
  report += table(`Category B — bulk generation, n=${size.toLocaleString('en-US')}`,
    (r) => r.category === 'B' && Number(r.count) === size,
    [
      { h: 'Language/Library', f: pkgLabel },
      { h: 'API/method', f: (r) => String(r.method ?? r.operation ?? '') },
      { h: 'IDs/sec', f: (r) => fmtN(r.items_per_sec ?? r.perSec) },
      { h: 'ms', f: (r) => fmtMs(r.ms) },
      { h: 'ns/ID', f: (r) => fmtN(r.ns_per_item ?? (r.ms && r.count ? (r.ms * 1e6) / r.count : null)) },
      { h: 'RSS Δ MB', f: (r) => (r.rss_delta_mb ?? r.rssMb ?? '—') },
    ])
}

report += table('Category F — codec operations',
  (r) => r.category === 'F' && !/sort/i.test(String(r.operation)),
  [
    { h: 'Language/Library', f: pkgLabel },
    { h: 'operation', f: (r) => String(r.operation ?? '') },
    { h: 'ns/op', f: (r) => fmtN(r.ns_per_op ?? r.nsPerOp) },
    { h: 'ops/sec', f: (r) => fmtN(r.ops_per_sec ?? r.opsPerSec) },
  ])

report += table('Sorting — 10k ULIDs',
  (r) => /^sort\./.test(String(r.operation)),
  [
    { h: 'Language/Library', f: pkgLabel },
    { h: 'operation', f: (r) => String(r.operation ?? '') },
    { h: 'ns/op', f: (r) => fmtN(r.ns_per_op ?? r.nsPerOp) },
  ])

// framework noise baseline callout
const noise = rows.find((r) => r.operation === 'noop')
if (noise) {
  report += `> Framework noise baseline (\`noop\`): **${fmtN(noise.ns_per_op ?? noise.nsPerOp)} ns** on this machine.
> Differences smaller than ~2× this value in single-call tables are marked
> _statistically indistinguishable_ rather than claimed as wins.\n\n`
}

writeFileSync(join(BENCH, 'reports/benchmark-report.md'), report)
console.log(`benchmark-report.md written (${rows.length} rows, day=${day})`)
