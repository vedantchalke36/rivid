# Security Policy

## Supported versions

| Version | Supported   |
|---------|-------------|
| `>=0.1` | yes         |

Earlier `0.0.x` development versions receive no patches.

## Reporting a vulnerability

Do **not** open a public issue. Instead:

1. Email <security.rivid@vuce.in> (GPG key on request).
2. Or open a private security advisory through GitHub:
   https://github.com/vedantchalke36/rivid/security/advisories/new

Include:

* A minimal reproduction (TypeScript snippet or `cargo` harness).
* The affected version range.
* Any impact hypotheses (especially denial-of-service via crafted input — the
  fuzz targets in `fuzz/` are explicitly meant to prevent it).

We aim to acknowledge within **3 business days** and publish a coordinated
fix within **30 days**. Ask for an extension if you need one.

## Supply chain posture

* **Dependency footprint:** the Rust core has exactly one runtime dependency
  (`rand`, for the ChaCha12 thread-local CSPRNG). The NAPI layer depends only
  on `napi`/`napi-derive`; the published npm package has zero runtime JS
  dependencies (platform binaries ship via `optionalDependencies`).
* **Auditing:** CI runs `cargo audit` and `npm audit --omit=dev` on every
  push to `main`; failures block merge.
* **Lockfiles:** `Cargo.lock` and the package manager lockfile are committed;
  release builds are reproducible from them.
* **Provenance:** npm releases are published with `--provenance`
  (`npm publish --provenance`), so packages are linked to their source
  workflow run on GitHub.
* **Platform binaries** are built by the tagged release workflow directly
  from the commit — never uploaded by hand.

## Ad-hoc security posture

* Production randomness flows through the same OS-seeded ChaCha12 generator
  that the `rand` crate, `uuid`, and `openssl` docs recommend for identifier
  generation. It is suitable for IDs; do not use it for key material.
* Deterministic/test mode (any path touching `seed`) is Xoshiro256\*\*
  seeded via SplitMix64 — explicitly **not** secure. The `UlidGenerator` API
  makes this opt-in only through `{ seed }`.
* All decoders return `Err` on malformed input; the fuzz suite verifies
  they never panic even under arbitrary byte strings.
* Bulk interfaces (`generateMany`, `generateInto`, `generateBytes`, …)
  validate buffer lengths and `count` bounds before allocating.
