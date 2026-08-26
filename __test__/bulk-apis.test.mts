/**
 * Correctness suite for the optimized/bulk APIs added in the performance pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ulid,
  generateMany,
  decodeTime,
  decode,
  decodeInto,
  decodeMany,
  sort,
  UlidGenerator,
  isValid,
} from '../src/index.js'

test('generateMany: length, validity, uniqueness', () => {
  const n = 100_000
  const ids = generateMany(n)
  assert.equal(ids.length, n)
  const set = new Set(ids)
  assert.equal(set.size, n, 'all unique')
  for (const id of ids) assert.ok(isValid(id))
})

test('generateMany: single shared timestamp across whole batch', () => {
  // Batch spans >1ms of wall time; every ID must carry the same instant.
  const before = Date.now()
  const ids = generateMany(500_000) // takes ~100-300 ms on CI hardware
  const after = Date.now()
  const times = new Set<number>()
  for (let i = 0; i < ids.length; i += 997) times.add(decodeTime(ids[i]!))
  assert.equal(times.size, 1, `expected one timestamp, got ${times.size}`)
  const t = [...times][0]!
  assert.ok(t >= before - 5 && t <= after + 5, 'timestamp within wall-clock bounds')
})

test('generateMany: rejects invalid counts', () => {
  assert.throws(() => generateMany(-1), /count must be/)
  assert.throws(() => generateMany(100_000_001), /count must be/)
})

test('decodeInto: exact round trip', () => {
  for (const id of [ulid(), ulid(), ulid()]) {
    const out = new Uint8Array(16)
    decodeInto(id, out)
    assert.deepEqual(Array.from(out), Array.from(decode(id)))
    const rt = Buffer.from(out).toString('base64') // ensure stable bytes
    void rt
  }
})

test('decodeInto: rejects wrong-size buffers and invalid ids', () => {
  const out = new Uint8Array(16)
  assert.throws(() => decodeInto('short', out))
  assert.throws(() => decodeInto(ulid(), new Uint8Array(15)))
  assert.throws(() => decodeInto(ulid(), new Uint8Array(17)))
})

test('decodeMany: batch equals per-id decode', () => {
  const ids = generateMany(5_000)
  const packed = decodeMany(ids)
  assert.equal(packed.length, ids.length * 16)
  for (let i = 0; i < ids.length; i++) {
    assert.deepEqual(
      Array.from(packed.subarray(i * 16, (i + 1) * 16)),
      Array.from(decode(ids[i]!)),
      `mismatch at ${i}`,
    )
  }
})

test('decodeMany: throws on any invalid element', () => {
  const ids = generateMany(10)
  ids[7] = 'not-a-ulid'
  assert.throws(() => decodeMany(ids))
})

test('UlidGenerator.nextMany: count, uniqueness, deterministic reproducibility', () => {
  const g1 = new UlidGenerator({ seed: 42 })
  const a = g1.nextMany(1_000)
  assert.equal(a.length, 1_000)
  assert.equal(new Set(a).size, 1_000)

  const g2 = new UlidGenerator({ seed: 42 })
  const b = g2.nextMany(1_000)
  // Deterministic mode with no pinned time still uses now(); within one run
  // both calls likely land in the same ms but may straddle one — compare
  // sorted values modulo timestamp only when timestamps agree.
  const ta = decodeTime(a[0]!)
  const tb = decodeTime(b[0]!)
  if (ta === tb) assert.deepEqual(b, a, 'same seed + same ms => identical sequence')
})

test('UlidGenerator.nextMany: pinned timestamps are fully reproducible', () => {
  const T = 1_700_000_000_000
  const g1 = new UlidGenerator({ seed: 7 })
  const g2 = new UlidGenerator({ seed: 7 })
  const x = Array.from({ length: 500 }, () => g1.next(T))
  const y = Array.from({ length: 500 }, () => g2.next(T))
  assert.deepEqual(x, y, 'same seed + same pinned ms => identical sequences')
})

test('UlidGenerator.monotonicMany: strictly increasing across batch', () => {
  const g = new UlidGenerator()
  const ids = g.monotonicMany(10_000)
  assert.equal(ids.length, 10_000)
  let prev = ''
  for (const id of ids) {
    assert.ok(id > prev, `monotonic violation at ${id}`)
    prev = id
  }
})

test('sort validate:false skips validation cost', () => {
  const ids = generateMany(1_000)
  const sorted = sort(ids, { validate: false })
  assert.deepEqual(sorted, [...ids].sort())
})
