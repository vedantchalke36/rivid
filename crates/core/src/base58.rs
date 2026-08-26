//! Base58 (Bitcoin alphabet) encoding for arbitrary byte strings.
//!
//! Alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`
//! (excludes `0`, `O`, `I`, `l`).
//!
//! This is the classic leading-zero-preserving Base58 used by Bitcoin: each
//! zero byte becomes a `1`, so encodings grow with input entropy rather than
//! input length alone. A 128-bit identifier encodes to ~22 characters.
//!
//! **Not lexicographically sortable**: numeric order is not preserved by
//! string comparison (e.g. a value with fewer digits sorts before a longer
//! one regardless of magnitude). Use the ULID or `sortable` formats when
//! ordering matters.

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

static DECODE: [i8; 256] = build_decode_table();

const INVALID: i8 = -1;

const fn build_decode_table() -> [i8; 256] {
    let mut table = [INVALID; 256];
    let mut i = 0;
    while i < 58 {
        table[ALPHABET[i] as usize] = i as i8;
        i += 1;
    }
    table
}

/// Sanity guard against pathological inputs (still far above any real ID).
const MAX_INPUT_LEN: usize = 4096;

/// Encodes arbitrary bytes as Base58.
pub fn encode(bytes: &[u8]) -> String {
    // Count leading zeros; each becomes '1'.
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    let mut digits: Vec<u8> = Vec::with_capacity(bytes.len() * 138 / 100 + 2);
    for &byte in &bytes[zeros..] {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut out = String::with_capacity(zeros + digits.len());
    for _ in 0..zeros {
        out.push('1');
    }
    for &d in digits.iter().rev() {
        out.push(ALPHABET[d as usize] as char);
    }
    if out.is_empty() {
        // Empty and all-zero inputs must not produce empty strings that
        // decode ambiguously; all-zeros handled by zeros prefix, but the
        // truly empty input maps to the empty string by convention.
        return out;
    }
    out
}

/// Decodes a Base58 string to its original bytes.
///
/// Strictly validates the alphabet. Leading `1`s map back to leading zero
/// bytes.
pub fn decode(value: &str) -> crate::Result<Vec<u8>> {
    let bytes = value.as_bytes();
    if bytes.len() > MAX_INPUT_LEN {
        return Err(crate::Error::InvalidLength {
            expected: MAX_INPUT_LEN,
            got: bytes.len(),
        });
    }
    let ones = bytes.iter().take_while(|&&b| b == b'1').count();
    let mut output: Vec<u8> = Vec::with_capacity(bytes.len());
    for &c in &bytes[ones..] {
        let val = match DECODE[c as usize] {
            INVALID => return Err(crate::Error::InvalidCharacter(c)),
            v => v as u32,
        };
        let mut carry = val;
        for b in output.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            output.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let mut result = vec![0u8; ones];
    result.extend(output.iter().rev());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vectors() {
        assert_eq!(encode(b"hello world"), *"StV1DL6CwTryKyV");
        assert_eq!(decode("StV1DL6CwTryKyV").unwrap(), b"hello world");
        assert_eq!(encode(&[]), "");
        assert_eq!(decode("").unwrap(), Vec::<u8>::new());
        // Bitcoin genesis block address-style vector.
        assert_eq!(encode(&[0, 0, 1]), *"112");
        assert_eq!(decode("112").unwrap(), vec![0, 0, 1]);
    }

    #[test]
    fn round_trip_random_16_byte_ids() {
        let mut seed: u64 = 0xdead_beef_cafe_f00d;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..20_000 {
            let hi = next();
            let lo = next();
            let bytes = ((hi as u128) << 64 | lo as u128).to_be_bytes();
            let s = encode(&bytes);
            // 128-bit values encode to at most 22 chars.
            assert!(!s.is_empty() && s.len() <= 22);
            assert_eq!(decode(&s).unwrap(), bytes.to_vec());
        }
    }

    #[test]
    fn rejects_invalid_characters() {
        // 0, O, I, l are not in the alphabet.
        assert!(decode("0").is_err());
        assert!(decode("O").is_err());
        assert!(decode("I").is_err());
        assert!(decode("l").is_err());
        assert!(decode("StV1DL6CwTryKy0").is_err());
    }

    #[test]
    fn leading_zeros_preserved() {
        let bytes = [0u8, 0, 255];
        let s = encode(&bytes);
        assert!(s.starts_with("11"));
        assert_eq!(decode(&s).unwrap(), bytes.to_vec());
    }

    #[test]
    fn length_examples() {
        // Typical 128-bit identifiers: ~22 chars vs 26 for Crockford.
        let bytes = [0xffu8; 16];
        assert_eq!(encode(&bytes).len(), 22);
    }
}
