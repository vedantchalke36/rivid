#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Must never panic: arbitrary bytes as ULID string input.
    let _ = rivid_core::crockford::decode_chars(data);
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = rivid_core::ulid::decode(s);
        let _ = rivid_core::ulid::decode_time(data);
    }
});
