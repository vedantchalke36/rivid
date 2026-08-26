/**
 * UUIDv7 (RFC 9562) — a secondary feature built on the same Rust engine.
 *
 * UUIDv7 embeds a 48-bit millisecond timestamp followed by random bits,
 * giving it the same coarse sortability as ULID with standard UUID
 * representation.
 */
export {
  /** Canonical lowercase hyphenated UUIDv7 string. */
  uuidv7,
  /** Raw 16-byte UUIDv7 (big-endian wire order). */
  uuidv7Bytes,
  /** Bulk generation: `count` UUIDv7 strings in one NAPI call. */
  generateUuidV7Many,
} from '../index.js'

import { uuidv7Bytes, uuidv7Time as nativeTime } from '../index.js'

/**
 * Extracts the millisecond Unix timestamp from UUIDv7 **bytes**
 * (`bytes.length` must be exactly 16).
 *
 * @remarks
 * Note the name overlap with the root `decodeTime(id: string)`: the root
 * export operates on 26-character ULID strings, while this function (only
 * reachable via the `uuidv7` submodule) operates on raw 16-byte UUIDv7
 * values. For UUIDv7 strings use {@link decodeTimeFromString}.
 *
 * @param bytes - Raw 16-byte UUIDv7 in big-endian wire order.
 * @returns Milliseconds since the Unix epoch.
 */
export function decodeTime(bytes: Uint8Array): number {
  return nativeTime(bytes)
}

/**
 * Extracts the millisecond Unix timestamp from a canonical UUIDv7 string.
 *
 * @param uuid - Hyphenated or hex UUIDv7 string (32 hex digits).
 * @returns Milliseconds since the Unix epoch.
 * @throws `TypeError` if the string is not exactly 32 hexadecimal digits
 * after hyphen removal.
 */
export function decodeTimeFromString(uuid: string): number {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new TypeError('invalid UUID string')
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return nativeTime(bytes)
}

/** Convenience alias matching `uuidv7Bytes()`. */
export const bytes = uuidv7Bytes
