/**
 * Generator class tests: reuse, monotonic behavior, deterministic mode
 * separation from secure mode.
 *
 * Deterministic reproducibility is asserted with an explicit pinned
 * timestamp (`gen.next(T)` / `gen.monotonic(T)`) so tests never race the
 * wall clock across millisecond boundaries. Without a timestamp the random
 * component is still fully seed-determined; only the time prefix follows
 * real time.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UlidGenerator, isValid, ulid, encodeTime } from '../src/index.js'

const T = 1_700_000_000_000

test('generator produces valid ULIDs', () => {
  const gen = new UlidGenerator()
  for (let i = 0; i < 1000; i++) {
    assert.equal(isValid(gen.next()), true)
  }
})

test('generator.monotonic() is strictly increasing per instance', () => {
  const gen = new UlidGenerator()
  let prev = gen.monotonic()
  for (let i = 0; i < 10_000; i++) {
    const next = gen.monotonic()
    assert.ok(next > prev)
    prev = next
  }
})

test('two generators have independent monotonic state', () => {
  const a = new UlidGenerator()
  const b = new UlidGenerator()
  assert.notEqual(a.next(), b.next())
})

test('deterministic mode: same seed + pinned time -> identical sequence', () => {
  const a = new UlidGenerator({ seed: 12345 })
  const b = new UlidGenerator({ seed: 12345 })
  for (let i = 0; i < 500; i++) {
    assert.equal(a.next(T), b.next(T))
    assert.equal(a.monotonic(T), b.monotonic(T))
  }
})

test('deterministic mode: different seeds diverge', () => {
  const a = new UlidGenerator({ seed: 1 })
  const b = new UlidGenerator({ seed: 2 })
  const seqA = Array.from({ length: 20 }, () => a.next(T))
  const seqB = Array.from({ length: 20 }, () => b.next(T))
  assert.notDeepEqual(seqA, seqB)
})

test('random component is seed-determined even with wall-clock time', () => {
  // The last 16 chars (random part) must match regardless of time prefix.
  const a = new UlidGenerator({ seed: 777 })
  const b = new UlidGenerator({ seed: 777 })
  for (let i = 0; i < 50; i++) {
    const [x, y] = [a.next(), b.next()]
    // Allow at most one ms of skew between the two calls.
    if (x.slice(0, 10) === y.slice(0, 10)) {
      assert.equal(x.slice(10), y.slice(10))
    }
  }
})

test('deterministic mode is flagged and isolated', () => {
  const det = new UlidGenerator({ seed: 42 })
  const sec = new UlidGenerator()
  assert.equal(det.deterministic, true)
  assert.equal(sec.deterministic, false)
})

test('pinned-time monotonic matches reference factory semantics', () => {
  const gen = new UlidGenerator({ seed: 9 })
  const t1 = gen.monotonic(T)
  const t2 = gen.monotonic(T)
  // Same pinned ms -> incrementing random part, identical time component.
  assert.equal(t1.slice(0, 10), t2.slice(0, 10))
  assert.ok(t2 > t1)
  // Going "back in time" keeps incrementing (reference behavior).
  const t3 = gen.monotonic(T - 5)
  assert.equal(t3.slice(0, 10), t2.slice(0, 10))
  assert.ok(t3 > t2)
  // Jump forward -> fresh randomness, new stamp.
  const t4 = gen.monotonic(T + 1000)
  assert.equal(t4.slice(0, 10), encodeTimePrefix(T + 1000))
  assert.ok(t4 > t3)
})

test('module-level ulid() accepts reference-style seedTime', () => {
  const id = ulid(1469918176385)
  assert.equal(id.slice(0, 10), encodeTime(1469918176385))
  assert.equal(isValid(id), true)
})

test('seedTime validation', () => {
  const gen = new UlidGenerator({ seed: 1 })
  assert.throws(() => gen.next(-1), /out of range/)
  assert.throws(() => gen.next(281474976710656), /out of range/)
  assert.throws(() => gen.monotonic(1.5), /out of range/)
  assert.throws(() => ulid(-1), /out of range/)
})

test('deterministic monotonic is still strictly increasing (wall clock)', () => {
  const gen = new UlidGenerator({ seed: 999 })
  let prev = gen.monotonic()
  for (let i = 0; i < 5000; i++) {
    const next = gen.monotonic()
    assert.ok(next > prev, `${next} !> ${prev}`)
    prev = next
  }
})

test('default generator output cannot be predicted from any small seed set', () => {
  const sec = ulid()
  for (let seed = 0; seed < 256; seed++) {
    const g = new UlidGenerator({ seed })
    for (let i = 0; i < 4; i++) {
      assert.notEqual(g.next(), sec)
      assert.notEqual(g.monotonic(), sec)
    }
  }
})

/** Crockford-encodes a timestamp exactly like `encodeTime` (test helper). */
function encodeTimePrefix(ms: number): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let out = ''
  let v = ms
  for (let i = 0; i < 10; i++) {
    out = A[v % 32] + out
    v = Math.floor(v / 32)
  }
  return out
}
