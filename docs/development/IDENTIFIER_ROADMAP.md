# Identifier Expansion Plan — KSUID Completion and Beyond

Status: Draft
Date: 2026-11-02
Baseline: `main` @ `3751959` (`feat: add KSUID support and benchmark suite`)
Owner: Vedant Chalke

## Objective

Turn KSUID from a Rust/Node primitive into a complete format across CLI,
WASM, Python, ORM/schema governance, and benchmarking. Then add the next
high-value identifier formats that build on the same Rust engine.

The goal is not "more formats for the sake of it." Each addition must improve
one of:

1. Interoperability with an established identifier ecosystem.
2. Storage or ordering behavior for a real database design.
3. Identifier governance across services and schemas.
4. Reproducible performance evidence against a conventional implementation.

## Principles

- **One engine, thin bindings.** Identifier logic lives in `rivid-core`;
  NAPI, WASM, and Python only convert values and errors.
- **Spec fidelity first.** Standard formats match their reference vectors.
  Rivid-specific extensions are named and documented as extensions.
- **Benchmark every format.** Use the existing harness, separate layers, and
  compare full operations (generation + string encoding), not partial work.
- **Storage is part of the feature.** A format is not complete until its
  PostgreSQL/ORM representation and validation path are documented and tested.
- **No cross-machine causal ordering.** Sortability is per identifier family,
  not a distributed ordering guarantee.
- **Additive API surface.** New exports are additive unless a major version
  intentionally removes something.

## Shipped Baseline

KSUID is already available from the Rust core and Node.js binding:

- `crates/core/src/ksuid.rs`: 20-byte wire format, base62 codec, generation,
  validation, timestamp extraction, comparison, batch fills.
- `src/lib.rs`: NAPI bindings and Latin1 string fast path.
- `src/ksuid.ts`: public Node API, constants, and `sortKsuid`.
- `__test__/ksuid.test.mts`: reference vectors and compatibility tests against
  the `ksuid` npm package.
- `npm run bench:ksuid`: dedicated benchmark suite.

Current reference numbers (2026-11-02, Intel i5-10210U, Node 24, release build):

| Operation | Rivid | `ksuid` npm |
|---|---:|---:|
| Single string | 335 ns / 3.0M ops/s | 15,300 ns / 65K ops/s |
| Bulk strings, 100K | 39 ms / 2.5M IDs/s | ~1.3 s / 75K IDs/s |
| Bulk bytes, 1M | 16 ms / 62M IDs/s | not comparable (no binary API) |
| Preallocated bytes, 1M | 12 ms / 82M IDs/s | not comparable |

WASM and Python currently expose ULID and UUIDv7 only. The CLI and schema
governance paths do not yet understand KSUID.

---

## Priority Summary

| Priority | Workstream | Why | Effort |
|---|---|---|---|
| P0 | KSUID CLI + auto-detect | Completes the developer workflow | S |
| P0 | KSUID in WASM and Python | Makes the cross-language claim accurate | S–M |
| P0 | KSUID ORM/PostgreSQL support and `rivid check` | Storage + governance are the differentiator | M |
| P1 | KSUID deterministic helpers and fuzzing | Fixtures, migrations, and decoder hardening | S |
| P1 | Cross-language KSUID benchmarks | Credible comparison beyond one JS package | M |
| P1 | TypeID | Type-prefixed UUIDv7 with strong API fit | M |
| P2 | ObjectId and UUIDv4 | Interop and compatibility | S–M |
| P2 | Snowflake / 64-bit | `BIGINT` and MySQL use cases, but needs coordination | M–L |
| P3 | Timeflake / XID | Niche interop; parse/encode first | S–M |
| P3 | Tooling: inspect, migrate, regression gates | Compounds the identifier layer | M |

S = days, M = 1–2 weeks, L = multi-week.

---

## Milestone 1 — KSUID Parity

Target: every surface that supports ULID/UUIDv7 also supports KSUID, and the
schema tools understand KSUID storage choices.

### 1.1 CLI

Working commands:

```bash
npx rivid ksuid                    # one KSUID
npx rivid ksuid --count 10         # ten
npx rivid decode <ksuid>           # timestamp + 20-byte payload
npx rivid validate <ksuid>         # exit 0 if valid
```

Implementation notes:

