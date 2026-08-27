# Rivid

**[![npm](https://img.shields.io/npm/v/@rivid/core)](https://www.npmjs.com/package/@rivid/core)**
[![CI](https://github.com/vedantchalke36/rivid/actions/workflows/ci.yml/badge.svg)](https://github.com/vedantchalke36/rivid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@rivid/core)](https://www.nnpmjs.com/package/@rivid/core)

<p align="center">
  <img src="public/Rivid.png" alt="Rivid Logo" width="400">
</p>

<p align="center">
  <img src="public/Works with Image.png" alt="Works with" width="400">
</p>

> **ULIDs at 7 million per second.** Spec-compatible, drop-in replacement for [`ulid`](https://github.com/ulid/javascript) — with the hot paths rewritten in Rust.

```ts
import { ulid } from "@rivid/core";

ulid(); // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

---

## Contents

- [Why Rivid?](#why-rivid)
- [Installation](#installation)
- [Compatibility](#compatibility)
- [Usage](#usage)
- [CLI](#cli)
- [Performance](#performance)
- [Security](#security)
- [Databases & ORMs](#databases--orms)
- [Documentation](#documentation)
- [Development](#development)

## Why Rivid?

Rivid generates the same ULIDs you already know — unique, lexicographically sortable, canonically encoded as a 26-character Crockford Base32 string — but moves string allocation, Base32 encoding, and randomness into a native Rust engine:

- **~310× faster than `ulid` npm for single IDs** — *measured*, not estimated
- **~2,000× faster** for bulk generation — 1 M IDs in **16 ms** instead of 40 seconds
- **Zero setup** — prebuilt binaries for 6 platforms via npm; no Rust toolchain required
- **Drop-in compatible** — same alphabet, same `isValid` / `encodeTime` / `decodeTime` vectors, same `seedTime` semantics
- **Battle-tested** — 147 tests across JS + Rust, 8 fuzz targets, CI matrix over Node 18–24 × Linux/macOS/Windows
- **More than ULIDs** — UUIDv7 (RFC 9562), monotonic mode, binary APIs, Base58/Base64URL encodings, deterministic test fixtures, and a CLI

### Why not plain `ulid` / `uuid`?

Pure-JS ULID libraries spend most of their time in string allocation, Base32 codec loops, and per-ID randomness. And random UUIDv4s scatter across your B-tree index, fragmenting pages as your table grows. Rivid gives you time-ordered IDs your database will love, without giving up throughput to get them.

| | `ulid` (JS) | `rivid` |
|---|---|---|
| 1 M IDs | **40 s** | **0.28 s** (`generateMany`) · **0.02 s** (`generateBytes`) |
| Single call | 38 µs | **126 ns** |
| Randomness | crypto.randomBytes per ID | ChaCha12 batch fills, one syscall-class fill per batch |

*(Full methodology below — every number is reproducible with one command.)*

## Installation

```bash
npm install @rivid/core
```

or

```bash
pnpm add @rivid/core
yarn add @rivid/core
```

The correct native binary is installed automatically for your platform — nothing to compile.

## Compatibility

| Environment | Supported |
|---|---|
| Node.js | v18+ ✅ |
| Bun | ✅ |
| Docker / Alpine (musl) | ✅ |
| Browsers | ❌ use [`ulid`](https://github.com/ulid/javascript) (WASM build under discussion) |

Both **ESM and CommonJS** entry points are provided.

## Usage

### Generate a ULID

```ts
import { ulid } from "@rivid/core";

ulid(); // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

### Seed time

Pass a seed time to pin the timestamp component — useful for migrations and backfills:

```ts
ulid(1469918176385); // "01ARYZ6S41TSV4RRFFQ69G5FAV"
```

### Monotonic ULIDs

Strict ordering within the same millisecond — increments the least-significant random bit instead of replacing it:

```ts
import { monotonicUlid } from "@rivid/core";

monotonicUlid(150000); // "000XAL6S41ACTAV9WEVGEMMVR8"
monotonicUlid(150000); // "000XAL6S41ACTAV9WEVGEMMVR9"
monotonicUlid(150000); // "000XAL6S41ACTAV9WEVGEMMVRA"
// even a lower seed time preserves sort order
monotonicUlid(100000); // "000XAL6S41ACTAV9WEVGEMMVRB"
```

For isolated streams or reproducible test fixtures, use a generator instance:

```ts
import { UlidGenerator } from "@rivid/core";

const gen = new UlidGenerator();
gen.monotonic();

const fixture = new UlidGenerator({ seed: 42 }); // deterministic — NOT secure
fixture.next(1_700_000_000_000);                 // same output every run
```

### Bulk generation

One JavaScript↔Rust crossing per batch — this is where Rivid pulls away from the field:

```ts
import { generateMany, generateBytes, generateInto } from "@rivid/core";

generateMany(1_000_000);          // string[]        — 0.28 s
generateBytes(1_000_000);         // Uint8Array      — 16 MiB of raw 128-bit IDs, 20 ms
const buf = new Uint8Array(16 * 1_000_000);
generateInto(buf);                // zero allocation — 16 ms
```

All IDs in a batch share one captured timestamp — consistent creation instant, no per-ID clock reads.

### Binary round trips

ULIDs are natively 128-bit values; the string is just a presentation:

```ts
import { ulidBytes, encode, decode } from "@rivid/core";

const bytes = ulidBytes();  // Uint8Array(16), big-endian
encode(bytes);              // 26-char canonical ULID
decode("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // back to 16 bytes
```

### Validity & timestamps

```ts
import { isValid, decodeTime, encodeTime, compare } from "@rivid/core";

isValid("01ARZ3NDEKTSV4RRFFQ69G5FAV");    // true
isValid("01ARZ3NDEKTSV4RRFFQ69G5FA");     // false
decodeTime("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // 1469922850259
encodeTime(1469918176385);                // "01ARYZ6S41"
compare(a, b);                            // -1 | 0 | 1 — case-insensitive
```

### UUIDv7

RFC 9562 time-ordered UUIDs from the same engine — plus lossless ULID ↔ UUID conversion:

```ts
import { uuidv7, generateUuidV7Many, toUuid, fromUuid } from "@rivid/core";

uuidv7();                    // "01942e73-2a1c-7e3b-8f2a-..."
generateUuidV7Many(100_000); // bulk, same amortization
toUuid("01ARZ3NDEKTSV4RRFFQ69G5FAV");
// "01563E3A-B5D3-D676-4C61-EFB99302BD5B"
```

### Alternative encodings

Compact representations of the underlying 128 bits when 26 characters is more than you need:

```ts
import { encodeBase58, encodeBase64Url, encodeSortable } from "@rivid/core";
```

## CLI

Generate IDs straight from your terminal:

```bash
npx rivid ulid                  # one ULID
npx rivid ulid --count 10       # ten
npx rivid uuidv7 --count 5      # UUIDv7s
npx rivid decode <ulid>         # inspect timestamp + bytes
npx rivid validate <ulid>...    # exit 0 if valid
```

## Performance

Everything below was produced by the committed harness on:

```
CPU: Intel Core i5-10210U @ 1.60GHz · Linux x64 · Node v24.19.0 · napi release build
```

Reproduce yourself: `npm run bench` (results persist to `benchmarks/results/latest.json`).

### Single ID generation

```
@rivid/core ulid()            x 7,900,000 ops/sec   (126 ns · p50 117 ns)
@rivid/core monotonicUlid()   x 7,000,000 ops/sec   (144 ns · p99 184 ns)
@rivid/core uuidv7()          x 5,800,000 ops/sec   (171 ns · p99 292 ns)
ulidx monotonicFactory()      x 2,200,000 ops/sec   (460 ns/op)
js-baseline (Math.random)     x 1,500,000 ops/sec   (660 ns/op)
ulid (npm)                    x    26,000 ops/sec   (38,300 ns/op)
```

> **310× the reference implementation** on identical hardware — and the baseline isn't even slow by JS standards.

### Bulk generation

| Count | `generateMany` | `generateBytes` | `generateInto` | `ulid` (JS) loop |
|---:|---:|---:|---:|---:|
| 1 K | 4.6 M/s | 53 M/s | **57 M/s** | 22 K/s |
| 100 K | 4.2 M/s | 49 M/s | **51 M/s** | 25 K/s |
| 1 M | 3.5 M/s | 50 M/s | **62 M/s** | 25 K/s |
| 10 M | 2.7 M/s | 55 M/s | **60 M/s** | — |

At one million IDs: `generateMany` finishes in **282 ms** where the reference loop needs **40 s**. The binary APIs do it in **under 20 ms** with zero retained garbage.

### Where the time actually goes

We instrumented the whole stack, so you don't have to guess:

| Path | Cost |
|---|---:|
| Pure Rust engine (direct) | ~40 ns |
| + NAPI boundary round-trip | 24 ns |
| + JS string materialization | ≈ 140 ns total |
| PostgreSQL INSERT round trip | ≈ 1,184 µs |

An ULID costs **0.01% of a typical database insert**. Your bottleneck was never ID generation — but now it definitely isn't.

<details>
<summary><strong>Utility & codec benchmarks</strong></summary>

| Operation | Throughput | Per-op |
|---|---:|---:|
| `isValid(id)` | 9.1 M ops/s | 110 ns |
| `decodeTime(id)` | 8.7 M ops/s | 115 ns |
| `encodeTime(now)` | 6.1 M ops/s | 164 ns |
| `compare(a, b)` | 3.7 M ops/s | 272 ns |
| `decode(id)` → bytes | 665 K ops/s | 1.5 µs |
| Crockford encode / decode | 3.7 M / 636 K | 267 ns / 1.6 µs |
| Base58 encode / decode | 1.9 M / 518 K | 525 ns / 1.9 µs |
| Base64URL encode / decode | 3.7 M / 560 K | 268 ns / 1.8 µs |

Engineering note: a Rust-side sort was prototyped, measured **60× slower** than V8's TimSort through the boundary, and deliberately not shipped. `sort()` delegates to the JS engine; only mixed-case inputs route through validating `compare`.

</details>

<details>
<summary><strong>PostgreSQL storage representation benchmarks</strong></summary>

Benchmarked against PostgreSQL 16.4 with 10M rows:

| Representation | rows/sec | Storage (10M) | Point Lookup avg |
|---------------|---------:|--------------:|----------------:|
| ULID as native uuid | 117,451 | 1,226 MB | 331 µs |
| ULID as BYTEA | 101,095 | 1,420 MB | 284 µs |
| UUIDv7 as native uuid | 93,193 | 1,222 MB | 353 µs |
| ULID as VARCHAR(26) | 75,936 | 1,651 MB | 412 µs |
| UUIDv7 as CHAR(36) | 74,870 | 1,869 MB | 364 µs |
| ULID as CHAR(26) | 72,969 | 1,647 MB | 368 µs |

**Key finding**: ULID and UUID share the same 128-bit binary layout. Storing a ULID as native `uuid` uses **16 bytes** (same as UUID), eliminating the 34.8% storage penalty of CHAR(26).

</details>

## Security

| Mode | RNG | Intended use |
|---|---|---|
| Default | ChaCha12 CSPRNG, OS-seeded & auto-reseeded (`rand::rng()`) | Production — globally unique, unguessable |
| `{ seed: n }` opt-in | Xoshiro256\*\* via SplitMix64 | Tests & fixtures only — **never** security-sensitive |

- Monotonic exhaustion waits for the next millisecond instead of throwing (reference lib throws).
- All decoders are total: malformed input produces errors, never panics.
- Property `decode(encode(x)) == x` holds for every codec — enforced by fuzzing (~40 M execs across 8 targets).
- Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Databases & ORMs

Tested integration recipes with automated correctness suites against PostgreSQL 16 — CRUD, insertion-order indexing, keyset pagination, transaction rollbacks, collision-free concurrency:

| Stack | Recipe |
|---|---|
| Drizzle ORM | [`integrations/drizzle`](integrations/drizzle) |
| Prisma 6 | [`integrations/prisma`](integrations/prisma) |
| SQLAlchemy 2.0 | [`integrations/sqlalchemy`](integrations/sqlalchemy) |
| SQLx (Rust — same engine) | [`integrations/sqlx`](integrations/sqlx) |
| Go (`database/sql`, GORM) | [`integrations/go-databasesql`](integrations/go-databasesql) · [`integrations/go-gorm`](integrations/go-gorm) |

### Recommended: Store as native `uuid`

```sql
-- Application generates ULID, converts to UUID for storage
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    -- ...
);
```

```typescript
import { ulid, toUuid, fromUuid } from '@rivid/core';

// Generate and store
const id = ulid();
const uuid = toUuid(id);
await db.query('INSERT INTO entities (id, ...) VALUES ($1, ...)', [uuid]);

// Retrieve and convert back
const row = await db.query('SELECT id FROM entities WHERE id = $1', [uuid]);
const ulidString = fromUuid(row.id);
```

This provides:
- **16-byte storage** (same as native UUID)
- **Fastest insert performance** (117K rows/sec at 10M rows)
- **Zero-cost conversion** between ULID string and UUID
- **Native PostgreSQL UUID type** benefits

## Documentation

| Document | Description |
|----------|-------------|
| [IDENTIFIER_MATRIX.md](IDENTIFIER_MATRIX.md) | Identifier selection guide — which ID to use when |
| [DATABASE.md](DATABASE.md) | Database representation guide — storage, performance, migration |
| [POSTGRES.md](POSTGRES.md) | PostgreSQL-specific guidance — schema, indexes, partitioning |
| [ORM.md](ORM.md) | ORM integration architecture — Drizzle, Prisma, SQLx, SQLAlchemy, GORM |
| [MICROSERVICES.md](MICROSERVICES.md) | Microservices identifier patterns |
| [EVENTS.md](EVENTS.md) | Event-driven architecture guide |
| [QUEUES.md](QUEUES.md) | Queue integration patterns — Kafka, NATS, RabbitMQ, SQS |
| [CACHING.md](CACHING.md) | Cache key design and invalidation patterns |
| [IDEMPOTENCY.md](IDEMPOTENCY.md) | Idempotency key implementation |
| [OUTBOX_INBOX.md](OUTBOX_INBOX.md) | Transactional outbox pattern |
| [SECURITY.md](SECURITY.md) | Security guide — threat model, RNG, timing attacks |
| [BENCHMARK_METHODOLOGY.md](BENCHMARK_METHODOLOGY.md) | Benchmark measurement methodology |
| [PERFORMANCE_OPTIMIZATION_REPORT.md](PERFORMANCE_OPTIMIZATION_REPORT.md) | Performance optimization before/after results |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Performance baseline with variance analysis |

## Development

```bash
git clone https://github.com/vedantchalke36/rivid && cd rivid
npm install
npx napi build --platform        # debug native build
npm test                         # 87 JS tests
cargo test -p rivid-core         # 60 Rust tests
npm run lint                     # type check
npm run bench --quick            # benchmark smoke
./bench.sh                       # cross-language suite
```

Layout: [`crates/core`](crates/core) (pure Rust engine) · [`src/lib.rs`](src/lib.rs) (NAPI bindings) · [`src/*.ts`](src) (public API) · [`cli`](cli) · [`fuzz`](fuzz) · [`docs`](docs).

Full API surface: see [`index.d.ts`](index.d.ts) and [`examples/`](examples). Release history: [CHANGELOG](docs/CHANGELOG.md). Contributing: [CONTRIBUTING](docs/CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Vedant Chalke
