# Rivid

**[![npm](https://img.shields.io/npm/v/@rivid/core)](https://www.npmjs.com/package/@rivid/core)**
[![CI](https://github.com/vedantchalke36/rivid/actions/workflows/ci.yml/badge.svg)](https://github.com/vedantchalke36/rivid/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@rivid/core)](https://www.npmjs.com/package/@rivid/core)

<p align="center">
  <img src="public/Rivid.png" alt="Rivid — identifiers, everywhere" width="640">
</p>

**High-performance, cross-language identifier infrastructure.** Rivid generates, encodes,
validates, stores, and governs time-sortable identifiers — ULID, monotonic ULID, UUIDv7,
raw 128-bit — from one Rust engine, with native bindings for Node.js, browsers (WASM),
Python, Go, Java, and Rust.

```bash
npm install @rivid/core
```

```ts
import { ulid } from "@rivid/core";

ulid(); // "01ARZ3NDEKTSV4RRFFQ69G5FAV" — 26 chars, lexicographically sortable
```

---

## Contents

- [Why Rivid?](#why-rivid)
- [Identifiers](#identifiers)
- [Performance](#performance)
- [Usage](#usage)
- [PostgreSQL & ORMs](#postgresql--orms)
- [Languages & ecosystems](#languages--ecosystems)
- [CLI](#cli)
- [Identifier governance](#identifier-governance)
- [Security](#security)
- [Documentation](#documentation)
- [Contributing](#contributing)

## Why Rivid?

Pure-JS identifier libraries spend their time in string allocation, Base32 codec loops, and
per-ID randomness — and random UUIDv4s scatter across B-tree indexes as tables grow. Rivid
moves all of that into a native Rust engine and keeps the identifier layer consistent from
application code down to the database column.

- **Fast where it counts** — single ULIDs in ~120 ns through the Node binding (measured;
  see [Performance](#performance)), bulk binary generation at 45–63 M IDs/s
- **Sortable by construction** — ULID/UUIDv7 embed a 48-bit millisecond timestamp; byte
  order is time order, so B-tree inserts stay localized and `ORDER BY id` approximates
  creation order
- **Drop-in compatible** — same Crockford alphabet, same `isValid`/`encodeTime`/`decodeTime`
  vectors, same `seedTime` semantics as the reference `ulid` package
- **Beyond generation** — binary APIs, Base58/Base64URL/sortable encodings, ULID↔UUID
  reinterpretation, deterministic test fixtures, ORM column types, and schema governance
- **Hardened** — 155 tests across JS and Rust, 9 fuzz targets (~40 M execs), CI matrix over
  Node 18–24 × Linux/macOS/Windows, fuzz-clean total decoders (malformed input throws, never
  panics)

## Identifiers

| Identifier | API | Layout | Sorts by time | Typical use |
|---|---|---|---|---|
| ULID | `ulid()` | 48-bit ms time + 80-bit random | ✅ lexicographic = chronological | Primary keys, public IDs, URLs |
| Monotonic ULID | `monotonicUlid()` | same; increments within a ms | ✅ + strict per-process ordering | Event sourcing, write-heavy keys |
| UUIDv7 | `uuidv7()` | RFC 9562, 48-bit ms time + 74-bit random | ✅ | Standard-facing systems, interop |
| UUIDv4-style random | `ulidBytes()` subsets | 122-bit random, no timestamp | ❌ | Secrets, tokens, idempotency keys |
| Raw 128-bit | `ulidBytes()`, `generateBytes(n)` | 16 bytes big-endian | same as source | Binary columns, wire formats |

**Which one when?** The full decision table — entity IDs vs public API IDs vs event IDs vs
idempotency keys — lives in [docs/identifiers.md](docs/identifiers.md).

A note on **ULID ↔ UUID**: `toUuid()`/`fromUuid()` are a raw reinterpretation of the same
128 bits — nothing is re-encoded. A ULID stored in a PostgreSQL `uuid` column occupies 16
bytes and participates in B-trees natively, but its embedded bits are **not** an
RFC-conformant UUIDv7 (version/variant nibbles are ULID's). It reads back losslessly with
`fromUuid()`. Ordering guarantees are per-identifier-family: lexicographic order equals
timestamp order for IDs from the same family — monotonic ULIDs additionally preserve
generation order within one process. Rivid never claims cross-machine causal ordering.

## Performance

Measured on the committed harness — Intel Core i5-10210U @ 1.60 GHz, Linux x64, Node
v24.19.0, NAPI release build, 2026-08-26. Every number below is reproducible with
`npm run bench`; full methodology, percentile treatment, and the noise floor are documented
in [docs/benchmarking.md](docs/benchmarking.md).

### Single ID generation (Node native binding)

| Operation | Throughput | Latency | vs `ulid` npm |
|---|---:|---:|---:|
| `ulid()` | 8.1 M ops/s | 123 ns (p50 116) | **~326×** |
| `monotonicUlid()` | 6.8 M ops/s | 148 ns | ~3.2× vs `ulidx` mono |
| `uuidv7()` | 5.7 M ops/s | 175 ns | — |
| `ulid` (npm, reference) | 25 K ops/s | 40,111 ns | 1× |

### Bulk generation (100 K IDs per call)

| API | Throughput | Wall time | Notes |
|---|---:|---:|---|
| `generateInto(prealloc)` | 63 M IDs/s | 1.6 ms | writes into caller's buffer |
| `generateBytes(n)` | 45 M IDs/s | 2.2 ms | one contiguous `Uint8Array` |
| `generateMany(n)` | 6.8 M IDs/s | 14.8 ms | `string[]` output |
| `ulid` (npm) per-ID loop | 24 K IDs/s | 4,149 ms | reference |

At one million IDs: `generateMany` finishes in **0.28 s** where the reference loop needs
**~40 s**; the binary APIs do it in **~16–20 ms** — up to ~2,000× faster for bulk *binary*
generation (the multiplier applies to `generateBytes`/`generateInto`, not to string APIs).

The pure Rust core (no binding boundary) generates a single ULID in ~53 ns; the ~70 ns
difference is the NAPI crossing. Each layer is measured separately — Rust core, native
binding, WASM, driver, and ORM overhead are never collapsed into one number. The ORM layer
breakdown (L0 generation → L1 driver → L2 ORM) and the full cross-language matrix
(Rust/Node/Python/Go/Java) are in
[benchmarks/reports/benchmark-report.md](benchmarks/reports/benchmark-report.md).

## Usage

### Generate

```ts
import { ulid, monotonicUlid, uuidv7 } from "@rivid/core";

ulid();                       // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
ulid(1469918176385);          // pin timestamp — migrations/backfills
monotonicUlid();              // strictly increasing within the process
uuidv7();                     // "01942e73-2a1c-7e3b-8f2a-…" (RFC 9562)
```

### Bulk

```ts
import { generateMany, generateBytes, generateInto } from "@rivid/core";

generateMany(1_000_000);          // string[] — all IDs share one batch timestamp
generateBytes(1_000_000);         // Uint8Array (16 MiB) of raw 128-bit IDs
const buf = new Uint8Array(16 * 1_000_000);
generateInto(buf);                // caller-owned allocation, no retained garbage
```

### Binary, codecs, validation

```ts
import {
  ulidBytes, encode, decode, isValid, decodeTime, encodeTime,
  toUuid, fromUuid, encodeBase58, encodeBase64Url,
} from "@rivid/core";

const bytes = ulidBytes();                // 16 bytes, big-endian
encode(decode("01ARZ3NDEKTSV4RRFFQ69G5FAV")); // exact round trip
isValid("01ARZ3NDEKTSV4RRFFQ69G5FAV");    // true (case-insensitive Crockford)
decodeTime("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // 1469922850259
toUuid("01ARZ3NDEKTSV4RRFFQ69G5FAV");     // same 128 bits, hyphenated form
```

### Deterministic test fixtures

```ts
import { UlidGenerator } from "@rivid/core";

const fixture = new UlidGenerator({ seed: 42 }); // reproducible — NOT secure
fixture.next(1_700_000_000_000);                 // same output every run
```

Production paths use an OS-seeded ChaCha12 CSPRNG; deterministic mode is opt-in via
`{ seed }` and isolated from secure generation.

Runnable examples for every pattern above live in [`examples/`](examples).

## PostgreSQL & ORMs

**Recommended: store identifiers in the native `uuid` type (16 bytes).** ULID and UUIDv7
are both 128-bit big-endian values, so either fits `uuid` directly — 34.8% less storage
than `CHAR(26)` and ~38% faster bulk inserts at 10 M rows (see
[docs/databases.md](docs/databases.md) for the full representation matrix):

```ts
import { ulid, toUuid, fromUuid } from "@rivid/core";

const id = ulid();
await db.query("INSERT INTO entities (id, …) VALUES ($1, …)", [toUuid(id)]);
const ulidString = fromUuid((await db.query("SELECT id FROM entities WHERE id = $1", [id])).rows[0].id);
```

Identifier choice affects **index locality, storage width, and pagination** — not raw
INSERT throughput, which is dominated by database/network round trips (generation is
~0.01% of a typical insert). What the data shows: time-ordered keys keep B-tree inserts
localized and make keyset pagination natural.

Official, tested integrations with live-PostgreSQL correctness suites
(CRUD, ordering, keyset pagination, transactions, concurrency):

| Stack | Package / path |
|---|---|
| Drizzle ORM | [`@rivid/drizzle`](packages/drizzle) · suite: [`integrations/drizzle`](integrations/drizzle) |
| Prisma 6 | [`@rivid/prisma`](packages/prisma) · suite: [`integrations/prisma`](integrations/prisma) |
| SQLAlchemy 2.0 | [`rivid` (Python)](packages/python) · suite: [`integrations/sqlalchemy`](integrations/sqlalchemy) |
| SQLx (Rust) | [`integrations/sqlx`](integrations/sqlx) |

Guides: [docs/postgres.md](docs/postgres.md) (schema, BRIN indexes, partitioning) ·
[docs/orm.md](docs/orm.md) (patterns per ORM) · plus focused playbooks for
[microservices](docs/microservices.md), [events](docs/events.md), [queues](docs/queues.md),
[caching](docs/caching.md), [idempotency](docs/idempotency.md), and the
[outbox pattern](docs/outbox-inbox.md).

## Languages & ecosystems

| Target | Package | Install | Status |
|---|---|---|---|
| Node.js / Bun | `@rivid/core` (NAPI-RS) | `npm install @rivid/core` | stable — ESM + CJS, prebuilt binaries for Linux (glibc/musl, x64/arm64), macOS arm64, Windows x64 |
| Browsers / WASM | `@rivid/wasm` | see [docs/wasm.md](docs/wasm.md) | stable — web + Node + bundler builds, 64 KB wasm core |
| Rust | `rivid-core` (this workspace) | path/cargo | stable — the engine everything shares |
| Python | `rivid` (PyO3) | see [packages/python](packages/python) | beta — maturin build, SQLAlchemy types included |
| Go | — | — | not available yet — a rivid Go binding is on the roadmap; see [docs/orm.md](docs/orm.md) for schema patterns |
| Java | `benchmarks/java` (JMH) | Gradle | benchmark suite; bindings on the roadmap |

## CLI

```bash
npx rivid ulid                  # one ULID
npx rivid ulid --count 10       # ten
npx rivid uuidv7 --count 5      # UUIDv7s
npx rivid decode <ulid>         # inspect timestamp + bytes
npx rivid validate <ulid>...    # exit 0 if valid
npx rivid check .               # identifier governance audit (below)
```

## Identifier governance

`rivid check` audits SQL schemas, Prisma models, and Drizzle table definitions for
identifier inconsistencies — UUIDs stored as text, foreign-key/primary-key representation
mismatches, primary-key drift across tables, and unbounded `TEXT` identifiers. Intentional
conventions are declared in a policy file so they are never flagged:

```yaml
# .rivid.yml
rivid:
  database: uuidv7     # expected primary-key family
  public_ids: ulid     # users.id → uuidv7, users.public_id → ulid is fine
  idempotency: random128
  allow:
    - table: legacy_users
      column: id
      reason: "frozen legacy schema"
```

```bash
rivid check            # human-readable report
rivid check --json     # machine-readable
rivid check --strict   # warnings fail the build
```

For pull requests, the composite action at
[`.github/actions/rivid-check`](.github/actions/rivid-check) posts findings as inline
annotations. Exit codes: `0` clean, `1` findings, `2` usage error.

## Security

- **Production randomness**: ChaCha12 CSPRNG, OS-seeded, auto-reseeded — one batch fill
  amortized across many IDs
- **Deterministic mode**: Xoshiro256\*\* via explicit `{ seed }` only — never reachable
  from production paths; for tests and fixtures
- **Total decoders**: malformed input produces errors, never panics — fuzz-enforced
  (~40 M execs across 9 targets)
- **Timestamps are public**: ULID/UUIDv7 embed creation time; use random 128-bit IDs where
  that leaks something sensitive
- Monotonic exhaustion waits for the next millisecond instead of throwing

Full threat model, RNG architecture, and reporting policy:
[SECURITY.md](SECURITY.md).

## Documentation

| Document | Description |
|---|---|
| [docs/identifiers.md](docs/identifiers.md) | Which identifier to use when — decision matrix |
| [docs/databases.md](docs/databases.md) | Storage representations, size & insert benchmarks |
| [docs/postgres.md](docs/postgres.md) | PostgreSQL schema, indexes, partitioning |
| [docs/orm.md](docs/orm.md) | ORM integration architecture per stack |
| [docs/wasm.md](docs/wasm.md) | WASM package — when to use it vs the native binding |
| [docs/benchmarking.md](docs/benchmarking.md) | Benchmark methodology & reproducibility |
| [docs/microservices.md](docs/microservices.md) | Identifier patterns across services |
| [docs/events.md](docs/events.md) | Event-driven architecture |
| [docs/queues.md](docs/queues.md) | Kafka / NATS / RabbitMQ / SQS patterns |
| [docs/caching.md](docs/caching.md) | Cache key design and invalidation |
| [docs/idempotency.md](docs/idempotency.md) | Idempotency key implementation |
| [docs/outbox-inbox.md](docs/outbox-inbox.md) | Transactional outbox pattern |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/development/](docs/development) | Internal engineering reports (baseline data, optimization journals) |

## Contributing

```bash
git clone https://github.com/vedantchalke36/rivid && cd rivid
npm install
npx napi build --platform   # debug native build
npm test                    # 87 JS tests
cargo test -p rivid-core    # 60 Rust tests
npm run lint                # type check
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the development loop, benchmark
protocol, and release process.

## License

[MIT](LICENSE) © 2026 Vedant Chalke
