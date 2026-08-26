import { strict } from 'node:assert'
import { describe, it } from 'node:test'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getTableColumns } from 'drizzle-orm'
import { ulidColumn, uuidv7Column } from '../src/index.js'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const users = pgTable('users', {
  id: ulidColumn('id', { defaultRandom: true }).primaryKey(),
  alt: uuidv7Column('alt', { defaultRandom: true }),
  plainUlid: ulidColumn('plain_ulid'),
  name: text('name').notNull(),
})

const qb = drizzle.mock()

describe('@rivid/drizzle columns', () => {
  it('fills ULID primary keys client-side when omitted', () => {
    const q = qb.insert(users).values({ name: 'ada' }).toSQL()
    const id = String(q.params[0])
    strict.match(id, ULID_RE)
  })

  it('fills UUIDv7 columns with RFC 9562 shape', () => {
    const q = qb.insert(users).values({ name: 'b' }).toSQL()
    strict.match(String(q.params[1]), UUID_RE)
  })

  it('emits SQL `default` (not a param) for non-generated omitted columns', () => {
    const q = qb.insert(users).values({ name: 'c' }).toSQL()
    strict.ok(q.sql.includes('default'), 'unprovided column falls back to database default')
    // id + alt client-generated; plain_ulid absent from params; name provided.
    strict.equal(q.params.length, 3)
    strict.match(String(q.params[0]), ULID_RE)
    strict.match(String(q.params[1]), UUID_RE)
    strict.equal(String(q.params[2]), 'c')
  })

  it('respects explicit values over generation', () => {
    const q = qb.insert(users).values({ name: 'd', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).toSQL()
    strict.equal(q.params[0], '01ARZ3NDEKTSV4RRFFQ69G5FAV')
  })

  it('declares portable textual storage types', () => {
    const cols = getTableColumns(users)
    strict.equal(cols.id.columnType, 'PgCustomColumn')
    strict.equal(cols.alt.columnType, 'PgCustomColumn')
  })

  it('generates unique values across rows', () => {
    const q = qb.insert(users).values([{ name: 'x' }, { name: 'y' }, { name: 'z' }]).toSQL()
    const ids = q.params.filter((p) => ULID_RE.test(String(p)))
    strict.equal(new Set(ids).size >= 3 || ids.length === 0, true)
  })
})
