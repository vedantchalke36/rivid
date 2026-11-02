/**
 * KSUID tests: encoding vectors, timestamp semantics, validation, bulk
 * generation, ordering, and compatibility with the reference `ksuid`
 * npm implementation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import KSUID from 'ksuid'
import {
  ksuid,
  ksuidBytes,
  generateKsuidMany,
  generateKsuidBytes,
  generateKsuidInto,
  isValidKsuid,
  decodeKsuidTime,
  ksuidTime,
  decodeKsuid,
  encodeKsuid,
  compareKsuid,
  sortKsuid,
  KSUID_EPOCH_MS,
  KSUID_EPOCH_SECONDS,
  KSUID_TIME_MAX_MS,
  KSUID_BYTES,
  KSUID_LEN,
  MIN_KSUID,
  MAX_KSUID,
} from '../src/index.js'

const KSUID_RE = /^[0-9A-Za-z]{27}$/
const SAMPLE = '0ujtsYcgvSTl8PAuAdqWYSMnLOv'
const SAMPLE_RAW =
  '0669f7efb5a1cd34b5f99d1154fb6853345c9735'

test('ksuid() produces canonical 27-char base62 strings', () => {
  for (let i = 0; i < 1000; i++) {
    const id = ksuid()
    assert.match(id, KSUID_RE, id)
    assert.equal(id.length, KSUID_LEN)
    assert.equal(isValidKsuid(id), true)
  }
})

test('ksuid() timestamps are current and second-aligned', () => {
  for (let i = 0; i < 100; i++) {
    const ts = decodeKsuidTime(ksuid())
    assert.equal(ts % 1000, 0)
    assert.ok(Math.abs(ts - Date.now()) <= 2_000, `timestamp drifted by ${ts - Date.now()}ms`)
  }
})

test('ksuid() is effectively unique', () => {
  const set = new Set<string>()
  const n = 100_000
  for (let i = 0; i < n; i++) set.add(ksuid())
  assert.equal(set.size, n)
})

test('known KSUID vectors match the reference implementation', () => {
  assert.equal(encodeKsuid(new Uint8Array(20)), MIN_KSUID)
  assert.equal(encodeKsuid(new Uint8Array(20).fill(0xff)), MAX_KSUID)
  assert.deepEqual(Buffer.from(decodeKsuid(SAMPLE)).toString('hex'), SAMPLE_RAW)
  assert.equal(encodeKsuid(decodeKsuid(SAMPLE)), SAMPLE)
  assert.equal(decodeKsuidTime(SAMPLE), 1_507_608_047_000)
})

test('explicit timestamps floor to KSUID seconds', () => {
  const ts = 1_700_000_000_999
  const id = ksuid(ts)
  assert.equal(decodeKsuidTime(id), 1_700_000_000_000)
  const bytes = decodeKsuid(id)
  const ref = KSUID.fromParts(ts, Buffer.alloc(16)).raw
  assert.deepEqual(Buffer.from(bytes.subarray(0, 4)), ref.subarray(0, 4))
})

test('explicit timestamp range matches the KSUID era', () => {
  assert.doesNotThrow(() => ksuid(KSUID_EPOCH_MS))
  assert.doesNotThrow(() => ksuid(KSUID_TIME_MAX_MS))
  assert.throws(() => ksuid(KSUID_EPOCH_MS - 1), /out of range/i)
  assert.throws(() => ksuid(KSUID_TIME_MAX_MS + 1), /out of range/i)
  assert.throws(() => ksuid(1.5), /out of range/i)
  assert.throws(() => ksuid(Number.NaN), /out of range/i)
})

test('constants expose the KSUID domain', () => {
  assert.equal(KSUID_EPOCH_MS, KSUID_EPOCH_SECONDS * 1000)
  assert.equal(KSUID_BYTES, 20)
  assert.equal(MIN_KSUID.length, KSUID_LEN)
  assert.equal(MAX_KSUID.length, KSUID_LEN)
})

test('ksuidBytes() yields 20 bytes with a matching timestamp', () => {
  for (let i = 0; i < 100; i++) {
    const bytes = ksuidBytes()
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes.length, KSUID_BYTES)
    const id = encodeKsuid(bytes)
    assert.equal(isValidKsuid(id), true)
    assert.equal(ksuidTime(bytes), decodeKsuidTime(id))
    assert.deepEqual(decodeKsuid(id), bytes)
  }
})

test('decode/encode round trip preserves exact bytes', () => {
  for (let i = 0; i < 500; i++) {
    const id = ksuid()
    assert.equal(encodeKsuid(decodeKsuid(id)), id)
  }
})

test('decode and encode enforce exact widths', () => {
  assert.throws(() => decodeKsuid('nope'), /length/i)
  assert.throws(() => decodeKsuid(MIN_KSUID.slice(0, 26)), /length/i)
  assert.throws(() => encodeKsuid(new Uint8Array(19)), /length/i)
  assert.throws(() => encodeKsuid(new Uint8Array(21)), /length/i)
})

test('validation rejects malformed and overflowing strings', () => {
  const invalid = [
    '',
    'short',
    MIN_KSUID.slice(1),
    `${MIN_KSUID}0`,
    '0ujtsYcgvSTl8PAuAdqWYSMnLO-',
    'aWgEPTl1tmebfsQzFP4bxwgy80W',
    'aWgEPTl1tmebfsQzFP4bxwgy80v',
    'b00000000000000000000000000',
  ]
  for (const id of invalid) {
    assert.equal(isValidKsuid(id), false, id)
    assert.throws(() => decodeKsuid(id), /length|character|160 bits/i)
  }
})

test('isValidKsuid agrees with the reference parser on well-formed input', () => {
  const cases = [
    MIN_KSUID,
    MAX_KSUID,
    SAMPLE,
    '0ujtsYcgvSTl8PAuAdqWYSMnLOW',
    'aWgEPTl1tmebfsQzFP4bxwgy80W',
    'b00000000000000000000000000',
    '',
  ]
  for (const id of cases) {
    let ref = true
    try {
      KSUID.parse(id)
    } catch {
      ref = false
    }
    assert.equal(isValidKsuid(id), ref, id)
  }
  // The reference parser is lenient about non-base62 characters; Rivid
  // intentionally rejects them instead of decoding them as negative digits.
  assert.equal(isValidKsuid('0ujtsYcgvSTl8PAuAdqWYSMnLO-'), false)
})

test('compare orders by full 160-bit value', () => {
  assert.equal(compareKsuid(MIN_KSUID, MAX_KSUID), -1)
  assert.equal(compareKsuid(MAX_KSUID, MIN_KSUID), 1)
  assert.equal(compareKsuid(SAMPLE, SAMPLE), 0)
  const a = ksuid(1_700_000_000_000)
  const b = ksuid(1_700_000_001_000)
  assert.equal(compareKsuid(a, b), -1)
  assert.equal(compareKsuid(a, a), 0)
})

test('compare throws on invalid input', () => {
  assert.throws(() => compareKsuid('bad', ksuid()), /length|character/i)
  assert.throws(() => compareKsuid(ksuid(), ''), /length|character/i)
})

test('sortKsuid returns a new sorted array without mutating input', () => {
  const ids = [ksuid(), MAX_KSUID, ksuid(), MIN_KSUID, ksuid()]
  const snapshot = [...ids]
  const sorted = sortKsuid(ids)
  assert.notEqual(sorted, ids)
  assert.deepEqual(ids, snapshot)
  assert.equal(sorted[0], MIN_KSUID)
  assert.equal(sorted[sorted.length - 1], MAX_KSUID)
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(compareKsuid(sorted[i - 1]!, sorted[i]!) <= 0)
  }
})

test('string ordering matches the reference implementation', () => {
  const ids = Array.from({ length: 500 }, () => ksuid())
  assert.deepEqual(sortKsuid(ids), [...ids].sort())
})

test('bulk string generation shares one second and is unique', () => {
  const ids = generateKsuidMany(10_000)
  assert.equal(ids.length, 10_000)
  assert.equal(new Set(ids).size, ids.length)
  const stamps = new Set(ids.map((id) => decodeKsuidTime(id)))
  assert.equal(stamps.size, 1)
  for (const id of ids) assert.equal(isValidKsuid(id), true)
})

test('bulk byte and preallocated generation match string encoding', () => {
  for (const n of [0, 1, 10, 1_000]) {
    const bytes = generateKsuidBytes(n)
    assert.equal(bytes.length, n * 20)
    for (let i = 0; i < n; i++) {
      const id = encodeKsuid(bytes.subarray(i * 20, (i + 1) * 20))
      assert.equal(isValidKsuid(id), true)
    }

    const out = new Uint8Array(n * 20)
    assert.equal(generateKsuidInto(out), n)
    for (let i = 0; i < n; i++) {
      const id = encodeKsuid(out.subarray(i * 20, (i + 1) * 20))
      assert.equal(isValidKsuid(id), true)
    }
  }
  assert.throws(() => generateKsuidInto(new Uint8Array(21)), /length/i)
  assert.throws(() => generateKsuidMany(-1), /count must be/i)
  assert.throws(() => generateKsuidBytes(-1), /count must be/i)
})

test('generated KSUIDs parse through the reference package', () => {
  for (const id of generateKsuidMany(500)) {
    const parsed = KSUID.parse(id)
    assert.equal(parsed.string, id)
    assert.equal((parsed.timestamp + KSUID_EPOCH_SECONDS) * 1000, decodeKsuidTime(id))
    assert.deepEqual(Buffer.from(decodeKsuid(id)), parsed.raw)
  }
})

test('reference-generated KSUIDs decode through Rivid', () => {
  const payload = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  for (const ms of [KSUID_EPOCH_MS, 1_507_608_047_000, 1_700_000_000_000, KSUID_TIME_MAX_MS]) {
    const ref = KSUID.fromParts(ms, payload)
    const id = ref.string
    assert.equal(decodeKsuidTime(id), (ref.timestamp + KSUID_EPOCH_SECONDS) * 1000)
    assert.deepEqual(Buffer.from(decodeKsuid(id)), ref.raw)
    assert.equal(encodeKsuid(decodeKsuid(id)), id)
  }
})
