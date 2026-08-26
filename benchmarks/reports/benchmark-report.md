# Cross-Language Benchmark Report — 2026-08-23

Environment and pinned versions: see platform-matrix.json alongside this file.
Security column: all entries are CSP-seeded unless marked ⚠️. `[native]` =
Rust/C-backed implementation. Categories follow spec/workloads.json.

### Category A — single string generation

| Language/Library | op | ns/op | ops/sec | p50 | p99 |
| --- | --- | --- | --- | --- | --- |
| rust/fast-id-core [native] | generate.single.ulid | 48 | 20,680,536 | — | — |
| node/@fast-id/core [native] | generate.single.ulid-mono | 145 | 6,920,053 | 135 | 188 |
| node/@fast-id/core [native] | generate.single.uuidv7 | 166 | 6,028,566 | 158 | 203 |
| node/@fast-id/core [native] | generate.single.ulid | 177 | 5,641,567 | 149 | 273 |
| go/google/uuid | generate.single.uuidv7 | 184 | 5,437,738 | — | — |
| go/google/uuid | generate.single.uuidv4 | 186 | 5,364,807 | — | — |
| go/oklog/ulid/v2 | generate.single.ulid | 206 | 4,852,014 | — | — |
| node/@fast-id/core [native] | generate.single.ulid | 239 | 4,190,019 | 227 | 347 |
| python/uuid-utils [native] | generate.single.uuidv4 | 295 | 3,391,181 | 287 | 419 |
| python/uuid-utils [native] | generate.single.uuidv7 | 367 | 2,726,558 | 359 | 431 |
| node/ulid (JS) | generate.single.ulid-mono | 466 | 2,145,424 | 432 | 925 |
| node/ulidx (JS) | generate.single.ulid-mono | 501 | 1,994,974 | 479 | 679 |
| node/js-baseline (Math.random) ⚠️insecure | generate.single.ulid | 780 | 1,282,703 | 747 | 1,035 |
| python/cpython-uuid | generate.single.uuidv4 | 2,643 | 378,411 | 2,571 | 3,028 |
| python/python-ulid | generate.single.ulid | 5,122 | 195,226 | 4,821 | 8,699 |
| node/ulidx (JS) | generate.single.ulid | 40,545 | 24,664 | 39,981 | 43,972 |
| node/ulid (JS) | generate.single.ulid | 40,837 | 24,487 | 42,930 | 44,864 |

### Category B — bulk generation, n=1,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateBytes(n) | 16,707,879 | 0.1 ms | 100 | 0 |
| node/@fast-id/core [native] | generateInto(prealloc) | 16,058,066 | 0.1 ms | 100 | 0 |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,234,880 | — | — | — |
| node/@fast-id/core [native] | generateMany(n) | 3,092,911 | 0.3 ms | 300 | 0 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,156,033 | 0.9 ms | 900 | 0 |
| python/python-ulid | generate.bulk.ulid | 211,228 | 4.7 ms | 4,734 | — |
| node/ulid (JS) | per-ID call loop | 18,517 | 54 ms | 54,000 | 0.3 |

### Category B — bulk generation, n=10,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| go/oklog/ulid/v2 | generate.bulk.ulid | 5,982,801 | — | — | — |
| python/python-ulid | generate.bulk.ulid | 200,355 | 50 ms | 4,991 | — |

### Category B — bulk generation, n=100,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateInto(prealloc) | 44,429,891 | 2.3 ms | 23 | 0 |
| node/@fast-id/core [native] | generateBytes(n) | 35,699,967 | 2.8 ms | 28 | 9 |
| rust/fast-id-core [native] | generate.bulk.ulid | 15,743,913 | — | 64 | — |
| go/oklog/ulid/v2 | generate.bulk.ulid | 5,957,356 | — | — | — |
| node/@fast-id/core [native] | generateMany(n) | 5,391,762 | 19 ms | 185 | 1.3 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,428,992 | 70 ms | 700 | 69.3 |
| python/python-ulid | generate.bulk.ulid | 200,934 | 498 ms | 4,977 | — |
| node/ulid (JS) | per-ID call loop | 19,959 | 5010 ms | 50,103 | 145 |

### Category B — bulk generation, n=1,000,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| rust/fast-id-core [native] | generate.bulk.ulid | 16,620,002 | — | 60 | — |
| python/uuid-utils [native] | generate.bulk.uuidv7 | 2,543,004 | 393 ms | 393 | — |
| python/python-ulid | generate.bulk.ulid | 190,266 | 5256 ms | 5,256 | — |

### Category F — codec operations

| Language/Library | operation | ns/op | ops/sec |
| --- | --- | --- | --- |
| rust/fast-id-core [native] | codec.timeextract.ulid | 8 | 128,109,816 |
| node/js native | codec.compare.native | 13 | 74,158,149 |
| go/oklog/ulid/v2 | codec.decode.ulid | 15 | 67,204,301 |
| go/oklog/ulid/v2 | codec.validate.ulid | 23 | 43,802,015 |
| rust/fast-id-core [native] | codec.decode.ulid | 48 | 20,925,796 |
| node/@fast-id/core [native] | codec.validate.ulid | 132 | 7,584,891 |
| node/node builtin | codec.encode.base64url.node | 144 | 6,952,364 |
| node/@fast-id/core [native] | codec.timeextract.ulid | 156 | 6,423,423 |
| node/@fast-id/core [native] | encode.time.ulid | 196 | 5,094,229 |
| node/@fast-id/core [native] | encodeCrockford(bytes) | 248 | 4,034,552 |
| node/@fast-id/core [native] | codec.convert.ulid.uuid | 277 | 3,605,939 |
| node/@fast-id/core [native] | codec.encode.ulid | 277 | 3,605,293 |
| node/@fast-id/core [native] | codec.compare.ulid | 337 | 2,970,800 |
| node/@fast-id/core [native] | encodeBase64Url(bytes) | 372 | 2,689,864 |
| node/ulid (JS) | encode.time.ulid | 374 | 2,675,457 |
| node/@fast-id/core [native] | encodeBase58(bytes) | 521 | 1,920,637 |
| node/ulid (JS) | codec.timeextract.ulid | 524 | 1,907,338 |
| node/@fast-id/core [native] | codec.decode.ulid | 1,353 | 739,028 |
| node/@fast-id/core [native] | decodeCrockford(str) | 1,449 | 689,945 |
| node/@fast-id/core [native] | decodeBase64Url(str) | 1,766 | 566,217 |
| node/@fast-id/core [native] | decodeBase58(str) | 2,137 | 467,982 |

### Sorting — 10k ULIDs

| Language/Library | operation | ns/op |
| --- | --- | --- |
| node/js native | sort.ulid.10k.native | 268,874 |
| node/@fast-id/core [native] | sort.ulid.10k | 4,604,213 |
| node/@fast-id/core [native] | sort.ulid.10k | 4,664,491 |

> Framework noise baseline (`noop`): **46 ns** on this machine.
> Differences smaller than ~2× this value in single-call tables are marked
> _statistically indistinguishable_ rather than claimed as wins.

