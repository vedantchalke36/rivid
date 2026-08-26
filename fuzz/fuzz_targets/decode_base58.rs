#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(decoded) = rivid_core::base58::decode(s) {
            // Reversibility invariant for accepted inputs.
            assert_eq!(rivid_core::base58::encode(&decoded), s);
        }
    }
});
