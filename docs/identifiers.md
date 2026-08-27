# Identifier Matrix — Rivid

## Classification

| Class | Meaning |
|-------|---------|
| **CORE** | Implemented in `rivid-core`. Primary use cases. Actively maintained. |
| **OPTIONAL** | Supported via encoding/conversion helpers. Not a primary generation target. |
| **EXPERIMENTAL** | Investigated; not implemented unless benchmark demonstrates clear advantage. |
| **NOT RECOMMENDED** | Documented why Rivid does not implement. |

---

## CORE Identifiers

### UUIDv7 (RFC 9562) — `uuidv7()`

| Property | Value |
|----------|-------|
| Bit width | 128 |
| Textual representation | `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx` (36 chars) |
| Binary representation | 16 bytes, big-endian |
| Sortable | Yes (lexicographic == chronological) |
| Monotonic | Yes (within same ms via random bits; monotonic variant available) |
| Timestamp | 48-bit millisecond Unix epoch |
| Sub-second precision | **Nanosecond possible** — RFC 9562 §6.2 permits encoding sub-ms in random bits |
| Entropy | 74–86 bits (depending on sub-second allocation) |
| Collision resistance | 2^122+ (birthday bound: ~2^61 for 1B IDs) |
| Distributed generation | Yes (no coordination required) |
| Clock sensitivity | Millisecond granularity; sub-ms precision optional |
| Storage (PostgreSQL) | Native `uuid` type — 16 bytes |
| Storage (text) | 36 chars |
| ORM compatibility | Universal — every ORM supports UUID |
| Indexing | B-tree optimal on native `uuid`; time-range queries efficient |
| Queue suitability | Excellent — time-sortable, compact binary |
| Event-stream suitability | Excellent — time-ordered, globally unique |
| Cache suitability | Good — 16-byte binary key |
| URL/API suitability | Good — standard hyphenated form |
| Human usability | Moderate — hyphens help visual scanning |
| Generation performance | 87 ns/op (Rust), 165 ns/op (Node NAPI) |
| Decode performance | 52 ns/op (Rust) |

**Why CORE**: The modern standard. Native PostgreSQL UUID type. RFC-compliant. Sub-second precision for nanosecond/microsecond use cases. Supersedes UUIDv4 for all new systems.

**Nanosecond precision**: RFC 9562 §6.2 allows encoding sub-second precision in the random component. A UUIDv7 can carry 30+ bits of nanosecond fractional time while remaining sortable and collision-resistant. This makes it suitable for:
- High-frequency trading event ordering
- Distributed tracing with sub-ms correlation
- Scientific data pipelines
- Log correlation across services

### ULID — `ulid()`

| Property | Value |
|----------|-------|
| Bit width | 128 |
| Textual representation | 26-char Crockford Base32 |
| Binary representation | 16 bytes, big-endian |
| Sortable | Yes (lexicographic == chronological) |
| Monotonic | Yes (monotonic variant available) |
| Timestamp | 48-bit millisecond Unix epoch |
| Sub-second precision | No (millisecond only per spec) |
| Entropy | 80 bits |
| Collision resistance | 2^80 per millisecond |
| Distributed generation | Yes (no coordination required) |
| Clock sensitivity | Millisecond |
| Storage (PostgreSQL) | 26 bytes as `CHAR(26)` or `VARCHAR(26)`, or native `uuid` via reinterpretation |
| Storage (binary) | 16 bytes (identical layout to UUID) |
| ORM compatibility | Good — as string or via UUID reinterpretation |
| Indexing | Good on `CHAR(26)` (fixed-length); B-tree sortable |
| Queue suitability | Good — compact text, time-sorted |
| Event-stream suitability | Good — time-ordered |
| Cache suitability | Good — 26-char text key |
| URL/API suitability | Excellent — no hyphens, URL-safe alphabet |
| Human usability | Good — no ambiguous chars (I,L,O,U excluded) |
| Generation performance | 54 ns/op (Rust), 132 ns/op (Node NAPI) |
| Decode performance | 51 ns/op (Rust), 1520 ns/op (Node — mitigated by `decode_into`) |

