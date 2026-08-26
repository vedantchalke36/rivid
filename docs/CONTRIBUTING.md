# Contributing

Thanks for your interest! The project is young — a clear, well-tested PR
or a performance regression report is one of the best things you can add.

## Setup

```bash
git clone https://github.com/vedantchalke36/rivid && cd rivid
rustup component add rustfmt clippy
npm install
npx napi build --platform         # debug build is enough for the suite
# Or: npm run build               # release + TypeScript compilation
```

## Development loop

| What                              | Command                                  | Timeout |
|-----------------------------------|------------------------------------------|---------|
| All Rust tests                    | `cargo test -p rivid-core`             | ~10s    |
| Whole workspace lint              | `cargo fmt --all --check; cargo clippy --workspace --all-targets -- -D warnings` | ~20s |
| Type & unit tests (76 total)      | `node --import tsx --test __test__/*.test.mts` | ~3s |
| Fuzz targets (short run)          | `cargo +nightly fuzz run decode_ulid -- -max_total_time=20` | ~20s each |
| Single benchmark suite            | `node --import tsx benchmarks/run.mts --quick --suite=single` | ~15s |
| Full benchmarks (10M workloads)   | `node --import tsx benchmarks/run.mts`   | ~5 min |
| CLI smoke                         | `node cli/rivid.mjs ulid --count 5` |  |

The CI matrix runs all of the above (plus type-checking) on Linux,
macOS and Windows against Node 18/20/22/24.

## Style

- Rust: `cargo fmt` (stable), `clippy -- -D warnings`.
- Typescript: strict, 26-char-line-friendly imports, `tsc --noEmit -p config/tsconfig.check.json`.
- Tests are `node:test` suites in `__test__/*.test.mts`, executed through `tsx`.
- Benchmark harness lives in `benchmarks/`; results are written to `benchmarks/results/latest.json`.

## When changing the public API

1. Update both Rust and NAPI layers in tandem if the change crosses the boundary.
2. Keep ULID spec-compat by running `benchmarks/` and `__test__/compat.test.mts` against `ulid@3.x`.

## Release process

```bash
npx tsc -p config/tsconfig.esm.json && npx tsc -p config/tsconfig.cjs.json && node scripts/post-build.mjs
npx napi build --platform --release   # repeat for every platform triple in `package.json#napi`
npx napi prepublish
npm publish --provenance --access public
```

Tags `v*` trigger `.github/workflows/release.yml` for platform builds + npm publish.

## Pull requests

Open from a feature branch, fill in `.github/pull_request_template.md`, and
attach bench output if any runtime path changed. See `SECURITY.md` for
reporting vulnerabilities.

All contributions are licensed under the repository's [LICENSE](LICENSE) (MIT).
