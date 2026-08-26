//! Python bindings for the rivid engine (`rivid._native`).
//!
//! Mirrors the JS surface: canonical ULIDs, strict monotonic mode,
//! batched generation over one FFI crossing, and RFC 9562 UUIDv7.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

fn err(e: rivid_core::Error) -> PyErr {
    PyValueError::new_err(e.to_string())
}

/// Module-level monotonic stream, mirroring `monotonicUlid()` semantics.
static MONOTONIC: std::sync::LazyLock<std::sync::Mutex<rivid_core::monotonic::MonotonicState>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(rivid_core::monotonic::MonotonicState::new()));

/// Generate a canonical 26-char ULID. Pass `seed_time` (ms) to pin the
/// timestamp component — useful for migrations and backfills.
#[pyfunction]
#[pyo3(signature = (seed_time=None))]
fn ulid(seed_time: Option<u64>) -> PyResult<String> {
    match seed_time {
        Some(ts) => rivid_core::ulid::generate_at(ts).map_err(err),
        None => Ok(rivid_core::ulid::generate()),
    }
}

/// Strictly increasing ULIDs within the same millisecond.
#[pyfunction]
#[pyo3(signature = (seed_time=None))]
fn monotonic_ulid(seed_time: Option<u64>) -> String {
    let mut state = MONOTONIC.lock().unwrap();
    match seed_time {
        Some(ts) => state.next_secure_at(ts),
        None => state.next_secure(),
    }
}

/// Validate a ULID string (26 chars, Crockford alphabet).
#[pyfunction]
fn is_valid(id: &str) -> bool {
    rivid_core::ulid::is_valid(id.as_bytes())
}

/// Extract the millisecond timestamp from a ULID string.
#[pyfunction]
fn decode_time(id: &str) -> PyResult<u64> {
    rivid_core::ulid::decode_time(id.as_bytes()).map_err(err)
}

/// Encode a millisecond timestamp into its 10-char ULID time component.
#[pyfunction]
#[pyo3(signature = (seed_time=None))]
fn encode_time(seed_time: Option<u64>) -> PyResult<String> {
    let ts = seed_time.unwrap_or_else(rivid_core::now_ms);
    rivid_core::crockford::encode_time_str(ts).map_err(err)
}

/// Compare two ULIDs (-1 / 0 / 1). Case-insensitive.
#[pyfunction]
fn compare(a: &str, b: &str) -> PyResult<i8> {
    rivid_core::ulid::compare(a, b).map(|o| match o {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        _ => 1,
    }).map_err(err)
}

/// Generate `count` ULIDs in one Rust crossing (shared batch timestamp).
#[pyfunction]
fn generate_many(count: usize) -> PyResult<Vec<String>> {
    const MAX_BATCH: usize = 100_000_000;
    if count == 0 || count > MAX_BATCH {
        return Err(PyValueError::new_err("count must be between 1 and 100000000"));
    }
    Ok(rivid_core::batch::generate_ulid_strings(count))
}

/// Generate an RFC 9562 UUIDv7 in standard hyphenated form.
#[pyfunction]
fn uuidv7() -> String {
    rivid_core::uuidv7::generate()
}

/// Batch UUIDv7 generation, one FFI crossing.
#[pyfunction]
fn generate_uuidv7_many(count: usize) -> PyResult<Vec<String>> {
    const MAX_BATCH: usize = 100_000_000;
    if count == 0 || count > MAX_BATCH {
        return Err(PyValueError::new_err("count must be between 1 and 100000000"));
    }
    Ok(rivid_core::uuidv7::generate_strings(count))
}

/// Engine version.
#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(ulid, m)?)?;
    m.add_function(wrap_pyfunction!(monotonic_ulid, m)?)?;
    m.add_function(wrap_pyfunction!(is_valid, m)?)?;
    m.add_function(wrap_pyfunction!(decode_time, m)?)?;
    m.add_function(wrap_pyfunction!(encode_time, m)?)?;
    m.add_function(wrap_pyfunction!(compare, m)?)?;
    m.add_function(wrap_pyfunction!(generate_many, m)?)?;
    m.add_function(wrap_pyfunction!(uuidv7, m)?)?;
    m.add_function(wrap_pyfunction!(generate_uuidv7_many, m)?)?;
    m.add_function(wrap_pyfunction!(version, m)?)?;
    Ok(())
}
