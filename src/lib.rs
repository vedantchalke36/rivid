//! NAPI-RS binding layer for the rivid Rust engine.
//!
//! This crate contains no ID logic: everything is delegated to
//! `rivid-core`. Bindings are thin conversions only, so per-call overhead
//! stays minimal and bulk APIs can amortize it entirely.
//!
//! Naming: Rust `snake_case` exports as `camelCase` (e.g. `generate_many`
//! becomes `generateMany`).

#![deny(clippy::all)]

use std::cmp::Ordering;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::*;
use napi::{Error, Result, Status};
use napi_derive::napi;

use rivid_core as core;

use napi::{Env, JsString, NapiRaw, NapiValue};

/// Encodes `value` into a fresh JS string without any intermediate heap
/// allocation on the Rust side: 26 bytes are Crockford-encoded onto the
/// stack and handed to V8 as a one-byte (Latin1) string.
///
/// SAFETY contract of the call site: `buf` must live until the N-API call
/// returns (it does — V8 copies synchronously).
#[inline]
fn js_string_latin1_26(env: Env, buf: &[u8; 26]) -> Result<JsString> {
    unsafe {
        let mut js: napi::sys::napi_value = std::ptr::null_mut();
        napi::check_status!(
            napi::sys::napi_create_string_latin1(env.raw(), buf.as_ptr().cast(), 26, &mut js)
        )?;
        Ok(JsString::from_raw(env.raw(), js)?)
    }
}

#[inline]
fn encode_stack(ts: u64, random: u128) -> [u8; 26] {
    core::crockford::encode_value(core::Id128::from_parts(ts, random).as_u128())
}

// ---------------------------------------------------------------------------
// Error conversion
// ---------------------------------------------------------------------------

/// Maps engine errors onto NAPI errors (all validation failures surface as
/// JS `TypeError`s with descriptive messages).
fn to_napi(e: core::Error) -> Error {
    Error::new(Status::InvalidArg, e.to_string())
}

type CoreResult<T> = std::result::Result<T, core::Error>;

trait IntoNapi<T> {
    fn napi(self) -> Result<T>;
}

impl<T> IntoNapi<T> for CoreResult<T> {
    #[inline]
    fn napi(self) -> Result<T> {
        self.map_err(to_napi)
    }
}

fn invalid_count(count: i64) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("count must be between 0 and {MAX_BATCH}, got {count}"),
    )
}

const MAX_BATCH: i64 = 100_000_000;

/// Formats a range-check failure for a JS-side `number` timestamp. The
/// message matches `core::Error::TimestampOutOfRange` exactly; the f64 value
/// cannot be stored in the core error's lossless `u64` payload (it may be
/// NaN, negative or fractional), so it is formatted here at the boundary.
fn ts_out_of_range(v: f64) -> Error {
    to_napi(core::Error::TimestampOutOfRange(v as u64))
}

/// Validates an explicitly provided timestamp (`seedTime`-style argument).
fn explicit_ts(timestamp_ms: Option<f64>) -> Result<Option<u64>> {
    match timestamp_ms {
        None => Ok(None),
        Some(v) => {
            if !v.is_finite() || v.fract() != 0.0 || !(0.0..=(core::TIME_MAX as f64)).contains(&v) {
                return Err(ts_out_of_range(v));
            }
            Ok(Some(v as u64))
        }
    }
}

/// Locks a mutex, recovering from poisoning by taking the inner guard.
///
/// A panic in another thread leaves the data itself consistent for these
/// types (state machines tolerate a torn read by design), and a poisoned
/// lock must never permanently wedge a long-running Node process.
fn lock_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

// ---------------------------------------------------------------------------
// Primary ULID API
// ---------------------------------------------------------------------------

/// Generate a canonical 26-character ULID using the current wall-clock
/// millisecond timestamp and secure randomness.
///
/// An optional explicit millisecond timestamp may be passed (reference
/// `ulid(seedTime)` parity).
#[napi]
pub fn ulid(env: Env, timestamp_ms: Option<f64>) -> Result<JsString> {
    let ts = match explicit_ts(timestamp_ms)? {
        None => core::now_ms(),
        Some(t) => t,
    };
    if ts > core::TIME_MAX {
        return Err(Error::new(
            Status::InvalidArg,
            format!("timestamp {ts} exceeds ULID max {}", core::TIME_MAX),
        ));
    }
    let buf = encode_stack(ts, core::rng::random_80());
    js_string_latin1_26(env, &buf)
}

