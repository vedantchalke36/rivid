#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Drives MonotonicState through adversarial timestamp sequences and
    // verifies the two core invariants that must hold for ANY input:
    //
    //   1. Output values are strictly increasing (same-ms increments,
    //      backwards clocks, huge jumps — always monotonic).
    //   2. Deterministic mode is reproducible: identical seed + identical
    //      timestamp sequence produces an identical output sequence.
    if data.len() < 9 {
        return;
    }
    let seed = u64::from_le_bytes(data[0..8].try_into().unwrap());

    let mut state_a = rivid_core::monotonic::MonotonicState::new();
    let mut state_b = rivid_core::monotonic::MonotonicState::new();
    let mut rng_a = rivid_core::rng::DeterministicRng::new(seed);
    let mut rng_b = rivid_core::rng::DeterministicRng::new(seed);

    let mut prev: Option<u128> = None;
    // Each subsequent byte perturbs the timestamp around a base value,
    // including steps that go backwards or stay equal.
    let mut ts: u64 = 1_700_000_000_000;
    for &b in &data[8..] {
        match b % 4 {
            0 => ts = ts.wrapping_add((b as u64) << 3),
            1 => ts = ts.wrapping_sub(b as u64),
            2 => {} // same ms again
            _ => ts = ts.wrapping_add(1),
        }

        let id = state_a.next_deterministic_at(ts, &mut rng_a);
        assert_eq!(id.len(), 26, "encoded length invariant");
        let v = rivid_core::crockford::decode_chars(id.as_bytes()).unwrap();
        if let Some(p) = prev {
            assert!(v > p, "monotonic violation at ts={ts}: {v} <= {p}");
        }
        prev = Some(v);

        // Reproducibility: a twin state + twin RNG must produce byte-equal
        // output for every step of the sequence.
        let twin = state_b.next_deterministic_at(ts, &mut rng_b);
        assert_eq!(id, twin, "deterministic reproducibility violated");
    }
});
