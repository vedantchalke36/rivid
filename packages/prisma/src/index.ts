/**
 * Prisma client extension — automatic rivid IDs.
 *
 * ```ts
 * import { PrismaClient } from '@prisma/client'
 * import { rid } from '@rivid/prisma'
 *
 * const db = new PrismaClient().$extends(rid())               // ULIDs everywhere
 * const db2 = new PrismaClient().$extends(rid({ models: ['User'] }))
 * const db3 = new PrismaClient().$extends(rid({ mode: 'uuid7', field: 'id' }))
 * ```
 *
 * Only fills the key when the caller didn't supply one. Batch writes
 * (`createMany`, `createManyAndReturn`) draw from one native
 * `generateMany` call — one JS↔Rust crossing per statement.
 */
import { ulid as generateUlid, generateMany, generateUuidV7Many, uuidv7 as generateUuidV7 } from '@rivid/core'

// NOTE: intentionally NOT using `@prisma/client/extension`'s
// `defineExtension` — a plain extension object is accepted by
// `client.$extends()` verbatim, so this package has ZERO runtime coupling
// to Prisma internals and no generated-client requirement at build time.
// (Types flow from the consumer's own generated client.)

export interface RidOptions {
  /** Restrict injection to these Prisma model names (default: all models). */
  models?: readonly string[]
  /** Data field to fill (default: `id`). */
  field?: string
  /** `'ulid'` (default) or `'uuid7'`. */
  mode?: 'ulid' | 'uuid7'
}

/** Pure decision layer, unit-tested independently of Prisma runtime. */
export function shouldFill(model: string, opts: Required<Pick<RidOptions, 'models'>>): boolean {
  return opts.models.length === 0 || opts.models.includes(model)
}

/** Fill missing keys in-place. Returns number of IDs generated. */
export function fillIds(
  rows: Record<string, unknown>[],
  field: string,
  mode: 'ulid' | 'uuid7',
): number {
  const missing = rows.filter((r) => r[field] === undefined || r[field] === null)
  if (missing.length === 0) return 0
  if (missing.length === 1) {
    missing[0][field] = mode === 'uuid7' ? generateUuidV7() : generateUlid()
    return 1
  }
  const ids = mode === 'uuid7' ? generateUuidV7Many(missing.length) : generateMany(missing.length)
  missing.forEach((row, i) => {
    row[field] = ids[i]
  })
  return missing.length
}

export function rid(options: RidOptions = {}) {
  const models = options.models ?? []
  const field = options.field ?? 'id'
  const mode = options.mode ?? 'ulid'

  return {
    name: 'rivid',
    query: {
      $allModels: {
        async create({ model, args, query }: any) {
          if (shouldFill(model, { models })) {
            fillIds([args.data as Record<string, unknown>], field, mode)
          }
          return query(args)
        },
        async createMany({ model, args, query }: any) {
          if (shouldFill(model, { models })) {
            fillIds(args.data as Record<string, unknown>[], field, mode)
          }
          return query(args)
        },
        async createManyAndReturn({ model, args, query }: any) {
          if (shouldFill(model, { models })) {
            fillIds(args.data as Record<string, unknown>[], field, mode)
          }
          return query(args)
        },
      },
    },
  }
}

export default rid
