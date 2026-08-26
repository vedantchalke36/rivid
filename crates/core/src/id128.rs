//! The shared 128-bit identifier primitive.
//!
//! ## Representation
//!
//! [`Id128`] stores the identifier as a native [`u128`]. The canonical byte
//! layout of every format in this crate is **big-endian** (`to_be_bytes` /
//! `from_be_bytes`):
//!
//! ```text
//! bytes[0..=5]   timestamp (48 bits, big-endian, ms since Unix epoch)
//! bytes[6..=15]  randomness / per-format payload (80 bits)
//! ```
//!
//! This matches both the ULID specification and RFC 9562 UUIDv7 wire order,
//! so a single conversion serves every format. `u128` is used internally
//! because monotonic increments, comparison and Base32 shifts are single
//! machine operations on 64-bit targets.

/// A 128-bit identifier: ULID, UUIDv7 or raw 16-byte ID, all sharing one
/// canonical big-endian byte layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Id128(u128);

impl Id128 {
    /// The all-zero identifier (`00000000000000000000000000` as a ULID).
    pub const ZERO: Id128 = Id128(0);

    /// Mask covering the 80-bit randomness component.
    pub const RANDOM_MASK: u128 = (1 << 80) - 1;

    #[inline]
    #[must_use]
    pub const fn from_u128(value: u128) -> Self {
        Id128(value)
    }

    #[inline]
    #[must_use]
    pub const fn as_u128(self) -> u128 {
        self.0
    }

    /// Build from canonical big-endian bytes.
    #[inline]
    #[must_use]
    pub const fn from_be_bytes(bytes: [u8; 16]) -> Self {
        Id128(u128::from_be_bytes(bytes))
    }

    /// Canonical big-endian representation shared by ULID/UUID/raw formats.
    #[inline]
    #[must_use]
    pub const fn to_be_bytes(self) -> [u8; 16] {
        self.0.to_be_bytes()
    }

    /// Construct from a millisecond timestamp and an 80-bit random part.
    ///
    /// Values above the 48-bit timestamp domain are truncated to the low 48
    /// bits; callers validate first ([`crate::TIME_MAX`]).
    #[inline]
    #[must_use]
    pub const fn from_parts(timestamp_ms: u64, randomness: u128) -> Self {
        Id128(
            ((timestamp_ms as u128 & ((1u128 << 48) - 1)) << 80) | (randomness & Self::RANDOM_MASK),
        )
    }

    /// Timestamp component in milliseconds (top 48 bits).
    #[inline]
    #[must_use]
    pub const fn timestamp_ms(self) -> u64 {
        (self.0 >> 80) as u64
    }

    /// Randomness component (low 80 bits).
    #[inline]
    #[must_use]
    pub const fn randomness(self) -> u128 {
        self.0 & Self::RANDOM_MASK
    }
}

impl From<u128> for Id128 {
    #[inline]
    fn from(v: u128) -> Self {
        Id128(v)
    }
}

impl From<Id128> for u128 {
    #[inline]
    fn from(id: Id128) -> u128 {
        id.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_round_trip() {
        let ts = 1_704_067_200_000u64;
        let rand = 0x0123_4567_89ab_cdef_0123u128;
        let id = Id128::from_parts(ts, rand);
        assert_eq!(id.timestamp_ms(), ts);
        assert_eq!(id.randomness(), rand);
    }

    #[test]
    fn be_bytes_layout_matches_ulid_spec() {
        // First 6 bytes are the timestamp, big-endian.
        let id = Id128::from_parts(0x0102_0304_0506, 0x0708_090a_0b0c_0d0e_0f10);
        let b = id.to_be_bytes();
        assert_eq!(&b[..6], &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
        assert_eq!(b[15], 0x10);
        assert_eq!(Id128::from_be_bytes(b), id);
    }

    #[test]
    fn truncates_out_of_domain_timestamp() {
        let id = Id128::from_parts(1 << 48, 0); // 2^48 -> wraps to 0
        assert_eq!(id.timestamp_ms(), 0);
    }

    #[test]
    fn ord_is_big_endian_value_order() {
        let a = Id128::from_parts(1, 0);
        let b = Id128::from_parts(1, 1);
        let c = Id128::from_parts(2, 0);
        assert!(a < b && b < c);
    }
}
