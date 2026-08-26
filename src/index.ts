/**
 * @rivid/core — fast, compatible ULIDs for Node.js and Bun, powered by a Rust core via NAPI-RS.
 * Rust core through NAPI-RS.
 *
 * @remarks
 * The primary API is intentionally tiny:
 *
 * ```ts
 * import { ulid } from '@rivid/core'
 * const id = ulid() // '01K2C7P3Z8...'
 * ```
 *
 * Everything else (bulk generation, binary forms, alternative encodings,
 * UUIDv7) builds on the same 128-bit ID engine and stays out of the way.
 *
 * @packageDocumentation
 */

export {
  // Primary
  ulid,
  monotonicUlid,
  generateMany,
  generateBytes,
  generateInto,
  // Utilities
  ulidBytes,
  isValid,
  decodeTime,
  encodeTime,
  decode,
  encode,
  compare,
} from './ulid.js'

// Sorting helpers (JS-native sort with Rust compare fallback)
export { sort, sortInPlace, MIN_ULID, MAX_ULID, TIME_MAX } from './ulid.js'

// Zero-allocation decode variants (hot-loop APIs)
export { decodeInto, decodeMany } from './ulid.js'

// Alternative encodings & conversions
export {
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
} from './encodings.js'

// Byte-level conversion aliases
export { ulidToBytes, bytesToUlid } from './encodings.js'

// Short aliases for the ULID <-> UUID conversions (same functions).
export { toUuid, fromUuid } from './encodings.js'

// UUIDv7 (secondary)
export { uuidv7, uuidv7Bytes, generateUuidV7Many } from './uuidv7.js'

// UUIDv7 timestamp extraction at the root (avoids decodeTime name clash
// with the ULID string form; see README §Naming note).
export { decodeTime as uuidv7DecodeTime, decodeTimeFromString as uuidv7DecodeTimeFromString } from './uuidv7.js'

// Stateful generator
export { UlidGenerator } from './generator.js'
export type { UlidGeneratorOptions } from './generator.js'

/** Raw native surface; useful for diagnostics and benchmarks. */
export { native } from './internal.js'
