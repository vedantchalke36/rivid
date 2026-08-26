# Changelog

All notable changes are documented here. The format is inspired by
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

[0.1.0]: https://github.com/vedantchalke36/rivid/releases/tag/v0.1.0
