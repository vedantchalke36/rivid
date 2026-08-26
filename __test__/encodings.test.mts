/**
 * Alternative encoding tests: Base58, Base64URL, Crockford, Sortable,
 * and ULID<->UUID conversions. Includes round-trip property sweeps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  ulidToBytes,
  bytesToUlid,
  ulid,
  ulidBytes,
  decode,
  encode,
} from '../src/index.js'

/** Deterministic xorshift for reproducible property sweeps in JS. */
function prng(seed: number): () => number {
  let s = seed | 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

function random16(rand: () => number): Uint8Array {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(rand() * 256)
  return b
}

// ---------------------------------------------------------------------------
// Base58
// ---------------------------------------------------------------------------

test('base58 known vectors', () => {
  assert.equal(encodeBase58(new Uint8Array(0)), '')
  assert.deepEqual(decodeBase58(''), new Uint8Array(0))
  assert.equal(
    encodeBase58(new TextEncoder().encode('hello world')),
    'StV1DL6CwTryKyV',
  )
  assert.deepEqual(
    decodeBase58('StV1DL6CwTryKyV'),
    new TextEncoder().encode('hello world'),
  )
  assert.equal(encodeBase58(new Uint8Array([0, 0, 1])), '112')
  assert.deepEqual(decodeBase58('112'), new Uint8Array([0, 0, 1]))
})

test('base58 alphabet excludes 0 O I l', () => {
  const out = encodeBase58(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 1, 2, 3]))
  assert.equal(/[0OIl]/.test(out), false)
})

test('base58 rejects invalid characters', () => {
  assert.throws(() => decodeBase58('0'))
  assert.throws(() => decodeBase58('O'))
  assert.throws(() => decodeBase58('I'))
  assert.throws(() => decodeBase58('l'))
})

test('base58: 128-bit IDs encode to at most 22 chars', () => {
  const rand = prng(42)
  let maxLen = 0
  for (let i = 0; i < 2000; i++) {
    const s = encodeBase58(random16(rand))
    maxLen = Math.max(maxLen, s.length)
  }
  assert.ok(maxLen <= 22, `maxLen ${maxLen}`)
  // The maximum value fills all 22 characters.
  assert.equal(encodeBase58(new Uint8Array(16).fill(255)).length, 22)
})

// ---------------------------------------------------------------------------
// Base64URL
// ---------------------------------------------------------------------------

test('base64url RFC 4648 vectors', () => {
  const enc = (s: string) => encodeBase64Url(new TextEncoder().encode(s))
  const dec = (s: string) => new TextDecoder().decode(decodeBase64Url(s))
  assert.equal(enc(''), '')
  assert.equal(enc('f'), 'Zg')
  assert.equal(enc('fo'), 'Zm8')
  assert.equal(enc('foo'), 'Zm9v')
  assert.equal(enc('foob'), 'Zm9vYg')
  assert.equal(enc('fooba'), 'Zm9vYmE')
  assert.equal(enc('foobar'), 'Zm9vYmFy')
  assert.equal(dec('Zm9vYmFy'), 'foobar')
  // Padded forms accepted on decode.
  assert.equal(dec('Zg=='), 'f')
  assert.equal(dec('Zm8='), 'fo')
})

test('base64url is URL-safe and unpadded', () => {
  const rand = prng(7)
  for (let i = 0; i < 500; i++) {
    const s = encodeBase64Url(random16(rand))
    assert.equal(/[+/=]/.test(s), false)
  }
})

test('base64url: 128-bit IDs are exactly 22 chars', () => {
  assert.equal(encodeBase64Url(new Uint8Array(16)).length, 22)
  assert.equal(encodeBase64Url(new Uint8Array(16).fill(255)).length, 22)
})

test('base64url rejects bad input', () => {
  assert.throws(() => decodeBase64Url('Z')) // len % 4 == 1
  assert.throws(() => decodeBase64Url('Zg=')) // bad padding
  assert.throws(() => decodeBase64Url('Zm+v')) // '+' not URL-safe
  assert.throws(() => decodeBase64Url('Zh')) // non-canonical bits
  assert.deepEqual(decodeBase64Url('Zg'), new TextEncoder().encode('f'))
})

// ---------------------------------------------------------------------------
// Crockford (canonical ULID codec as a byte-level utility)
// ---------------------------------------------------------------------------

