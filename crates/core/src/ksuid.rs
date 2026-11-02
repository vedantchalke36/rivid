//! Segment KSUID generation, validation and comparison.
//!
//! A KSUID is a 20-byte, lexicographically sortable identifier:
//!
//! ```text
//! bytes[0..=3]   32-bit timestamp (seconds since 2014-05-13T16:53:20Z)
//! bytes[4..=19]  128-bit random payload
//! ```
//!
//! The canonical text representation is 27 base62 characters using the
//! alphabet `0-9A-Za-z`. That alphabet is ASCII-ordered, so lexicographic
//! string order equals byte order. Unlike ULID, the timestamp has
//! second-level precision and generation is not monotonic.
//!
//! Rivid exposes timestamps in Unix **milliseconds** at the binding layer
//! (matching the ULID API), while the wire format stores seconds. `decode*`
//! helpers return milliseconds, truncated to the encoded second.

/// KSUID's custom epoch: 2014-05-13T16:53:20Z in Unix seconds.
pub const EPOCH_SECONDS: u64 = 1_400_000_000;

/// KSUID's custom epoch in Unix milliseconds.
pub const EPOCH_MS: u64 = EPOCH_SECONDS * 1_000;

/// Number of bytes in a binary KSUID.
pub const BYTE_LEN: usize = 20;

/// Number of characters in a canonical string KSUID.
pub const STRING_LEN: usize = 27;

/// Maximum Unix second representable by the 32-bit KSUID timestamp.
pub const TIME_MAX_SECONDS: u64 = EPOCH_SECONDS + u32::MAX as u64;

/// Maximum Unix millisecond accepted by the millisecond-facing API.
pub const TIME_MAX_MS: u64 = TIME_MAX_SECONDS * 1_000;

/// Base62 alphabet used by KSUID. The ASCII ordering of this alphabet is what
/// makes canonical strings sortable.
pub const ALPHABET: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Canonical string representation of the maximum KSUID value (`2^160 - 1`).
pub const MAX_STRING: &[u8; STRING_LEN] = b"aWgEPTl1tmebfsQzFP4bxwgy80V";

/// Canonical string representation of the minimum KSUID value.
pub const MIN_STRING: &[u8; STRING_LEN] = b"000000000000000000000000000";

const INVALID: i8 = -1;

static DECODE: [i8; 256] = build_decode_table();

const fn build_decode_table() -> [i8; 256] {
    let mut table = [INVALID; 256];
    let mut i = 0;
    while i < 62 {
        table[ALPHABET[i] as usize] = i as i8;
        i += 1;
    }
    table
}

#[inline]
fn decode_char(b: u8) -> crate::Result<u8> {
    match DECODE[b as usize] {
        INVALID => Err(crate::Error::InvalidCharacter(b)),
        d => Ok(d as u8),
    }
}

/// A 160-bit KSUID in canonical big-endian wire order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Ksuid([u8; BYTE_LEN]);

impl Ksuid {
    /// Wraps exactly 20 canonical big-endian bytes.
    #[inline]
    #[must_use]
    pub const fn from_bytes(bytes: [u8; BYTE_LEN]) -> Self {
        Ksuid(bytes)
    }

    /// Builds a KSUID from an explicit Unix timestamp (seconds) and payload.
    ///
    /// # Errors
    ///
    /// Returns [`crate::Error::KsuidTimestampOutOfRange`] when `unix_seconds`
    /// is before [`EPOCH_SECONDS`] or above [`TIME_MAX_SECONDS`].
    pub fn from_parts(unix_seconds: u64, payload: [u8; 16]) -> crate::Result<Self> {
        let field = timestamp_field(unix_seconds)?;
        Ok(Self::from_field(field, payload))
    }

    #[inline]
    fn from_field(field: u32, payload: [u8; 16]) -> Self {
        let mut bytes = [0u8; BYTE_LEN];
        bytes[..4].copy_from_slice(&field.to_be_bytes());
        bytes[4..].copy_from_slice(&payload);
        Ksuid(bytes)
    }

    /// Generates a KSUID with the current wall clock and secure randomness.
    #[must_use]
    pub fn generate() -> Self {
        let field = current_timestamp_field();
        let payload = crate::rng::random_128().to_be_bytes();
        Self::from_field(field, payload)
    }

