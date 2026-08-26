//! Canonical Crockford Base32 codec for 128-bit identifiers.
//!
//! Alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I`, `L`, `O`, `U`).
//!
//! * Encoding is defined over the full 128-bit value; a canonical ULID's
//!   timestamp is always `< 2^48`, which keeps the first character in `0..=7`.
//! * Decoding is case-insensitive (ASCII case folding only), matching the
//!   reference JavaScript implementation, which upper-cases input before
//!   consulting the alphabet. `I`, `L`, `O`, `U` are invalid in every case —
//!   lenient aliasing (`i`/`l` -> `1`, `o` -> `0`) is deliberately NOT applied
//!   automatically.

/// The Crockford Base32 alphabet used by the ULID specification.
pub const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const INVALID: i8 = -1;

/// Maps an ASCII byte to its alphabet index, or [`INVALID`].
///
/// Both cases are accepted for decoding; membership in this table is exactly
/// the reference implementation's "uppercase the char and check membership"
/// validity rule.
static DECODE: [i8; 256] = build_decode_table();

const fn build_decode_table() -> [i8; 256] {
    let mut table = [INVALID; 256];
    let mut i = 0;
    while i < 32 {
        let c = ALPHABET[i];
        table[c as usize] = i as i8;
        // Case-insensitive decoding: map the lowercase equivalent of letters
        // only (adding 32 to digits would collide with unrelated letters).
        if c.is_ascii_uppercase() {
            table[(c + 32) as usize] = i as i8;
        }
        i += 1;
    }
    table
}

/// Encodes two characters per 10-bit group: `PAIR[i] = encode(i as 10 bits)`.
static PAIR: [[u8; 2]; 1024] = build_pair_table();

const fn build_pair_table() -> [[u8; 2]; 1024] {
    let mut table = [[0u8; 2]; 1024];
    let mut i = 0;
    while i < 1024 {
        table[i][0] = ALPHABET[(i >> 5) & 0x1f];
        table[i][1] = ALPHABET[i & 0x1f];
        i += 1;
    }
    table
}

#[inline]
fn digit(b: u8) -> Result<u128, crate::Error> {
    match DECODE[b as usize] {
        INVALID => Err(crate::Error::InvalidCharacter(b)),
        d => Ok(d as u128),
    }
}

/// Fast membership check used by ULID validation.
#[inline]
#[must_use]
pub fn is_alphabet_char(b: u8) -> bool {
    DECODE[b as usize] != INVALID
}

/// Encode the low 130 bits of `value` (a u128 holds exactly 128) into exactly
/// 26 Crockford Base32 characters, most significant first.
///
/// A value whose top bits are set produces a first character above `7`; such
/// strings cannot be produced from valid ULIDs but remain decodable up to the
/// 128-bit domain of this function.
#[inline]
#[must_use]
pub const fn encode_value(value: u128) -> [u8; 26] {
    let mut out = [0u8; 26];
    let mut rest = value;
    let mut pos = 24usize;
    // 13 groups of 10 bits cover all 26 chars (group 12 only has 8 real bits).
    let mut group = 0;
    while group < 13 {
        let pair = &PAIR[(rest & 0x3ff) as usize];
        out[pos] = pair[0];
        out[pos + 1] = pair[1];
        if group < 12 {
            pos -= 2;
        }
        rest >>= 10;
        group += 1;
    }
    out
}

/// Encode `value` as a canonical 26-character ULID-style string.
#[inline]
#[must_use]
pub fn encode_string(value: u128) -> String {
    let mut buf = Vec::with_capacity(26);
    buf.extend_from_slice(&encode_value(value));
    // SAFETY: every byte written by `encode_value` is drawn from ALPHABET,
    // which is ASCII-only by construction.
    unsafe { String::from_utf8_unchecked(buf) }
}

/// Decode exactly 26 Crockford Base32 characters into their 128-bit value.
///
/// Case-insensitive. Rejects wrong lengths, non-alphabet characters, and
/// values that exceed 128 significant bits (first char above `7`).
///
/// # Errors
///
/// * [`crate::Error::InvalidLength`] — input is not exactly 26 characters.
/// * [`crate::Error::InvalidCharacter`] — a byte outside the Crockford
///   alphabet (in either case) was encountered.
/// * [`crate::Error::ValueTooLarge`] — the first character exceeds `7`,
///   i.e. the value does not fit in 128 bits.
pub fn decode_chars(chars: &[u8]) -> crate::Result<u128> {
    if chars.len() != 26 {
        return Err(crate::Error::InvalidLength {
            expected: 26,
            got: chars.len(),
        });
    }
    let mut value: u128 = 0;
    let mut i = 0usize;
    while i < 26 {
        let d = digit(chars[i])?;
        if i == 0 && d > 7 {
            // Only the low 3 bits of the first digit fit in 128 bits.
            return Err(crate::Error::ValueTooLarge);
        }
        value |= d << (125 - 5 * i);
        i += 1;
    }
    Ok(value)
}