/// Generate a monotonic ULID: strictly increasing across successive calls
/// within this process (same-millisecond values increment the previous one).
///
/// State is process-global and thread-safe; for maximum throughput in
/// multi-threaded pipelines prefer per-thread `UlidGenerator` instances.
#[napi]
pub fn monotonic_ulid(env: Env, timestamp_ms: Option<f64>) -> Result<JsString> {
    static STATE: OnceLock<Mutex<core::monotonic::MonotonicState>> = OnceLock::new();
    let state = STATE.get_or_init(|| Mutex::new(core::monotonic::MonotonicState::new()));
    let mut guard = match state.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let value = match explicit_ts(timestamp_ms)? {
        Some(t) => guard.next_secure_at(t),
        None => guard.next_secure(),
    };
    // Monotonic output is already canonical; reuse the zero-alloc encoder.
    let mut buf = [0u8; 26];
    buf.copy_from_slice(value.as_bytes());
    js_string_latin1_26(env, &buf)
}

/// Generate `count` ULID strings in one call.
///
/// All IDs share the batch's single captured timestamp; randomness is drawn
/// per ID from the secure thread-local generator. The JS array is allocated
/// at its final size up front and strings are created through the ASCII
/// (latin1) fast path; no intermediate Rust string vector is materialized.
///
/// (Returns the raw N-API array object; the generated declaration is patched
/// to `string[]` by scripts/post-build.mjs.)
#[napi]
pub fn generate_many(env: Env, count: i64) -> Result<napi::JsObject> {
    if !(0..=MAX_BATCH).contains(&count) {
        return Err(invalid_count(count));
    }
    let count = count as usize;
    let mut arr = env.create_array_with_length(count)?;
    let ts = core::now_ms();
    for i in 0..count {
        // Two secure draws per ID — same RNG pattern as before; the win is
        // skipping the intermediate Vec<String> entirely.
        let block = core::batch::ulid_block_secure(ts);
        let ascii = core::crockford::encode_value(u128::from_be_bytes(block));
        let s = env.create_string_latin1(&ascii)?;
        arr.set_element(i as u32, s)?;
    }
    Ok(arr)
}

/// Generate `count` ULIDs packed into a single contiguous Uint8Array
/// (`count * 16` bytes, big-endian layout).
#[napi]
pub fn generate_bytes(count: i64) -> Result<Uint8Array> {
    if !(0..=MAX_BATCH).contains(&count) {
        return Err(invalid_count(count));
    }
    let vec = core::batch::generate_ulid_bytes(count as usize);
    Ok(Uint8Array::from(vec.as_slice()))
}

/// Fills a caller-provided Uint8Array with ULIDs (16 bytes each).
///
/// The array length must be a multiple of 16. Returns the number of IDs
/// written (`length / 16`). Lets applications control allocation entirely.
#[napi]
pub fn generate_into(mut buffer: Uint8Array) -> Result<u32> {
    let slice: &mut [u8] = buffer.as_mut();
    let n = core::batch::fill_ulid_secure(slice).napi()?;
    Ok(n as u32)
}

/// Generate one raw 16-byte ULID (canonical big-endian layout).
#[napi]
pub fn ulid_bytes() -> Uint8Array {
    let b = core::ulid::generate_bytes16();
    Uint8Array::from(b.as_slice())
}

// ---------------------------------------------------------------------------
// ULID utilities
// ---------------------------------------------------------------------------

/// Validates ULID format: exactly 26 characters, all within the Crockford
/// Base32 alphabet (case-insensitive, matching the reference implementation).
#[napi]
pub fn is_valid(id: String) -> bool {
    core::ulid::is_valid(id.as_bytes())
}

/// Extracts the creation timestamp (ms since Unix epoch) of a ULID string.
#[napi]
pub fn decode_time(id: String) -> Result<f64> {
    Ok(core::ulid::decode_time(id.as_bytes()).napi()? as f64)
}

/// Encodes a millisecond timestamp (0..=2^48-1) as its 10-character ULID
/// time component.
#[napi]
pub fn encode_time(timestamp_ms: f64) -> Result<String> {
    if !timestamp_ms.is_finite() || timestamp_ms.fract() != 0.0 {
        return Err(ts_out_of_range(timestamp_ms));
    }
    if !(0.0..=(core::TIME_MAX as f64)).contains(&timestamp_ms) {
        return Err(ts_out_of_range(timestamp_ms));
    }
    core::crockford::encode_time_str(timestamp_ms as u64).napi()
}

