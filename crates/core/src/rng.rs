//! Randomness sources.
//!
//! ## Production (default): OS-seeded ChaCha12
//!
//! All default APIs draw randomness from [`rand::rng()`] — the `rand`
//! crate's thread-local generator: ChaCha12 seeded from the operating
//! system's secure entropy source (`getrandom`) and periodically reseeded
//! from it. This is a cryptographically-seeded PRNG suitable for identifier
//! generation; it is what mainstream libraries (e.g. `uuid` v4) use in
//! practice. It is NOT intended for deriving cryptographic key material —
//! if you need that, use your platform's direct OS entropy API.
//!
//! ## Deterministic (test only)
//!
//! [`DeterministicRng`] implements a Xoshiro256\*\* generator seeded via
//! SplitMix64 from a user-provided u64 seed. It is **not** secure, produces
//! fully reproducible sequences, and is only reachable through explicitly
//! named test-mode APIs (see `UlidGenerator`'s `seed` option). It can never
//! be selected accidentally by production code paths.

use rand::RngCore;
use std::cell::RefCell;

/// Amortises CSPRNG work: one ChaCha12 fill serves 32 ULID randomness draws.
struct EntropyPool {
    idx: usize,
    words: [u128; 32],
}

thread_local! {
    static POOL: RefCell<EntropyPool> = const { RefCell::new(EntropyPool { idx: 32, words: [0; 32] }) };
}

/// Draws 80 bits of randomness (the ULID random component).
///
/// Served from a thread-local pool refilled by the OS-seeded ChaCha12
/// thread-local generator every 32 draws — statistically identical to
/// drawing fresh, but with the generator's block overhead amortised.
#[inline]
#[must_use]
pub fn random_80() -> u128 {
    POOL.with_borrow_mut(|p| {
        if p.idx == p.words.len() {
            // SAFETY: `[u128; 32]` is trivially transmutable to its 512-byte
            // view — same alignment, no padding possible for a primitive array.
            let bytes: &mut [u8] =
                unsafe { std::slice::from_raw_parts_mut(p.words.as_mut_ptr().cast(), 512) };
            rand::rng().fill_bytes(bytes);
            p.idx = 0;
        }
        let v = p.words[p.idx];
        p.idx += 1;
        v & crate::id128::Id128::RANDOM_MASK
    })
}

/// Fills `buf` entirely with secure random bytes using the thread-local
/// generator (one call amortizes reseeding across the whole batch).
#[inline]
pub fn fill_secure(buf: &mut [u8]) {
    rand::rng().fill_bytes(buf);
}

/// Deterministic Xoshiro256\*\* generator for tests and reproducible fixtures.
///
/// **Not cryptographically secure.** Only use in test mode.
pub struct DeterministicRng {
    state: [u64; 4],
}

impl DeterministicRng {
    /// Creates a deterministic generator from a 64-bit seed (expanded to a
    /// 256-bit state with SplitMix64).
    ///
    /// The same seed always produces the same output sequence; different
    /// seeds produce practically uncorrelated sequences.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self::build(seed)
    }

    #[must_use]
    pub(crate) fn build(seed: u64) -> Self {
        let mut sm = SplitMix64 { state: seed };
        Self {
            state: [sm.next(), sm.next(), sm.next(), sm.next()],
        }
    }

    /// Draws the next 64 pseudorandom bits.
    ///
    /// Inherent wrapper so downstream crates don't need `rand`.
    #[inline]
    pub fn draw_u64(&mut self) -> u64 {
        RngCore::next_u64(self)
    }
}

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

impl RngCore for DeterministicRng {
    fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    fn next_u64(&mut self) -> u64 {
        // xoshiro256**
        let s = &mut self.state;
        let result = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        result
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        // Fill 8 bytes at a time; simple and correct for our buffer sizes.
        let mut chunks = dest.chunks_exact_mut(8);
        for chunk in &mut chunks {
            chunk.copy_from_slice(&self.next_u64().to_le_bytes());
        }
        let rem = chunks.into_remainder();
        if !rem.is_empty() {
            let bytes = self.next_u64().to_le_bytes();
            rem.copy_from_slice(&bytes[..rem.len()]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_same_seed_same_sequence() {
        let mut a = DeterministicRng::new(42);
        let mut b = DeterministicRng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn deterministic_different_seeds_differ() {
        let mut a = DeterministicRng::new(1);
        let mut b = DeterministicRng::new(2);
        let seq_a: Vec<u64> = (0..16).map(|_| a.next_u64()).collect();
        let seq_b: Vec<u64> = (0..16).map(|_| b.next_u64()).collect();
        assert_ne!(seq_a, seq_b);
    }

    #[test]
    fn fill_bytes_covers_remainder() {
        let mut r = DeterministicRng::new(7);
        let buf = &mut [0u8; 21];
        r.fill_bytes(buf);
        assert!(buf.iter().any(|&b| b != 0));
    }

    #[test]
    fn secure_rng_produces_varied_output() {
        let a = random_80();
        let b = random_80();
        assert_ne!(a, b); // 2^-80 collision chance
        assert!(a <= crate::id128::Id128::RANDOM_MASK);
    }
}
