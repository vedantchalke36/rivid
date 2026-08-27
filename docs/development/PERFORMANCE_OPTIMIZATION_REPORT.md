# Performance Optimization Report — 2026-08-26

## Summary

Optimized Rivid's NAPI binding layer and JS validation path while preserving
correctness, security, and API compatibility. All 87 tests pass. No warnings.

---

## Optimization 1: `encode()` / `encodeCrockford()` / `bytesToUlid()` — Eliminate Allocation

### What Changed

Replaced `core::ulid::encode(&bytes) → Result<String>` with a direct path:
`u128::from_be_bytes` → `crockford::encode_value` (stack `[u8; 26]`) → `js_string_latin1_26`.

Eliminated: 16-byte copy + 26-byte heap `Vec` + `String` → NAPI string conversion.

### Hypothesis

Avoiding the intermediate Rust `String` allocation and the NAPI `String` → JS string
conversion path should save ~50–100ns per call.

### Benchmark (3-run average)

| Function | Before (ns) | After (ns) | Delta |
| --- | ---: | ---: | ---: |
| `encode(bytes16)` | 304 | 252 | **−17%** |
| `encodeCrockford(bytes)` | 307 | 252 | **−18%** |
| `bytesToUlid(bytes)` | 331 | 252 | **−24%** |
| `encodeSortable(bytes)` | 311 | ~260 | **−16%** |

### Implementation

- `src/lib.rs`: `encode()`, `bytes_to_ulid()`, `encode_crockford()`, `encode_sortable()`.
- Added generic `js_string_latin1::<N>()` helper for arbitrary-length Latin1 strings.
- Reads `u128` directly from NAPI `Uint8Array` buffer (no intermediate copy).

### Decision: **KEEP**

---

## Optimization 2: Sort Validation — Lookup Table Replace Dual-Regex

### What Changed

Replaced two regex tests (`CANONICAL_RE` + `ANY_CASE_RE`) with a single-pass
forward scan using `Uint8Array` lookup tables. Validates length, alphabet
membership, and mixed-case detection in one pass.

### Hypothesis

A table-lookup approach avoids regex engine overhead (backtracking, capture groups)
and processes the string in a single forward scan.

### Benchmark (3-run average)

| Operation | Before (ns/elem) | After (ns/elem) | Delta |
| --- | ---: | ---: | ---: |
| Sort validation (10k) | 152 | 101 | **−34%** |
| Total sortInPlace (10k) | ~4.8ms | ~4.5ms | **−6%** |

### Key Finding: Sort Benchmark Comparison Was Unfair

The existing benchmark compared `sortInPlace(ids.slice())` (validated, unsorted data)
against `Array#sort(sortedish.slice().sort())` (pre-sorted data). With `{validate:false}`,
`sortInPlace` performs at **3.12ms** vs native `Array#sort` at **3.27ms** on unsorted data —
actually slightly faster due to the Latin1 string fast path.

### Implementation

- `src/ulid.ts`: Added `VALID_CHAR` and `VALID_UPPER` `Uint8Array` lookup tables.
- Added `validateAndDetectCase()` function (single-pass).
- Removed unused `ANY_CASE_RE` regex.

### Decision: **KEEP**

---

## Optimization 3: `fill_random_pairs` Core Helper

### What Changed

Added `batch::fill_random_pairs(&mut [u128])` to `rivid-core` for bulk random
generation with better cache locality than per-element `ulid_block_secure()`.

### Hypothesis

Batching RNG draws improves cache locality and reduces per-element function call overhead.

### Benchmark

The chunked `generateMany` implementation that used this helper regressed (5.1M/s vs 6.6M/s)
due to additional loop overhead and stack pressure. The helper is retained for potential
future use but the NAPI layer reverts to the original per-element pattern.

### Decision: **KEEP** (helper only, not used in hot path)

---

## Optimization 4: Build Hygiene

### What Changed

- Removed unused `NapiRaw` import from `src/lib.rs`.
- Clean build with zero warnings.

### Decision: **KEEP**

---

## PostgreSQL + ORM Results

### Insert Throughput (500K rows)

| Layout | rows/sec | Table MB | Index MB |
| --- | ---: | ---: | ---: |
| UUIDv7 (@rivid) | 179,821 | 41 | 19 |
| UUIDv4 (random) | 150,740 | 39 | 18 |
| ULID CHAR(26) | 124,268 | 59 | 31 |

### ORM Layer Separation (10K rows)

| Layer | Operation | Value |
| --- | --- | ---: |
| L0 | `rivid.ulid()` generation | 146 ns/op |
| L1 | Raw pg bulk INSERT | 77,534 rows/s |
| L1 | Single INSERT via raw pg | 1,124 µs p50 |
| L2 | Single INSERT via Drizzle | 1,192 µs p50 |
| L2 | SELECT by PK via Drizzle | 360 µs p50 |

**Drizzle overhead**: 68 µs per single insert (6% of total latency).

### Key Insight

ID generation (146 ns) is negligible compared to database round-trip (~1.1 ms).
The ORM adds only 6% overhead. The performance-critical path is the network +
PostgreSQL write, not identifier generation.

---

## Remaining Bottlenecks (Ranked)

| # | Bottleneck | Impact | Difficulty | Risk |
| --- | --- | --- | --- | --- |
| 1 | **decode() NAPI overhead** (~1.47ms vs 51ns Rust) | High for decode-heavy workloads | Low (use `decode_into`) | None |
| 2 | **generateMany string creation** (6.6M/s ceiling) | Medium (already 8.5x faster than JS libs) | High (NAPI per-element limit) | None |
| 3 | **ULID table storage** (+37.5% vs UUID) | Medium (DB space) | Low (use BYTEA) | Schema change |
| 4 | **Entropy pool batch fill** | Low (already amortized) | Low | None |
| 5 | **SIMD encoding/decoding** | Low (not profiled as bottleneck) | High | Platform-specific |

---

## Files Modified

| File | Changes |
| --- | --- |
| `src/lib.rs` | encode/decode path optimization, removed unused import |
| `src/ulid.ts` | Sort validation lookup table |
| `crates/core/src/batch.rs` | Added `fill_random_pairs` helper + test |
| `PERFORMANCE_BASELINE.md` | New: baseline measurements |
| `BENCHMARK_METHODOLOGY.md` | New: methodology documentation |
| `PERFORMANCE_OPTIMIZATION_REPORT.md` | This file |
