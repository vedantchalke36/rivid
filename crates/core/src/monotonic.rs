//! Monotonic ULID generation.
//!
//! Within the same millisecond (or when the clock appears to move
//! backwards), the 80-bit random component of the previous ULID is
//! incremented by one instead of being replaced. This guarantees strictly
//! increasing values for successive calls.
//!
//! Overflow handling: if the random component is already at its maximum
//! (probability ~2^-80 per millisecond) the generator spins until the wall
//! clock advances to the next millisecond, then reseeds. The reference
//! JavaScript implementation throws in this case; waiting preserves
//! "never throws" ergonomics while remaining spec-compliant.

use crate::id128::Id128;
use crate::rng::DeterministicRng;
use rand::rand_core::TryRng;
use rand::Rng;
use rand::RngExt;
use std::convert::Infallible;

/// Adapter exposing the secure thread-local generator through [`TryRng`] so
/// secure and deterministic paths share one code path.
pub(crate) struct SecureThreadRng;

impl TryRng for SecureThreadRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        Ok(rand::rng().next_u32())
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        Ok(rand::rng().next_u64())
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), Infallible> {
        rand::rng().fill(dest);
        Ok(())
    }
}

/// State machine shared by `monotonicUlid()` and generator instances.
///
/// Not `Sync`: each thread or generator instance owns its own state.
pub struct MonotonicState {
    last_ms: u64,
    last_rand: u128,
}

impl MonotonicState {
    /// Creates fresh state: the first call is treated as a new millisecond
    /// and draws fresh randomness.
    #[must_use]
    pub fn new() -> Self {
        Self {
            last_ms: 0,
            last_rand: 0,
        }
    }

    /// Produces the next monotonic ULID using secure randomness.
    #[must_use]
    pub fn next_secure(&mut self) -> String {
        let mut rng = SecureThreadRng;
        self.next_with(crate::now_ms(), &mut rng)
    }

    /// Produces the next monotonic ULID using a deterministic RNG
    /// (test mode only).
    #[must_use]
    pub fn next_deterministic(&mut self, rng: &mut DeterministicRng) -> String {
        self.next_with(crate::now_ms(), rng)
    }

    /// Like [`next_secure`] but stamped with an explicit timestamp
    /// (`seedTime` in reference-API terms).
    pub fn next_secure_at(&mut self, now_ms: u64) -> String {
        let mut rng = SecureThreadRng;
        self.next_with(now_ms, &mut rng)
    }

    /// Deterministic variant of [`next_secure_at`].
    pub fn next_deterministic_at(&mut self, now_ms: u64, rng: &mut DeterministicRng) -> String {
        self.next_with(now_ms, rng)
    }

    #[inline]
    fn next_with<R: Rng>(&mut self, now: u64, rng: &mut R) -> String {
        let (ms, rand) = self.advance(now, rng);
        crate::crockford::encode_string(Id128::from_parts(ms, rand).as_u128())
    }

    #[inline]
    fn advance<R: Rng>(&mut self, now: u64, rng: &mut R) -> (u64, u128) {
        if now > self.last_ms {
            // New millisecond: fresh randomness.
            self.last_ms = now;
            self.last_rand = draw_80(rng);
        } else if self.last_rand < Id128::RANDOM_MASK {
            // Same ms (or clock went backwards): increment previous value.
            self.last_rand += 1;
        } else {
            // Random space exhausted within this ms (~2^-80 probability):
            // wait for the clock to move on, then reseed.
            spin_until_next_ms(self.last_ms);
            self.last_ms = crate::now_ms();
            self.last_rand = draw_80(rng);
        }
        (self.last_ms, self.last_rand)
    }
}

impl Default for MonotonicState {
    fn default() -> Self {
        Self::new()
    }
}

#[inline]
fn draw_80<R: Rng>(rng: &mut R) -> u128 {
    (((rng.next_u64() as u128) << 64) | rng.next_u64() as u128) & Id128::RANDOM_MASK
}

#[inline]
fn spin_until_next_ms(current: u64) {
    while crate::now_ms() <= current {
        std::hint::spin_loop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strictly_increasing_within_same_call_batch() {
        let mut state = MonotonicState::new();
        let mut prev = 0u128;
        for _ in 0..10_000 {
            let v = crockford_val(state.next_secure().as_str());
            assert!(v > prev, "monotonic violation");
            prev = v;
        }
    }

    #[test]
    fn deterministic_mode_is_monotonic_and_reproducible() {
        let now = 1_700_000_000_000u64;
        let mut a = MonotonicState::new();
        let mut ra = DeterministicRng::new(12345);
        let mut b = MonotonicState::new();
        let mut rb = DeterministicRng::new(12345);
        for _ in 0..1000 {
            assert_eq!(
                a.next_deterministic_at(now, &mut ra),
                b.next_deterministic_at(now, &mut rb)
            );
        }
        // Same-ms increments still strictly increase.
        let seq: Vec<u128> = (0..100)
            .map(|_| crockford_val(a.next_deterministic_at(now, &mut ra).as_str()))
            .collect();
        for w in seq.windows(2) {
            assert!(w[0] < w[1]);
        }
    }

    #[test]
    fn seed_time_semantics_match_reference() {
        // Same or earlier seedTime: increment previous random part.
        let mut s = MonotonicState::new();
        let mut rng = DeterministicRng::new(9);
        let first = s.next_deterministic_at(1000, &mut rng);
        let second = s.next_deterministic_at(1000, &mut rng);
        let earlier = s.next_deterministic_at(999, &mut rng);
        assert_eq!(&first[..10], "00000000Z8"); // encode_time(1000)
        assert_eq!(&second[..10], &first[..10]);
        assert_eq!(&earlier[..10], &second[..10]); // keeps last ms
        assert!(crockford_val(&first) < crockford_val(&second));
        assert!(crockford_val(&second) < crockford_val(&earlier));
        // Newer seedTime: fresh randomness.
        let later = s.next_deterministic_at(2000, &mut rng);
        assert_eq!(&later[..10], "00000001YG"); // encode_time(2000)
    }

    #[test]
    fn fresh_ms_resets_random_component() {
        // A state whose "last" is far in the past reseeds rather than
        // incrementing millions of times.
        let mut state = MonotonicState {
            last_ms: 1,
            last_rand: 5,
        };
        let s = state.next_secure();
        let v = crockford_val(s.as_str());
        assert!(v > 0);
    }

    fn crockford_val(s: &str) -> u128 {
        crate::crockford::decode_chars(s.as_bytes()).unwrap()
    }
}
