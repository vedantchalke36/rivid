use std::fmt;

/// Errors produced by the ID engine.
///
/// All decoders and validators are total: they return `Err` on any malformed
/// input instead of panicking. This property is enforced by fuzz targets in
/// `fuzz/`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// Input string length does not match the format's expected length.
    InvalidLength { expected: usize, got: usize },
    /// A character outside of the format's alphabet was encountered.
    InvalidCharacter(u8),
    /// The encoded value exceeds what 128 bits (or a 48-bit ULID timestamp)
    /// can represent, e.g. a ULID string whose first char is above `7`.
    ValueTooLarge,
    /// Timestamp argument is outside the representable range
    /// (`0..=2^48-1`). Stored losslessly as `u64`.
    TimestampOutOfRange(u64),
    /// A sortable/base58/base64url input is not in canonical form.
    NonCanonical,
    /// Input is not a valid UUID string.
    InvalidUuid,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidLength { expected, got } => {
                write!(f, "invalid length: expected {expected}, got {got}")
            }
            Error::InvalidCharacter(c) => {
                write!(f, "invalid character: {:?}", *c as char)
            }
            Error::ValueTooLarge => write!(
                f,
                "encoded value exceeds 128 bits (ULID timestamp part must be <= 2^48-1)"
            ),
            Error::TimestampOutOfRange(t) => write!(
                f,
                "timestamp {t} out of range: must be an integer between 0 and 281474976710655 (2^48 - 1)"
            ),
            Error::NonCanonical => write!(f, "input is not in canonical form"),
            Error::InvalidUuid => write!(f, "invalid UUID string"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