    /// Generates a KSUID at an explicit Unix timestamp in seconds.
    ///
    /// # Errors
    ///
    /// Same range rules as [`Ksuid::from_parts`].
    pub fn generate_at_unix_seconds(unix_seconds: u64) -> crate::Result<Self> {
        let field = timestamp_field(unix_seconds)?;
        Ok(Self::from_field(
            field,
            crate::rng::random_128().to_be_bytes(),
        ))
    }

    /// Generates a KSUID at an explicit Unix timestamp in milliseconds.
    ///
    /// The millisecond is floored to the KSUID's encoded second.
    ///
    /// # Errors
    ///
    /// Returns [`crate::Error::KsuidTimestampOutOfRange`] outside the
    /// representable KSUID window.
    pub fn generate_at_unix_ms(unix_ms: u64) -> crate::Result<Self> {
        if !(EPOCH_MS..=TIME_MAX_MS).contains(&unix_ms) {
            return Err(crate::Error::KsuidTimestampOutOfRange(unix_ms));
        }
        Self::generate_at_unix_seconds(unix_ms / 1_000)
    }

    /// Raw 20-byte big-endian representation.
    #[inline]
    #[must_use]
    pub const fn to_bytes(self) -> [u8; BYTE_LEN] {
        self.0
    }

    /// Borrow the raw bytes without copying.
    #[inline]
    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; BYTE_LEN] {
        &self.0
    }

    /// Unix timestamp in seconds (the precision actually stored).
    #[inline]
    #[must_use]
    pub fn timestamp_seconds(self) -> u64 {
        u32::from_be_bytes(self.0[..4].try_into().unwrap()) as u64 + EPOCH_SECONDS
    }

    /// Unix timestamp in milliseconds, truncated to the encoded second.
    #[inline]
    #[must_use]
    pub fn timestamp_ms(self) -> u64 {
        self.timestamp_seconds() * 1_000
    }

    /// The 128-bit random payload.
    #[inline]
    #[must_use]
    pub fn payload(self) -> [u8; 16] {
        self.0[4..].try_into().unwrap()
    }

    /// Encodes as the canonical 27-character base62 string.
    #[inline]
    #[must_use]
    pub fn encode(self) -> String {
        encode_string(&self.0)
    }

    /// Parses a canonical 27-character base62 KSUID.
    ///
    /// # Errors
    ///
    /// * [`crate::Error::InvalidLength`] — input is not exactly 27 bytes.
    /// * [`crate::Error::InvalidCharacter`] — a byte outside `0-9A-Za-z`.
    /// * [`crate::Error::KsuidValueTooLarge`] — the decoded value exceeds 160 bits.
    pub fn parse(id: &str) -> crate::Result<Self> {
        decode_str(id)
    }
}

impl std::fmt::Display for Ksuid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.encode())
    }
}

/// Generates a KSUID string with the current time and secure randomness.
#[must_use]
pub fn generate() -> String {
    Ksuid::generate().encode()
}

/// Generates one raw 20-byte KSUID.
#[must_use]
pub fn generate_bytes20() -> [u8; BYTE_LEN] {
    Ksuid::generate().to_bytes()
}

/// Generates a KSUID string at an explicit Unix timestamp in seconds.
///
/// # Errors
///
/// Same range rules as [`Ksuid::from_parts`].
pub fn generate_at_unix_seconds(unix_seconds: u64) -> crate::Result<String> {
    Ksuid::generate_at_unix_seconds(unix_seconds).map(Ksuid::encode)
}

/// Generates a KSUID string at an explicit Unix timestamp in milliseconds.
///
/// # Errors
///
/// Same range rules as [`Ksuid::generate_at_unix_ms`].
pub fn generate_at_unix_ms(unix_ms: u64) -> crate::Result<String> {
    Ksuid::generate_at_unix_ms(unix_ms).map(Ksuid::encode)
}

/// Encodes exactly 20 bytes as a canonical 27-character KSUID string.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] unless `bytes.len() == 20`.
pub fn encode(bytes: &[u8]) -> crate::Result<String> {
    if bytes.len() != BYTE_LEN {
        return Err(crate::Error::InvalidLength {
            expected: BYTE_LEN,
            got: bytes.len(),
        });
    }
    let mut arr = [0u8; BYTE_LEN];
    arr.copy_from_slice(bytes);
    Ok(encode_string(&arr))
}

