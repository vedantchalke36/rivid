# Cross-Language Benchmark Report — 2026-08-23

Environment and pinned versions: see platform-matrix.json alongside this file.
Security column: all entries are CSP-seeded unless marked ⚠️. `[native]` =
Rust/C-backed implementation. Categories follow spec/workloads.json.

### Category A — single string generation

| Language/Library | op | ns/op | ops/sec | p50 | p99 |
| --- | --- | --- | --- | --- | --- |
| rust/fast-id-core [native] | generate.single.ulid | 59 | 17,081,696 | — | — |
| node/@fast-id/core [native] | generate.single.ulid | 143 | 7,010,721 | 138 | 204 |
| node/@fast-id/core [native] | generate.single.ulid-mono | 168 | 5,935,739 | 154 | 270 |
| go/google/uuid | generate.single.uuidv4 | 174 | 5,763,689 | — | — |
| go/google/uuid | generate.single.uuidv7 | 180 | 5,555,556 | — | — |
| go/oklog/ulid/v2 | generate.single.ulid | 195 | 5,141,388 | — | — |
| node/@fast-id/core [native] | generate.single.uuidv7 | 208 | 4,804,280 | 195 | 326 |
| node/@fast-id/core [native] | generate.single.ulid | 243 | 4,122,451 | 236 | 313 |
| python/uuid-utils [native] | generate.single.uuidv4 | 404 | 2,477,204 | 403 | 625 |
| python/uuid-utils [native] | generate.single.uuidv7 | 479 | 2,088,115 | 434 | 759 |
| node/ulidx (JS) | generate.single.ulid-mono | 574 | 1,741,968 | 530 | 1,017 |
| node/ulid (JS) | generate.single.ulid-mono | 650 | 1,537,577 | 617 | 1,093 |
| node/js-baseline (Math.random) ⚠️insecure | generate.single.ulid | 813 | 1,229,513 | 786 | 1,263 |
| python/cpython-uuid | generate.single.uuidv4 | 3,640 | 274,713 | 3,362 | 5,574 |
| python/python-ulid | generate.single.ulid | 6,843 | 146,131 | 6,425 | 10,317 |
| node/ulid (JS) | generate.single.ulid | 44,167 | 22,641 | 45,308 | 47,220 |
| node/ulidx (JS) | generate.single.ulid | 47,318 | 21,134 | 47,211 | 55,176 |

### Category B — bulk generation, n=1,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateInto(prealloc) | 16,306,297 | 0.1 ms | 100 | 0 |
| node/@fast-id/core [native] | generateBytes(n) | 12,418,195 | 0.1 ms | 100 | 0 |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,816,261 | — | — | — |
| node/@fast-id/core [native] | generateMany(n) | 4,946,039 | 0.2 ms | 200 | 0 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 735,548 | 1.4 ms | 1,400 | 0 |
| python/python-ulid | generate.bulk.ulid | 181,694 | 5.5 ms | 5,504 | — |
| node/ulid (JS) | per-ID call loop | 20,307 | 49 ms | 49,200 | 0.1 |

### Category B — bulk generation, n=10,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,682,763 | — | — | — |
| python/python-ulid | generate.bulk.ulid | 160,598 | 62 ms | 6,227 | — |

### Category B — bulk generation, n=100,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateInto(prealloc) | 57,839,844 | 1.7 ms | 17 | 0 |
| node/@fast-id/core [native] | generateBytes(n) | 37,718,996 | 2.7 ms | 27 | 9 |
| rust/fast-id-core [native] | generate.bulk.ulid | 10,924,486 | — | 92 | — |
| go/oklog/ulid/v2 | generate.bulk.ulid | 6,420,388 | — | — | — |
| node/@fast-id/core [native] | generateMany(n) | 5,087,513 | 20 ms | 197 | 1.3 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,595,059 | 63 ms | 627 | 68.6 |
| python/python-ulid | generate.bulk.ulid | 157,596 | 635 ms | 6,345 | — |
| node/ulid (JS) | per-ID call loop | 20,859 | 4794 ms | 47,941 | 146.3 |