**Why CORE**: Lexicographically sortable without hyphens. Crockford Base32 is human-friendly. 80 bits of entropy (vs UUIDv7's 74–86). Mature ecosystem. Binary layout identical to UUID — zero-cost conversion.

**Key advantage over UUIDv7**: 80-bit randomness (vs 74–86 for UUIDv7 with sub-ms). Simpler text format (no hyphens). Better for URL slugs and human-readable IDs.

**Trade-off vs UUIDv7**: No native PostgreSQL `uuid` type — requires `CHAR(26)` or binary reinterpretation. No RFC standardization. No sub-second precision in spec.

### Monotonic ULID — `monotonicUlid()`

| Property | Value |
|----------|-------|
| Same as ULID | All ULID properties apply |
| Monotonic | Strictly increasing within a process (same-ms increment) |
| Overflow | Spins until next millisecond (probability ~2^-80 per ms) |

**Why CORE**: Critical for event ordering, database primary keys, and event sourcing where insertion order must be preserved within a process. Without monotonicity, same-millisecond IDs may sort incorrectly.

### Random 128-bit — `ulidBytes()` / `uuidv7Bytes()` (binary APIs)

| Property | Value |
|----------|-------|
| Bit width | 128 |
| Format | Raw 16 bytes |
| Sortable | Depends on generation method |
| Timestamp | Depends on generation method |

**Why CORE**: Binary APIs are essential for:
- Database `BYTEA` / binary column storage
- Binary protocol serialization (Protobuf, Avro)
- Zero-copy interop between services
- Binary key lookups in Redis/KeyDB

---

## OPTIONAL Identifiers

### UUIDv4 — `uuidv7()` with random-only layout

| Property | Value |
|----------|-------|
| Bit width | 128 |
| Textual representation | 36-char hyphenated hex |
| Sortable | No |
| Timestamp | None |
| Entropy | 122 bits |
| Storage (PostgreSQL) | Native `uuid` — 16 bytes |
| Generation performance | ~87 ns/op (same as UUIDv7 with random bits) |

**Why OPTIONAL**: UUIDv4 is still widely used in existing systems. Rivid generates it as UUIDv7 with the timestamp zeroed (or by using only the random component). For new systems, prefer UUIDv7.

### Compact Sortable — `encodeSortable()` / `decodeSortable()`

| Property | Value |
|----------|-------|
| Bit width | 128 |
| Textual representation | 22-char URL-safe Base64 variant |
| Sortable | Yes (lexicographic == numeric) |
| URL-safe | Yes |
| Standard | No (project-specific) |

**Why OPTIONAL**: 22 chars vs ULID's 26. Useful for URL shortening and compact API responses. Not standard — requires both writer and reader to use Rivid.

---

## EXPERIMENTAL Identifiers

### Snowflake-style (64-bit)

| Property | Value |
|----------|-------|
| Bit width | 64 |
| Components | 41-bit timestamp + 5-bit datacenter + 5-bit worker + 12-bit sequence |
| Sortable | Yes |
| Timestamp | 41-bit millisecond |
| Throughput per worker | 4096 IDs/ms |
| Requires coordination | Yes (worker ID assignment) |

**Status**: Investigated but not implemented.

**Assessment**: 64-bit is attractive for storage efficiency (fits in `BIGINT`), but requires worker/node ID coordination — a significant operational burden. UUIDv7 at 128 bits provides equivalent time-sortability without coordination. The 64-bit advantage is mainly for MySQL `BIGINT` primary keys; PostgreSQL handles `uuid` efficiently.

**When Snowflake makes sense**: When you need `BIGINT` primary keys for MySQL compatibility and have existing worker-ID infrastructure (ZooKeeper, etcd). Not recommended for new PostgreSQL-based systems.

### KSUID (Segment)

| Property | Value |
|----------|-------|
| Bit width | 160 |
| Textual representation | 27-char Base62 |
| Timestamp | 32-bit second-precision |
| Epoch | Custom (2014-05-13) |

**Status**: Investigated but not implemented.

**Assessment**: 160 bits (vs 128 for ULID/UUID). Second-precision (vs millisecond for ULID/UUID). Base62 is URL-safe but not standard. ULID provides better precision and smaller representation. KSUID's main advantage was arriving before ULID/UUIDv7; that advantage no longer exists.

### ObjectId (MongoDB)

| Property | Value |
|----------|-------|
| Bit width | 96 |
| Textual representation | 24-char hex |
| Timestamp | 4-byte second-precision |
| Components | timestamp + machine ID + process ID + counter |

**Status**: Not implemented.

**Assessment**: MongoDB-specific. 96 bits. Second-precision. Requires machine+process coordination. No advantage over ULID/UUIDv7 for non-MongoDB systems. If using MongoDB, their native ObjectId is the right choice.

### CUID / CUID2

| Property | Value |
|----------|-------|
| Bit width | 128 (CUID2) |
| Timestamp | None (CUID2 is random-only) |
| Sortable | No |
| Collision resistance | Good |

**Status**: Not implemented.

**Assessment**: No timestamp, no sortability. Slower generation than ULID. CUID2 is essentially a random 128-bit value with a specific construction — ULID provides the same guarantees with better performance and time-sortability.

### NanoID

| Property | Value |
|----------|-------|
| Bit width | Variable (configurable) |
| Alphabet | Configurable |
| Timestamp | None |
| Sortable | No |

**Status**: Not implemented.

**Assessment**: Variable length is a feature for URL shorteners, but a liability for database schemas and fixed-width indexes. No timestamp. Collision risk increases with shorter lengths. For URL shortening, use ULID or compact sortable. For database IDs, use UUIDv7 or ULID.

### XID

| Property | Value |
|----------|-------|
| Bit width | 96 |
| Textual representation | 20-char Base58 |
| Timestamp | 4-byte second-precision |
| Components | timestamp + machine ID + process ID + counter |

**Status**: Not implemented.

**Assessment**: Similar to ObjectId but with Base58 encoding. 96 bits. Second-precision. Requires machine+process coordination. No advantage over ULID (128-bit, millisecond, no coordination).

### Sonyflake

| Property | Value |
|----------|-------|
| Bit width | 63 (usable) |
| Timestamp | 39-bit 10ms-precision |
| Components | timestamp + machine ID + sequence |

**Status**: Not implemented.

**Assessment**: 10ms precision is insufficient for modern distributed systems. Requires machine ID. Sony ecosystem specific. No advantage over UUIDv7 or ULID.

---

## NOT RECOMMENDED

### UUIDv1 / UUIDv6

| Property | Value |
|----------|-------|
| Reason | MAC address leakage, complex bit layout, superseded by UUIDv7 |

**Why not**: UUIDv1 leaks MAC addresses. UUIDv6 reorders v1 bits for sortability but inherits the same problems. UUIDv7 provides the same benefits without MAC leakage.

### UUIDv3 / UUIDv5 (Name-based)

| Property | Value |
|----------|-------|
| Reason | Deterministic (same input → same output), not suitable for entity IDs |

**Why not**: Useful for namespace-based ID derivation (DNS, URLs), but not for generating unique entity IDs. Rivid's core use case is generation, not derivation.

### Auto-increment integers

| Property | Value |
|----------|-------|
| Reason | Requires centralized coordination, not distributed-safe |

**Why not**: Database auto-increment is fine for single-database systems but breaks in distributed/multi-primary setups. If you need distributed IDs, use UUIDv7 or ULID.

### Short random strings (e.g., 8-char alphanumeric)

| Property | Value |
|----------|-------|
| Reason | Collision probability too high at scale, no timestamp |

**Why not**: An 8-character alphanumeric string has ~2.8 × 10^14 possible values. At 1M IDs/sec, collision probability exceeds 1% within minutes. Use ULID or UUIDv7 for any system that scales.

---

## Selection Guide

| Need | Use |
|------|-----|
| Native PostgreSQL UUID | `uuidv7()` |
| Sortable textual IDs | `ulid()` |
| Monotonic ordering within a process | `monotonicUlid()` |
| Compact binary representation | `ulidBytes()` / `uuidv7Bytes()` |
| Idempotency key | `ulidBytes()` (random component) |
| URL slug | `ulid()` (no hyphens, URL-safe) |
| Event sourcing primary key | `monotonicUlid()` |
| Cross-service correlation | `uuidv7()` (standard format) |
| High-frequency sub-ms ordering | `uuidv7()` with nanosecond precision |
| Database `BIGINT` compatibility | Snowflake-style (not in Rivid core — use external library) |
| Maximum entropy (122 bits) | `ulid()` (80-bit random) or `uuidv7()` (74–86 bits) |
| Existing UUIDv4 systems | `uuidv7()` (binary-compatible) |

---

## Timestamp Precision

Rivid supports multiple precision levels:

| Precision | Identifier | Implementation |
|-----------|-----------|----------------|
| Millisecond (default) | ULID, UUIDv7 | Standard generation |
| Microsecond | UUIDv7 | Sub-second encoding per RFC 9562 §6.2 |
| Nanosecond | UUIDv7 | Sub-second encoding per RFC 9562 §6.2 |

**Recommendation**: Use millisecond precision by default. Use nanosecond/microsecond only when:
1. You have a verified high-precision clock source
2. You need sub-ms event ordering
3. You can tolerate the reduced random-entropy budget

PostgreSQL stores `timestamp(6)` with microsecond precision natively. For nanosecond precision, store as `BIGINT` (nanoseconds since epoch) alongside the UUID/ULID.
