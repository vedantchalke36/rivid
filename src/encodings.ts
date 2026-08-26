/**
 * Alternative encodings for the underlying 128-bit identifier.
 *
 * These are secondary utilities. They never affect `ulid()`, which always
 * returns the canonical, spec-compliant Crockford Base32 form.
 */
import {
  encodeBase58,
  decodeBase58,
  encodeBase64Url,
  decodeBase64Url,
  encodeCrockford,
  decodeCrockford,
  encodeSortable,
  decodeSortable,
  ulidToUuid,
  uuidToUlid,
} from '../index.js'

export {
  /**
   * Base58 (Bitcoin alphabet: no `0 O I l`) encoding of arbitrary bytes.
   *
   * A 128-bit identifier encodes to ~22 characters. NOT lexicographically
   * sortable — numeric order is not preserved by string comparison.
   *
   * @param bytes - Arbitrary-length byte payload.
   */
  encodeBase58,
  /**
   * Base58 decoding; throws `TypeError` on any non-alphabet character.
   *
   * @param value - Base58 string (Bitcoin alphabet).
   */
  decodeBase58,
  /**
   * Unpadded Base64URL (RFC 4648 §5) encoding of arbitrary bytes.
   *
   * A 128-bit identifier encodes to exactly 22 characters. Plain Base64URL
   * is not sortable; use {@link encodeSortable} if ordering matters.
   *
   * @param bytes - Arbitrary-length byte payload.
   */
  encodeBase64Url,
  /**
   * Base64URL decoding. Accepts both padded and unpadded input; throws
   * `TypeError` on invalid characters and non-canonical trailing bits.
   *
   * @param value - Base64URL string, padded or unpadded.
   */
  decodeBase64Url,
  /**
   * Crockford Base32 encoding of exactly 16 bytes — identical to the ULID
   * string format. Throws `RangeError`-style errors unless `bytes.length === 16`.
   *
   * @param bytes - Exactly 16 bytes, big-endian.
   */
  encodeCrockford,
  /**
   * Crockford Base32 decoding of exactly 26 characters (case-insensitive).
   * This is the inverse of the canonical ULID encoding.
   *
   * @param value - 26-character Crockford Base32 string.
   */
  decodeCrockford,
} from '../index.js'

/**
 * **Fast ULID Sortable** — a project-specific extension, NOT standard ULID.
 *
 * Encodes exactly 16 bytes into 22 URL-safe characters whose lexicographic
 * order matches the numeric order of the underlying 128-bit value:
 *
 * - same character set as Base64URL (`A-Z a-z 0-9 - _`)
 * - alphabet index order equals ASCII order
 * - fixed length ⇒ byte-wise comparison == value comparison
 * - strictly canonical: decoding rejects non-zero padding bits
 *
 * Use only within systems you fully control (both writer and reader).
 */
export {
  encodeSortable,
  decodeSortable,
} from '../index.js'

export {
  /**
   * Converts a ULID string to its hyphenated uppercase UUID form.
   *
   * This is a pure reinterpretation of the same 128 bits. It does NOT make
   * a UUID "mean" anything new: only UUIDv7 shares the ULID's timestamp
   * interpretation; converting e.g. a UUIDv4 yields bytes with an
   * incidental leading pattern and no temporal meaning.
   *
   * @param id - Canonical ULID string (26 chars, case-insensitive).
   */
  ulidToUuid,
  /**
   * Inverse of {@link ulidToUuid}. Accepts canonical hyphenated UUIDs.
   *
   * @param uuid - Hyphenated UUID string, any hex case.
   */
  uuidToUlid,
} from '../index.js'

/** Convenience aliases mirroring common naming in other ecosystems. */
export const toUuid = ulidToUuid
export const fromUuid = uuidToUlid

export {
  /**
   * ULID string -> 16 big-endian bytes (alias of `decode()`).
   *
   * @param id - Canonical ULID string (26 chars, case-insensitive).
   */
  ulidToBytes,
} from '../index.js'
export {
  /**
   * 16 big-endian bytes -> canonical ULID string (alias of `encode()`).
   *
   * @param bytes - Exactly 16 bytes, big-endian.
   */
  bytesToUlid,
} from '../index.js'
