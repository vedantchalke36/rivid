//! WebAssembly build of the [rivid](https://github.com/vedantchalke36/rivid)
//! ID engine — spec-compatible ULIDs and UUIDv7 for browsers and other
//! Wasm runtimes.
//!
//! Design notes:
//! * **Clock**: `SystemTime` is not dependable under `wasm32-unknown-unknown`,
//!   so every timestamp flows in from `Date.now()` (or an explicit argument)
//!   through the engine's `_at` injection APIs.
//! * **Randomness**: the engine's ChaCha12 CSPRNG is seeded by `getrandom`,
//!   which resolves to `crypto.getRandomValues` here via the `wasm_js`
//!   feature enabled in this crate alone.
//! * Deterministic `{ seed }` mode is intentionally **not** exposed — it is a
//!   test-fixture tool and has no safe use in browsers.

use rivid_core as core;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
fn start() {
    // Route Rust panics to console.error with message + location instead of
    // an opaque wasm trap.
    console_error_panic_hook::set_once();
}

/// Feed the host clock to the engine. `SystemTime` traps under wasm32, so
/// every entry point syncs `Date.now()` through the engine's override first.
fn sync_clock() {
    core::set_clock_override(now_ms());
}

/// Milliseconds since epoch from the host clock; clamps pre-1970 to 0,
/// mirroring the native layer.
fn now_ms() -> u64 {
    let t = js_sys::Date::now();
    if t.is_finite() && t > 0.0 { t as u64 } else { 0 }
}

/// Validate an optional explicit seed time the way the NAPI layer does:
/// finite, integral, non-negative. Overflow past TIME_MAX is rejected by the
/// engine itself and surfaced as a JS error.
fn resolve_ts(seed_time: Option<f64>) -> Result<u64, JsError> {
    match seed_time {
        None => Ok(now_ms()),
        Some(t) => {
            if !t.is_finite() || t < 0.0 || t.fract() != 0.0 {
                return Err(JsError::new(
                    "seedTime must be a finite, non-negative integer number of milliseconds",
                ));
            }
            Ok(t as u64)
        }
    }
}

fn max_batch(count: usize) -> Result<(), JsError> {
    // Matches the NAPI layer's MAX_BATCH ceiling.
    const MAX_BATCH: usize = 100_000_000;
    if count == 0 || count > MAX_BATCH {
        return Err(JsError::new("count must be between 1 and 100000000"));
    }
    Ok(())
}

// ── ULID ─────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn ulid(seed_time: Option<f64>) -> Result<String, JsError> {
    let ts = resolve_ts(seed_time)?;
    core::ulid::generate_at(ts).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn ulid_bytes() -> Vec<u8> {
    sync_clock();
    core::ulid::generate_bytes16().to_vec()
}

#[wasm_bindgen]
pub fn monotonic_ulid(seed_time: Option<f64>) -> Result<String, JsError> {
    let ts = resolve_ts(seed_time)?;
    thread_local! {
        static STATE: std::cell::RefCell<core::monotonic::MonotonicState> =
            std::cell::RefCell::new(core::monotonic::MonotonicState::new());
    }
    Ok(STATE.with(|s| s.borrow_mut().next_secure_at(ts)))
}

#[wasm_bindgen]
pub fn generate_many(count: usize) -> Result<Vec<String>, JsError> {
    max_batch(count)?;
    sync_clock();
    Ok(core::batch::generate_ulid_strings(count))
}

#[wasm_bindgen]
pub fn generate_bytes(count: usize) -> Result<Vec<u8>, JsError> {
    max_batch(count)?;
    sync_clock();
    Ok(core::batch::generate_ulid_bytes(count))
}

#[wasm_bindgen]
pub fn is_valid(id: &str) -> bool {
    core::ulid::is_valid(id.as_bytes())
}

#[wasm_bindgen]
pub fn decode_time(id: &str) -> Result<f64, JsError> {
    // TIME_MAX < 2^53, so f64 represents every legal value exactly.
    core::ulid::decode_time(id.as_bytes())
        .map(|t| t as f64)
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn encode_time(seed_time: Option<f64>) -> Result<String, JsError> {
    let ts = resolve_ts(seed_time)?;
    core::crockford::encode_time_str(ts).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn decode(id: &str) -> Result<Vec<u8>, JsError> {
    core::ulid::decode(id)
        .map(|b| b.to_vec())
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn encode(bytes: &[u8]) -> Result<String, JsError> {
    core::ulid::encode(bytes).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn compare(a: &str, b: &str) -> Result<i8, JsError> {
    core::ulid::compare(a, b)
        .map(|o| match o {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        })
        .map_err(|e| JsError::new(&e.to_string()))
}

// ── UUIDv7 ───────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn uuidv7() -> String {
    sync_clock();
    core::uuidv7::generate()
}

#[wasm_bindgen]
pub fn uuidv7_bytes() -> Vec<u8> {
    sync_clock();
    core::uuidv7::generate_bytes16().to_vec()
}

#[wasm_bindgen]
pub fn generate_uuid_v7_many(count: usize) -> Result<Vec<String>, JsError> {
    max_batch(count)?;
    sync_clock();
    Ok(core::uuidv7::generate_strings(count))
}

#[wasm_bindgen]
pub fn uuidv7_time(bytes: &[u8]) -> Result<f64, JsError> {
    let arr: [u8; 16] = bytes
        .try_into()
        .map_err(|_| JsError::new("expected exactly 16 bytes"))?;
    Ok(core::uuidv7::timestamp_ms(&arr) as f64)
}

// ── Isolated monotonic stream ────────────────────────────────────────────

/// Instance-scoped monotonic generator, for parallel streams that must not
/// share ordering state (the free function above uses one global stream).
#[wasm_bindgen]
pub struct MonotonicGenerator {
    state: core::monotonic::MonotonicState,
}

#[wasm_bindgen]
impl MonotonicGenerator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MonotonicGenerator {
        MonotonicGenerator {
            state: core::monotonic::MonotonicState::new(),
        }
    }

    pub fn next(&mut self, seed_time: Option<f64>) -> Result<String, JsError> {
        let ts = resolve_ts(seed_time)?;
        Ok(self.state.next_secure_at(ts))
    }
}

// ── Meta ─────────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