test('crockford mirrors ulid()/decode()/encode()', () => {
  for (let i = 0; i < 300; i++) {
    const bytes = ulidBytes()
    assert.equal(encodeCrockford(bytes), encode(bytes))
    assert.deepEqual(decodeCrockford(encode(bytes)), bytes)
  }
})

test('crockford decode is case-insensitive', () => {
  const s = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
  assert.deepEqual(decodeCrockford(s.toLowerCase()), decodeCrockford(s))
  assert.throws(() => decodeCrockford('01ARZ3NDEKTSV4RRFFQ69G5FAU'))
  assert.throws(() => decodeCrockford('tooshort'))
})

test('crockford enforces 16-byte input', () => {
  assert.throws(() => encodeCrockford(new Uint8Array(15)))
})

// ---------------------------------------------------------------------------
// Sortable (Fast ULID extension)
// ---------------------------------------------------------------------------

test('sortable: fixed 22-char URL-safe output', () => {
  const rand = prng(99)
  for (let i = 0; i < 1000; i++) {
    const s = encodeSortable(random16(rand))
    assert.equal(s.length, 22)
    assert.equal(/[+/_=]|[^-A-Za-z0-9]/.test(s.replace(/_/g, '')), false, s)
  }
})

test('sortable preserves lexicographic order of values', () => {
  const rand = prng(1234)
  const pairs: Array<[Uint8Array, string]> = []
  pairs.push([new Uint8Array(16), encodeSortable(new Uint8Array(16))])
  const max = new Uint8Array(16).fill(255)
  pairs.push([max, encodeSortable(max)])
  for (let i = 0; i < 20_000; i++) {
    const b = random16(rand)
    pairs.push([b, encodeSortable(b)])
  }
  const byBytes = [...pairs].sort((a, b) => {
    const x = Buffer.from(a[0])
    const y = Buffer.from(b[0])
    return x.compare(y)
  })
  const byString = [...pairs].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  assert.deepEqual(
    byBytes.map((p) => p[1]),
    byString.map((p) => p[1]),
  )
})

test('sortable round trip (property sweep)', () => {
  const rand = prng(555)
  for (let i = 0; i < 20_000; i++) {
    const b = random16(rand)
    assert.deepEqual(decodeSortable(encodeSortable(b)), b)
  }
})

test('sortable rejects non-canonical padding', () => {
  const good = encodeSortable(new Uint8Array(16)) // all '-' except last char
  assert.deepEqual(decodeSortable(good), new Uint8Array(16))
  // Flip last char to one with non-zero low nibble -> non-canonical.
  const bad = good.slice(0, 21) + 'B'
  assert.throws(() => decodeSortable(bad), /canonical/i)
  assert.throws(() => decodeSortable(good.slice(0, 10)), /length/i)
})

test('sortable is shorter than Crockford for the same value', () => {
  const b = ulidBytes()
  assert.ok(encodeSortable(b).length < encodeCrockford(b).length)
})

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

test('ulidToUuid matches reference vectors', () => {
  assert.equal(
    ulidToUuid('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    '01563E3A-B5D3-D676-4C61-EFB99302BD5B',
  )
  assert.equal(
    ulidToUuid('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
    '015F4BFF-CD73-5334-ADA7-8EDC1D4A6F1F',
  )
  assert.equal(
    ulidToUuid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'),
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
  )
})

test('uuidToUlid inverts ulidToUuid', () => {
  for (let i = 0; i < 200; i++) {
    const id = ulid()
    assert.equal(uuidToUlid(ulidToUuid(id)), id)
  }
})

test('uuidToUlid accepts lowercase and rejects malformed', () => {
  assert.equal(
    uuidToUlid('01563e3a-b5d3-d676-4c61-efb99302bd5b'),
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  )
  assert.throws(() => uuidToUlid('nope'))
  assert.throws(() => uuidToUlid('01563e3ab5d3d6764c61efb99302bd5b')) // no dashes
  assert.throws(() => uuidToUlid('01563e3a-b5d3-d676-4c61-efb99302bd5g'))
})

test('ulidToBytes/bytesToUlid alias decode/encode', () => {
  for (let i = 0; i < 50; i++) {
    const id = ulid()
    assert.deepEqual(ulidToBytes(id), decode(id))
    assert.equal(bytesToUlid(ulidToBytes(id)), id)
  }
})
