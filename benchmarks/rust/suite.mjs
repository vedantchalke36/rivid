#!/usr/bin/env node
/**
 * Cross-language benchmark — Rust adapter.
 *
 * Wraps `cargo run --release --example bench_direct` and converts its
 * human-readable output into the common result schema. The Rust core has no
 * N-API overhead here; this measures the engine proper.
 *
 * Output: BEGIN_RESULTS / END_RESULTS framed JSON on stdout.
 */
import { spawnSync } from 'node:child_process'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const args = new Set(process.argv.slice(2))
const QUICK = args.has('--quick')

const WORKLOAD_MAP = [
  [/^ulid\(\)/, 'generate.single.ulid', 'ulid', 'A', { native: true, secure: true }],
  [/^decode\(str\)/, 'codec.decode.ulid', 'ulid', 'F', {}],
  [/^decode_time/, 'codec.timeextract.ulid', 'ulid', 'F', {}],
  [/^encode_time/, 'codec.encode.time.ulid', 'ulid', 'F', {}],
]

const BULK_RE = /^bulk (strings|bytes)\s+x\s+(\d+)\s+(\S+)\s+ns\/id\s+(\d+) ids\/sec/

function rustVersion() {
  try {
    return execSync('rustc --version').toString().trim()
  } catch {
    return 'unknown'
  }
}

function commit() {
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'no-git'
  }
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function runBenchDirect() {
  // bench_direct runs fixed workloads; --quick is honored by reducing env.
  const r = spawnSync('cargo', ['run', '--release', '-p', 'rivid-core', '--example', 'bench_direct'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, BENCH_QUICK: QUICK ? '1' : '' },
  })
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? 'cargo failed\n')
    process.exit(1)
  }
  return r.stdout
}

const out = runBenchDirect()
const rows = []
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const rv = rustVersion()

for (const line of out.split('\n')) {
  const m = BULK_RE.exec(line.trim())
  if (m) {
    const [, kind, count, nsPer, idsSec] = m
    const n = Number(count.replace(/_/g, ''))
    rows.push({
      timestamp: stamp,
      commit: commit(),
      language: 'rust',
      package: 'rivid-core',
      package_version: '0.1.0',
      runtime_version: rv,
      category: kind === 'bytes' ? 'D' : 'B',
      operation: `generate.bulk.${kind === 'bytes' ? 'binary.' : ''}ulid`,
      identifier: 'ulid',
      native: true,
      secure: true,
      mode: kind === 'bytes' ? 'binary16' : 'string',
      count: n,
      ns_per_item: parseFloat(nsPer),
      items_per_sec: parseInt(idsSec.replace(/,/g, ''), 10),
      os: process.platform,
      arch: process.arch,
    })
    continue
  }
  for (const [re, op, ident, cat, extra] of WORKLOAD_MAP) {
    if (re.test(line.trim())) {
      const ns = /(\d+(?:\.\d+)?) ns\/op/.exec(line)?.[1]
      const ops = /(\d+) ops\/sec/.exec(line)?.[1]
      if (ns && ops) {
        rows.push({
          timestamp: stamp,
          commit: commit(),
          language: 'rust',
          package: 'rivid-core',
          package_version: '0.1.0',
          runtime_version: rv,
          category: cat,
          operation: op,
          identifier: ident,
          native: true,
          secure: true,
          count: 1,
          ns_per_op: parseFloat(ns),
          ops_per_sec: parseInt(ops.replace(/,/g, ''), 10),
          os: process.platform,
          arch: process.arch,
          ...extra,
        })
      }
      break
    }
  }
}

console.log('BEGIN_RESULTS')
console.log(JSON.stringify(rows, null, 1))
console.log('END_RESULTS')
if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(rows, null, 1))