/// Decodes a canonical 26-character ULID into its 16-byte representation.
#[napi]
pub fn decode(id: String) -> Result<Uint8Array> {
    let bytes = core::ulid::decode(&id).napi()?;
    Ok(Uint8Array::from(bytes.as_slice()))
}

/// Decodes a ULID string into a caller-provided Uint8Array (exactly 16
/// bytes). Avoids the per-call typed-array allocation entirely — measured
/// ~4x faster than `decode()` in hot loops. Returns nothing; throws on
/// invalid input.
#[napi]
pub fn decode_into(id: String, mut out: Uint8Array) -> Result<()> {
    let slice: &mut [u8] = out.as_mut();
    if slice.len() != 16 {
        return Err(to_napi(core::Error::InvalidLength {
            expected: 16,
            got: slice.len(),
        }));
    }
    let v = core::crockford::decode_chars(id.as_bytes()).napi()?;
    slice.copy_from_slice(&v.to_be_bytes());
    Ok(())
}

/// Decodes `ids.len()` ULID strings into one contiguous Uint8Array
/// (`n * 16` bytes, big-endian, index i at offset i*16). Amortizes the
/// typed-array allocation across the whole batch.
///
/// Every element must be a valid ULID; throws otherwise.
#[napi]
pub fn decode_many(ids: Vec<String>) -> Result<Uint8Array> {
    if ids.len() > MAX_BATCH as usize {
        return Err(invalid_count(ids.len() as i64));
    }
    let mut out = vec![0u8; ids.len() * 16];
    for (i, id) in ids.iter().enumerate() {
        let v = core::crockford::decode_chars(id.as_bytes()).napi()?;
        out[i * 16..(i + 1) * 16].copy_from_slice(&v.to_be_bytes());
    }
    Ok(Uint8Array::from(out.as_slice()))
}

/// Encodes exactly 16 bytes (canonical big-endian ID layout) as a
/// 26-character ULID string.
#[napi]
pub fn encode(bytes: Uint8Array) -> Result<String> {
    core::ulid::encode(&bytes).napi()
}

/// Compares two ULIDs by their full 128-bit value.
/// Returns `-1`, `0` or `1`.
#[napi]
pub fn compare(a: String, b: String) -> Result<i32> {
    Ok(match core::ulid::compare(&a, &b).napi()? {
        Ordering::Less => -1,
        Ordering::Equal => 0,
        Ordering::Greater => 1,
    })
}

/// Returns a new array with the ULIDs sorted ascending by value.
///
/// Every element must be a valid ULID string; otherwise an error is thrown.
#[napi]
pub fn sort(ids: Vec<String>) -> Result<Vec<String>> {
    let mut decoded: Vec<(u128, String)> = ids
        .into_iter()
        .map(|s| {
            core::crockford::decode_chars(s.as_bytes())
                .map(|v| (v, s))
                .map_err(to_napi)
        })
        .collect::<Result<Vec<_>>>()?;
    decoded.sort_by_key(|(v, _)| *v);
    Ok(decoded.into_iter().map(|(_, s)| s).collect())
}

// ---------------------------------------------------------------------------
// Alternative encodings (secondary utilities)
// ---------------------------------------------------------------------------

/// Base58 (Bitcoin alphabet) encode for arbitrary bytes.
#[napi]
pub fn encode_base58(bytes: Uint8Array) -> String {
    core::base58::encode(&bytes)
}

/// Base58 decode; strictly validates the alphabet.
#[napi]
pub fn decode_base58(value: String) -> Result<Uint8Array> {
    let v = core::base58::decode(&value).napi()?;
    Ok(Uint8Array::from(v.as_slice()))
}

/// Unpadded Base64URL encode for arbitrary bytes.
#[napi]
pub fn encode_base64_url(bytes: Uint8Array) -> String {
    core::base64url::encode(&bytes)
}

/// Base64URL decode (accepts padded and unpadded input).
#[napi]
pub fn decode_base64_url(value: String) -> Result<Uint8Array> {
    let v = core::base64url::decode(&value).napi()?;
    Ok(Uint8Array::from(v.as_slice()))
}

