//! Direct Rust-core benchmark — no Node.js, no NAPI.
//!
//! Used to quantify the NAPI boundary overhead by comparing these numbers
//! with the equivalent operations called through NAPI from JavaScript
//! (`pnpm bench`). Run: `cargo run --release -p rivid-core --example
//! bench_direct`.

use rivid_core as core;
use std::hint::black_box;
use std::time::Instant;

fn measure<F: FnMut()>(label: &str, iterations: u64, mut f: F) {
    // Warmup
    for _ in 0..(iterations / 10).max(1000) {
        f();
    }
    let start = Instant::now();
    for _ in 0..iterations {
        f();
    }
    let elapsed = start.elapsed();
    println!(
        "{:<38} {:>12.0} ns/op {:>14.0} ops/sec",
        label,
        elapsed.as_nanos() as f64 / iterations as f64,
        iterations as f64 / elapsed.as_secs_f64()
    );
}

fn main() {
    println!("== rivid-core direct Rust benchmarks (no NAPI) ==");
    println!("{}\n", std::process::id());

    measure("ulid() [generate + encode]", 5_000_000, || {
        black_box(core::ulid::generate());
    });

    let mut mono = core::monotonic::MonotonicState::new();
    measure("monotonic ulid()", 5_000_000, || {
        black_box(mono.next_secure());
    });

    measure("uuidv7()", 5_000_000, || {
        black_box(core::uuidv7::generate());
    });

    measure("encode(u128)", 20_000_000, || {
        black_box(core::crockford::encode_string(black_box(
            12345678901234567890u128,
        )));
    });

    let sample = "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string();
    measure("decode(str)", 20_000_000, || {
        black_box(core::crockford::decode_chars(black_box(sample.as_bytes())).unwrap());
    });

    measure("is_valid(str)", 50_000_000, || {
        black_box(core::ulid::is_valid(black_box(sample.as_bytes())));
    });

    measure("decode_time(str)", 20_000_000, || {
        black_box(core::ulid::decode_time(black_box(sample.as_bytes())).unwrap());
    });

    let a = sample.as_str();
    let b = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
    measure("compare(a,b)", 50_000_000, || {
        black_box(core::ulid::compare(a, b).unwrap());
    });

    measure("sortable encode", 20_000_000, || {
        black_box(core::sortable::encode_string(black_box(
            9999999999999999999999999u128,
        )));
    });

    measure("base58 encode 16B", 5_000_000, || {
        black_box(core::base58::encode(&[
            1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        ]));
    });

    // Bulk throughput
    for n in [100_000usize, 1_000_000] {
        let start = Instant::now();
        let ids = black_box(core::batch::generate_ulid_strings(n));
        let el = start.elapsed();
        println!(
            "bulk strings x {:>9}                    {:>12.0} ns/id {:>14.0} ids/sec ({} bytes out)",
            n,
            el.as_nanos() as f64 / n as f64,
            n as f64 / el.as_secs_f64(),
            ids.len() * 26
        );
    }
    for n in [1_000_000usize, 10_000_000] {
        let start = Instant::now();
        let buf = black_box(core::batch::generate_ulid_bytes(n));
        let el = start.elapsed();
        println!(
            "bulk bytes   x {:>9}                    {:>12.0} ns/id {:>14.0} ids/sec ({} bytes)",
            n,
            el.as_nanos() as f64 / n as f64,
            n as f64 / el.as_secs_f64(),
            buf.len()
        );
    }
}
