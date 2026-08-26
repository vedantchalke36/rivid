# React × rivid-wasm

Vite + React app that loads `@rivid/wasm` in a real browser and proves it:
an in-app self-test panel runs the ULID reference vectors inside Chromium,
and a Playwright suite asserts generation, monotonic ordering, bulk
throughput and validation end-to-end.

```bash
npm install
npm run dev        # http://localhost:5173 — self-test panel shows ALL CHECKS PASS
npm run test:e2e   # builds nothing; serves dist/ via preview + Playwright
```

`npm run build` must run before `test:e2e` (preview serves `dist/`).

## How it consumes the wasm module

`sync-wasm.mjs` copies the wasm-pack **web-target** output
(`crates/wasm/pkg-web`, built via
`wasm-pack build crates/wasm --target web`) into `src/rivid-wasm/`.
The web target's async `init()` + `new URL(..., import.meta.url)` asset
loading works under both Vite dev server and production Rollup builds
without extra plugins.

## Covered in-browser

| Check | Where |
|---|---|
| Crockford format, seedTime prefix pinning | self-test panel |
| decodeTime/encodeTime reference vectors | self-test panel |
| encode∘decode round trip, isValid edges | self-test panel |
| Monotonic strict increase + compare | self-test panel + e2e |
| UUIDv7 version nibble + timestamp ≈ now | self-test panel |
| Bulk 10k uniqueness/shared-timestamp | self-test panel |
| Live-clock single IDs through React state | e2e |
| Validator input UX | e2e |
