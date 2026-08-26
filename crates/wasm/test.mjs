/**
 * rivid-wasm — Node-run correctness suite against the wasm-bindgen `nodejs`
 * target. Reuses the reference ULID vectors from __test__/compat.test.mts.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const r = require('./pkg/rivid_wasm.js')

let failures = 0
function check(name, cond) {
  if (!cond) {
    failures++
    console.error('FAIL:', name)
  }
}
function throws(name, fn) {
  try {
    fn()
    failures++
    console.error('FAIL (no throw):', name)
  } catch {
    /* expected */
  }
}

const FMT = /^[0-9A-HJKMNP-TV-Z]{26}$/

// ── Reference vectors ────────────────────────────────────────────────────
check('ulid() format', FMT.test(r.ulid()))
// seedTime pins ONLY the 10-char timestamp component; randomness stays random.
check('seedTime vector prefix', r.ulid(1469918176385).slice(0, 10) === '01ARYZ6S41')
check(
  'decodeTime vector',
  r.decodeTime('01ARZ3NDEKTSV4RRFFQ69G5FAV') === 1469922850259,
)
check('encodeTime vector', r.encodeTime(1469918176385) === '01ARYZ6S41')

// ── Validity ─────────────────────────────────────────────────────────────
check('isValid true', r.isValid('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
check('isValid lowercase ok', r.isValid('01arz3ndektsv4rrffq69g5fav'.toUpperCase()) === true)
check('isValid too short', !r.isValid('01ARZ3NDEKTSV4RRFFQ69G5FA'))
check('isValid bad alphabet', !r.isValid('01ARZ3NDEKTSV4RRFFQ69G5FAI'))
check('isValid empty', !r.isValid(''))

// ── Round trips & uniqueness ────────────────────────────────────────────
for (let i = 0; i < 1000; i++) {
  const id = r.ulid()
  if (!FMT.test(id) || !r.isValid(id)) { check(`roundtrip ${i}`, false); break }
  if (r.encode(r.decode(id)) !== id) { check(`encode∘decode ${i}`, false); break }
}
check('roundtrip sweep done', failures === 0)

const many = r.generateMany(10_000)
check('generate_many length', many.length === 10_000)
check('generate_many unique', new Set(many).size === 10_000)

// Batch shares one captured timestamp — all prefixes identical.
const prefix = many[0].slice(0, 10)
check('batch shared timestamp', many.every((id) => id.slice(0, 10) === prefix))

// ── Monotonic (global stream + isolated instance) ────────────────────────
let prev = ''
for (let i = 0; i < 100; i++) {
  const m = r.monotonicUlid(150000)
  if (!(m > prev)) { check(`monotonic global at ${i}`, false); break }
  prev = m
}
// Even a backwards seed preserves order.
check('monotonic rollback-safe', r.monotonicUlid(100000) > prev)

const g = new r.MonotonicGenerator()
const a1 = g.next(150000)
const a2 = g.next(150000)
const a3 = g.next(150000)
check('instance strict increase', a1 < a2 && a2 < a3)
check('instance increments last char', a2.slice(-1) !== a1.slice(-1))

// ── compare ──────────────────────────────────────────────────────────────
// Batch output shares one timestamp (random tail order); use the strictly
// increasing monotonic stream for deterministic ordering assertions.
const lo = r.monotonicUlid(150000)
const hi = r.monotonicUlid(150000)
check('compare less', r.compare(lo, hi) === -1)
check('compare equal', r.compare('01ARZ3NDEKTSV4RRFFQ69G5FAV', '01arz3ndektsv4rrffq69g5fav') === 0)
check('compare greater', r.compare(hi, lo) === 1)

// ── UUIDv7 ───────────────────────────────────────────────────────────────
const u7 = r.uuidv7()
check('uuidv7 format', /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u7))
const u7bytes = r.uuidv7Bytes()
check('uuidv7 bytes length', u7bytes.length === 16)
const t7 = r.uuidv7Time(u7bytes)
const now = Date.now()
check('uuidv7 time plausible', Math.abs(now - t7) < 5000)
check('uuidv7 many', r.generateUuidV7Many(100).length === 100)

// ── Error paths throw as JS exceptions ──────────────────────────────────
throws('decode garbage', () => r.decode('!!!!!!!!!!!!!!!!!!!!!!!!!!'))
throws('decodeTime bad', () => r.decodeTime('zzzzzzzzzzzzzzzzzzzzzzzzzz'))
throws('generate_many zero', () => r.generateMany(0))
throws('negative seedTime', () => r.ulid(-1))
throws('fractional seedTime', () => r.ulid(1.5))
throws('overflow seedTime', () => r.ulid(281474976710656))
check('version string', /^\d+\.\d+\.\d+/.test(r.version()))

if (failures) {
  console.error(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('rivid-wasm: all checks passed')
