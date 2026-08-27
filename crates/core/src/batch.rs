//! Bulk generation: amortizes timestamp reads, RNG reseeding and (at the
//! NAPI layer) JavaScript boundary crossings across an entire batch.
//!
//! ## Timestamp semantics
//!
//! A batch captures `now` **once** and stamps every ID in the batch with it.
//! For batches that take longer than a millisecond to build this differs
//! from per-ID wall-clock reads by at most the batch duration; in exchange
//! every ID in a batch shares one consistent creation instant, which is what
//! high-throughput ingestion systems want.

use crate::crockford;
use crate::id128::Id128;
use rand::Rng;

/// Validates that a fill-buffer length is a multiple of 16.
pub(crate) fn validate_block_len(len: usize) -> crate::Result<()> {
    if len % 16 != 0 {
        return Err(crate::Error::InvalidLength {
            expected: len.next_multiple_of(16),
            got: len,
        });
    }
    Ok(())
}

/// Builds one 16-byte ULID block from a timestamp and two random u64 words.
#[inline]
#[must_use]
pub fn ulid_block(timestamp_ms: u64, r_hi: u64, r_lo: u64) -> [u8; 16] {
    let rand = (((r_hi as u128) << 64) | r_lo as u128) & Id128::RANDOM_MASK;
    Id128::from_parts(timestamp_ms, rand).to_be_bytes()
}

/// One ULID block stamped with an explicit timestamp, using secure
/// randomness (single-ID counterpart of [`fill_ulid_secure`]).
#[must_use]
pub fn ulid_block_secure(timestamp_ms: u64) -> [u8; 16] {
    let mut rng = crate::monotonic::SecureThreadRng;
    let hi = rng.next_u64();
    let lo = rng.next_u64();
    ulid_block(timestamp_ms, hi, lo)
}

/// Fills `buf` entirely with ULIDs (16 bytes each) using secure randomness.
///
/// `buf.len()` must be a multiple of 16. Returns the number of IDs written.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a
/// multiple of 16.
pub fn fill_ulid_secure(buf: &mut [u8]) -> crate::Result<usize> {
    validate_block_len(buf.len())?;
    let mut rng = crate::monotonic::SecureThreadRng;
    fill_ulid_with(buf, &mut rng)
}

/// Fills `buf` with ULIDs drawn from an explicit RNG (timestamp = now).
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a
/// multiple of 16.
pub fn fill_ulid_with<R: Rng>(buf: &mut [u8], rng: &mut R) -> crate::Result<usize> {
    let ts = crate::now_ms();
    fill_ulid_with_ts(buf, ts, rng)
}

/// Fills `buf` with ULIDs drawn from an explicit RNG, stamped with an
/// explicit timestamp (the NAPI layer pins one `now` for the whole batch).
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a
/// multiple of 16.
pub fn fill_ulid_with_ts<R: Rng>(buf: &mut [u8], ts: u64, rng: &mut R) -> crate::Result<usize> {
    validate_block_len(buf.len())?;
    for chunk in buf.chunks_exact_mut(16) {
        let hi = rng.next_u64();
        let lo = rng.next_u64();
        chunk.copy_from_slice(&ulid_block(ts, hi, lo));
    }
    Ok(buf.len() / 16)
}

/// Generates `count` canonical ULID strings using secure randomness.
///
/// All IDs share the batch's single captured timestamp.
#[must_use]
pub fn generate_ulid_strings(count: usize) -> Vec<String> {
    let mut rng = crate::monotonic::SecureThreadRng;
    let ts = crate::now_ms();
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let hi = rng.next_u64();
        let lo = rng.next_u64();
        out.push(crockford::encode_string(u128::from_be_bytes(ulid_block(
            ts, hi, lo,
        ))));
    }
    out
}

/// Generates `count` raw ULIDs into a freshly allocated byte vector
/// (`count * 16` bytes).
#[must_use]
pub fn generate_ulid_bytes(count: usize) -> Vec<u8> {
    let mut buf = vec![0u8; count * 16];
    // The length is a multiple of 16 by construction, so the only error
    // variant is impossible; a violation would mean corrupted allocation
    // logic upstream, which must be loud rather than silently zero-filled.
    if let Err(e) = fill_ulid_secure(&mut buf) {
        unreachable!("fill_ulid_secure failed on an internally allocated buffer: {e}");
    }
    buf
}

/// Fills `pairs` with random u128 values drawn from the secure
/// thread-local generator. Each u128 holds two u64 random words suitable
/// for [`ulid_block`].
///
/// This is the batch-optimized counterpart of calling `ulid_block_secure`
/// per element — it amortizes pool-refill checks across the whole batch.
pub fn fill_random_pairs(pairs: &mut [u128]) {
    let mut rng = crate::monotonic::SecureThreadRng;
    for slot in pairs.iter_mut() {
        let hi = rng.next_u64();
        let lo = rng.next_u64();
        *slot = ((hi as u128) << 64) | lo as u128;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crockford;

    #[test]
    fn fill_produces_valid_ids() {
        let mut buf = [0u8; 16 * 100];
        let n = fill_ulid_secure(&mut buf).unwrap();
        assert_eq!(n, 100);
        for chunk in buf.chunks_exact(16) {
            let v = u128::from_be_bytes(chunk.try_into().unwrap());
            assert!(v != 0);
            // Timestamp component must equal roughly now.
            let id = Id128::from_u128(v);
            let now = crate::now_ms();
            assert!((now as i64 - id.timestamp_ms() as i64).abs() <= 1);
        }
    }

    #[test]
    fn fill_rejects_bad_lengths() {
        let mut buf = [0u8; 15];
        assert!(fill_ulid_secure(&mut buf).is_err());
    }

    #[test]
    fn strings_are_unique_and_valid() {
        let ids = generate_ulid_strings(50_000);
        assert_eq!(ids.len(), 50_000);
        let set: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(set.len(), 50_000);
        for id in &ids {
            assert_eq!(id.len(), 26);
            assert!(crate::ulid::is_valid(id.as_bytes()));
            assert!(crockford::decode_chars(id.as_bytes()).is_ok());
        }
    }

    #[test]
    fn byte_batch_matches_string_encoding() {
        let buf = generate_ulid_bytes(10);
        assert_eq!(buf.len(), 160);
        for chunk in buf.chunks_exact(16) {
            let s = crockford::encode_string(u128::from_be_bytes(chunk.try_into().unwrap()));
            assert_eq!(s.len(), 26);
        }
    }

    #[test]
    fn fill_random_pairs_produces_varied_output() {
        let mut pairs = [0u128; 100];
        fill_random_pairs(&mut pairs);
        // All values should be non-zero
        for &v in &pairs {
            assert!(v != 0);
        }
        // Should have reasonable variety
        let unique: std::collections::HashSet<u128> = pairs.iter().copied().collect();
        assert!(unique.len() > 90);
    }
}
