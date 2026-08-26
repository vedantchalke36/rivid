//! # rivid-core
//!
//! Platform-independent Rust ID engine powering `@rivid/core`.
//!
//! The crate is deliberately free of any Node.js / NAPI dependency so it can be
//! tested and benchmarked directly in Rust (`cargo test`, `cargo bench`).
//!
//! ## Layout
//!
//! * [`id128`] — the 128-bit identifier primitive every format shares.
//! * [`crockford`] — canonical Crockford Base32 codec (ULID encoding).
//! * [`ulid`] — ULID generation, validation, timestamps, comparison.
//! * [`monotonic`] — monotonic ULID state machine (same-ms increment).
//! * [`rng`] — secure (default) and deterministic (test-only) randomness.
//! * [`batch`] — bulk generation into raw buffers or string vectors.
//! * [`uuidv7`] — RFC 9562 UUIDv7 generation.
//! * [`base58`], [`base64url`], [`sortable`] — alternative encodings.
//! * [`convert`] — ULID <-> UUID string conversions.

pub mod base58;
pub mod base64url;
pub mod batch;
pub mod convert;
pub mod crockford;
pub mod error;
pub mod id128;
pub mod monotonic;
pub mod rng;
pub mod sortable;
pub mod ulid;
pub mod uuidv7;

pub use error::{Error, Result};
pub use id128::Id128;

/// ULID spec: maximum 48-bit timestamp value (2^48 - 1).
pub const TIME_MAX: u64 = (1 << 48) - 1;

/// ULID spec: length of the encoded timestamp component in characters.
pub const TIME_LEN: usize = 10;

/// ULID spec: length of the encoded randomness component in characters.
pub const RANDOM_LEN: usize = 16;

/// ULID spec: total encoded length in characters.
pub const ULID_LEN: usize = TIME_LEN + RANDOM_LEN; // 26

/// Milliseconds per second, exported for completeness of the time domain.
pub const TIME_MS: u64 = 1000;

/// Current wall-clock time in milliseconds since the Unix epoch.
///
/// A system clock set before 1970 clamps to `0` rather than panicking; a
/// ULID timestamp is unsigned by specification.
///
/// On platforms without a real-time clock (Wasm, some embedded targets),
/// [`set_clock_override`] supplies the value instead; `SystemTime` is then
/// never touched.
#[inline]
#[must_use]
pub fn now_ms() -> u64 {
    if CLOCK_OVERRIDE_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
        return CLOCK_OVERRIDE_MS.load(std::sync::atomic::Ordering::Relaxed);
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        // System clock before 1970: clamp to 0 rather than panicking. A ULID
        // timestamp is unsigned by specification.
        .map_or(0, |d| d.as_millis() as u64)
}

static CLOCK_OVERRIDE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CLOCK_OVERRIDE_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Force [`now_ms`] (and therefore every default-clock generation path) to
/// return `ms` until [`clear_clock_override`] is called.
///
/// Intended for embedders on clock-less platforms — the Wasm bindings feed
/// `Date.now()` through this — and for deterministic integration tests.
pub fn set_clock_override(ms: u64) {
    CLOCK_OVERRIDE_MS.store(ms, std::sync::atomic::Ordering::Relaxed);
    CLOCK_OVERRIDE_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Return to reading the platform wall clock.
pub fn clear_clock_override() {
    CLOCK_OVERRIDE_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_match_spec() {
        assert_eq!(TIME_MAX, 281_474_976_710_655);
        assert_eq!(ULID_LEN, 26);
        assert_eq!(TIME_LEN, 10);
        assert_eq!(RANDOM_LEN, 16);
    }

    #[test]
    fn clock_override_round_trip() {
        clear_clock_override();
        let real = now_ms();

        set_clock_override(1_700_000_000_000);
        assert_eq!(now_ms(), 1_700_000_000_000);

        clear_clock_override();
        let after = now_ms();
        assert!(after >= real, "clock override must release cleanly");
    }

    #[test]
    fn batch_paths_honor_override() {
        use crate::batch::generate_ulid_strings;
        clear_clock_override();
        set_clock_override(1_469_918_176_385);
        let ids = generate_ulid_strings(4);
        clear_clock_override();
        for id in ids {
            assert_eq!(&id[..TIME_LEN], "01ARYZ6S41");
        }
    }
}
