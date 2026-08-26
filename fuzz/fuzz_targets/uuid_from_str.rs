#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(bytes) = rivid_core::convert::parse_hyphenated_uuid(s) {
            // Accepted UUIDs must reformat to exactly the canonical form.
            assert_eq!(
                rivid_core::convert::format_hyphenated_lower(&bytes),
                s.to_lowercase()
            );
        }
        let _ = rivid_core::convert::ulid_to_uuid(s);
        let _ = rivid_core::convert::uuid_to_ulid(s);
    }
});
