<!--
Thanks for contributing! Please fill in the sections below.
Attach benchmark output for any change touching a runtime code path.
-->

## Summary

<!-- What does this PR change and why? -->

## Checklist

- [ ] `cargo test -p rivid-core` passes
- [ ] `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` passes
- [ ] `npm run lint` (tsc over src, tests, benchmarks, examples) passes
- [ ] `node --import tsx --test __test__/*.test.mts` passes
- [ ] Benchmarks: attached `pnpm bench -- --quick --suite=single` output, or `N/A` (no runtime path touched)
- [ ] Public API changes documented in README.md + CHANGELOG.md

## Notes for reviewers

<!-- Anything surprising: trade-offs taken, alternatives rejected, follow-ups filed -->
