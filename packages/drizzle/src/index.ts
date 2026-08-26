/**
 * ULID / UUIDv7 column helpers for Drizzle ORM.
 *
 * Columns are application-generated client-side through the rivid engine,
 * so inserts never wait on the database and `ORDER BY id` equals insertion
 * order (with monotonic or batch generation).
 *
 * ```ts
 * import { pgTable } from 'drizzle-orm/pg-core'
 * import { ulidColumn, uuidv7Column } from '@rivid/drizzle'
 *
 * export const users = pgTable('users', {
 *   id: ulidColumn('id', { defaultRandom: true }).primaryKey(),
 *   alt: uuidv7Column('alt'),
 * })
 * ```
 */
import { customType } from 'drizzle-orm/pg-core'
import { ulid as generateUlid, monotonicUlid, uuidv7 as generateUuidV7 } from '@rivid/core'

export interface RidColumnOptions {
  /** Generate a fresh ID client-side when the value is omitted on insert. */
  defaultRandom?: boolean
  /** Use strict same-millisecond ordering for generated values. */
  monotonic?: boolean
}

function nextUlid(opts: RidColumnOptions): string {
  if (opts.monotonic) return monotonicUlid()
  return generateUlid()
}

/** Portable fixed-width textual primary key — `char(26)` canonical ULID. */
export function ulidColumn(name: string, opts: RidColumnOptions = {}) {
  const b = customType<{ data: string; driverData: string }>({
    dataType() {
      return 'char(26)'
    },
  })(name)
  if (opts.defaultRandom) {
    return b.$defaultFn(() => nextUlid(opts))
  }
  return b
}

/** RFC 9562 time-ordered UUID in standard hyphenated form — `char(36)`. */
export function uuidv7Column(name: string, opts: RidColumnOptions = {}) {
  const b = customType<{ data: string; driverData: string }>({
    dataType() {
      return 'char(36)'
    },
  })(name)
  if (opts.defaultRandom) {
    return b.$defaultFn(() => generateUuidV7())
  }
  return b
}
