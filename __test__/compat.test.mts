/**
 * Compatibility tests against the reference `ulid` npm package (v3.x).
 *
 * These verify that @rivid/core is a drop-in replacement at the semantic
 * level: identical timestamps, identical encoding/validation rules, and
 * monotonic ordering that agrees with the reference implementation.
 *
 * The reference package is a devDependency used ONLY by this test file and
 * the benchmark suite; it is never required at runtime by the library.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeTime, decodeTime, isValid, monotonicFactory } from 'ulid'
import {
  ulid,
  encodeTime as fastEncodeTime,
  decodeTime as fastDecodeTime,
  isValid as fastIsValid,
  monotonicUlid,
  sort,
} from '../src/index.js'

const SAMPLE = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

test('encodeTime agrees with reference across a timestamp sweep', () => {
  const points = [
    0,
    1,
    2,
    1000,
    1469918176385,
    Date.now(),
    Date.now() + 12345,
    424242424242,
    1704067200000,
    2147483647000,
    281474976710654,
    281474976710655, // TIME_MAX
  ]
  for (const t of points) {
    assert.equal(fastEncodeTime(t), encodeTime(t), `t=${t}`)
  }
})

test('encodeTime rejects what the reference rejects', () => {
  assert.throws(() => fastEncodeTime(-1))
  assert.throws(() => fastEncodeTime(281474976710655 + 1))
})

test('decodeTime agrees with reference on known and generated IDs', () => {
  const ids = [
    SAMPLE,
    '7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
    '0000000000ZZZZZZZZZZZZZZZZ',
    ...Array.from({ length: 500 }, () => ulid()),
  ]
  for (const id of ids) {
    assert.equal(fastDecodeTime(id), decodeTime(id), id)
  }
})

test('isValid agrees with reference on edge cases', () => {
  const cases = [
    '',
    'x',
    SAMPLE,
    SAMPLE.toLowerCase(),
    '01ARZ3NDEKTSV4RRFFQ69G5FAU', // U excluded
    '81ARZ3NDEKTSV4RRFFQ69G5FAV', // format-valid, timestamp domain exceeded
    '-1ARZ3NDEKTSV4RRFFQ69G5FAV', // dash invalid
  ]
  for (const id of cases) {
    assert.equal(fastIsValid(id), isValid(id), JSON.stringify(id))
  }
})

test('monotonic behavior matches reference semantics', () => {
  const t = 1_700_000_000_000
  const refFactory = monotonicFactory()

  // Reference: same seedTime increments the previous random part.
  const r1 = refFactory(t)
  const r2 = refFactory(t)
  assert.equal(r1.slice(0, 10), r2.slice(0, 10))
  assert.ok(r2 > r1)

  // Ours: successive calls are strictly increasing too.
  let prev = monotonicUlid()
  for (let i = 0; i < 2000; i++) {
    const next = monotonicUlid()
    assert.ok(next > prev)
    prev = next
  }
})

test('sort produces the same order as plain lexicographic sorting', () => {
  const ids = Array.from({ length: 300 }, () => ulid())
  const jsSorted = [...ids].sort()
  const rustSorted = sort(ids)
  assert.deepEqual(rustSorted, jsSorted)
})
