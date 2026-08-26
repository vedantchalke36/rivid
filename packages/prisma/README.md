# `@rivid/prisma`

[Prisma client extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions)
that fills primary keys with ULIDs or UUIDv7 from the Rust engine behind
[`@rivid/core`](https://github.com/vedantchalke36/rivid).

```bash
npm install @rivid/prisma @rivid/core
```

```ts
import { PrismaClient } from '@prisma/client'
import { rid } from '@rivid/prisma'

const db = new PrismaClient().$extends(rid())                          // ULIDs, all models
const scoped = new PrismaClient().$extends(rid({ models: ['User'] }))  // subset only
const uuids = new PrismaClient().$extends(rid({ mode: 'uuid7' }))
```

- Only fills when the caller didn't supply a value
- `createMany` draws all IDs from **one** native `generateMany` call
  (single JS↔Rust crossing per statement)

Full CRUD/ordering/pagination/transaction suite (live PostgreSQL):
[`integrations/prisma`](../../integrations/prisma).