/// Encode a millisecond timestamp as its canonical 10-character form.
///
/// # Errors
///
/// Returns [`crate::Error::TimestampOutOfRange`] when `timestamp_ms`
/// exceeds the 48-bit ULID domain (`2^48 - 1`).
pub fn encode_time(timestamp_ms: u64) -> crate::Result<[u8; 10]> {
    if timestamp_ms > crate::TIME_MAX {
        return Err(crate::Error::TimestampOutOfRange(timestamp_ms));
    }
    let mut out = [0u8; 10];
    let mut ts = timestamp_ms;
    let mut pos = 9;
    loop {
        out[pos] = ALPHABET[(ts & 0x1f) as usize];
        if pos == 0 {
            break;
        }
        ts >>= 5;
        pos -= 1;
    }
    Ok(out)
}

/// Encode a timestamp directly to a string (convenience wrapper).
///
/// # Errors
///
/// Same as [`encode_time`]: [`crate::Error::TimestampOutOfRange`] for
/// timestamps beyond `2^48 - 1`.
pub fn encode_time_str(timestamp_ms: u64) -> crate::Result<String> {
    encode_time(timestamp_ms).map(|b| {
        // SAFETY: bytes come straight from ALPHABET (ASCII).
        unsafe { String::from_utf8_unchecked(b.to_vec()) }
    })
}

/// Decode a 10-character timestamp component back to milliseconds.
///
/// Mirrors the reference implementation: values beyond the 48-bit domain
/// produce [`crate::Error::ValueTooLarge`].
///
/// # Errors
///
/// * [`crate::Error::InvalidLength`] — input is not exactly 10 characters.
/// * [`crate::Error::InvalidCharacter`] — a byte outside the Crockford
///   alphabet was encountered.
/// * [`crate::Error::ValueTooLarge`] — the decoded value exceeds
///   `2^48 - 1`.
pub fn decode_time_bytes(chars: &[u8]) -> crate::Result<u64> {
    if chars.len() != 10 {
        return Err(crate::Error::InvalidLength {
            expected: 10,
            got: chars.len(),
        });
    }
    let mut time: u64 = 0;
    for &b in chars {
        let d = digit(b)?;
        time = time.wrapping_mul(32).wrapping_add(d as u64);
    }
    if time > crate::TIME_MAX {
        return Err(crate::Error::ValueTooLarge);
    }
    Ok(time)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alphabet_matches_spec() {
        assert_eq!(ALPHABET.len(), 32);
        assert!(!ALPHABET.iter().any(|&c| b"ILOUiloU".contains(&c)));
    }

    #[test]
    fn zero_and_max_encode() {
        assert_eq!(encode_value(0), *b"00000000000000000000000000");
        assert_eq!(encode_value(u128::MAX), *b"7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
    }

    #[test]
    fn known_timestamp_vectors() {
        assert_eq!(encode_time(0).unwrap(), *b"0000000000");
        assert_eq!(encode_time(1).unwrap(), *b"0000000001");
        assert_eq!(encode_time(1469918176385).unwrap(), *b"01ARYZ6S41");
        assert_eq!(encode_time(281474976710655).unwrap(), *b"7ZZZZZZZZZ");
        assert_eq!(encode_time(424242424242).unwrap(), *b"00CB3D3ADJ");
        assert_eq!(encode_time(1704067200000).unwrap(), *b"01HK153X00");
        assert!(encode_time(281474976710656).is_err());
    }

    #[test]
    fn decode_known_vectors() {
        assert_eq!(decode_time_bytes(b"01ARZ3NDEK").unwrap(), 1469922850259);
        assert_eq!(decode_time_bytes(b"7ZZZZZZZZZ").unwrap(), 281474976710655);
        assert_eq!(decode_time_bytes(b"0000000000").unwrap(), 0);
    }

    #[test]
    fn decode_rejects_bad_input() {
        assert!(decode_chars(b"short").is_err());
        assert!(decode_chars(b"01ARZ3NDEKTSV4RRFFQ69G5FAU").is_err()); // U
        assert!(decode_chars(b"01ARZ3NDEKTSV4RRFFQ69G5FA1").is_ok());
        assert!(decode_chars(b"01arz3ndektsv4rrffq69g5fav").is_ok()); // lowercase ok
        assert!(decode_chars(b"81ARZ3NDEKTSV4RRFFQ69G5FAV").is_err()); // > 128 bits
    }

    #[test]
    fn round_trip_all_bit_patterns() {
        // Deterministic pseudo-random sweep plus structured edge cases.
        let mut seed: u64 = 0x9E3779B97F4A7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut cases = vec![0u128, 1, u128::MAX, 1 << 127, (1 << 80) - 1, (1 << 48) - 1];
        for _ in 0..100_000 {
            cases.push(((next() as u128) << 64) | next() as u128);
        }
        for v in cases {
            let s = encode_value(v);
            assert_eq!(s.len(), 26);
            assert_eq!(decode_chars(&s).unwrap(), v, "round trip failed for {v}");
        }
    }

    #[test]
    fn decode_time_too_large() {
        // 10 'Z' chars = 32^10 - 1 > 2^48 - 1.
        assert_eq!(
            decode_time_bytes(b"ZZZZZZZZZZ"),
            Err(crate::Error::ValueTooLarge)
        );
    }
}
