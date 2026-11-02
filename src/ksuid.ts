/**
 * KSUID (Segment) — a 160-bit, base62-sortable identifier.
 *
 * ```text
 *  0ujtsYcgvSTl8PAuAdqWYSMnLOv
 *  |--| |--------------------|
 *  32-bit      128-bit random
 *  seconds     payload
 * ```
 *
 * KSUID uses a custom epoch (2014-05-13T16:53:20Z) and second-level
 * precision. Rivid's timestamp arguments and `decode*Time` helpers use Unix
 * **milliseconds** to match the ULID API; the encoded value is floored to
 * the second because that is all KSUID stores.
 */
export {
  /** Canonical 27-character KSUID string. */
  ksuid,
  /** Raw 20-byte KSUID (4-byte timestamp + 16-byte payload). */
  ksuidBytes,
  /** Bulk generation: `count` KSUID strings in one NAPI call. */
  generateKsuidMany,
  /** Bulk generation: `count * 20` bytes in one contiguous Uint8Array. */
  generateKsuidBytes,
  /** Fill a caller-owned buffer; returns the number of IDs written. */
  generateKsuidInto,
  /** Validate length, base62 alphabet, and the 160-bit range. */
  isValidKsuid,
  /** Extract the Unix timestamp (milliseconds) from a KSUID string. */
  decodeKsuidTime,
  /** Extract the Unix timestamp (milliseconds) from 20 KSUID bytes. */
  ksuidTime,
  /** Decode a KSUID string to its 20-byte representation. */
  decodeKsuid,
  /** Encode exactly 20 bytes as a canonical KSUID string. */
  encodeKsuid,
  /** Compare two KSUIDs by full 160-bit value. */
  compareKsuid,
} from '../index.js'

import { sortKsuid as nativeSortKsuid } from '../index.js'

/** KSUID epoch (2014-05-13T16:53:20Z) in Unix milliseconds. */
export const KSUID_EPOCH_MS = 1_400_000_000_000

/** KSUID epoch in Unix seconds. */
export const KSUID_EPOCH_SECONDS = 1_400_000_000

/**
 * Latest Unix millisecond representable by KSUID's 32-bit timestamp field
 * (2150-06-19T23:21:35Z).
 */
export const KSUID_TIME_MAX_MS = 5_694_967_295_000

/** Length of a binary KSUID in bytes. */
export const KSUID_BYTES = 20

/** Length of a canonical KSUID string. */
export const KSUID_LEN = 27

/** Minimum possible KSUID string (all zero bits). */
export const MIN_KSUID = '000000000000000000000000000'

/** Maximum possible KSUID string (`2^160 - 1`). */
export const MAX_KSUID = 'aWgEPTl1tmebfsQzFP4bxwgy80V'

/**
 * Returns a new array with KSUIDs sorted ascending by value.
 *
 * The input is not mutated. Every element must be a valid KSUID.
 */
export function sortKsuid(ids: readonly string[]): string[] {
  return nativeSortKsuid([...ids])
}
