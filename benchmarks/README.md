# Benchmarks

Everything measured, nothing hard-coded. Every script writes/prints its
methodology; numbers are only meaningful when reproduced (see
`docs/development/PERFORMANCE_OPTIMIZATION_REPORT.md` §1 for the variance
envelope on laptop hardware).

## Suite

| Command | What it measures |
|---|---|
| `npm run bench` | Full: single-call, bulk (1K→10M), utils, encodings |
| `npm run bench -- --quick` | Reduced sizes (~20 s), CI-friendly |
| `npm run bench -- --suite=single\|bulk\|utils\|encodings` | One suite only |
| `npm run bench:rust` | Direct Rust core, no N-API (`bench_direct`) |
| `npm run bench:startup` | Cold-start cost vs pure-JS libs |

## Profiling tools

| Script | Purpose |
|---|---|
| `profile/boundary.mts` | Decomposes N-API crossing costs per argument/result shape. Key facts: string export ≈ 100 ns; **fresh Uint8Array export ≥ 1.1 µs** (V8 object construction floor); writing into caller buffers avoids both. |
| `scale.mts [--workers=N]` | Worker-thread scaling of bulk generation (near-linear: 3.71× at 4 workers). |

CPU profiles: `node --cpu-prof --import tsx benchmarks/run.mts -- --suite=utils`
writes `.cpuprofile` files loadable in Chrome DevTools.

## Database benchmarks

`db-postgres.mts` compares UUIDv4 / UUIDv7 / ULID insertion throughput,
table+index size and point-lookup latency over 1M rows:

```bash
docker run -d --name rivid-pg -e POSTGRES_PASSWORD=bench -e POSTGRES_DB=ids -p 54329:5432 postgres:16-alpine
npm install --no-save pg
DB_BENCH_ROWS=1000000 node --import tsx benchmarks/db-postgres.mts
docker rm -f rivid-pg
```

Headline result (PostgreSQL 16, 1M rows): UUIDv7 inserts **+26 %** faster
than UUIDv4 (B-tree locality). ULID-as-text pays ~47 % more table space.
Generation speed itself is never the bottleneck at DB scale.

## Methodology notes

- Bulk timings: best-of-N after warmup (ceiling estimate); GC forced between reps via `--expose-gc`.
- Single-call stats: batched hrtime sampling; p50/p95/p99 are per-batch means — treat tails as lower bounds.
- Result verification: bulk benches assert output lengths; correctness properties live in `__test__/`.
- Noise gauge: `noop()` boundary probe printed alongside every single-call table. On this laptop expect ±15 % run-to-run under frequency scaling; distrust any comparison whose probe also moved.
- Results JSON (`results/latest.json`) includes env metadata (Node, CPU, date, mode) for diffing across machines.