/// Crockford Base32 encode of exactly 16 bytes (the ULID encoding rule).
#[napi]
pub fn encode_crockford(bytes: Uint8Array) -> Result<String> {
    if bytes.len() != 16 {
        return Err(to_napi(core::Error::InvalidLength {
            expected: 16,
            got: bytes.len(),
        }));
    }
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&bytes);
    Ok(core::crockford::encode_string(u128::from_be_bytes(arr)))
}

/// Crockford Base32 decode of exactly 26 characters (case-insensitive).
#[napi]
pub fn decode_crockford(value: String) -> Result<Uint8Array> {
    let v = core::crockford::decode_chars(value.as_bytes()).napi()?;
    Ok(Uint8Array::from(v.to_be_bytes().as_slice()))
}

/// Fast ULID Sortable encoding: 22 chars, URL-safe, lexicographically
/// ordered like the underlying 128-bit value. Project-specific extension —
/// NOT standard ULID.
#[napi]
pub fn encode_sortable(bytes: Uint8Array) -> Result<String> {
    if bytes.len() != 16 {
        return Err(to_napi(core::Error::InvalidLength {
            expected: 16,
            got: bytes.len(),
        }));
    }
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&bytes);
    Ok(core::sortable::encode_string(u128::from_be_bytes(arr)))
}

/// Decode a Fast ULID Sortable string back to 16 bytes.
#[napi]
pub fn decode_sortable(value: String) -> Result<Uint8Array> {
    let v = core::sortable::decode_chars(value.as_bytes()).napi()?;
    Ok(Uint8Array::from(v.to_be_bytes().as_slice()))
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/// Converts a ULID string to hyphenated uppercase UUID form.
/// Pure reinterpretation of the same 128 bits.
#[napi]
pub fn ulid_to_uuid(id: String) -> Result<String> {
    core::convert::ulid_to_uuid(&id).napi()
}

/// Converts a hyphenated UUID string to canonical ULID form.
#[napi]
pub fn uuid_to_ulid(uuid: String) -> Result<String> {
    core::convert::uuid_to_ulid(&uuid).napi()
}

/// Converts a ULID string to its 16-byte big-endian representation.
/// Equivalent to `decode()`; provided for symmetry with `bytesToUlid`.
#[napi]
pub fn ulid_to_bytes(id: String) -> Result<Uint8Array> {
    let bytes = core::ulid::decode(&id).napi()?;
    Ok(Uint8Array::from(bytes.as_slice()))
}

/// Converts exactly 16 big-endian bytes to the canonical ULID string.
/// Equivalent to `encode()`.
#[napi]
pub fn bytes_to_ulid(bytes: Uint8Array) -> Result<String> {
    core::ulid::encode(&bytes).napi()
}

// ---------------------------------------------------------------------------
// UUIDv7 (secondary feature)
// ---------------------------------------------------------------------------

/// Generates a canonical lowercase RFC 9562 UUIDv7 string.
#[napi]
pub fn uuidv7() -> String {
    core::uuidv7::generate()
}

/// Generates a raw 16-byte UUIDv7.
#[napi]
pub fn uuidv7_bytes() -> Uint8Array {
    let b = core::uuidv7::generate_bytes16();
    Uint8Array::from(b.as_slice())
}

/// Generates `count` UUIDv7 strings in one call.
#[napi]
pub fn generate_uuid_v7_many(count: i64) -> Result<Vec<String>> {
    if !(0..=MAX_BATCH).contains(&count) {
        return Err(invalid_count(count));
    }
    Ok(core::uuidv7::generate_strings(count as usize))
}

/// Extracts the millisecond timestamp embedded in UUIDv7 bytes.
#[napi]
pub fn uuidv7_time(bytes: Uint8Array) -> Result<f64> {
    let arr: [u8; 16] = bytes
        .as_ref()
        .try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "expected exactly 16 bytes"))?;
    Ok(core::uuidv7::timestamp_ms(&arr) as f64)
}

// ---------------------------------------------------------------------------
// Generator class
// -------------------------------------------------------------------

/// Options for `UlidGenerator`.
///
/// Providing `seed` switches the generator to **deterministic test mode**:
/// output is fully reproducible but NOT cryptographically random. Omitting
/// it keeps production-grade secure generation.
#[napi(object)]
pub struct UlidGeneratorOptions {
    /// Seed for deterministic (test) mode. Ignored when absent.
    pub seed: Option<i64>,
}

