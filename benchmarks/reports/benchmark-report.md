# Cross-Language Benchmark Report — 2026-08-26

Environment and pinned versions: see platform-matrix.json alongside this file.
Security column: all entries are CSP-seeded unless marked ⚠️. `[native]` =
Rust/C-backed implementation. Categories follow spec/workloads.json.

### Category A — single string generation

| Language/Library | op | ns/op | ops/sec | p50 | p99 |
| --- | --- | --- | --- | --- | --- |
| rust/rivid-core [native] | generate.single.ulid | 53 | 18,736,504 | — | — |
| node/@rivid/core [native] | generate.single.ulid | 123 | 8,138,001 | 116 | 168 |
| node/@rivid/core [native] | generate.single.ulid-mono | 148 | 6,764,622 | 139 | 207 |
| node/@rivid/core [native] | generate.single.uuidv7 | 175 | 5,714,295 | 167 | 251 |
| go/oklog/ulid/v2 | generate.single.ulid | 183 | 5,464,481 | — | — |
| go/google/uuid | generate.single.uuidv4 | 189 | 5,279,831 | — | — |
| go/google/uuid | generate.single.uuidv7 | 212 | 4,725,898 | — | — |
| node/@rivid/core [native] | generate.single.ulid | 248 | 4,025,888 | 231 | 346 |
| python/uuid-utils [native] | generate.single.uuidv4 | 387 | 2,581,058 | 353 | 671 |
| node/ulidx (JS) | generate.single.ulid-mono | 474 | 2,109,938 | 448 | 820 |
| node/ulid (JS) | generate.single.ulid-mono | 479 | 2,088,174 | 448 | 652 |
| python/uuid-utils [native] | generate.single.uuidv7 | 520 | 1,923,488 | 486 | 792 |
| node/js-baseline (Math.random) ⚠️insecure | generate.single.ulid | 731 | 1,368,675 | 703 | 988 |
| python/cpython-uuid | generate.single.uuidv4 | 3,784 | 264,270 | 3,635 | 5,119 |
| python/python-ulid | generate.single.ulid | 7,902 | 126,545 | 7,299 | 12,117 |
| node/ulidx (JS) | generate.single.ulid | 38,962 | 25,666 | 40,103 | 40,116 |
| node/ulid (JS) | generate.single.ulid | 40,111 | 24,931 | 40,568 | 42,170 |

### Category B — bulk generation, n=1,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@rivid/core [native] | generateBytes(n) | 18,287,219 | 0.1 ms | 100 | 0 |
| node/@rivid/core [native] | generateInto(prealloc) | 17,915,689 | 0.1 ms | 100 | 0 |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,311,139 | — | — | — |
| node/@rivid/core [native] | generateMany(n) | 2,826,376 | 0.4 ms | 400 | 0 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,316,486 | 0.8 ms | 800 | 0 |
| python/python-ulid | generate.bulk.ulid | 169,068 | 5.9 ms | 5,915 | — |
| node/ulid (JS) | per-ID call loop | 24,894 | 40 ms | 40,200 | -0.1 |

### Category B — bulk generation, n=10,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,361,619 | — | — | — |
| python/python-ulid | generate.bulk.ulid | 183,126 | 55 ms | 5,461 | — |

### Category B — bulk generation, n=100,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@rivid/core [native] | generateInto(prealloc) | 62,959,328 | 1.6 ms | 16 | 0 |
| node/@rivid/core [native] | generateBytes(n) | 44,810,396 | 2.2 ms | 22 | 8.9 |
| rust/rivid-core [native] | generate.bulk.ulid | 14,417,800 | — | 69 | — |
| node/@rivid/core [native] | generateMany(n) | 6,764,755 | 15 ms | 148 | 1.4 |
| go/oklog/ulid/v2 | generate.bulk.ulid | 5,896,266 | — | — | — |
| node/js-baseline ⚠️insecure | loop + hoisted time | 2,178,285 | 46 ms | 459 | 69.1 |
| python/python-ulid | generate.bulk.ulid | 170,048 | 588 ms | 5,881 | — |
| node/ulid (JS) | per-ID call loop | 24,102 | 4149 ms | 41,491 | 145.3 |

### Category B — bulk generation, n=1,000,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| rust/rivid-core [native] | generate.bulk.ulid | 14,517,837 | — | 69 | — |
| python/uuid-utils [native] | generate.bulk.uuidv7 | 2,485,290 | 402 ms | 402 | — |
| python/python-ulid | generate.bulk.ulid | 166,834 | 5994 ms | 5,994 | — |

### Category F — codec operations

| Language/Library | operation | ns/op | ops/sec |
| --- | --- | --- | --- |
| rust/rivid-core [native] | codec.timeextract.ulid | 8 | 117,934,117 |
| node/js native | codec.compare.native | 12 | 82,971,868 |
| go/oklog/ulid/v2 | codec.decode.ulid | 16 | 61,766,523 |
| go/oklog/ulid/v2 | codec.validate.ulid | 25 | 40,032,026 |
| rust/rivid-core [native] | codec.decode.ulid | 52 | 19,136,858 |
| node/@rivid/core [native] | codec.validate.ulid | 130 | 7,701,900 |
| node/@rivid/core [native] | codec.timeextract.ulid | 136 | 7,329,454 |
| node/@rivid/core [native] | encode.time.ulid | 146 | 6,868,657 |
| node/node builtin | codec.encode.base64url.node | 150 | 6,661,579 |
| node/@rivid/core [native] | encodeCrockford(bytes) | 252 | 3,965,487 |
| node/@rivid/core [native] | codec.encode.ulid | 274 | 3,645,021 |
| node/@rivid/core [native] | encodeBase64Url(bytes) | 283 | 3,534,504 |
| node/@rivid/core [native] | codec.compare.ulid | 302 | 3,310,250 |
| node/ulid (JS) | encode.time.ulid | 317 | 3,153,135 |
| node/@rivid/core [native] | codec.convert.ulid.uuid | 383 | 2,608,349 |
| node/ulid (JS) | codec.timeextract.ulid | 443 | 2,256,143 |
| node/@rivid/core [native] | encodeBase58(bytes) | 546 | 1,830,491 |
| node/@rivid/core [native] | decodeCrockford(str) | 1,612 | 620,464 |
| node/@rivid/core [native] | codec.decode.ulid | 1,620 | 617,148 |
| node/@rivid/core [native] | decodeBase64Url(str) | 1,921 | 520,517 |
| node/@rivid/core [native] | decodeBase58(str) | 1,943 | 514,725 |

### Sorting — 10k ULIDs

| Language/Library | operation | ns/op |
| --- | --- | --- |
| node/js native | sort.ulid.10k.native | 296,387 |
| node/@rivid/core [native] | sort.ulid.10k | 4,614,149 |
| node/@rivid/core [native] | sort.ulid.10k | 5,196,659 |

> Framework noise baseline (`noop`): **73 ns** on this machine.
> Differences smaller than ~2× this value in single-call tables are marked
> _statistically indistinguishable_ rather than claimed as wins.

