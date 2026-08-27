# Changelog

All notable changes are documented here. The format is inspired by
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] — 2026-08-27

### Changed

- **NAPI-RS v2 → v3 migration**: native binding layer rewritten for napi 3.
  `JsString` replaced by a `Latin1<N>` newtype that preserves the one-byte
  V8 fast path; `JsObject` array returns now go through `Array` +
  `coerce_to_object()`; `JsBuffer` replaced by the standalone `Buffer` type.
  Deprecated `compat-mode` APIs (`create_array_with_length`,
  `create_buffer_with_data`, `create_buffer`) eliminated.
- **rand 0.9 → 0.10**: `TryRng`/`Rng`/`RngExt` trait changes applied across
  `rng.rs`, `monotonic.rs`, `batch.rs`, `uuidv7.rs`. All 60 core tests pass.
- **TypeScript 7.0.2**: strict check passes; CJS tsconfig migrated from
  `moduleResolution: "Node10"` to `"Node16"` for TS7 compatibility.
- **drizzle-orm 0.45.2** and **@types/node 26**: installed, tsc clean, 95/95
  tests pass.
- GitHub Actions bumped: setup-node v4→v7, setup-python v5→v7, setup-go
  v5→v7, setup-java v4→v5, dependency-review-action v4→v5.
- `package.json` napi `binaryName` set to `"index"` for v3 compatibility with
  existing npm platform packages.

### Removed

- **Linux ARM64 musl (`@rivid/core-linux-arm64-musl`) prebuilt binaries are no
  longer built or published** — Ubuntu ARM runners ship no aarch64-musl cross
  toolchain (missing `libgcc` in its sysroot) and Alpine containers cannot run
  JS actions on ARM64 runners. Alpine ARM64 users can compile from source
  (`npx napi build --platform --release`). glibc ARM64 coverage is unchanged.

## [1.0.0] — 2026-08-27

First release declaring the identifier API surface stable.

### Added

- **Identifier governance**: `rivid check` audits SQL DDL, Prisma schemas and
  Drizzle table definitions for identifier inconsistencies (UUID-as-text,
  FK/PK representation mismatches, primary-key drift, unbounded TEXT ids) with
  a `.rivid.yml`/`.rivid.json` policy file for intentional conventions,
  `--json` machine-readable output, `--strict` mode, and GitHub Actions
  annotations (`.github/actions/rivid-check` composite action).
- Documentation architecture: user guides under `docs/` (identifiers,
  databases, postgres, orm, wasm, cli, benchmarking, microservices, events,
  queues, caching, idempotency, outbox-inbox), internal engineering reports
  under `docs/development/`.
- WASM documentation ([docs/wasm.md](docs/wasm.md)) covering native-vs-WASM
  selection, randomness/clock behavior, and build commands.

### Changed

- README rewritten as a concise landing page; every performance number
  re-verified against `benchmarks/results/latest.json` (2026-08-26) and
  labeled by layer (Rust core / native binding / bulk API / database).
- SQLAlchemy integration now generates through the genuine rivid engine
  (`rivid` PyO3 package) instead of the python-ulid stand-in; all 6 tests
  re-verified against live PostgreSQL.
- Platform scope narrowed: **Intel Mac (x86_64-apple-darwin) prebuilt
  binaries are no longer built or published** — macOS is Apple Silicon
  (arm64) only. Intel Mac users can compile from source.
- Integrations whose identifiers did not flow through the rivid engine were
  removed rather than shipped as pretense (the Go `database/sql` and GORM
  suites used the `oklog/ulid` stand-in). Schema guidance for Go ORMs
  remains in `docs/orm.md`; a rivid Go binding is on the roadmap.
- Bulk-performance claim scoped precisely: "up to ~2,000×" now explicitly
  applies to bulk *binary* generation (`generateBytes`/`generateInto`);
  `generateMany` (string API) is quoted separately.
- ULID↔UUID conversion documented as raw 128-bit reinterpretation (not an
  RFC UUIDv7 transformation); ordering guarantees scoped per identifier
  family, with no claim of cross-machine causal ordering.
- Security reporting policy moved to `.github/SECURITY.md`; the security
  guide remains at the root `SECURITY.md`.
- CLI type surface: root `index.d.ts` now declares `string[]` returns for
  batch APIs directly (previously patched post-build).
- CI hygiene: Gradle caches, pytest caches and backup scratch files no longer
  tracked; clippy clean on Rust 1.98 (`missing_const_for_thread_local`,
  `needless_question_mark` fixes).

### Removed

- Duplicate changelog (`docs/CHANGELOG.md` — identical copy of the root file).
- Development-only reports from the repository root (moved to
  `docs/development/`).

## [0.1.0] — 2026-08-22

### Added

- Initial release of `@rivid/core`.
- ULID generation (`ulid`, `monotonicUlid`, optional `seedTime` parity with the `ulid` npm package).
- Batch APIs: `generateMany`, `generateBytes`, `generateInto`.
- Codec: canonical Crockford Base32 (validated against the reference `ulid` test vectors).
- Validation, `decodeTime`/`encodeTime`, `compare`.
- Native-sort-backed `sort`/`sortInPlace` (benchmark: JS engine TimSort wins by ~60× over per-element NAPI crossings; the library therefore delegates sorting to it rather than retaining a slower Rust implementation).
- Fast-path `compare(a,b)` that delegates to Rust only for mixed-case inputs (otherwise `a < b` suffices for canonical uppercase ULIDs).
- Generator class `UlidGenerator` with `seed`-switchable deterministic Xoshiro256\*\* mode; wall-clock-seeded ChaCha12 secure mode is the default.
- `ulidBytes` / `encode` / `decode` 16-byte binary APIs.
- ULID ↔ UUID string conversions (`ulidToUuid`, `uuidToUlid`, aliases).
- UUIDv7 generation (`uuidv7`, `uuidv7Bytes`), bulk `generateUuidV7Many`.
- Alternative 128-bit encodings: Base58 (Bitcoin alphabet, ~22 chars), Base64URL (unpadded, 22 chars), Fast ULID Sortable (22 chars, ASCII-ordered, sortable, project extension).
- Fuzz harness (cargo-fuzz, nightly): decoders, encoders, validators, batch paths.
- CLI (`rivid ulid|uuidv7|decode|validate|benchmark|version`).
- Benchmark harness (`pnpm bench`) vs `ulid`, `ulidx`, js-baseline; direct Rust `bench_direct`.
- NAPI-RS platform builds for Linux glibc/musl x64, Linux ARM64, macOS ARM64/x64, Windows x64.

[1.1.0]: https://github.com/vedantchalke36/rivid/releases/tag/v1.1.0
[1.0.0]: https://github.com/vedantchalke36/rivid/releases/tag/v1.0.0
[0.1.0]: https://github.com/vedantchalke36/rivid/releases/tag/v0.1.0
