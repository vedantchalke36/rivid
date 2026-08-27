# WASM — `@rivid/wasm`

The same Rust engine as `@rivid/core`, compiled to WebAssembly for browsers and
other WASM runtimes. Build it from this repository with
[wasm-pack](https://rustwasm.github.io/wasm-pack/):

```bash
wasm-pack build crates/wasm --target web --out-dir pkg-web --release    # browsers/bundlers
wasm-pack build crates/wasm --target nodejs --out-dir pkg --release     # Node
node scripts/package-wasm.mjs                                           # assemble @rivid/wasm npm layout (crates/wasm/npm)
node crates/wasm/test.mjs                                               # reference-vector suite
```

## `@rivid/core` (native) vs `@rivid/wasm`

| | `@rivid/core` | `@rivid/wasm` |
|---|---|---|
| Runtime | Node.js 18+, Bun | Browsers, Node, WASM runtimes |
| Binding | NAPI-RS native addon | wasm-bindgen |
| Single ULID | ~123 ns | slower — wasm boundary + JS glue; measure on your workload |
| Binary size | per-platform `.node` binary | ~64 KB `.wasm` + JS glue |
| Randomness | OS CSPRNG → ChaCha12 | `crypto.getRandomValues` → ChaCha12 |
| Clock | native `Date.now()` equivalents | `Date.now()` fed into the engine |
| Deterministic mode | yes (`{ seed }`) | intentionally **not exposed** |

**Choose `@rivid/core`** for servers — it is faster and needs no initialization.
**Choose `@rivid/wasm`** in browsers, Electron renderers, Deno/edge runtimes
without native addons, or anywhere a native `.node` binary cannot load.

## Behavior notes

- `SystemTime` is unreliable under `wasm32-unknown-unknown`, so every entry
  point syncs the host clock (`Date.now()`) through the engine's clock
  override before generating.
- Seeded/deterministic generation is deliberately unavailable in the WASM
  build — it is a test-fixture tool with no safe browser use.
- Panics are routed to `console.error` with message and location instead of
  opaque wasm traps.
- The Node (`nodejs`) target build is CommonJS; the web build is ESM. The
  assembled npm package exposes both via export conditions.

## Correctness

The WASM crate runs the same reference ULID vectors as the native test suite
(`node crates/wasm/test.mjs`), plus a browser-level Playwright suite in
[`integrations/react-wasm`](../integrations/react-wasm).