/// Encodes exactly 20 bytes into a stack-allocated 27-character buffer.
#[must_use]
pub fn encode_string(bytes: &[u8; BYTE_LEN]) -> String {
    // SAFETY: every byte in the output comes from the ASCII base62 alphabet.
    unsafe { String::from_utf8_unchecked(encode_value(bytes).to_vec()) }
}

/// Encodes exactly 20 bytes into a stack-allocated 27-character array.
#[must_use]
pub fn encode_value(bytes: &[u8; BYTE_LEN]) -> [u8; STRING_LEN] {
    let mut limbs = [
        u32::from_be_bytes(bytes[0..4].try_into().unwrap()),
        u32::from_be_bytes(bytes[4..8].try_into().unwrap()),
        u32::from_be_bytes(bytes[8..12].try_into().unwrap()),
        u32::from_be_bytes(bytes[12..16].try_into().unwrap()),
        u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
    ];
    let mut out = [b'0'; STRING_LEN];

    // 62^27 > 2^160, so 27 divisions always consume the full value.
    let mut pos = STRING_LEN;
    while pos > 0 {
        pos -= 1;
        let mut rem = 0u64;
        for limb in &mut limbs {
            let value = (rem << 32) | u64::from(*limb);
            *limb = (value / 62) as u32;
            rem = value % 62;
        }
        out[pos] = ALPHABET[rem as usize];
    }
    out
}

/// Decodes a canonical 27-character KSUID string into 20 bytes.
///
/// # Errors
///
/// Same rules as [`Ksuid::parse`].
pub fn decode(id: &str) -> crate::Result<[u8; BYTE_LEN]> {
    decode_str(id).map(Ksuid::to_bytes)
}

/// Validates a KSUID string: exact length, base62 alphabet, and no overflow
/// past 160 bits.
#[must_use]
pub fn is_valid(id: &[u8]) -> bool {
    decode_bytes(id).is_ok()
}

/// Extracts the Unix timestamp (seconds) from a 20-byte KSUID.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] unless `bytes.len() == 20`.
pub fn time_seconds(bytes: &[u8]) -> crate::Result<u64> {
    if bytes.len() != BYTE_LEN {
        return Err(crate::Error::InvalidLength {
            expected: BYTE_LEN,
            got: bytes.len(),
        });
    }
    let field = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as u64;
    Ok(field + EPOCH_SECONDS)
}

/// Extracts the Unix timestamp (milliseconds) from a 20-byte KSUID.
///
/// # Errors
///
/// Same rules as [`time_seconds`].
pub fn time_ms(bytes: &[u8]) -> crate::Result<u64> {
    time_seconds(bytes).map(|s| s * 1_000)
}

/// Extracts the Unix timestamp (milliseconds) from a string KSUID.
///
/// # Errors
///
/// Same rules as [`Ksuid::parse`].
pub fn decode_time_ms(id: &str) -> crate::Result<u64> {
    decode_str(id).map(|k| k.timestamp_ms())
}

/// Compares two KSUIDs by their full 160-bit value.
///
/// # Errors
///
/// Returns the parse errors of either operand.
pub fn compare(a: &str, b: &str) -> crate::Result<std::cmp::Ordering> {
    Ok(decode_str(a)?.cmp(&decode_str(b)?))
}

/// Generates `count` canonical KSUID strings, sharing one captured second.
#[must_use]
pub fn generate_strings(count: usize) -> Vec<String> {
    let field = current_timestamp_field();
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let payload = crate::rng::random_128().to_be_bytes();
        out.push(Ksuid::from_field(field, payload).encode());
    }
    out
}

/// Generates `count` raw 20-byte KSUIDs into one contiguous vector.
#[must_use]
pub fn generate_bytes(count: usize) -> Vec<u8> {
    let mut buf = vec![0u8; count * BYTE_LEN];
    // The length is a multiple of BYTE_LEN by construction.
    if let Err(e) = fill_secure(&mut buf) {
        unreachable!("fill_secure failed on an internally allocated buffer: {e}");
    }
    buf
}

