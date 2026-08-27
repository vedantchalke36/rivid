//! UUIDv7 generation (RFC 9562).
//!
//! Layout (big-endian wire order):
//!
//! ```text
//! bytes[0..6]   unix_ts_ms (48 bits, big-endian)
//! bytes[6]      version = 0x7 in the high nibble, rand_a high bits
//! bytes[7]      rand_a low bits
//! bytes[8]      variant = 0b10 in the top two bits, rand_b high bits
//! bytes[9..16]  rand_b low part
//! ```
//!
//! `ver = 0b0111` (7), `var = 0b10`. Randomness comes from the same secure
//! thread-local generator as ULIDs. Like the ULID batch APIs, a batch
//! captures `now` once and stamps all IDs with it.

use crate::batch::validate_block_len;
use crate::monotonic::SecureThreadRng;
use rand::Rng;

/// Builds one UUIDv7 block: RFC 9562 field layout over random bytes.
#[inline]
#[must_use]
pub fn uuidv7_block(timestamp_ms: u64, mut bytes: [u8; 16]) -> [u8; 16] {
    bytes[..6].copy_from_slice(&timestamp_ms.to_be_bytes()[2..]);
    // version 7: high nibble of byte 6.
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    // variant 10x: top two bits of byte 8.
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    bytes
}

/// Generates a UUIDv7 string in canonical lowercase hyphenated form.
#[must_use]
pub fn generate() -> String {
    let mut rng = SecureThreadRng;
    format_hyphenated(&generate_block(&mut rng, crate::now_ms()))
}

/// Generates a raw 16-byte UUIDv7.
#[must_use]
pub fn generate_bytes16() -> [u8; 16] {
    let mut rng = SecureThreadRng;
    generate_block(&mut rng, crate::now_ms())
}

/// Draws fresh randomness through [`uuidv7_block`] for one ID.
#[inline]
fn generate_block<R: Rng>(rng: &mut R, ts: u64) -> [u8; 16] {
    let hi = rng.next_u64();
    let lo = rng.next_u64();
    uuidv7_block(ts, ((hi as u128) << 64 | lo as u128).to_be_bytes())
}

/// Fills `buf` with UUIDv7 values (16 bytes each, multiple of 16 required).
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a
/// multiple of 16.
pub fn fill_secure(buf: &mut [u8]) -> crate::Result<usize> {
    validate_block_len(buf.len())?;
    let mut rng = SecureThreadRng;
    fill_with(buf, &mut rng)
}

/// Fills `buf` with UUIDv7 values using an explicit RNG.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a
/// multiple of 16.
pub fn fill_with<R: Rng>(buf: &mut [u8], rng: &mut R) -> crate::Result<usize> {
    validate_block_len(buf.len())?;
    let ts = crate::now_ms();
    for chunk in buf.chunks_exact_mut(16) {
        chunk.copy_from_slice(&generate_block(rng, ts));
    }
    Ok(buf.len() / 16)
}

/// Generates `count` canonical UUIDv7 strings with secure randomness.
#[must_use]
pub fn generate_strings(count: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(count);
    let ts = crate::now_ms();
    let mut rng = SecureThreadRng;
    for _ in 0..count {
        out.push(format_hyphenated(&generate_block(&mut rng, ts)));
    }
    out
}

/// Extracts the millisecond timestamp from UUIDv7 bytes.
#[inline]
#[must_use]
pub fn timestamp_ms(bytes: &[u8; 16]) -> u64 {
    let mut b = [0u8; 8];
    b[2..8].copy_from_slice(&bytes[..6]);
    u64::from_be_bytes(b)
}

/// Formats 16 bytes as the canonical lowercase hyphenated UUID form.
///
/// Shared with [`crate::convert`]; both formats share one big-endian layout.
#[inline]
#[must_use]
pub fn format_hyphenated(bytes: &[u8; 16]) -> String {
    crate::convert::format_hyphenated_lower(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_and_variant_bits_set() {
        for _ in 0..1000 {
            let id = generate();
            assert_eq!(id.len(), 36);
            let bytes = id.as_bytes();
            assert_eq!(bytes[14], b'7');
            assert!(matches!(bytes[19], b'8' | b'9' | b'a' | b'b'));
        }
    }

    #[test]
    fn timestamp_round_trip() {
        let b = generate_bytes16();
        let ts = timestamp_ms(&b);
        assert!((crate::now_ms() as i64 - ts as i64).abs() <= 1);
        assert_eq!(timestamp_ms(&uuidv7_block(ts + 5, [9u8; 16])), ts + 5);
    }

    #[test]
    fn uniqueness_smoke() {
        let ids = generate_strings(50_000);
        let set: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(set.len(), 50_000);
    }

    #[test]
    fn batch_fill_sets_fields() {
        let mut buf = vec![0u8; 16 * 32];
        assert_eq!(fill_secure(&mut buf).unwrap(), 32);
        for chunk in buf.chunks_exact(16) {
            let arr: [u8; 16] = chunk.try_into().unwrap();
            assert_eq!(arr[6] >> 4, 0x7);
            assert_eq!(arr[8] >> 6, 0b10);
            assert_ne!(&chunk[9..16], &[0u8; 7][..]);
        }
    }

    #[test]
    fn rejects_non_multiple_lengths() {
        assert!(fill_secure(&mut [0u8; 17]).is_err());
    }
}