- Add `ksuid` command alongside `ulid` and `uuidv7`.
- Extend `decode`/`validate` with format detection by length and alphabet:
  26 Crockford = ULID, 27 base62 = KSUID, 36 hyphenated hex = UUID. Add an
  explicit `--format` override for scripts.
- `decode` output should show Unix milliseconds, KSUID-relative seconds,
  payload hex, and canonical string.
- Preserve existing exit codes: `0` valid/clean, `1` findings/invalid, `2`
  usage error.

Acceptance:

- [ ] CLI tests cover valid, invalid, boundary, `--count`, `--json`, and
      explicit `--format`.
- [ ] `docs/cli.md` updated with KSUID examples.
- [ ] No change to existing ULID/UUIDv7 command output.

### 1.2 WASM

Add to `crates/wasm/src/lib.rs`:

- `ksuid(seedTime?)`
- `ksuidBytes()`
- `generateKsuidMany(n)`
- `generateKsuidBytes(n)`
- `generateKsuidInto(buffer)` if the WASM ABI supports caller buffers cleanly;
  otherwise document why it is absent.
- `isValidKsuid`, `decodeKsuidTime`, `ksuidTime`, `decodeKsuid`, `encodeKsuid`,
  `compareKsuid`.

The WASM clock still flows through `Date.now()` and the engine clock override.
Randomness comes from the existing `getrandom`/`crypto.getRandomValues` path.

Acceptance:

- [ ] `wasm-pack` web and Node builds compile.
- [ ] `crates/wasm/test.mjs` covers a KSUID round trip, timestamp, and invalid
      input.
- [ ] `scripts/package-wasm.mjs` README and package keywords mention KSUID.
- [ ] Existing WASM ULID/UUIDv7 tests remain green.

### 1.3 Python

Add to `crates/python/src/lib.rs` and export from
`packages/python/src/rivid/__init__.py`:

- `ksuid(seed_time=None)` (milliseconds, matching the Node API)
- `ksuid_bytes()`
- `generate_ksuid_many(count)`
- `is_valid_ksuid(id)`
- `decode_ksuid_time(id)`
- `ksuid_time(bytes)`
- `decode_ksuid(id)`
- `encode_ksuid(bytes)`
- `compare_ksuid(a, b)`

Acceptance:

- [ ] Python tests cover known vectors, timestamp flooring, range errors,
      bulk generation, and invalid input.
- [ ] `packages/python/README.md` and PyPI metadata mention KSUID.
- [ ] The wheel builds with the existing maturin flow.

### 1.4 Deterministic helpers and core hardening

Add:

- `ksuid_from_parts(unix_seconds, payload)` / `ksuid_parts(bytes)` in Rust.
- Public Node equivalents: `ksuidFromParts(seconds, payload)` and
  `ksuidParts(bytes)`.
- Optional `KsuidGenerator({ seed })` for reproducible fixtures. Use the same
  Xoshiro256** deterministic mode as `UlidGenerator`, clearly marked
  test-only.
- A `decode_ksuid` fuzz target, plus KSUID cases in round-trip fuzzing.

Do **not** add `monotonicKsuid()` as if it were standard KSUID. If demand
appears, ship it as a clearly named Rivid extension with a documented caveat
that it is not Segment KSUID ordering semantics.

Acceptance:

- [ ] Deterministic sequences are reproducible with a pinned timestamp.
- [ ] No deterministic path is reachable from production defaults.
- [ ] Fuzz target builds and the decoder remains total (no panics).
- [ ] `SECURITY.md` notes KSUID timestamps are public and second-precision.

### 1.5 ORM and PostgreSQL

KSUID storage options:

| Representation | Size | Notes |
|---|---:|---|
| `BYTEA` | 20 bytes | Best storage; binary round trip; no native type |
| `CHAR(27)` / `VARCHAR(27)` | 27 bytes | Human-readable; fixed-length indexing |
| `TEXT` | 27+ bytes | Convenient but unbounded; should be flagged by policy |

Deliverables:

- Drizzle column type for KSUID (`@rivid/drizzle`).
- Prisma field helpers or documented `Bytes`/`String` patterns
  (`@rivid/prisma`).
- SQLAlchemy `TypeDecorator` for KSUID (`rivid` Python package).
- `rivid check` policy support:

```yaml
rivid:
  database: ksuid
  allow:
    - table: legacy_events
      column: id
      reason: "KSUID stored as text during migration"
```

`rivid check` should detect:

