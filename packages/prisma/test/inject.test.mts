import { strict } from 'node:assert'
import { describe, it } from 'node:test'
import { fillIds, shouldFill } from '../src/index.js'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('@rivid/prisma injection', () => {
  it('fills a single missing id with a canonical ULID', () => {
    const row: Record<string, unknown> = { email: 'a@b.c' }
    strict.equal(fillIds([row], 'id', 'ulid'), 1)
    strict.match(String(row.id), ULID_RE)
  })

  it('respects caller-supplied ids', () => {
    const row = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', email: 'x' }
    strict.equal(fillIds([row], 'id', 'ulid'), 0)
    strict.equal(row.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV')
  })

  it('batch-fills via one generateMany crossing', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ n: i }))
    strict.equal(fillIds(rows, 'id', 'ulid'), 5000)
    const ids = rows.map((r) => String(r.id))
    strict.ok(ids.every((id) => ULID_RE.test(id)))
    strict.equal(new Set(ids).size, 5000)
    // Shared batch timestamp — all time components identical.
    strict.equal(new Set(ids.map((id) => id.slice(0, 10))).size, 1)
  })

  it('uuid7 mode emits RFC 9562 shape', () => {
    const row: Record<string, unknown> = {}
    fillIds([row], 'id', 'uuid7')
    strict.match(String(row.id), UUID_RE)
  })

  it('honours custom field names', () => {
    const row: Record<string, unknown> = {}
    fillIds([row], 'sku', 'ulid')
    strict.match(String(row.sku), ULID_RE)
  })

  it('model filter matches exactly', () => {
    const opts = { models: ['User'] }
    strict.equal(shouldFill('User', opts), true)
    strict.equal(shouldFill('Post', opts), false)
    strict.equal(shouldFill('Anything', { models: [] }), true)
  })
})
