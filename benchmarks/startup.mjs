/**
 * Cold-start cost: time from spawning `node -e "require(...)"` to first ID.
 *
 * Measures module load + native binding load (dlopen) for @rivid/core
 * versus the pure-JS reference. Reported as the median of N runs.
 */
import { spawnSync } from 'node:child_process'

const RUNS = Number(process.argv[2] ?? 15)

function bench(label, code) {
  const times = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    const r = spawnSync(process.execPath, ['-e', code], { stdio: 'pipe' })
    const el = performance.now() - t0
    if (r.status !== 0) {
      console.error(`${label} FAILED:`, r.stderr.toString())
      process.exit(1)
    }
    times.push(el)
  }
  times.sort((a, b) => a - b)
  const med = times[Math.floor(times.length / 2)]
  const min = times[0]
  console.log(
    `${label.padEnd(34)} median ${med.toFixed(1)}ms   min ${min.toFixed(1)}ms`,
  )
  return { label, median: +med.toFixed(1), min: +min.toFixed(1) }
}

const results = [
  bench('node baseline (no imports)', 'process.exit(0)'),
  bench('@rivid/core require+first ulid', "const {ulid}=require('./dist/cjs/index.js'); ulid();"),
  bench('ulid (JS) require+first ulid', "const {ulid}=require('ulid'); ulid();"),
]

console.log('\nJSON:', JSON.stringify(results))
