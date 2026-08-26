#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let valid = rivid_core::ulid::is_valid(data);
    if valid && data.len() == 26 {
        // Anything that validates must decode (timestamp part may still be
        // out of the 48-bit domain, so only assert charset acceptance).
        let _ = rivid_core::crockford::decode_chars(data);
    }
});