/// Fills `buf` with raw KSUIDs (20 bytes each) using secure randomness.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] when `buf.len()` is not a multiple
/// of 20.
pub fn fill_secure(buf: &mut [u8]) -> crate::Result<usize> {
    if buf.len() % BYTE_LEN != 0 {
        return Err(crate::Error::InvalidLength {
            expected: buf.len().next_multiple_of(BYTE_LEN),
            got: buf.len(),
        });
    }
    let field = current_timestamp_field().to_be_bytes();
    for chunk in buf.chunks_exact_mut(BYTE_LEN) {
        chunk[..4].copy_from_slice(&field);
        crate::rng::fill_secure(&mut chunk[4..]);
    }
    Ok(buf.len() / BYTE_LEN)
}

#[inline]
fn timestamp_field(unix_seconds: u64) -> crate::Result<u32> {
    if !(EPOCH_SECONDS..=TIME_MAX_SECONDS).contains(&unix_seconds) {
        return Err(crate::Error::KsuidTimestampOutOfRange(unix_seconds));
    }
    Ok((unix_seconds - EPOCH_SECONDS) as u32)
}

#[inline]
fn current_timestamp_field() -> u32 {
    let now = crate::now_ms() / 1_000;
    // Wall clocks outside the KSUID era are clamped to the representable
    // window rather than panicking. The normal range is 2014-2150.
    (now.clamp(EPOCH_SECONDS, TIME_MAX_SECONDS) - EPOCH_SECONDS) as u32
}

fn decode_bytes(id: &[u8]) -> crate::Result<[u8; BYTE_LEN]> {
    if id.len() != STRING_LEN {
        return Err(crate::Error::InvalidLength {
            expected: STRING_LEN,
            got: id.len(),
        });
    }

    let mut limbs = [0u32; 5];
    for &byte in id {
        let digit = u64::from(decode_char(byte)?);
        let mut carry = digit;
        for limb in limbs.iter_mut().rev() {
            let value = u64::from(*limb) * 62 + carry;
            *limb = value as u32;
            carry = value >> 32;
        }
        if carry != 0 {
            return Err(crate::Error::KsuidValueTooLarge);
        }
    }

    let mut bytes = [0u8; BYTE_LEN];
    bytes[0..4].copy_from_slice(&limbs[0].to_be_bytes());
    bytes[4..8].copy_from_slice(&limbs[1].to_be_bytes());
    bytes[8..12].copy_from_slice(&limbs[2].to_be_bytes());
    bytes[12..16].copy_from_slice(&limbs[3].to_be_bytes());
    bytes[16..20].copy_from_slice(&limbs[4].to_be_bytes());
    Ok(bytes)
}