/// Stateful ULID generator.
///
/// Use a generator when you need isolated monotonic state (per worker or
/// per stream) or deterministic test fixtures. For raw single-call
/// throughput prefer module-level `ulid()`; class-method dispatch adds
/// roughly 100-150 ns.
///
/// * Default mode: OS-seeded ChaCha12 secure randomness.
/// * `{ seed }` mode: deterministic Xoshiro256\*\* — reproducible, NOT
///   secure. Clearly separated; never used unless explicitly requested.
#[napi]
pub struct UlidGenerator {
    mono: Mutex<core::monotonic::MonotonicState>,
    det: Option<Mutex<core::rng::DeterministicRng>>,
}

#[napi]
impl UlidGenerator {
    #[napi(constructor)]
    pub fn new(options: Option<UlidGeneratorOptions>) -> Self {
        let seed = options.and_then(|o| o.seed);
        UlidGenerator {
            mono: Mutex::new(core::monotonic::MonotonicState::new()),
            det: seed.map(|s| Mutex::new(core::rng::DeterministicRng::new(s as u64))),
        }
    }

    /// Next non-monotonic ULID (fresh random part every call).
    ///
    /// Pass an explicit millisecond timestamp (`timestampMs`) to pin time —
    /// required for fully reproducible sequences in deterministic mode.
    #[napi]
    pub fn next(&self, timestamp_ms: Option<f64>) -> Result<String> {
        match (&self.det, explicit_ts(timestamp_ms)?) {
            (Some(det), ts) => {
                let t = ts.unwrap_or_else(core::now_ms);
                let mut rng = lock_recover(det);
                let hi = rng.draw_u64();
                let lo = rng.draw_u64();
                Ok(core::crockford::encode_string(u128::from_be_bytes(
                    core::batch::ulid_block(t, hi, lo),
                )))
            }
            (None, Some(t)) => Ok(core::crockford::encode_string(u128::from_be_bytes(
                core::batch::ulid_block_secure(t),
            ))),
            (None, None) => Ok(core::ulid::generate()),
        }
    }

    /// Next monotonic ULID (strictly increasing per instance).
    ///
    /// Accepts the same optional `timestampMs` as [`next`](#next); when
    /// given, times earlier than the last keep incrementing the previous
    /// value (reference `monotonicFactory(seedTime)` semantics).
    #[napi]
    pub fn monotonic(&self, timestamp_ms: Option<f64>) -> Result<String> {
        let mut mono = lock_recover(&self.mono);
        match (&self.det, explicit_ts(timestamp_ms)?) {
            (Some(det), Some(ts)) => {
                let mut rng = lock_recover(det);
                Ok(mono.next_deterministic_at(ts, &mut rng))
            }
            (Some(det), None) => {
                let mut rng = lock_recover(det);
                Ok(mono.next_deterministic(&mut rng))
            }
            (None, Some(ts)) => Ok(mono.next_secure_at(ts)),
            (None, None) => Ok(mono.next_secure()),
        }
    }

    /// True when this generator runs in deterministic (test) mode.
    #[napi(getter)]
    pub fn deterministic(&self) -> bool {
        self.det.is_some()
    }

    /// Generates `count` non-monotonic ULIDs with this generator's state in
    /// one call. Amortizes N-API dispatch (~116 ns/call for `next()`); all
    /// IDs share one timestamp, deterministic mode stays reproducible.
    ///
    /// (Raw array; declaration patched to `string[]` by post-build.)
    #[napi]
    pub fn next_many(&self, env: Env, count: i64) -> Result<napi::JsObject> {
        if !(0..=MAX_BATCH).contains(&count) {
            return Err(invalid_count(count));
        }
        let count = count as usize;
        let mut arr = env.create_array_with_length(count)?;
        let ts = core::now_ms();
        match &self.det {
            Some(det) => {
                let mut rng = lock_recover(det);
                for i in 0..count {
                    let hi = rng.draw_u64();
                    let lo = rng.draw_u64();
                    let ascii = core::crockford::encode_value(u128::from_be_bytes(
                        core::batch::ulid_block(ts, hi, lo),
                    ));
                    let s = env.create_string_latin1(&ascii)?;
                    arr.set_element(i as u32, s)?;
                }
            }
            None => {
                for i in 0..count {
                    let ascii = core::crockford::encode_value(u128::from_be_bytes(
                        core::batch::ulid_block_secure(ts),
                    ));
                    let s = env.create_string_latin1(&ascii)?;
                    arr.set_element(i as u32, s)?;
                }
            }
        }
        Ok(arr)
    }

