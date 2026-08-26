/**
 * Primary ULID API tests: format, spec vectors, validation, timestamps,
 * monotonic behavior, bulk generation, binary representation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ulid,
  monotonicUlid,
  generateMany,
  generateBytes,
  generateInto,
  ulidBytes,
  isValid,
  decodeTime,
  encodeTime,
  decode,
  encode,
  compare,
  sort,
  sortInPlace,
  MIN_ULID,
  MAX_ULID,
  TIME_MAX,
  UlidGenerator,
} from '../src/index.js'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

const SAMPLE_TIME = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

test('ulid() produces canonical 26-char uppercase Crockford strings', () => {
  for (let i = 0; i < 1000; i++) {
    const id = ulid()
    assert.match(id, ULID_RE, id)
    assert.equal(id.length, 26)
  }
})

test('ulid() timestamps are current', () => {
  for (let i = 0; i < 100; i++) {
    const ts = decodeTime(ulid())
    const delta = Math.abs(ts - Date.now())
    // Generous bound: under parallel test-runner load the event loop can
    // stall for many milliseconds between generation and this check.
    assert.ok(delta <= 250, `timestamp drifted by ${delta}ms`)
  }
})

test('ulid() is effectively unique', () => {
  const set = new Set<string>()
  const N = 100_000
  for (let i = 0; i < N; i++) set.add(ulid())
  assert.equal(set.size, N)
})

// ---------------------------------------------------------------------------
// Spec vectors (extracted from the reference `ulid` npm package v3.0.2)
// ---------------------------------------------------------------------------

test('encodeTime known vectors', () => {
  assert.equal(encodeTime(0), '0000000000')
  assert.equal(encodeTime(1), '0000000001')
  assert.equal(encodeTime(1469918176385), '01ARYZ6S41')
  assert.equal(encodeTime(TIME_MAX), '7ZZZZZZZZZ')
  assert.equal(encodeTime(424242424242), '00CB3D3ADJ')
  assert.equal(encodeTime(1704067200000), '01HK153X00')
})

test('encodeTime rejects out-of-range and non-integer input', () => {
  const rangeErr = /out of range|not an integer/i
  assert.throws(() => encodeTime(-1), rangeErr)
  assert.throws(() => encodeTime(TIME_MAX + 1), rangeErr)
  assert.throws(() => encodeTime(1.5), rangeErr)
  assert.throws(() => encodeTime(Number.NaN), rangeErr)
  assert.throws(() => encodeTime(Number.POSITIVE_INFINITY), rangeErr)
})

test('decodeTime known vectors', () => {
  assert.equal(decodeTime('01ARZ3NDEKTSV4RRFFQ69G5FAV'), 1469922850259)
  assert.equal(decodeTime(MAX_ULID), TIME_MAX)
  assert.equal(decodeTime(MIN_ULID), 0)
})

test('decodeTime rejects malformed input', () => {
  assert.throws(() => decodeTime('short'), /length/i)
  assert.throws(() => decodeTime(''), /length/i)
})

test('decodeTime only inspects the first 10 chars (reference parity)', () => {
  // Like the reference `ulid.decodeTime`, only the time component is parsed;
  // garbage in the random part is irrelevant.
  const id = '01ARZ3NDEKTSV4RRFFQ69G5FAU' // invalid 'U' at position 25
  assert.doesNotThrow(() => decodeTime(id))
  assert.equal(decodeTime(id), decodeTime(SAMPLE_TIME))
})

test('encodeTime/decodeTime round trip across the domain', () => {
  for (const t of [0, 1, 2, Date.now(), 1469918176385, TIME_MAX - 1, TIME_MAX]) {
    assert.equal(decodeTime(encodeTime(t) + 'ZZZZZZZZZZZZZZZZ'), t)
  }
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('isValid accepts canonical and case-insensitive forms', () => {
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAV'), true)
  assert.equal(isValid('01arz3ndektsv4rrffq69g5fav'), true)
  assert.equal(isValid(ulid()), true)
  assert.equal(isValid(generateMany(100)[50]!), true)
})

test('isValid rejects malformed values', () => {
  assert.equal(isValid(''), false)
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FA'), false) // 25 chars
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAVV'), false) // 27 chars
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAU'), false) // U excluded
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAL'), false) // L excluded
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAI'), false) // I excluded
  assert.equal(isValid('01ARZ3NDEKTSV4RRFFQ69G5FAO'), false) // O excluded
  assert.equal(isValid('-1ARZ3NDEKTSV4RRFFQ69G5FAV'), false)
})

// ---------------------------------------------------------------------------
// Binary representation
// ---------------------------------------------------------------------------

test('ulidBytes() yields 16 bytes with correct layout', () => {
  for (let i = 0; i < 100; i++) {
    const bytes = ulidBytes()
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes.length, 16)
    const id = encode(bytes)
    assert.equal(isValid(id), true)
    assert.deepEqual(decode(id), bytes)
  }
})

test('decode/encode round trip preserves exact value', () => {
  for (let i = 0; i < 500; i++) {
    const id = ulid()
    assert.equal(encode(decode(id)), id)
  }
})

test('decode accepts lowercase, encode always emits uppercase', () => {
  const lower = ulid().toLowerCase()
  assert.equal(encode(decode(lower)), encode(decode(lower.toUpperCase())))
})

test('decode rejects invalid input precisely', () => {
  assert.throws(() => decode('nope'), /length/i)
  assert.throws(() => decode(MIN_ULID.slice(0, 25)), /length/i)
  // First char above 7 would exceed 128 bits.
  assert.throws(() => decode('8' + MIN_ULID.slice(1)), /128 bits/i)
  assert.throws(() => decode(MIN_ULID.replace(/^0/, 'U')), /invalid character/i)
})

test('encode enforces exactly 16 bytes', () => {
  assert.throws(() => encode(new Uint8Array(15)), /length/i)
  assert.throws(() => encode(new Uint8Array(17)), /length/i)
  assert.equal(encode(new Uint8Array(16)), MIN_ULID)
  assert.equal(encode(new Uint8Array([...Array(6).fill(255), ...Array(10).fill(255)])), MAX_ULID)
})

// ---------------------------------------------------------------------------
// Comparison & sorting
// ---------------------------------------------------------------------------

test('compare orders by full 128-bit value', () => {
  assert.equal(compare(MIN_ULID, MAX_ULID), -1)
  assert.equal(compare(MAX_ULID, MIN_ULID), 1)
  assert.equal(compare(MIN_ULID, MIN_ULID), 0)
  const a = ulid()
  assert.equal(compare(a, a), 0)
  // Case-insensitive equivalence.
  assert.equal(compare(a.toLowerCase(), a), 0)
  // Later timestamp wins regardless of randomness.
  assert.equal(compare(encodeTime(1) + 'ZZZZZZZZZZZZZZZZ', encodeTime(2) + '0000000000000000'), -1)
})

test('compare throws on invalid input', () => {
  assert.throws(() => compare('bad', ulid()), /length|character/)
  assert.throws(() => compare(ulid(), ''), /length|character/)
  // Invalid charset with correct length surfaces the bad character.
  assert.throws(() => compare('0UARZ3NDEKTSV4RRFFQ69G5FAV', ulid()), /invalid character/)
})

test('sort returns a new sorted array without mutating input', () => {
  const ids = [ulid(), MAX_ULID, ulid(), MIN_ULID, ulid()]
  const snapshot = [...ids]
  const sorted = sort(ids)
  assert.notEqual(sorted, ids)
  assert.deepEqual(ids, snapshot)
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(compare(sorted[i - 1]!, sorted[i]!) <= 0)
  }
  assert.equal(sorted[0], MIN_ULID)
  assert.equal(sorted[sorted.length - 1], MAX_ULID)
})

test('sortInPlace mutates the array', () => {
  const ids = [ulid(), MAX_ULID, ulid(), MIN_ULID]
  sortInPlace(ids)
  assert.equal(ids[0], MIN_ULID)
  assert.equal(ids[3], MAX_ULID)
})

test('sort matches JavaScript native ordering for same-case ids', () => {
  const ids = Array.from({ length: 200 }, () => ulid())
  const expected = [...ids].sort()
  const got = sort(ids)
  assert.deepEqual(got, expected)
})

test('sort throws on invalid elements', () => {
  assert.throws(() => sort(['not-a-ulid']), /length|character/)
})

// ---------------------------------------------------------------------------
// Monotonic
// ---------------------------------------------------------------------------

test('monotonicUlid() is strictly increasing within the process', () => {
  let prev = monotonicUlid()
  for (let i = 0; i < 10_000; i++) {
    const next = monotonicUlid()
    assert.ok(next > prev, `${next} !> ${prev}`)
    prev = next
  }
})

test('monotonicUlid() increments within same millisecond', () => {
  const first = monotonicUlid()
  const second = monotonicUlid()
  assert.equal(first.slice(0, 10), second.slice(0, 10))
  assert.ok(second > first)
  // Last char should differ by an increment of the random part.
  assert.notEqual(first, second)
})

test('bulk generation: generateMany', () => {
  for (const n of [0, 1, 10, 1000]) {
    const ids = generateMany(n)
    assert.equal(ids.length, n)
    for (const id of ids) {
      assert.equal(id.length, 26)
      assert.equal(isValid(id), true)
    }
  }
})

test('generateMany large batch is unique', () => {
  const ids = generateMany(200_000)
  assert.equal(new Set(ids).size, ids.length)
})

test('generateMany validates count bounds', () => {
  assert.throws(() => generateMany(-1), /count must be/)
  assert.throws(() => generateMany(100_000_001), /count must be/)
})

test('generateBytes packs IDs contiguously', () => {
  const buf = generateBytes(1000)
  assert.ok(buf instanceof Uint8Array)
  assert.equal(buf.length, 16 * 1000)
  for (let i = 0; i < 1000; i++) {
    const id = encode(buf.subarray(i * 16, (i + 1) * 16))
    assert.equal(isValid(id), true)
    // All share the batch timestamp.
    assert.ok(Math.abs(decodeTime(id) - Date.now()) <= 250)
  }
})

test('generateBytes rejects bad counts', () => {
  assert.throws(() => generateBytes(-5), /count must be/)
})

test('generateInto fills caller-provided buffers', () => {
  const buf = new Uint8Array(16 * 500)
  const n = generateInto(buf)
  assert.equal(n, 500)
  for (const chunk of Array.from({ length: n }, (_, i) => buf.subarray(i * 16, (i + 1) * 16))) {
    assert.equal(isValid(encode(chunk)), true)
  }
  // Zero-length buffer writes zero IDs.
  assert.equal(generateInto(new Uint8Array(0)), 0)
  // Non-multiple of 16 must throw.
  assert.throws(() => generateInto(new Uint8Array(17)), /length/i)
})

test('batch timestamp semantics: all IDs in one batch share one instant', () => {
  const ids = generateMany(10_000)
  const stamps = new Set(ids.map((id) => id.slice(0, 10)))
  // A single captured timestamp means at most one distinct time prefix per batch.
  assert.equal(stamps.size, 1)
})
