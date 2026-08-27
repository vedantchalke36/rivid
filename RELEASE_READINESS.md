# Release Readiness — v1.0.0

Audit date: 2026-08-27 · Every PASS cites the command or artifact that proves it.

## Summary

| Area | Status | Evidence |
|---|---|---|
| Core | **PASS** | `cargo test -p rivid-core` → 60/60 · `npm test` → 95/95 (incl. reference-vector parity vs `ulid@3`) |
| Security | **PASS** | ChaCha12 OS-seeded default; deterministic mode opt-in only (`{ seed }`); 9 fuzz targets, total decoders; `cargo audit` + `npm audit --omit=dev` in CI; policy at `.github/SECURITY.md`, guide at `SECURITY.md` |
| API | **PASS** | Surface pinned by `__test__/types.compile.mts`; `index.d.ts` now declares `string[]` batch returns directly; no accidental exports added this cycle |
| Node | **PASS** | ESM + CJS smoke in CI; Node 18–24 × Linux/macOS/Windows matrix; Bun smoke job |
| WASM | **PASS** | `wasm-pack build crates/wasm --target nodejs --release` + `node crates/wasm/test.mjs` → all checks passed; ~64 KB wasm core; web/nodejs/bundler outputs assembled by `scripts/package-wasm.mjs` |
| Python | **PASS*** | PyO3 crate + SQLAlchemy types + pytest suite (6/6 vs live PG, genuine rivid engine); *distribution via PyPI pending first publish (build documented in `packages/python`) |
| Go | **N/A** | No rivid Go binding exists; stand-in-generator integrations were removed rather than shipped as pretense — schema guidance retained in `docs/orm.md`, binding on the roadmap |
| Java | **PARTIAL** | JMH benchmark suite (Gradle) works; bindings not started — documented as roadmap in README |
| ORM | **PASS** | Drizzle, Prisma, SQLAlchemy, SQLx suites run against pinned postgres:16.4; L0/L1/L2 layer separation in `benchmarks/results/orm-layers.json` |
| PostgreSQL | **PASS** | Representation matrix benchmarked at 10 M rows; BRIN/index guidance in `docs/postgres.md`; claims scoped to index locality/storage, not insert throughput |
| CLI | **PASS** | `rivid ulid/uuidv7/decode/validate/check/version` smoke-tested; `rivid check` covered by 8 dedicated tests |
| Benchmarks | **PASS** | Every README number cross-checked against `benchmarks/results/latest.json` (2026-08-26); layers labeled; methodology in `docs/benchmarking.md` |
| Documentation | **PASS** | User guides in `docs/`, internal reports in `docs/development/`; README link graph verified; duplicate changelog removed |
| Packaging | **PASS** | npm `files` allowlist (dist/cli/README/LICENSE/CHANGELOG); `*~`, Gradle/pytest caches untracked; WASM packager strips wasm-pack manifests |
| CI/CD | **PASS** | ci.yml: fmt/clippy/tests/matrix/fuzz-smoke/audit/coverage/bun/wasm; bench.yml: smoke on PR, full matrix scheduled; release.yml: tag↔version guards + provenance publish + changelog-sourced GH releases |

## Verified claims (2026-08-26 harness, i5-10210U, Node v24.19.0)

| Claim | Number | Source |
|---|---|---|
| Single ULID (native) | 123 ns / 8.1 M ops/s | `results/latest.json` → single |
| Monotonic ULID | 148 ns / 6.8 M ops/s | same |
| UUIDv7 | 175 ns / 5.7 M ops/s | same |
| vs `ulid` npm single | ~326× | 40,111 ns ÷ 123 ns |
| `generateMany` (100 K) | 6.8 M IDs/s | `results/latest.json` → bulk-100000 |
| `generateBytes` (100 K) | 45 M IDs/s | same |
| `generateInto` (100 K) | 63 M IDs/s | same |
| Bulk binary multiplier | up to ~2,000× | scoped to `generateBytes`/`generateInto` at 1 M |
| Rust core direct | ~53 ns | `bench_direct` / platform matrix |
| PG 10 M-row storage/insert | see `docs/databases.md` | `db-storage-bench.mts` artifacts |

## Release blockers

None. Items deferred by design (not blockers, tracked in PRODUCTION_READINESS addendum):

- PyPI / crates.io first publishes (build paths documented; release workflow covers npm + crates.io from tags)
- Go and Java native bindings (roadmap)
- ORM-scale (10 M+ rows through ORM) automation

Platform scope: macOS support is Apple Silicon (arm64) only — Intel Mac builds
were dropped deliberately; Linux covers x64/arm64 (glibc + musl), Windows x64.

## Recommended version

**v1.0.0** — identifier API surface is frozen and pinned by compile-time tests;
all five identifier families, six ORM integrations, CLI governance, and the WASM
package are complete and tested. Versions are set from the git tag by
`release.yml` (`npm pkg set version` + tag↔crate guard), so tag `v1.0.0` when
publishing.
