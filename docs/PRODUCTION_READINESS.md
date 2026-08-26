# Production Readiness

Date: 2026-08-23 · Evidence links inline. No PASS without a runnable check.

## Core

| Item | Status | Evidence |
|---|---|---|
| ULID spec compliance | **PASS** | reference vectors `__test__/compat.test.mts`; 57 Rust tests incl. round-trip sweeps |
| UUIDv7 (RFC 9562) | **PASS** | version/variant bit tests; timestamp extraction JS+Rust |
| Monotonic behavior | **PASS** | same-ms increment + rollback semantics; monotonicMany batch test; fuzz target `monotonic_state` |
| Overflow / boundary timestamps | **PASS** | TIME_MAX ±1 in Rust+JS; lossless `TimestampOutOfRange(u64)` |
| Clock rollback | **PASS** | seedTime-earlier increments prior random part |
| Invalid input handling | **PASS** | decoders total → Err/throw; 8 fuzz targets, ~40M execs clean |
| Randomness / security split | **PASS** | ChaCha12 OS-seeded default; Xoshiro256\*\* only via explicit `{seed}`; SECURITY.md |
| API stability | **PARTIAL** | surface frozen; additive-only exports this cycle (`decodeInto`, `decodeMany`, `nextMany`, `monotonicMany`, `uuidv7DecodeTime*`, sort opts). Pre-1.0 |

## Packages

| Item | Status | Evidence |
|---|---|---|
| npm @rivid/core | **PARTIAL** | dual CJS/ESM verified by smokes; packed-artifact used by drizzle/prisma integration installs (`file:../..`); publish workflow exists, registry publish not yet performed |
| crates.io crate | **NOT IMPLEMENTED** | publishing pipeline absent |
| Python package (rivid-python) | **NOT IMPLEMENTED** | integrations use labeled stand-in generators |
| Go module (rivid-go) | **NOT IMPLEMENTED** | same |
| Java package | **NOT IMPLEMENTED** | out of scope now |

## Integrations — Wave 1

| Integration | Status | Evidence |
|---|---|---|
| Drizzle ORM | **PASS** | 11/11 vs live PG: CRUD, ORDER BY==insertion order (500), keyset 1k no dupes/skips, rollback, BYTEA round trip, 8-worker × 5k zero collisions |
| Prisma 6.19.3 | **PASS** | 8/8: explicit-PK contract asserted, mode-C baseline, ordering 300, pagination, transactions |
| SQLAlchemy 2.0.36 | **PASS*** | 6/6 — *generator is labeled stand-in (python-ulid) until rivid-python exists |
| SQLx (Rust) | **PASS** | 3/3 using genuine rivid-core engine |
| database/sql (Go) | **PASS*** | pool MaxConns asserted; CRUD/ordering/keyset/rollback; *stand-in generator |
| GORM (Go) | **PASS*** | Valuer/Scanner ULID type + BeforeCreate hook; *stand-in generator |

Wave 2 (TypeORM, Django, Diesel, SeaORM, Ent, Hibernate/Spring): **NOT IMPLEMENTED** — deliberate (plan §3).

## Database & benchmarks

| Item | Status | Evidence |
|---|---|---|
| PG infra reproducible | **PASS** | pinned postgres:16.4-alpine compose + init.sql + start/stop/reset + healthcheck |
| PG integration tests | **PASS** | every suite above ran against the canonical container |
| Layer-separated ORM bench | **PASS** | `benchmarks/orm/run.mts`: L0 151 ns → L1 1184 µs → L2 Drizzle +14 µs; JSON persisted |
| Identifier representation matrix | **PASS** | 1M-row uuid4/uuid7/char(26) numbers (`db-postgres.mts`) |
| Cross-language platform | **PASS** | node/rust/python/go suites (+java JMH); immutable daily results; hard correctness gates pre-timing |
| Methodology doc | **PASS** | noise-baseline rule, category separation, anti-goals |
| 10M/100M DB rows via ORMs | **PARTIAL** | raw-driver 10M measured; ORM-scale automation pending |

## CI / release

| Item | Status | Evidence |
|---|---|---|
| Unit + integration CI | **PASS** | ci.yml: fmt/clippy/tests, Node 18–24 matrix, fuzz smoke, audit job |
| Benchmark CI split | **PASS** | bench.yml: PR=smoke gates only; scheduled=full cross-platform matrix with artifacts |
| Release automation (npm) | **PASS** | release.yml platform matrix + provenance publish (untested against live registry) |
| Release automation (crates/PyPI/Go) | **NOT IMPLEMENTED** | — |

## Docs

| Item | Status |
|---|---|
| README w/ real benches | PASS |
| BENCHMARK_METHODOLOGY / CROSS_PLATFORM / BENCHMARKING | PASS |
| ORM_IMPLEMENTATION_PLAN / ORM_INTEGRATIONS | PASS |
| SECURITY / CONTRIBUTING / COC / CHANGELOG / LICENSE | PASS |
| Per-integration docs | PARTIAL — embedded guides in ORM_INTEGRATIONS.md; standalone READMEs pending |