fn decode_str(id: &str) -> crate::Result<Ksuid> {
    decode_bytes(id.as_bytes()).map(Ksuid::from_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "0ujtsYcgvSTl8PAuAdqWYSMnLOv";

    #[test]
    fn constants_match_spec() {
        assert_eq!(EPOCH_SECONDS, 1_400_000_000);
        assert_eq!(BYTE_LEN, 20);
        assert_eq!(STRING_LEN, 27);
        assert_eq!(TIME_MAX_SECONDS, 5_694_967_295);
        assert_eq!(TIME_MAX_MS, 5_694_967_295_000);
    }

    #[test]
    fn known_string_vectors() {
        assert_eq!(
            Ksuid::from_bytes([0u8; 20]).encode(),
            "000000000000000000000000000"
        );
        assert_eq!(
            Ksuid::from_bytes([0xffu8; 20]).encode(),
            std::str::from_utf8(MAX_STRING).unwrap()
        );
        assert_eq!(Ksuid::parse(SAMPLE).unwrap().encode(), SAMPLE);
    }

    #[test]
    fn sample_timestamp() {
        let k = Ksuid::parse(SAMPLE).unwrap();
        assert_eq!(
            k.to_bytes(),
            [
                0x06, 0x69, 0xf7, 0xef, 0xb5, 0xa1, 0xcd, 0x34, 0xb5, 0xf9, 0x9d, 0x11, 0x54, 0xfb,
                0x68, 0x53, 0x34, 0x5c, 0x97, 0x35,
            ]
        );
        assert_eq!(k.timestamp_seconds(), 1_507_608_047);
        assert_eq!(k.timestamp_ms(), 1_507_608_047_000);
    }

    #[test]
    fn round_trip_random_bytes() {
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..20_000 {
            let mut bytes = [0u8; 20];
            for chunk in bytes.chunks_exact_mut(8) {
                chunk.copy_from_slice(&next().to_be_bytes());
            }
            let s = encode_string(&bytes);
            assert_eq!(s.len(), 27);
            assert_eq!(decode(&s).unwrap(), bytes);
            assert!(is_valid(s.as_bytes()));
        }
    }

    #[test]
    fn string_order_matches_value_order() {
        let mut values: Vec<[u8; 20]> = (0u8..100)
            .map(|i| {
                let mut b = [0u8; 20];
                b[19] = i;
                b
            })
            .collect();
        values.sort_unstable();
        let strings: Vec<String> = values.iter().map(encode_string).collect();
        let mut sorted = strings.clone();
        sorted.sort();
        assert_eq!(strings, sorted);
    }

    #[test]
    fn rejects_malformed_strings() {
        assert!(Ksuid::parse("").is_err());
        assert!(Ksuid::parse("0").is_err());
        assert!(Ksuid::parse(&"0".repeat(26)).is_err());
        assert!(Ksuid::parse(&"0".repeat(28)).is_err());
        assert!(Ksuid::parse("aWgEPTl1tmebfsQzFP4bxwgy80W").is_err()); // > max
        assert!(Ksuid::parse("aWgEPTl1tmebfsQzFP4bxwgy80v").is_err()); // lowercase v > max
        assert!(Ksuid::parse("b00000000000000000000000000").is_err()); // leading digit too high
        assert!(Ksuid::parse("___________________________").is_err());
    }

    #[test]
    fn validates_known_values() {
        for s in [
            std::str::from_utf8(MIN_STRING).unwrap(),
            std::str::from_utf8(MAX_STRING).unwrap(),
            SAMPLE,
            "0ujtsYcgvSTl8PAuAdqWYSMnLOW",
        ] {
            assert!(is_valid(s.as_bytes()), "{s}");
        }
        assert!(!is_valid(b""));
        assert!(!is_valid(b"0ujtsYcgvSTl8PAuAdqWYSMnLO"));
        assert!(!is_valid(b"0ujtsYcgvSTl8PAuAdqWYSMnLOv "));
    }

    #[test]
    fn part_timestamp_range() {
        assert!(Ksuid::from_parts(EPOCH_SECONDS, [0u8; 16]).is_ok());
        assert!(Ksuid::from_parts(TIME_MAX_SECONDS, [0u8; 16]).is_ok());
        assert!(Ksuid::from_parts(EPOCH_SECONDS - 1, [0u8; 16]).is_err());
        assert!(Ksuid::from_parts(TIME_MAX_SECONDS + 1, [0u8; 16]).is_err());
        assert!(Ksuid::generate_at_unix_ms(EPOCH_MS - 1).is_err());
        assert!(Ksuid::generate_at_unix_ms(TIME_MAX_MS + 1).is_err());
    }

    #[test]
    fn millisecond_timestamp_truncates_to_seconds() {
        let k = Ksuid::generate_at_unix_ms(1_700_000_000_999).unwrap();
        assert_eq!(k.timestamp_ms(), 1_700_000_000_000);
        assert_eq!(k.timestamp_seconds(), 1_700_000_000);
    }

    #[test]
    fn batch_shapes() {
        let strings = generate_strings(100);
        assert_eq!(strings.len(), 100);
        assert!(strings.iter().all(|s| is_valid(s.as_bytes())));
        assert_eq!(
            strings
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            100
        );

        let bytes = generate_bytes(100);
        assert_eq!(bytes.len(), 2_000);
        for chunk in bytes.chunks_exact(20) {
            assert!(is_valid(encode(chunk).unwrap().as_bytes()));
        }

        let mut buf = [0u8; 20 * 50];
        assert_eq!(fill_secure(&mut buf).unwrap(), 50);
        assert!(fill_secure(&mut [0u8; 19]).is_err());
    }
}
