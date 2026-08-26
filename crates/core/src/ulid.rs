//! ULID generation, validation and comparison.

use crate::crockford;
use crate::id128::Id128;
use crate::rng;

/// Generates a ULID with the current wall-clock millisecond timestamp and
/// 80 bits of secure randomness.
///
/// The returned value is encoded as the canonical 26-character uppercase
/// Crockford Base32 form.
#[must_use]
pub fn generate() -> String {
    crockford::encode_string(Id128::from_parts(crate::now_ms(), rng::random_80()).as_u128())
}

/// Generates a raw 16-byte ULID (canonical big-endian layout).
#[must_use]
pub fn generate_bytes16() -> [u8; 16] {
    Id128::from_parts(crate::now_ms(), rng::random_80()).to_be_bytes()
}

/// Generates a ULID stamped with an explicit timestamp (ms since epoch).
///
/// # Errors
///
/// Returns [`crate::Error::TimestampOutOfRange`] when `timestamp_ms`
/// exceeds the 48-bit ULID domain.
pub fn generate_at(timestamp_ms: u64) -> crate::Result<String> {
    if timestamp_ms > crate::TIME_MAX {
        return Err(crate::Error::TimestampOutOfRange(timestamp_ms));
    }
    Ok(crockford::encode_string(
        Id128::from_parts(timestamp_ms, rng::random_80()).as_u128(),
    ))
}

/// Validates that `id` is a well-formed canonical-domain ULID string:
/// exactly 26 characters, all within the Crockford alphabet
/// (case-insensitive, like the reference implementation's validation).
///
/// Note: this checks *format* only — it does not verify that the timestamp
/// component is <= 2^48-1 (the first character may be any alphabet member),
/// matching reference implementations.
#[must_use]
pub fn is_valid(id: &[u8]) -> bool {
    if id.len() != crate::ULID_LEN {
        return false;
    }
    id.iter().all(|&b| crockford::is_alphabet_char(b))
}

/// Extracts the creation timestamp (ms since Unix epoch) of a ULID.
///
/// # Errors
///
/// * [`crate::Error::InvalidLength`] — input is not exactly 26 characters.
/// * Errors of [`crate::crockford::decode_time_bytes`] otherwise.
pub fn decode_time(id: &[u8]) -> crate::Result<u64> {
    if id.len() != crate::ULID_LEN {
        return Err(crate::Error::InvalidLength {
            expected: crate::ULID_LEN,
            got: id.len(),
        });
    }
    crockford::decode_time_bytes(&id[..crate::TIME_LEN])
}

/// Decodes a ULID string to its 16-byte big-endian representation.
///
/// # Errors
///
/// Returns the errors of [`crate::crockford::decode_chars`] (invalid
/// length, invalid character, or value exceeding 128 bits).
pub fn decode(id: &str) -> crate::Result<[u8; 16]> {
    let v = crockford::decode_chars(id.as_bytes())?;
    Ok(v.to_be_bytes())
}

/// Encodes exactly 16 bytes (canonical big-endian ID) as a ULID string.
///
/// # Errors
///
/// Returns [`crate::Error::InvalidLength`] unless `bytes.len() == 16`.
pub fn encode(bytes: &[u8]) -> crate::Result<String> {
    if bytes.len() != 16 {
        return Err(crate::Error::InvalidLength {
            expected: 16,
            got: bytes.len(),
        });
    }
    let mut arr = [0u8; 16];
    arr.copy_from_slice(bytes);
    Ok(crockford::encode_string(u128::from_be_bytes(arr)))
}

/// Compares two ULIDs by their full 128-bit value.
///
/// Inputs are decoded first so case variants compare consistently; invalid
/// input is an error.
///
/// # Errors
///
/// Returns the errors of [`crate::crockford::decode_chars`] for either
/// operand (invalid length, character, or oversized value).
pub fn compare(a: &str, b: &str) -> crate::Result<std::cmp::Ordering> {
    let va = crockford::decode_chars(a.as_bytes())?;
    let vb = crockford::decode_chars(b.as_bytes())?;
    Ok(va.cmp(&vb))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_ulids() {
        for _ in 0..1000 {
            let id = generate();
            assert_eq!(id.len(), 26);
            assert!(is_valid(id.as_bytes()), "{id}");
            let bytes = decode(&id).unwrap();
            let ts = decode_time(id.as_bytes()).unwrap();
            assert!(ts > 1_600_000_000_000 && ts < 3_000_000_000_000);
            // Re-encoding the decoded bytes must reproduce the exact string.
            assert_eq!(encode(&bytes).unwrap(), id);
        }
    }

    #[test]
    fn uniqueness_smoke() {
        use std::collections::HashSet;
        let set: HashSet<String> = (0..100_000).map(|_| generate()).collect();
        assert_eq!(set.len(), 100_000);
    }

    #[test]
    fn validation_rules() {
        assert!(is_valid(b"01ARZ3NDEKTSV4RRFFQ69G5FAV"));
        assert!(is_valid(b"01arz3ndektsv4rrffq69g5fav")); // case-insensitive
        assert!(!is_valid(b"01ARZ3NDEKTSV4RRFFQ69G5FAU")); // U excluded
                                                           // Format-valid even though the timestamp domain is exceeded
                                                           // (matches reference validation semantics; decode() rejects it).
        assert!(is_valid(b"81ARZ3NDEKTSV4RRFFQ69G5FAV"));
        assert!(!is_valid(b"01ARZ3NDEKTSV4RRFFQ69G5FA")); // 25
        assert!(!is_valid(b"01ARZ3NDEKTSV4RRFFQ69G5FAVV")); // 27
        assert!(!is_valid(b"0-ARZ3NDEKTSV4RRFFQ69G5FAV"));
        assert!(!is_valid(b""));
    }

    #[test]
    fn decode_time_matches_vector() {
        assert_eq!(
            decode_time(b"01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap(),
            1469922850259
        );
        assert_eq!(
            decode_time(b"7ZZZZZZZZZZZZZZZZZZZZZZZZZ").unwrap(),
            crate::TIME_MAX
        );
    }

    #[test]
    fn encode_rejects_wrong_sizes() {
        assert!(encode(&[0u8; 15]).is_err());
        assert!(encode(&[0u8; 17]).is_err());
        assert_eq!(encode(&[0u8; 16]).unwrap(), "0".repeat(26));
    }

    #[test]
    fn compare_semantics() {
        use std::cmp::Ordering::*;
        assert_eq!(
            compare("01ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap(),
            Equal
        );
        assert_eq!(
            compare("01ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAW").unwrap(),
            Less
        );
        // Case-insensitive equivalence in comparisons.
        assert_eq!(
            compare("01arz3ndektsv4rrffq69g5fav", "01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap(),
            Equal
        );
        assert!(compare("bad", "worse").is_err());
    }

    #[test]
    fn generate_at_range_checks() {
        assert!(generate_at(crate::TIME_MAX).is_ok());
        assert!(generate_at(crate::TIME_MAX + 1).is_err());
        assert_eq!(generate_at(1469918176385).unwrap()[..10], *"01ARYZ6S41");
    }

    #[test]
    fn monotonic_property_of_ids_within_generation() {
        // Lexicographic order equals numeric order for same-length canonical strings.
        let mut ids: Vec<String> = (0..10_000).map(crockford::encode_string).collect();
        ids.sort();
        for w in ids.windows(2) {
            let a = crockford::decode_chars(w[0].as_bytes()).unwrap();
            let b = crockford::decode_chars(w[1].as_bytes()).unwrap();
            assert!(a <= b);
        }
    }
}
