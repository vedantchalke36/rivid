/**
 * Compile-time public-API assertions.
 *
 * Not executed at runtime — this file exists so `npm run lint`
 * (tsc --noEmit via config/tsconfig.check.json) fails if the generated
 * `index.d.ts` drifts from the documented surface. That matters because
 * scripts/post-build.mjs regex-rewrites parts of it after every build;
 * these assertions pin the shapes consumers rely on.
 */
import type {
  UlidGenerator,
} from '../src/index.js'
import {
  compare,
  decode,
  decodeTime,
  encode,
  encodeBase58,
  encodeBase64Url,
  encodeTime,
  generateBytes,
  generateInto,
  generateMany,
  generateKsuidBytes,
  generateKsuidInto,
  generateKsuidMany,
  generateUuidV7Many,
  isValid,
  isValidKsuid,
  ksuid,
  ksuidBytes,
  ksuidTime,
  decodeKsuid,
  decodeKsuidTime,
  encodeKsuid,
  compareKsuid,
  sortKsuid,
  monotonicUlid,
  ulid,
  ulidBytes,
  ulidToUuid,
  uuidToUlid,
  uuidv7,
  KSUID_BYTES,
  KSUID_EPOCH_MS,
  KSUID_LEN,
  KSUID_TIME_MAX_MS,
  MAX_KSUID,
  MAX_ULID,
  MIN_KSUID,
  MIN_ULID,
  TIME_MAX,
} from '../src/index.js'

// Return types.
const id: string = ulid()
const mono: string = monotonicUlid(id.length - 1)
const bulkStrings: string[] = generateMany(10)
const bulkBytes: Uint8Array = generateBytes(10)
const singleBytes: Uint8Array = ulidBytes()
const v7: string = uuidv7()
const valid: boolean = isValid(id)
const time: number = decodeTime(id)
const encoded: string = encodeTime(1_700_000_000_000)
const round: string = encode(decode(id))
const ord: number = compare(id, id)
const b58: string = encodeBase58(singleBytes)
const b64u: string = encodeBase64Url(singleBytes)
const toUuid: string = ulidToUuid(id)
const fromUuid: string = uuidToUlid(toUuid)
const manyV7: string[] = generateUuidV7Many(10)

// KSUID surface.
const ksuidString: string = ksuid()
const ksuidBulk: string[] = generateKsuidMany(10)
const ksuidBinBulk: Uint8Array = generateKsuidBytes(10)
const ksuidBin: Uint8Array = ksuidBytes()
const ksuidEncoded: string = encodeKsuid(ksuidBin)
const ksuidDecoded: Uint8Array = decodeKsuid(ksuidString)
const ksuidValid: boolean = isValidKsuid(ksuidString)
const ksuidMs: number = decodeKsuidTime(ksuidString)
const ksuidBytesMs: number = ksuidTime(ksuidBin)
const ksuidOrder: number = compareKsuid(ksuidString, ksuidString)
const ksuidSorted: string[] = sortKsuid([ksuidString, MIN_KSUID, MAX_KSUID])
const ksuidWritten: number = generateKsuidInto(new Uint8Array(40))

// Constants are strings/number as documented.
const minOk: string = MIN_ULID
const maxOk: string = MAX_ULID
const timeMaxOk: number = TIME_MAX
const ksuidEpochOk: number = KSUID_EPOCH_MS
const ksuidTimeMaxOk: number = KSUID_TIME_MAX_MS
const ksuidBytesOk: number = KSUID_BYTES
const ksuidLenOk: number = KSUID_LEN
const ksuidMinOk: string = MIN_KSUID
const ksuidMaxOk: string = MAX_KSUID

// Generator class surface.
declare const gen: UlidGenerator
const genNext: string = gen.next()
const genMono: string = gen.monotonic()

// Rejected argument shapes (compile errors only).
// @ts-expect-error seedTime must be a number, not a string
ulid('1700000000000')
// @ts-expect-error validator takes a string
isValid(123)
// @ts-expect-error decoder takes a string
decode(42 as unknown as null)
// @ts-expect-error encoder takes bytes
encode('01ARZ3NDEKTSV4RRFFQ69G5FAV')
// @ts-expect-error count must be a number
generateMany('10')
// @ts-expect-error KSUID timestamp is a number of milliseconds
ksuid('1700000000000')
// @ts-expect-error KSUID validator takes a string
isValidKsuid(123)

// Silence unused-var linting for pure type assertions.
export type __Asserts = [
  typeof id, typeof mono, typeof bulkStrings, typeof bulkBytes,
  typeof singleBytes, typeof v7, typeof valid, typeof time,
  typeof encoded, typeof round, typeof ord, typeof b58, typeof b64u,
  typeof toUuid, typeof fromUuid, typeof manyV7, typeof minOk,
  typeof maxOk, typeof timeMaxOk, typeof genNext, typeof genMono,
  typeof ksuidString, typeof ksuidBulk, typeof ksuidBinBulk,
  typeof ksuidBin, typeof ksuidEncoded, typeof ksuidDecoded,
  typeof ksuidValid, typeof ksuidMs, typeof ksuidBytesMs,
  typeof ksuidOrder, typeof ksuidSorted, typeof ksuidWritten,
  typeof ksuidEpochOk, typeof ksuidTimeMaxOk, typeof ksuidBytesOk,
  typeof ksuidLenOk, typeof ksuidMinOk, typeof ksuidMaxOk,
]
