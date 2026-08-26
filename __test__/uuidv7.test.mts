/**
 * UUIDv7 tests: RFC 9562 field layout, timestamps, ordering, bulk APIs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  uuidv7,
  uuidv7Bytes,
  generateUuidV7Many,
} from '../src/index.js'
import { decodeTimeFromString } from '../src/uuidv7.js'

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parse(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

test('uuidv7() matches canonical RFC form', () => {
  for (let i = 0; i < 1000; i++) {
    const id = uuidv7()
    assert.match(id, UUID_V7_RE, id)
    assert.equal(id.length, 36)
  }
})

test('version nibble is 7 and variant bits are 10', () => {
  for (let i = 0; i < 1000; i++) {
    const b = uuidv7Bytes()
    assert.equal(b.length, 16)
    assert.equal(b[6]! >> 4, 0x7)
    assert.equal(b[8]! >> 6, 0b10)
  }
})

test('embedded timestamp is current', () => {
  for (let i = 0; i < 100; i++) {
    const ts = decodeTimeFromString(uuidv7())
    assert.ok(Math.abs(ts - Date.now()) <= 250, `${ts} vs ${Date.now()}`)
  }
})

test('uuidv7 sorts by time (lexicographic == chronological)', () => {
  const early = uuidv7()
  const late = uuidv7()
  assert.ok(early < late || early.slice(0, 13) === late.slice(0, 13))
})

test('generateUuidV7Many bulk correctness', () => {
  const ids = generateUuidV7Many(50_000)
  assert.equal(ids.length, 50_000)
  const set = new Set(ids)
  assert.equal(set.size, ids.length)
  // Single captured batch timestamp.
  const stamps = new Set(ids.map((id) => id.slice(0, 13)))
  assert.equal(stamps.size, 1)
  for (const id of ids) {
    assert.match(id, UUID_V7_RE)
    // First 48 bits equal the shared timestamp.
    assert.equal(decodeTimeFromString(id), decodeTimeFromString(ids[0]!))
  }
})

test('generateUuidV7Many validates count', () => {
  assert.throws(() => generateUuidV7Many(-1), /count must be/)
  assert.throws(() => generateUuidV7Many(100_000_001), /count must be/)
})

test('uuidv7Bytes round trips through timestamp extraction', () => {
  const b = uuidv7Bytes()
  let ms = 0
  for (let i = 0; i < 6; i++) ms = ms * 256 + b[i]!
  assert.ok(Math.abs(ms - Date.now()) <= 250)
})
