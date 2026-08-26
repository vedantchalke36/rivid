# `@rivid/drizzle`

ULID / UUIDv7 column helpers for [Drizzle ORM](https://orm.drizzle.team), powered
by the same Rust engine as [`@rivid/core`](https://github.com/vedantchalke36/rivid).

```bash
npm install @rivid/drizzle @rivid/core drizzle-orm
```

```ts
import { pgTable } from 'drizzle-orm/pg-core'
import { ulidColumn, uuidv7Column } from '@rivid/drizzle'

export const users = pgTable('users', {
  id: ulidColumn('id', { defaultRandom: true }).primaryKey(), // CHAR(26)
  alt: uuidv7Column('alt', { defaultRandom: true }),          // CHAR(36)
})
```

`defaultRandom` fills the key client-side on insert — no DB round-trip for
defaults, and `ORDER BY id` equals insertion order. Add `monotonic: true`
for strict same-millisecond ordering.

Full CRUD/ordering/pagination correctness suite (live PostgreSQL):
[`integrations/drizzle`](../../integrations/drizzle).
