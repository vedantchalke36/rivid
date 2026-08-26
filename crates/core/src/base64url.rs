//! Base64URL encoding (RFC 4648 §5) for arbitrary byte strings.
//!
//! Alphabet: `A-Z a-z 0-9 - _`. Encoding is **unpadded** (the compact
//! identifier convention); decoding accepts both padded and unpadded input.
//!
//! A 128-bit identifier encodes to exactly 22 characters (128 bits fit in
//! 132 bits of sextets). Note that plain Base64URL is NOT lexicographically
//! sortable: the standard alphabet's ASCII order does not match index order.
//! Use [`crate::sortable`] for a sortable variant.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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

/// Sanity guard against pathological inputs.
const MAX_INPUT_LEN: usize = 8192;

/// Encodes bytes as unpadded Base64URL.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut chunks = bytes.chunks_exact(3);
    for chunk in &mut chunks {
        let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | chunk[2] as u32;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(ALPHABET[(n >> 6) as usize & 63] as char);
        out.push(ALPHABET[n as usize & 63] as char);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(ALPHABET[(n >> 18) as usize & 63] as char);
            out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(ALPHABET[(n >> 18) as usize & 63] as char);
            out.push(ALPHABET[(n >> 12) as usize & 63] as char);
            out.push(ALPHABET[(n >> 6) as usize & 63] as char);
        }
        _ => {}
    }
    out
}

/// Decodes Base64URL into the original bytes.
///
/// Accepts unpadded and `=`-padded forms; rejects invalid characters,
/// impossible lengths (`len % 4 == 1`) and non-canonical trailing bits.
pub fn decode(value: &str) -> crate::Result<Vec<u8>> {
    let bytes = value.as_bytes();
    if bytes.len() > MAX_INPUT_LEN {
        return Err(crate::Error::InvalidLength {
            expected: MAX_INPUT_LEN,
            got: bytes.len(),
        });
    }
    // Strip at most two trailing '=' padding characters.
    let mut end = bytes.len();
    let mut pad = 0;
    while end > 0 && bytes[end - 1] == b'=' && pad < 2 {
        end -= 1;
        pad += 1;
    }
    let body = &bytes[..end];
    if body.len() % 4 == 1 || (pad > 0 && (end + pad) % 4 != 0) {
        return Err(crate::Error::InvalidLength {
            expected: 0,
            got: value.len(),
        });
    }
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut nbits: u32 = 0;
    for &c in body {
        let d = match DECODE[c as usize] {
            INVALID => return Err(crate::Error::InvalidCharacter(c)),
            v => v as u32,
        };
        acc = (acc << 6) | d;
        nbits += 6;
        if nbits >= 8 {
            nbits -= 8;
            out.push((acc >> nbits) as u8);
        }
    }
    // Canonical check: leftover bits must be zero.
    if nbits > 0 && (acc & ((1 << nbits) - 1)) != 0 {
        return Err(crate::Error::NonCanonical);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc4648_vectors() {
        // RFC 4648 test vectors, converted to the URL-safe alphabet.
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg");
        assert_eq!(encode(b"fo"), "Zm8");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg");
        assert_eq!(encode(b"fooba"), "Zm9vYmE");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");

        for (plain, enc) in [
            (&b""[..], ""),
            (&b"f"[..], "Zg"),
            (&b"fo"[..], "Zm8"),
            (&b"foobar"[..], "Zm9vYmFy"),
        ] {
            assert_eq!(decode(enc).unwrap(), plain);
            // Padded forms also decode.
            let padded = match enc.len() % 4 {
                2 => format!("{enc}=="),
                3 => format!("{enc}="),
                _ => enc.to_string(),
            };
            assert_eq!(decode(&padded).unwrap(), plain);
        }
    }

    #[test]
    fn url_safe_alphabet_only() {
        let s = encode(&[0xff, 0xfe, 0xfd, 0xfc]);
        assert!(s.bytes().all(|b| ALPHABET.contains(&b)));
        assert!(!s.contains('+') && !s.contains('/'));
        assert!(!s.contains('='));
    }

    #[test]
    fn round_trip_128_bit_ids() {
        let mut seed: u64 = 0x1234_5678_9abc_def0;
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
            // 128 bits -> exactly 22 chars.
            assert_eq!(s.len(), 22);
            assert_eq!(decode(&s).unwrap(), bytes.to_vec());
        }
    }

    #[test]
    fn rejects_bad_input() {
        assert!(decode("Zm9v+").is_err()); // '+' not URL-safe alphabet
        assert!(decode("Z").is_err()); // len % 4 == 1
        assert!(decode("Zg=").is_err()); // bad padding length
        assert_eq!(decode("Zg"), Ok(b"f".to_vec()));
        assert!(decode("Zh").is_err()); // non-canonical trailing bits
    }

    #[test]
    fn fixed_length_for_ids() {
        let zeros = [0u8; 16];
        assert_eq!(encode(&zeros).len(), 22);
        let ones = [0xffu8; 16];
        assert_eq!(encode(&ones).len(), 22);
    }
}