- KSUID columns stored as unbounded `TEXT`.
- `CHAR(27)` vs `BYTEA` primary/foreign-key representation mismatches.
- A declared KSUID convention violated by another table.
- Mixed ULID/KSUID/UUID primary-key families when the policy declares one.

Acceptance:

- [ ] Live PostgreSQL integration suite covers CRUD, ordering, keyset
      pagination, transactions, concurrency, and binary/text round trips.
- [ ] 1M-row storage/insertion comparison: KSUID as `BYTEA` vs `CHAR(27)` vs
      UUIDv7 as `uuid`.
- [ ] `docs/postgres.md`, `docs/orm.md`, and `docs/identifiers.md` updated.
- [ ] `rivid check --json` output and GitHub annotations include KSUID findings.

---

## Milestone 2 — TypeID

TypeID is the strongest next format because it builds directly on UUIDv7:

```text
user_01h455vb4pex5vsknk084sn02q
|--| |------------------------|
type      26-char UUIDv7 suffix
```

### Scope

- Rust core `typeid` module: parse, encode, validate, generate.
- Prefix validation against the TypeID specification (lowercase ASCII,
  allowed separators, length limits).
- Node API working names: `typeid(type)`, `typeidBytes(type)`,
  `parseTypeId(id)`, `isValidTypeId(id)`, `typeIdType(id)`.
- CLI: `rivid typeid --type user`, `rivid decode <typeid>`.
- ORM storage: UUIDv7 binary column plus a type prefix column, or a text
  column when the application requires the full string.

### Acceptance

- [ ] Reference TypeID vectors pass.
- [ ] Invalid prefixes, missing separators, wrong suffix lengths, and
      non-UUIDv7 suffixes are rejected.
- [ ] Generated TypeIDs sort by their UUIDv7 suffix.
- [ ] Docs explain the storage trade-off: 16-byte UUID + prefix vs 30–40-byte
      text.
- [ ] Benchmark: generation and parsing vs a conventional TypeID package.

### Guardrails

- Do not claim TypeID is a database primitive.
- Do not silently coerce arbitrary prefixes; callers must provide a valid
  type string.
- Keep the UUIDv7 suffix interoperable with existing UUID tooling.

---

## Milestone 3 — Optional Interop Formats

Add only when there is a concrete interoperability use case.

### MongoDB ObjectId

- 96-bit, 24-char hex, 4-byte seconds + 5-byte random + 3-byte counter.
- Start with `decodeObjectId`, `encodeObjectId`, `isValidObjectId`, and
  timestamp extraction.
- Add generation only if a per-process counter can be implemented without
  pretending it is globally coordinated.
- Acceptance: reference vectors, Mongo driver round trip, docs that explain
  the machine/process assumptions.

### UUIDv4

- Explicit `uuidv4()` and `uuidv4Bytes()` for compatibility.
- Reuse the existing random source.
- Acceptance: RFC 9562 version/variant bits and uniqueness tests.

### Snowflake / 64-bit

- Stateful generator with explicit worker/datacenter IDs.
- Clock-rollback policy must be explicit: wait, error, or borrow sequence.
- Sequence exhaustion behavior must be tested.
- Acceptance: deterministic tests with injected clock and worker ID, plus a
  documented deployment model. Do not ship an implicit machine-ID guess.

### Timeflake / XID

- Treat as interop codecs first: parse, encode, validate, timestamp.
- Add generation only if the format has clear user demand.
- XID and Snowflake require coordination assumptions; document them.

### Explicit non-goals

- CUID2 and NanoID: non-sortable, no structural timestamp; they do not
  strengthen the identifier-infrastructure positioning.
- A "universal" ID that hides format differences. Callers should choose a
  format deliberately.
- Cross-machine monotonicity claims for any format.

---

## Milestone 4 — Tooling and Regression Gates

### `rivid inspect`

- Auto-detect ULID, UUIDv7, KSUID, TypeID, ObjectId by length/alphabet plus
  strict validation.
- Print format, timestamp, payload/randomness, canonical form, and storage
  recommendation.
- Never guess when validation is ambiguous; require `--format`.

### `rivid migrate`

- Text ↔ binary storage conversion for ULID and KSUID.
- ULID ↔ UUID reinterpretation (existing).
- Dry-run mode and row-count reporting.
- Refuse destructive operations without an explicit flag.

