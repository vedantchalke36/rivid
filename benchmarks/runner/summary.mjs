#!/usr/bin/env node
/**
 * Cross-platform benchmark summary generator.
 *
 * Reads per-platform benchmark results (from downloaded artifacts) and
 * generates a unified markdown report comparing performance across all
 * platforms. Also merges platform-matrix.json entries.
 *
 * Usage:
 *   node runner/summary.mjs <results-dir>
 *
 * <results-dir> should contain per-platform subdirectories each with
 * results/<day>/<lang>.json and reports/platform-matrix.json files.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = dirname(BENCH)

const resultsRoot = process.argv[2] ?? join(BENCH, 'results')

function latestDay(dir) {
  if (!existsSync(dir)) return null
  const days = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  return days.at(-1)
}

// Discover per-platform result directories.
// Expected layout: <resultsRoot>/<platform-tag>/results/<day>/<lang>.json
// or flat: <resultsRoot>/<lang>.json (single-platform fallback)
const platforms = []
const day = latestDay(resultsRoot) ?? new Date().toISOString().slice(0, 10)

// Scan for platform subdirectories (bench-<os>-<arch> structure)
const entries = readdirSync(resultsRoot)
for (const entry of entries) {
  const platformDir = join(resultsRoot, entry)
  if (!existsSync(platformDir) || !readdirSync(platformDir).some(f => f.endsWith('.json') || f === 'results')) continue

  const matrixPath = join(platformDir, 'reports', 'platform-matrix.json')
  const resultsDir = join(platformDir, 'results', day)
  // fallback: results directly in platformDir
  const flatDir = join(platformDir, 'results')

  let matrix = null
  if (existsSync(matrixPath)) {
    try { matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) } catch {}
  }

  const rows = []
  for (const searchDir of [resultsDir, flatDir, platformDir]) {
    if (!existsSync(searchDir)) continue
    for (const f of readdirSync(searchDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(searchDir, f), 'utf8'))
        if (Array.isArray(data)) rows.push(...data)
      } catch {}
    }
    if (rows.length) break
  }

  if (rows.length || matrix) {
    platforms.push({
      label: matrix?.os ?? entry,
      matrix,
      rows,
    })
  }
}

// Sort platforms for consistent display order
const osOrder = { linux: 0, darwin: 1, win32: 2 }
platforms.sort((a, b) => {
  const aOs = a.matrix?.os?.split(' ')[0] ?? ''
  const bOs = b.matrix?.os?.split(' ')[0] ?? ''
  return (osOrder[aOs] ?? 99) - (osOrder[bOs] ?? 99)
})

const fmtN = (v) => (v == null ? '--' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }))
const fmtMs = (v) => (v == null ? '--' : `${Number(v).toFixed(v < 10 ? 1 : 0)} ms`)
const pkgLabel = (r) =>
  `${r.language}/${r.package}` +
  (r.secure ? '' : ' ⚠️insecure') + (r.native ? ' [native]' : '')

function findBest(rows, field, higher = true) {
  let best = null
  let bestVal = higher ? -Infinity : Infinity
  for (const r of rows) {
    const v = r[field]
    if (v == null) continue
    if (higher ? v > bestVal : v < bestVal) {
      bestVal = v
      best = r
    }
  }
  return best
}

let md = `# Cross-Platform Benchmark Summary — ${day}\n\n`

// ── Platform Overview ──────────────────────────────────────────────────
md += `## Platform Overview\n\n`
md += `| Platform | CPU | Cores | Memory | OS | Rust | Node | Python | Go |\n`
md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`
for (const p of platforms) {
  const m = p.matrix
  if (!m) continue
  const rt = m.runtimes ?? {}
  md += `| ${m.os} | ${m.cpu?.slice(0, 40) ?? '--'} | ${m.cores_logical ?? '--'} | ${m.memory_gb ? m.memory_gb + ' GB' : '--'} | ${m.kernel ?? '--'} | ${fmtN(rt.rust)} | ${fmtN(rt.node)} | ${fmtN(rt.python)} | ${fmtN(rt.go)} |\n`
}
md += '\n'

// ── Platform Failures ──────────────────────────────────────────────────
const allFailures = platforms.flatMap(p => (p.matrix?.failures ?? []).map(f => ({ platform: p.label, failure: f })))
if (allFailures.length) {
  md += `## Platform Failures\n\n`
  md += `| Platform | Failure |\n| --- | --- |\n`
  for (const { platform, failure } of allFailures) {
    md += `| ${platform} | ${failure} |\n`
  }
  md += '\n'
}

// ── Category A: Single Generation (cross-platform comparison) ──────────
md += `## Category A — Single ULID Generation (cross-platform)\n\n`
const singleUlidRows = platforms.flatMap(p =>
  p.rows.filter(r => r.category === 'A' && /generate\.single\.ulid/.test(r.operation ?? '') && r.identifier === 'ulid')
    .map(r => ({ ...r, _platform: p.label }))
)
if (singleUlidRows.length) {
  md += `| Platform | Library | ns/op | ops/sec | p50 | p99 |\n`
  md += `| --- | --- | --- | --- | --- | --- |\n`
  for (const r of singleUlidRows.sort((a, b) => (a.ns_per_op ?? Infinity) - (b.ns_per_op ?? Infinity))) {
    md += `| ${r._platform} | ${pkgLabel(r)} | ${fmtN(r.ns_per_op)} | ${fmtN(r.ops_per_sec)} | ${fmtN(r.p50_ns)} | ${fmtN(r.p99_ns)} |\n`
  }
} else {
  md += `_(no data)_\n`
}
md += '\n'

// ── Category A: Single UUIDv7 (cross-platform comparison) ──────────────
md += `## Category A — Single UUIDv7 Generation (cross-platform)\n\n`
const singleUuidRows = platforms.flatMap(p =>
  p.rows.filter(r => r.category === 'A' && /generate\.single\.uuidv7/.test(r.operation ?? ''))
    .map(r => ({ ...r, _platform: p.label }))
)
if (singleUuidRows.length) {
  md += `| Platform | Library | ns/op | ops/sec | p50 | p99 |\n`
  md += `| --- | --- | --- | --- | --- | --- |\n`
  for (const r of singleUuidRows.sort((a, b) => (a.ns_per_op ?? Infinity) - (b.ns_per_op ?? Infinity))) {
    md += `| ${r._platform} | ${pkgLabel(r)} | ${fmtN(r.ns_per_op)} | ${fmtN(r.ops_per_sec)} | ${fmtN(r.p50_ns)} | ${fmtN(r.p99_ns)} |\n`
  }
} else {
  md += `_(no data)_\n`
}
md += '\n'

// ── Category B: Bulk Generation (cross-platform, per size) ─────────────
for (const size of [1000, 10000, 100000, 1000000, 10000000]) {
  const has = platforms.some(p => p.rows.some(r => r.category === 'B' && Number(r.count) === size))
  if (!has) continue
  md += `## Category B — Bulk ULID Generation, n=${size.toLocaleString('en-US')} (cross-platform)\n\n`
  const bulkRows = platforms.flatMap(p =>
    p.rows.filter(r => r.category === 'B' && Number(r.count) === size && /ulid/.test(r.operation ?? ''))
      .map(r => ({ ...r, _platform: p.label }))
  )
  if (bulkRows.length) {
    md += `| Platform | Library | IDs/sec | ms | ns/ID |\n`
    md += `| --- | --- | --- | --- | --- |\n`
    for (const r of bulkRows.sort((a, b) => (b.items_per_sec ?? 0) - (a.items_per_sec ?? 0))) {
      md += `| ${r._platform} | ${pkgLabel(r)} | ${fmtN(r.items_per_sec)} | ${fmtMs(r.ms)} | ${fmtN(r.ns_per_item)} |\n`
    }
  } else {
    md += `_(no data)_\n`
  }
  md += '\n'
}

// ── Category F: Codec Operations (cross-platform) ──────────────────────
md += `## Category F — Codec Operations (cross-platform)\n\n`
const codecRows = platforms.flatMap(p =>
  p.rows.filter(r => r.category === 'F' && !/sort/i.test(String(r.operation)))
    .map(r => ({ ...r, _platform: p.label }))
)
if (codecRows.length) {
  md += `| Platform | Library | Operation | ns/op | ops/sec |\n`
  md += `| --- | --- | --- | --- | --- |\n`
  for (const r of codecRows.sort((a, b) => (a.ns_per_op ?? Infinity) - (b.ns_per_op ?? Infinity))) {
    md += `| ${r._platform} | ${pkgLabel(r)} | ${r.operation} | ${fmtN(r.ns_per_op)} | ${fmtN(r.ops_per_sec)} |\n`
  }
} else {
  md += `_(no data)_\n`
}
md += '\n'

// ── Platform Winners ──────────────────────────────────────────────────
md += `## Insights\n\n`

// Best platform for single ULID generation
const bestSingle = findBest(singleUlidRows, 'ops_per_sec', true)
if (bestSingle) {
  md += `- **Fastest single ULID generation:** ${bestSingle._platform} (${pkgLabel(bestSingle)}) at ${fmtN(bestSingle.ops_per_sec)} ops/sec\n`
}

// Best platform for bulk generation (10k)
const bulk10k = platforms.flatMap(p =>
  p.rows.filter(r => r.category === 'B' && Number(r.count) === 10000 && /ulid/.test(r.operation ?? ''))
    .map(r => ({ ...r, _platform: p.label }))
)
const bestBulk10k = findBest(bulk10k, 'items_per_sec', true)
if (bestBulk10k) {
  md += `- **Fastest bulk ULID (10k):** ${bestBulk10k._platform} (${pkgLabel(bestBulk10k)}) at ${fmtN(bestBulk10k.items_per_sec)} IDs/sec\n`
}

// Per-platform fastest library
for (const p of platforms) {
  const pSingle = p.rows.filter(r => r.category === 'A' && /generate\.single\.ulid/.test(r.operation ?? '') && r.identifier === 'ulid')
  const best = findBest(pSingle, 'ops_per_sec', true)
  if (best) {
    md += `- **${p.label}:** fastest ULID lib is ${pkgLabel(best)} (${fmtN(best.ops_per_sec)} ops/sec)\n`
  }
}

// Performance ratio across platforms
if (singleUlidRows.length >= 2) {
  const vals = singleUlidRows.map(r => r.ops_per_sec).filter(Boolean)
  if (vals.length >= 2) {
    const maxV = Math.max(...vals)
    const minV = Math.min(...vals)
    md += `- **Cross-platform spread:** ${fmtN(maxV)} vs ${fmtN(minV)} ops/sec (${(maxV / minV).toFixed(1)}× ratio)\n`
  }
}

// Native vs non-native comparison
const nativeRows = singleUlidRows.filter(r => r.native)
const nonNativeRows = singleUlidRows.filter(r => !r.native)
if (nativeRows.length && nonNativeRows.length) {
  const avgNative = nativeRows.reduce((s, r) => s + (r.ops_per_sec ?? 0), 0) / nativeRows.length
  const avgNonNative = nonNativeRows.reduce((s, r) => s + (r.ops_per_sec ?? 0), 0) / nonNativeRows.length
  if (avgNonNative > 0) {
    md += `- **Native vs non-native ULID avg:** ${fmtN(avgNative)} vs ${fmtN(avgNonNative)} ops/sec (${(avgNative / avgNonNative).toFixed(1)}×)\n`
  }
}

md += '\n'
md += `---\n_Generated by \`benchmarks/runner/summary.mjs\` from per-platform result artifacts._\n`

const outDir = join(BENCH, 'reports')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'cross-platform-summary.md'), md)
console.log(`cross-platform-summary.md written (${platforms.length} platforms, ${platforms.reduce((s, p) => s + p.rows.length, 0)} total rows)`)