### Category B — bulk generation, n=1,000,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateInto(prealloc) | 58,416,029 | 17 ms | 17 | 0 |
| node/@fast-id/core [native] | generateBytes(n) | 38,130,773 | 26 ms | 26 | 53.3 |
| rust/fast-id-core [native] | generate.bulk.ulid | 11,557,412 | — | 87 | — |
| node/@fast-id/core [native] | generateMany(n) | 5,721,257 | 175 ms | 175 | 0.2 |
| python/uuid-utils [native] | generate.bulk.uuidv7 | 2,306,437 | 434 ms | 434 | — |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,366,999 | 732 ms | 732 | 169.9 |
| python/python-ulid | generate.bulk.ulid | 160,763 | 6220 ms | 6,220 | — |
| node/ulid (JS) | per-ID call loop | 19,333 | 51724 ms | 51,724 | 10.1 |

### Category B — bulk generation, n=10,000,000

| Language/Library | API/method | IDs/sec | ms | ns/ID | RSS Δ MB |
| --- | --- | --- | --- | --- | --- |
| node/@fast-id/core [native] | generateInto(prealloc) | 47,286,160 | 212 ms | 21 | -0.1 |
| node/@fast-id/core [native] | generateBytes(n) | 36,035,492 | 278 ms | 28 | 152.6 |
| node/@fast-id/core [native] | generateMany(n) | 2,277,160 | 4391 ms | 439 | 278.3 |
| node/js-baseline ⚠️insecure | loop + hoisted time | 1,340,973 | 7457 ms | 746 | 1378.1 |

### Category F — codec operations

| Language/Library | operation | ns/op | ops/sec |
| --- | --- | --- | --- |
| rust/fast-id-core [native] | codec.timeextract.ulid | 9 | 114,654,251 |
| go/oklog/ulid/v2 | codec.decode.ulid | 15 | 65,919,578 |
| node/js native | codec.compare.native | 17 | 60,494,830 |
| go/oklog/ulid/v2 | codec.validate.ulid | 27 | 36,954,915 |
| rust/fast-id-core [native] | codec.decode.ulid | 58 | 17,222,949 |
| node/@fast-id/core [native] | codec.validate.ulid | 104 | 9,660,772 |
| node/@fast-id/core [native] | codec.timeextract.ulid | 113 | 8,848,026 |
| node/@fast-id/core [native] | encode.time.ulid | 152 | 6,597,596 |
| node/node builtin | codec.encode.base64url.node | 236 | 4,237,124 |
| node/@fast-id/core [native] | codec.compare.ulid | 273 | 3,660,210 |
| node/ulid (JS) | encode.time.ulid | 292 | 3,421,474 |
| node/@fast-id/core [native] | encodeBase64Url(bytes) | 396 | 2,525,109 |
| node/@fast-id/core [native] | encodeCrockford(bytes) | 417 | 2,395,777 |
| node/ulid (JS) | codec.timeextract.ulid | 430 | 2,323,356 |
| node/@fast-id/core [native] | codec.convert.ulid.uuid | 511 | 1,956,912 |
| node/@fast-id/core [native] | codec.encode.ulid | 645 | 1,550,785 |
| node/@fast-id/core [native] | encodeBase58(bytes) | 701 | 1,425,957 |
| node/@fast-id/core [native] | codec.decode.ulid | 2,120 | 471,627 |
| node/@fast-id/core [native] | decodeCrockford(str) | 2,328 | 429,503 |
| node/@fast-id/core [native] | decodeBase58(str) | 2,574 | 388,479 |
| node/@fast-id/core [native] | decodeBase64Url(str) | 2,996 | 333,795 |

### Sorting — 10k ULIDs

| Language/Library | operation | ns/op |
| --- | --- | --- |
| node/js native | sort.ulid.10k.native | 312,491 |
| node/@fast-id/core [native] | sort.ulid.10k | 5,382,960 |
| node/@fast-id/core [native] | sort.ulid.10k | 6,188,744 |

> Framework noise baseline (`noop`): **58 ns** on this machine.
> Differences smaller than ~2× this value in single-call tables are marked
> _statistically indistinguishable_ rather than claimed as wins.

