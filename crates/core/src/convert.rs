//! String-format conversion helpers.
//!
//! ## Semantics of ULID <-> UUID conversion
//!
//! Conversion is a **pure reinterpretation of the same 128 bits** between
//! the two textual encodings. It does NOT change or compare the semantics
//! of either format: a converted UUIDv4 carries no timestamp even though
//! its first bytes may look like one, and only UUIDv7 shares the ULID's
//! "first 48 bits are a millisecond timestamp" interpretation.

use crate::crockford;

const HEX: &[u8; 16] = b"0123456789abcdef";

/// Formats 16 bytes as lowercase hyphenated UUID form
/// (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
///
/// Shared by [`crate::uuidv7::format_hyphenated`]; ULID/UUIDv7/raw formats
/// all use one big-endian byte layout.
#[must_use]
pub fn format_hyphenated_lower(bytes: &[u8; 16]) -> String {
    let mut out = String::with_capacity(36);
    for (i, b) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            out.push('-');
        }
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Parses a canonical hyphenated UUID string (case-insensitive) into bytes.
///
/// Accepts exactly `8-4-4-4-12` hex digits with hyphens in place — matching
/// the reference `ulid` package's `uuidToULID` validation.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidUuid`] for wrong length, misplaced
/// hyphens, or non-hex characters.
pub fn parse_hyphenated_uuid(value: &str) -> crate::Result<[u8; 16]> {
    let b = value.as_bytes();
    if b.len() != 36 || b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return Err(crate::Error::InvalidUuid);
    }
    let mut out = [0u8; 16];
    // All non-dash positions were validated as hex above; consume pairs.
    let mut hex_iter = b
        .iter()
        .enumerate()
        .filter(|(i, _)| !matches!(i, 8 | 13 | 18 | 23))
        .map(|(_, c)| hex_val(*c));
    for slot in out.iter_mut() {
        let hi = hex_iter.next().ok_or(crate::Error::InvalidUuid)?;
        let lo = hex_iter.next().ok_or(crate::Error::InvalidUuid)?;
        *slot =
            (hi.ok_or(crate::Error::InvalidUuid)? << 4) | lo.ok_or(crate::Error::InvalidUuid)?;
    }
    Ok(out)
}

/// Converts a canonical ULID string to its hyphenated uppercase UUID form
/// (same 128 bits, pure representation change).
///
/// # Errors
///
/// Returns the errors of [`crate::crockford::decode_chars`] (invalid length,
/// character, or value too large).
pub fn ulid_to_uuid(ulid: &str) -> crate::Result<String> {
    let v = crockford::decode_chars(ulid.as_bytes())?;
    let bytes = v.to_be_bytes();
    // Reference implementation returns uppercase.
    Ok(format_hyphenated_lower(&bytes).to_uppercase())
}

/// Converts a hyphenated UUID string to its canonical ULID form.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidUuid`] for malformed UUID input.
pub fn uuid_to_ulid(uuid: &str) -> crate::Result<String> {
    let bytes = parse_hyphenated_uuid(uuid)?;
    Ok(crockford::encode_string(u128::from_be_bytes(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_conversion_vectors_from_reference_impl() {
        // Vectors produced by the reference `ulid` npm package (v3.0.2).
        assert_eq!(
            ulid_to_uuid("01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap(),
            "01563E3A-B5D3-D676-4C61-EFB99302BD5B"
        );
        assert_eq!(
            ulid_to_uuid("01BX5ZZKBKACTAV9WEVGEMMVRZ").unwrap(),
            "015F4BFF-CD73-5334-ADA7-8EDC1D4A6F1F"
        );
        assert_eq!(
            ulid_to_uuid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ").unwrap(),
            "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"
        );
    }

    #[test]
    fn uuid_parsing_is_strict() {
        assert!(parse_hyphenated_uuid("00000000-0000-0000-0000-000000000000").is_ok());
        assert!(parse_hyphenated_uuid("00000000000000000000000000000000").is_err()); // no dashes
        assert!(parse_hyphenated_uuid("00000000-0000-0000-0000-00000000000g").is_err());
        assert!(parse_hyphenated_uuid("00000000/0000-0000-0000-000000000000").is_err());
        assert!(parse_hyphenated_uuid("0000000Z-0000-0000-0000-000000000000").is_err());
        // Case-insensitive hex.
        assert_eq!(
            parse_hyphenated_uuid("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF").unwrap(),
            [0xff; 16]
        );
    }

    #[test]
    fn format_matches_canonical_shape() {
        let s = format_hyphenated_lower(&[
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 1, 2, 3, 4, 5, 6, 7, 8,
        ]);
        assert_eq!(s, "01234567-89ab-cdef-0102-030405060708");
    }

    #[test]
    fn max_ulid_converts_to_max_uuid() {
        let u = ulid_to_uuid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ").unwrap();
        assert_eq!(u, "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF");
    }
}
