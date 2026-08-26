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
  r.decode_time('01ARZ3NDEKTSV4RRFFQ69G5FAV') === 1469922850259,
)
check('encodeTime vector', r.encode_time(1469918176385) === '01ARYZ6S41')

// ── Validity ─────────────────────────────────────────────────────────────
check('isValid true', r.is_valid('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
check('isValid lowercase ok', r.is_valid('01arz3ndektsv4rrffq69g5fav'.toUpperCase()) === true)
check('isValid too short', !r.is_valid('01ARZ3NDEKTSV4RRFFQ69G5FA'))
check('isValid bad alphabet', !r.is_valid('01ARZ3NDEKTSV4RRFFQ69G5FAI'))
check('isValid empty', !r.is_valid(''))

// ── Round trips & uniqueness ────────────────────────────────────────────
for (let i = 0; i < 1000; i++) {
  const id = r.ulid()
  if (!FMT.test(id) || !r.is_valid(id)) { check(`roundtrip ${i}`, false); break }
  if (r.encode(r.decode(id)) !== id) { check(`encode∘decode ${i}`, false); break }
}
check('roundtrip sweep done', failures === 0)

const many = r.generate_many(10_000)
check('generate_many length', many.length === 10_000)
check('generate_many unique', new Set(many).size === 10_000)

// Batch shares one captured timestamp — all prefixes identical.
const prefix = many[0].slice(0, 10)
check('batch shared timestamp', many.every((id) => id.slice(0, 10) === prefix))

// ── Monotonic (global stream + isolated instance) ────────────────────────
let prev = ''
for (let i = 0; i < 100; i++) {
  const m = r.monotonic_ulid(150000)
  if (!(m > prev)) { check(`monotonic global at ${i}`, false); break }
  prev = m
}
// Even a backwards seed preserves order.
check('monotonic rollback-safe', r.monotonic_ulid(100000) > prev)

const g = new r.MonotonicGenerator()
const a1 = g.next(150000)
const a2 = g.next(150000)
const a3 = g.next(150000)
check('instance strict increase', a1 < a2 && a2 < a3)
check('instance increments last char', a2.slice(-1) !== a1.slice(-1))

// ── compare ──────────────────────────────────────────────────────────────
check('compare less', r.compare(many[0], many[1]) === -1)
check('compare equal', r.compare('01ARZ3NDEKTSV4RRFFQ69G5FAV', '01arz3ndektsv4rrffq69g5fav') === 0)
check('compare greater', r.compare(many[1], many[0]) === 1)

// ── UUIDv7 ───────────────────────────────────────────────────────────────
const u7 = r.uuidv7()
check('uuidv7 format', /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u7))
const u7bytes = r.uuidv7_bytes()
check('uuidv7 bytes length', u7bytes.length === 16)
const t7 = r.uuidv7_time(u7bytes)
const now = Date.now()
check('uuidv7 time plausible', Math.abs(now - t7) < 5000)
check('uuidv7 many', r.generate_uuid_v7_many(100).length === 100)

// ── Error paths throw as JS exceptions ──────────────────────────────────
throws('decode garbage', () => r.decode('!!!!!!!!!!!!!!!!!!!!!!!!!!'))
throws('decodeTime bad', () => r.decode_time('zzzzzzzzzzzzzzzzzzzzzzzzzz'))
throws('generate_many zero', () => r.generate_many(0))
throws('negative seedTime', () => r.ulid(-1))
throws('fractional seedTime', () => r.ulid(1.5))
throws('overflow seedTime', () => r.ulid(281474976710656))
check('version string', /^\d+\.\d+\.\d+/.test(r.version()))

if (failures) {
  console.error(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('rivid-wasm: all checks passed')
