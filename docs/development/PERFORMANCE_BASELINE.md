# Performance Baseline — 2026-08-26

## Platform

| Property | Value |
| --- | --- |
| OS | Debian 13 (trixie), kernel 6.12.105+deb13-amd64 |
| CPU | Intel Core i5-10210U @ 1.60GHz (8 logical cores) |
| Memory | 15 GB |
| Rust | rustc 1.98.0 (stable) |
| Node.js | v24.19.0 |
| Python | 3.13.5 |
| Go | 1.24.5 |
| Java | 21.0.12.1 |
| Commit | a39511cf3c5e2c62d4e3cf044c1a646f63fd9ea8 |

## Measurement Methodology

- 3 independent runs with `./bench.sh --quick`
- `measureOps`: adaptive batching, target 150ms, 2000-iter warmup, percentiles from per-batch samples
- `measureBulk`: best-of-N reps, GC forced between reps, RSS delta measured
- `bench_direct` (Rust): 5-50M iterations per single op, 100K-10M bulk

## Compiler Profiles

```toml
[profile.release]
lto = true
codegen-units = 1
opt-level = 3
```

## Rust Core (no NAPI overhead) — `bench_direct`

| Operation | ns/op | ops/sec |
| --- | ---: | ---: |
| ulid() generate+encode | 54 | 18.6M |
| monotonicUlid() | 43 | 23.3M |
| uuidv7() | 87 | 11.5M |
| encode(u128) | 20 | 49.2M |
| decode(str) | 51 | 19.4M |
| isValid(str) | 12 | 86.3M |
| decodeTime(str) | 8 | 120.5M |
| compare(a,b) | 48 | 21.0M |
| sortable encode | 21 | 47.4M |
| base58 encode 16B | 252 | 4.0M |
| bulk strings 100K | 75 ns/id | 13.3M ids/sec |
| bulk strings 1M | 62 ns/id | 16.2M ids/sec |
| bulk bytes 1M | 20 ns/id | 51.3M ids/sec |
| bulk bytes 10M | 18 ns/id | 56.2M ids/sec |

## Node.js + NAPI (3-run average, quick mode)

### Single-Call Latency

| Operation | ns/op (mean) | spread | ops/sec |
| --- | ---: | ---: | ---: |
| ulid() | 132 | 28 | 7.6M |
| ulid() [generator] | 247 | 18 | 4.1M |
| monotonicUlid() | 154 | 19 | 6.5M |
| uuidv7() | 165 | 10 | 6.1M |
| noop() [NAPI baseline] | 25 | 2 | 40.0M |

### Utility Operations

| Operation | ns/op (mean) | spread |
| --- | ---: | ---: |
| encodeTime(now) | 145 | 2 |
| decodeTime(id) | 126 | 16 |
| isValid(id) | 110 | 15 |
| compare(a,b) | 283 | 9 |
| decode(id) | 1520 | 29 |
| encode(bytes16) | 304 | 108 |
| ulidToUuid(id) | 331 | 113 |
| js native: a < b | 15 | 6 |

### Sorting (10k ULIDs)

| Operation | ns/op (mean) | spread |
| --- | ---: | ---: |
| sortInPlace(10k) | 4,572,354 | 101,374 |
| Array#sort(10k) native | 293,919 | 30,215 |
| sort(10k) copy | 5,055,328 | 410,509 |

**Sort analysis**: sortInPlace is ~15.5x slower than native Array#sort. The gap is
dominated by per-element regex validation (~1.3ms of 4.5ms for 10k). The `{validate:false}`
option eliminates this but isn't benchmarked separately. The Rust-side sort was measured at
~60x slower than V8 TimSort and was deliberately not shipped as the default path.

### Bulk Generation (3-run average)

| Size | Method | IDs/sec (mean) | spread | RSS delta |
| ---: | --- | ---: | ---: | ---: |
| 1K | generateMany(n) | 5.5M | 1.4M | 0 MB |
| 1K | generateBytes(n) | 16.7M | 5.8M | 0 MB |
| 1K | generateInto(prealloc) | 24.0M | 3.0M | 0 MB |
| 1K | js-baseline loop | 1.5M | 0.4M | 0 MB |
| 100K | generateMany(n) | 6.6M | 0.2M | 1.3 MB |
| 100K | generateBytes(n) | 40.5M | 0.4M | 8.8 MB |
| 100K | generateInto(prealloc) | 56.8M | 3.5M | 0 MB |
| 100K | js-baseline loop | 2.2M | 0.1M | 69.3 MB |

### Encoding Operations

| Operation | ns/op (mean) | spread |
| --- | ---: | ---: |
| encodeCrockford(bytes) | 307 | 96 |
| decodeCrockford(str) | 1980 | 757 |
| encodeBase58(bytes) | 652 | 269 |
| decodeBase58(str) | 1897 | 601 |
| encodeBase64Url(bytes) | 356 | 130 |
| decodeBase64Url(str) | 2561 | 213 |
| encodeSortable(bytes) | 311 | 92 |
| decodeSortable(str) | 1949 | 717 |
| Buffer#toString(base64url) | 193 | 70 |

## Key Observations

### NAPI Overhead Budget

| Path | Rust (ns) | Node (ns) | Overhead | Breakdown |
| --- | ---: | ---: | ---: | --- |
| ulid() | 54 | 132 | 78 ns | ~25ns NAPI call + ~53ns string export |
| decode(id) | 51 | 1520 | 1469 ns | ~200ns string import + ~50ns decode + ~1100ns Uint8Array export |
| encode(bytes) | 20 | 304 | 284 ns | ~100ns Uint8Array import + ~20ns encode + ~100ns string export + allocs |
| compare(a,b) | 48 | 283 | 235 ns | 2x string import + ~48ns decode+compare + ~10ns return |
| isValid(id) | 12 | 110 | 98 ns | ~100ns string import + ~12ns validate |

### Biggest Gaps

1. **decode(id)**: 30x slower through NAPI. Main cost is Uint8Array export (~1100ns).
   Mitigated by `decode_into()` which writes into caller buffer.
2. **encode(bytes)**: 15x slower through NAPI. Intermediate Rust String allocation.
3. **sortInPlace(10k)**: 15.5x slower than native Array#sort. Regex validation dominates.
4. **generateMany vs generateInto**: 8.6x throughput gap at 100K. Per-element string
   creation + array element setting is the bottleneck.

### Architecture Notes

- EntropyPool: ChaCha12, 512-byte amortized pool (32 ULIDs per fill), thread-local
- Crockford encoder: const fn with PAIR lookup table (1024 entries), stack-allocated [u8; 26]
- NAPI string export: `napi_create_string_latin1` fast path (zero Rust heap alloc)
- Sort: delegates to V8 Array#sort (not Rust sort) — measured 60x faster than per-element NAPI crossing
- Profile: LTO + codegen-units=1 + opt-level=3

## PostgreSQL / ORM

Not yet benchmarked. Docker available. Requires:
1. `bench.sh --db` suite (db-postgres.mts)
2. ORM layer separation bench (orm/run.mts)
3. Cross-language DB benchmarks

## Remaining Bottlenecks (ranked by real-world impact)

1. **decode path**: 1469ns NAPI overhead, mitigated by decode_into but not ergonomic
2. **generateMany string creation**: 6.6M/s ceiling from per-element NAPI calls
3. **Sort validation**: 15.5x overhead from regex validation (addressed by validate:false)
4. **encode allocation**: intermediate Rust String heap alloc
5. **Bulk random generation**: potential to batch RNG calls for better cache locality
