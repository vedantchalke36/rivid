/**
 * Scale test: single thread vs N worker threads.
 *
 * Each worker runs its own bulk generation (Rust RNG is thread-local), so
 * this measures the scaling ceiling for per-worker pipelines. The global
 * `monotonicUlid()` intentionally is NOT tested across workers: it serializes
 * on one mutex by design (single-writer semantics).
 *
 * Run: node --import tsx benchmarks/scale.mts [--workers=4]
 */
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const native = require(${JSON.stringify(join(ROOT, 'index.js'))})
const { ids, reps } = workerData
native.generateMany(10_000)
let best = Infinity
for (let r = 0; r < reps; r++) {
  const t = process.hrtime.bigint()
  const arr = native.generateMany(ids)
  const el = Number(process.hrtime.bigint() - t)
  if (arr.length !== ids) throw new Error('bad length')
  best = Math.min(best, el)
}
parentPort.postMessage(best)
`

function benchWorker(ids: number, reps = 3): Promise<number> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { ids, reps } })
    w.on('message', resolve)
    w.on('error', reject)
  })
}

async function main(): Promise<void> {
  const argWorkers = process.argv.find((a) => a.startsWith('--workers='))
  const maxWorkers = argWorkers ? Number(argWorkers.split('=')[1]) : 4
  const idsPerBatch = 500_000

  console.log(`Scale test: generateMany(${idsPerBatch.toLocaleString()}) per worker\n`)
  console.log('| workers | worst-worker ms | aggregate IDs/s | scaling vs 1T |')
  console.log('| ---: | ---: | ---: | ---: |')

  let singleMs: number | undefined
  for (let n = 1; n <= maxWorkers; n++) {
    const t0 = process.hrtime.bigint()
    const times = await Promise.all(Array.from({ length: n }, () => benchWorker(idsPerBatch)))
    void (Number(process.hrtime.bigint() - t0) / 1e6)
    const worstMs = Math.max(...times) / 1e6
    const agg = (n * idsPerBatch * 1e9) / (worstMs * 1e6)
    if (n === 1) singleMs = worstMs
    const scale = singleMs ? ((singleMs * n) / worstMs).toFixed(2) : '-'
    console.log(`| ${n} | ${worstMs.toFixed(0)} | ${(agg / 1e6).toFixed(1)}M | ${scale}x |`)
  }
}

main()
