#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // 16-byte round trips through every encoding.
    if data.len() >= 16 {
        let bytes: [u8; 16] = data[..16].try_into().unwrap();
        let v = u128::from_be_bytes(bytes);

        let crock = rivid_core::crockford::encode_value(v);
        assert_eq!(rivid_core::crockford::decode_chars(&crock).unwrap(), v);

        let sort = rivid_core::sortable::encode_value(v);
        assert_eq!(rivid_core::sortable::decode_chars(&sort).unwrap(), v);

        let b58 = rivid_core::base58::encode(&bytes);
        assert_eq!(rivid_core::base58::decode(&b58).unwrap(), bytes.to_vec());

        let b64 = rivid_core::base64url::encode(&bytes);
        assert_eq!(rivid_core::base64url::decode(&b64).unwrap(), bytes.to_vec());

        // Sortability invariant.
        if v != u128::MAX {
            let next = rivid_core::sortable::encode_string(v + 1);
            assert!(next.as_str() > std::str::from_utf8(&sort).unwrap());
        }
    }
});
