#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Exercise buffer-fill paths with adversarial lengths; must never panic.
    for len in data.iter().take(8).map(|&b| b as usize * 37) {
        let mut buf = vec![0u8; len];
        let _ = rivid_core::batch::fill_ulid_secure(&mut buf);
        let _ = rivid_core::uuidv7::fill_secure(&mut buf);
    }
});
