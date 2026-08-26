# rivid-core

Pure-Rust ID engine powering [rivid](https://github.com/vedantchalke36/rivid):
ULID (Crockford Base32), UUIDv7 (RFC 9562), monotonic generation, batch fills,
and alternative encodings (Base58, Base64URL, sortable).

- **Total decoders** — malformed input returns `Err`, never panics (fuzz-enforced)
- **Zero panics** in non-test paths; single runtime dependency (`rand`)
- **Injectable time & randomness** — every generator has an `_at`/`_with` variant

See the repo for benchmarks, fuzz targets, and the NAPI/WASM bindings layers.