### CI benchmark regression gate

- Run `npm run bench:ksuid` on the benchmark runner.
- Compare against the committed baseline with a relative threshold, not
  absolute nanoseconds.
- Investigate >20% regression; fail the job at >30% on the same runner class.
- Keep the existing noise-probe rule: if the noop probe moved, mark the run
  inconclusive instead of failing.

### Per-format documentation

- `docs/ksuid.md`
- `docs/typeid.md`
- `docs/objectid.md` (if added)
- Each doc covers wire layout, epoch/precision, storage, indexing, ordering,
  security, and benchmark command.

---

## Backlog

| Item | Priority | Depends on | Notes |
|---|---|---|---|
| KSUID CLI + decode/validate | P0 | — | Smallest user-visible gap |
| KSUID WASM | P0 | — | Rebuild generated packages |
| KSUID Python | P0 | — | Beta package |
| KSUID ORM types + `rivid check` | P0 | schema policy work | Highest differentiation |
| `ksuidFromParts` / `ksuidParts` | P1 | — | Needed for fixtures/migrations |
| `KsuidGenerator` deterministic mode | P1 | RNG plumbing | Test-only |
| `decode_ksuid` fuzz target | P1 | — | Security claim |
| Go/Rust/Python KSUID benchmarks | P1 | bindings | Cross-language report |
| TypeID | P1 | UUIDv7 | Best new format |
| ObjectId codecs | P2 | — | Interop |
| UUIDv4 | P2 | — | Compatibility |
| Snowflake | P2 | coordination design | `BIGINT` use case |
| Timeflake/XID | P3 | — | Interop only |
| `rivid inspect` / `migrate` | P3 | CLI parser | Tooling |
| Benchmark regression gate | P3 | CI runner | Reliability |

---

## Release Shape

Tentative, not a commitment:

- **1.2** — KSUID parity: CLI, WASM, Python, ORM/check, fuzz, cross-language
  benchmarks.
- **1.3** — TypeID.
- **1.4** — ObjectId/UUIDv4 plus `inspect`/`migrate`; Snowflake only if the
  coordination design is settled.

Keep changes additive. A major version should be reserved for an actual API
break, not for adding formats.

---

## Risks and Open Questions

| Risk | Mitigation |
|---|---|
| KSUID millisecond API vs second wire format confuses users | Document flooring everywhere; return second-aligned milliseconds from decode helpers; test boundary cases |
| Base62 mixed case causes case-sensitive comparisons | Canonicalize before compare; reject non-canonical input where appropriate; state that strings are case-sensitive |
| WASM clock/entropy differences | Reuse the existing clock override and `getrandom` path; test web and Node builds |
| Python beta packaging drifts | Build the wheel in CI; keep FFI names mirrored |
| Schema auto-detection produces false positives | Require explicit policy or `--format`; validate the full 160-bit domain, not just length |
| ORM column types diverge | One shared conformance suite across Drizzle, Prisma, SQLAlchemy |
| Snowflake worker-ID assignment is operationally heavy | Make worker ID explicit; document failure modes; do not guess |
| TypeID prefix rules change | Pin the spec version and test reference vectors |
| Benchmark numbers are machine-dependent | Relative thresholds; publish environment metadata; keep the noop probe |

Open questions:

1. Should KSUID's public `ksuid(timestamp)` argument stay milliseconds forever,
   or should a `ksuidAt(seconds)` alias be added for spec-native callers?
2. Should `BYTEA` or `CHAR(27)` be the recommended default for KSUID in
   PostgreSQL, given the 20-vs-27-byte trade-off?
3. Does TypeID belong in core or as a separate package built on UUIDv7?
4. Is Snowflake worth the coordination surface, or should it remain a
   documented external integration?
5. Do we want a plugin-style codec registry for future formats, or keep each
   format explicit?

---

## Definition of Done

For every new format:

- [ ] Rust core implementation with reference vectors.
- [ ] Node binding and TypeScript declarations.
- [ ] WASM and Python exposure, or an explicit documented exception.
- [ ] CLI generate/decode/validate support.
- [ ] Fuzz coverage for every decoder.
- [ ] ORM/PostgreSQL storage guidance and tests.
- [ ] Benchmark row against at least one conventional implementation.
- [ ] Docs, changelog, and security notes.
- [ ] No regression in ULID/UUIDv7 test suites or benchmark noise probes.