    /// Generates `count` monotonic ULIDs with this generator's state in one
    /// call. The monotonic state advances across the whole batch under a
    /// single lock acquisition; same-millisecond increment semantics apply
    /// within the batch.
    ///
    /// (Raw array; declaration patched to `string[]` by post-build.)
    #[napi]
    pub fn monotonic_many(&self, env: Env, count: i64) -> Result<napi::JsObject> {
        if !(0..=MAX_BATCH).contains(&count) {
            return Err(invalid_count(count));
        }
        let count = count as usize;
        let mut arr = env.create_array_with_length(count)?;
        match &self.det {
            Some(det) => {
                let mut mono = lock_recover(&self.mono);
                let mut rng = lock_recover(det);
                for i in 0..count {
                    let s_str = mono.next_deterministic(&mut rng);
                    let s = env.create_string_latin1(s_str.as_bytes())?;
                    arr.set_element(i as u32, s)?;
                }
            }
            None => {
                let mut mono = lock_recover(&self.mono);
                for i in 0..count {
                    let s_str = mono.next_secure();
                    let s = env.create_string_latin1(s_str.as_bytes())?;
                    arr.set_element(i as u32, s)?;
                }
            }
        }
        Ok(arr)
    }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// No-op used by the benchmark suite to measure raw NAPI call overhead.
/// Not useful in application code.
#[napi]
pub fn noop() {}

// --- boundary probes (benchmark-only; not part of the public promise) ------

/// Boundary probe: void -> void with a number argument.
#[napi]
pub fn noop_arg(_x: u32) {}

/// Boundary probe: returns a cached-length u32.
#[napi]
pub fn version_len() -> u32 {
    26
}

/// Boundary probe: imports a JS string, measures UTF-8 import cost only.
#[napi]
pub fn consume_string(_s: String) {}

/// Boundary probe: exports a fixed 26-char ASCII string.
#[napi]
pub fn const_ulid_string() -> String {
    "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string()
}

/// Boundary probe: imports a Uint8Array, measures buffer import cost only.
#[napi]
pub fn consume_bytes(_b: Uint8Array) {}

/// Boundary probe: returns a zeroed Uint8Array of the requested size.
#[napi]
pub fn bytes_n(len: u32) -> Uint8Array {
    Uint8Array::new(vec![0u8; len as usize])
}

/// Boundary probe A: current-style Vec -> Uint8Array conversion.
#[napi]
pub fn ret_u8a_16() -> Uint8Array {
    Uint8Array::new(vec![0u8; 16])
}

/// Boundary probe B: napi_create_external_buffer via create_buffer_with_data.
#[napi]
pub fn ret_buf_16(env: Env) -> Result<napi::JsBuffer> {
    Ok(env.create_buffer_with_data(vec![0u8; 16])?.into_raw())
}

/// Boundary probe C: uninitialized napi_create_buffer (Node pooled path).
#[napi]
pub fn ret_buf_uninit_16(env: Env) -> Result<napi::JsBuffer> {
    let mut b = env.create_buffer(16)?;
    b.as_mut().fill(0);
    Ok(b.into_raw())
}

/// Probe G1: array built by pushing UTF-8 strings (mirrors old generateMany).
#[napi]
pub fn gen_arr_utf8_push(env: Env, count: u32) -> Result<napi::JsObject> {
    let mut arr = env.create_array_with_length(count as usize)?;
    for i in 0..count {
        let s = env.create_string("01ARZ3NDEKTSV4RRFFQ69G5FAV")?;
        arr.set_element(i, s)?;
    }
    Ok(arr)
}

/// Probe G2: same but latin1 (ASCII fast-path) string creation.
#[napi]
pub fn gen_arr_latin1_push(env: Env, count: u32) -> Result<napi::JsObject> {
    let mut arr = env.create_array_with_length(count as usize)?;
    for i in 0..count {
        let s = env.create_string_latin1(b"01ARZ3NDEKTSV4RRFFQ69G5FAV")?;
        arr.set_element(i, s)?;
    }
    Ok(arr)
}

/// Package version (matches the npm release).
#[napi]
pub fn version() -> String {
    format!("rivid-core {}", env!("CARGO_PKG_VERSION"))
}
