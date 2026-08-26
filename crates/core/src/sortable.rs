//! **Fast ULID Sortable** — a project-specific compact sortable encoding.
//!
//! This is NOT a standard format and NOT a ULID. It is an optional
//! extension for storing 128-bit identifiers in fewer characters while
//! preserving lexicographic sort order.
//!
//! ## Design
//!
//! * Character set: URL-safe Base64 characters (`A-Z a-z 0-9 - _`).
//! * Index order == ASCII order: the alphabet below lists its characters in
//!   ascending ASCII order (`-`, `0-9`, `A-Z`, `_`, `a-z`), so comparing two
//!   fixed-length strings byte-wise compares their numeric values.
//! * Length: exactly 22 characters (132 bits of capacity for 128-bit values;
//!   the final character carries the value's lowest 2 bits shifted up, and is
//!   canonical only when those padding bits are zero).
//! * Encoding cost: comparable to Crockford Base32 (table-driven sextets).
//!
//! | Format            | Chars | Sortable | URL-safe | Standard |
//! |-------------------|-------|----------|----------|----------|
//! | ULID (Crockford)  | 26    | yes      | yes      | yes      |
//! | Base58            | ~22   | no       | yes      | de-facto |
//! | Plain Base64URL   | 22    | no       | yes      | RFC 4648 |
//! | **Sortable**      | 22    | **yes**  | yes      | no       |
//!
//! Use it only inside systems that fully control both writer and reader.

/// Characters listed in ascending ASCII order; index == rank.
pub const ALPHABET: &[u8; 64] = b"-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

static DECODE: [i8; 256] = build_decode_table();

const INVALID: i8 = -1;

const fn build_decode_table() -> [i8; 256] {
    let mut table = [INVALID; 256];
    let mut i = 0;
    while i < 64 {
        table[ALPHABET[i] as usize] = i as i8;
        i += 1;
    }
    table
}

pub const ENCODED_LEN: usize = 22;

#[inline]
fn digit(b: u8) -> Result<u128, crate::Error> {
    match DECODE[b as usize] {
        INVALID => Err(crate::Error::InvalidCharacter(b)),
        d => Ok(d as u128),
    }
}

/// Encodes a 128-bit identifier into exactly 22 sortable characters.
///
/// Lexicographic order of outputs matches numeric order of inputs.
#[inline]
#[must_use]
pub const fn encode_value(value: u128) -> [u8; ENCODED_LEN] {
    let mut out = [0u8; ENCODED_LEN];
    let mut i = 0usize;
    // Chars 0..21 cover bits 122..2 (six each); char 21 carries the low 2
    // bits shifted up by 4 (canonical padding).
    while i < 21 {
        out[i] = ALPHABET[((value >> (122 - 6 * i)) & 63) as usize];
        i += 1;
    }
    out[21] = ALPHABET[((value & 3) << 4) as usize];
    out
}

/// Encodes to a string (see [`encode_value`]).
#[inline]
#[must_use]
pub fn encode_string(value: u128) -> String {
    let mut buf = Vec::with_capacity(ENCODED_LEN);
    buf.extend_from_slice(&encode_value(value));
    // SAFETY: `encode_value` emits bytes from ALPHABET (ASCII only).
    unsafe { String::from_utf8_unchecked(buf) }
}

/// Decodes exactly 22 sortable characters back to the 128-bit value.
///
/// Rejects invalid characters and non-canonical padding in the final char.
///
/// # Errors
///
/// * [`crate::Error::InvalidLength`] — input is not exactly 22 characters.
/// * [`crate::Error::InvalidCharacter`] — a byte outside the sortable
///   alphabet was encountered.
/// * [`crate::Error::NonCanonical`] — the final character carries non-zero
///   padding bits (input was not produced by [`encode_value`]).
pub fn decode_chars(chars: &[u8]) -> crate::Result<u128> {
    if chars.len() != ENCODED_LEN {
        return Err(crate::Error::InvalidLength {
            expected: ENCODED_LEN,
            got: chars.len(),
        });
    }
    let mut value: u128 = 0;
    let mut i = 0usize;
    while i < 21 {
        let d = digit(chars[i])?;
        value |= d << (122 - 6 * i);
        i += 1;
    }
    let last = digit(chars[21])?;
    if last & 0x0f != 0 {
        return Err(crate::Error::NonCanonical);
    }
    value |= last >> 4;
    Ok(value)
}

/// Decodes a sortable string (see [`decode_chars`]).
///
/// # Errors
///
/// Same as [`decode_chars`].
pub fn decode_str(value: &str) -> crate::Result<u128> {
    decode_chars(value.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alphabet_is_ascii_ordered_and_url_safe() {
        for w in ALPHABET.windows(2) {
            assert!(w[0] < w[1], "alphabet must be ASCII-ascending");
        }
        assert!(ALPHABET
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
    }

    #[test]
    fn fixed_length() {
        assert_eq!(encode_value(0).len(), 22);
        assert_eq!(encode_value(u128::MAX).len(), 22);
        // Zero -> all '-' (index 0).
        assert_eq!(encode_value(0), *b"----------------------");
        // Value 1 -> low bit set -> last char index 16 ('F').
        assert_eq!(encode_value(1), *b"---------------------F");
    }

    #[test]
    fn lexicographic_order_equals_numeric_order() {
        let mut seed: u64 = 0xfeed_face_cafe_babe;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut cases: Vec<(u128, String)> = Vec::new();
        cases.push((0, encode_string(0)));
        cases.push((u128::MAX, encode_string(u128::MAX)));
        for _ in 0..50_000 {
            let v = ((next() as u128) << 64) | next() as u128;
            cases.push((v, encode_string(v)));
        }
        // Sorted by string must equal sorted by number.
        let mut by_num = cases.clone();
        by_num.sort_by_key(|c| c.0);
        let mut by_str = cases;
        by_str.sort_by(|a, b| a.1.cmp(&b.1));
        assert_eq!(
            by_num.iter().map(|c| c.1.as_str()).collect::<Vec<_>>(),
            by_str.iter().map(|c| c.1.as_str()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn round_trip() {
        let mut seed: u64 = 0x0f1e_2d3c_4b5a_6978;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut cases = vec![0u128, 1, 2, 3, u128::MAX];
        for _ in 0..50_000 {
            cases.push(((next() as u128) << 64) | next() as u128);
        }
        for v in cases {
            assert_eq!(decode_str(&encode_string(v)).unwrap(), v);
        }
    }

    #[test]
    fn rejects_non_canonical_and_invalid() {
        // Last char with non-zero padding bits.
        assert_eq!(decode_str(&encode_string(1)), Ok(1));
        let mut bad = encode_string(1).into_bytes();
        bad[21] = b'I'; // index 17 -> low nibble 1 -> non-canonical
        assert_eq!(decode_chars(&bad), Err(crate::Error::NonCanonical));
        assert!(decode_chars(b"short").is_err());
        assert!(decode_chars(&[b'!'; 22]).is_err());
    }

    #[test]
    fn shorter_than_ulid() {
        let v = u128::MAX;
        assert_eq!(encode_string(v).len(), 22);
        assert_eq!(crate::crockford::encode_value(v).len(), 26);
    }
}
