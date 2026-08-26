/**
 * Minimal dependency-free benchmarking primitives.
 *
 * Two measurement modes:
 * - `measureOps`: adaptive ops/sec + latency percentiles (for single calls).
 * - `measureBulk`: wall time for a fixed amount of work (for batch APIs),
 *   including peak RSS and heap deltas where measurable.
 */

export interface OpsResult {
  label: string
  opsPerSec: number
  nsPerOp: number
  p50: number
  p95: number
  p99: number
}

export interface BulkResult {
  label: string
  items: number
  ms: number
  itemsPerSec: number
  nsPerItem: number
  rssDeltaMb: number
}

const now = (): bigint => process.hrtime.bigint()

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

/**
 * Measures a single-call operation. Runs in exponentially growing batches
 * until at least `targetMs` of measurement has elapsed, sampling individual
 * call latencies (capped) for percentiles.
 */
export function measureOps(
  label: string,
  fn: () => unknown,
  opts: { targetMs?: number; minIters?: number } = {},
): OpsResult {
  const { targetMs = 300, minIters: minItersOpt = 20_000 } = opts

  // Warmup (JIT + NAPI fast paths).
  let iters = 2_000
  run(iters)

  function run(n: number): void {
    for (let i = 0; i < n; i++) fn()
  }

  // Calibrate batch size so one batch is ~5ms.
  let batch = 1_000
  let calNs = 0n
  for (;;) {
    const t0 = now()
    run(batch)
    const el = now() - t0
    calNs = el
    const elMs = Number(el) / 1e6
    if (elMs >= 4 || batch > 1 << 24) break
    batch *= Math.max(2, Math.ceil(5 / Math.max(elMs, 0.01)))
    batch = Math.min(batch, 1 << 24)
  }

  // Scale the minimum work to the operation's real cost: expensive ops
  // (e.g. sorting 10k items) must not be forced through 20k iterations.
  const perOpNs = Number(calNs) / batch
  const minIters = Math.max(
    200,
    Math.min(minItersOpt, Math.ceil((targetMs * 1e6) / Math.max(perOpNs, 1))),
  )

  // Timed sampling loop.
  const latencies: number[] = []
  let totalNs = 0n
  let totalOps = 0
  const deadline = Number(now()) + targetMs * 1e6
  while (totalOps < minIters || Number(now()) < deadline) {
    const t0 = now()
    run(batch)
    const el = now() - t0
    totalNs += el
    totalOps += batch
    // Sample per-op estimate for this batch.
    latencies.push(Number(el) / batch)
    if (Number(now()) > deadline && totalOps >= minIters) break
  }

  latencies.sort((a, b) => a - b)
  const nsPerOp = Number(totalNs) / totalOps
  return {
    label,
    opsPerSec: 1e9 / nsPerOp,
    nsPerOp,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  }
}

/**
 * Measures bulk work: runs `fn(items)` once per repetition after warmup and
 * reports wall-clock statistics plus RSS growth.
 */
export function measureBulk(
  label: string,
  items: number,
  reps: number,
  fn: (items: number) => unknown,
): BulkResult {
  gc()
  const rssBefore = process.memoryUsage.rss()

  // Warmup with a smaller workload to avoid double allocation cost.
  fn(Math.min(items, 10_000))
  gc()

  let bestNs = Infinity
  for (let r = 0; r < reps; r++) {
    const t0 = now()
    fn(items)
    bestNs = Math.min(bestNs, Number(now() - t0))
    gc()
  }

  const rssAfter = process.memoryUsage.rss()
  return {
    label,
    items,
    ms: bestNs / 1e6,
    itemsPerSec: (items * 1e9) / bestNs,
    nsPerItem: bestNs / items,
    rssDeltaMb: (rssAfter - rssBefore) / (1024 * 1024),
  }
}

/** Forces GC when Node runs with --expose-gc; otherwise a no-op hint. */
export function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc
  if (g) g()
}
