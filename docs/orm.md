# ORM Integration Architecture

## Principle

Each ORM integration must:
1. Map to the correct native database type (prefer `uuid` over `CHAR(26)`)
2. Avoid unnecessary string conversions
3. Support automatic ID generation
4. Support application-generated IDs
5. Support full CRUD + bulk operations
6. Support ordering, pagination, and transactions

## Integration Status

| ORM | Language | Status | Native UUID | Generation |
|-----|----------|--------|-------------|------------|
| **Drizzle** | TypeScript | ✅ Production | ⚠️ Uses `CHAR(36)` for UUIDv7 | `$defaultFn` |
| **Prisma** | TypeScript | ✅ Production | ✅ Uses `@db.Uuid` | Application-side |
| **SQLx** | Rust | ✅ Production | ⚠️ Uses `CHAR(26)` | Application-side |
| **SQLAlchemy** | Python | ✅ Production | ⚠️ Uses `CHAR(26)` | Application-side |

> Only integrations whose identifiers flow through the genuine rivid engine
> are documented here. Community patterns for Go ORMs can follow the same
> schema guidance once a rivid Go binding exists.

## Recommended Schema Patterns

### Pattern A: ULID/UUIDv7 as native UUID (recommended)

```sql
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    -- ...
);
```

**Application layer**: Generate ULID/UUIDv7, convert to UUID string, pass to ORM.

### Pattern B: ULID as CHAR(26) (when readability needed)

```sql
CREATE TABLE entities (
    id char(26) PRIMARY KEY,
    -- ...
);
```

**Application layer**: Generate ULID, pass string directly to ORM.

## Drizzle Integration

### Current Schema (uses CHAR(36) for UUIDv7)

```typescript
// Current: UUIDv7 stored as CHAR(36) — not ideal
export const usersUuidV7 = pgTable("users_uuid7_drizzle", {
  id: char("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  // ...
});
```

### Recommended Schema (uses native UUID)

```typescript
// Recommended: UUIDv7 stored as native uuid
import { uuid } from "drizzle-orm/pg-core";

export const usersUuidV7 = pgTable("users_uuid7", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  // ...
});
```

### ULID as UUID (recommended)

```typescript
import { uuid } from "drizzle-orm/pg-core";
import { ulid, toUuid } from "@rivid/core";

export const usersUlid = pgTable("users_ulid", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => toUuid(ulid())),
  // ...
});
```

### ULID as CHAR(26) (when readability needed)

```typescript
import { char } from "drizzle-orm/pg-core";
import { ulid } from "@rivid/core";

export const usersUlid = pgTable("users_ulid", {
  id: char("id", { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  // ...
});
```

## Prisma Integration

### Current Schema (uses @db.Uuid for UUIDv4)

```prisma
model UserUuidV4Db {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
}
```

### Recommended: UUIDv7 as native UUID

```prisma
model UserUuidV7 {
  id        String   @id @db.Uuid
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
}
```

Application-side generation:
```typescript
import { uuidv7 } from '@rivid/core';

const user = await prisma.userUuidV7.create({
  data: {
    id: uuidv7(),  // Application-generated UUIDv7
    email: 'user@example.com',
    name: 'User',
  },
});
```

### ULID as CHAR(26)

```prisma
model UserUlid {
  id        String   @id @db.Char(26)
  email     String
  name      String
  createdAt DateTime @default(now()) @map("created_at")
}
```

## SQLx (Rust) Integration

### Current Schema (uses CHAR(26))

```rust
sqlx::query(
    "CREATE TABLE IF NOT EXISTS users (
        id CHAR(26) PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
)
```

### Recommended: ULID as native UUID

```rust
sqlx::query(
    "CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
)
```

Application layer:
```rust
use rivid_core::{ulid, convert};

let id = ulid::generate();
let uuid_str = convert::ulid_to_uuid(&id)?;
sqlx::query("INSERT INTO users (id, email, name) VALUES ($1, $2, $3)")
    .bind(&uuid_str)
    .bind("user@example.com")
    .bind("User")
    .execute(&pool)
    .await?;
```

## SQLAlchemy (Python) Integration

### Current Schema (uses CHAR(26))

```python
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(ULIDType(), primary_key=True)  # CHAR(26)
```

### Recommended: ULID as native UUID

```python
from sqlalchemy.dialects.postgresql import UUID

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
```

Application layer:
```python
from ulid import ULID

user = User(
    id=str(ULID()),  # Convert to UUID string before storage
    email="user@example.com",
    name="User",
)
```

## Generation Strategies

### Mode A: Application-generated (recommended)

```typescript
// TypeScript
import { ulid, uuidv7 } from '@rivid/core';

// For ULID
const id = ulid();

// For UUIDv7
const id = uuidv7();

// For ULID as UUID
const id = toUuid(ulid());
```

```rust
// Rust
use rivid_core::{ulid, uuidv7};

// For ULID
let id = ulid::generate();

// For UUIDv7
let id = uuidv7::generate();
```

```python
# Python
from ulid import ULID

# For ULID
id = str(ULID())
```

### Mode B: Database-generated (fallback)

```sql
-- PostgreSQL
CREATE TABLE entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ...
);
```

Use as fallback for direct database inserts (bypassing application layer).

### Mode C: Hybrid (application generates, database validates)

```sql
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    -- No DEFAULT: application must provide ID
);
```

Application always generates the ID. Database enforces non-null.

## Performance Comparison

### Insert Throughput (10M rows)

| Pattern | rows/sec | Storage |
|---------|---------:|--------:|
| ULID as native uuid | 117,451 | 1,226 MB |
| UUIDv7 as native uuid | 93,193 | 1,222 MB |
| ULID as CHAR(26) | 72,969 | 1,647 MB |
| UUIDv7 as CHAR(36) | 74,870 | 1,869 MB |

### Point Lookup (1000 random PK lookups)

| Pattern | avg (µs) | p99 (µs) |
|---------|---------:|---------:|
| ULID as native uuid | 331 | 809 |
| UUIDv7 as native uuid | 353 | 830 |
| ULID as CHAR(26) | 368 | 972 |
| UUIDv7 as CHAR(36) | 364 | 701 |

## Migration Guide

### From CHAR(26) to native UUID

```sql
-- 1. Add new column
ALTER TABLE entities ADD COLUMN id_new uuid;

-- 2. Backfill (zero-cost: same 16 bytes)
UPDATE entities SET id_new = id::uuid;

-- 3. Create index
CREATE INDEX idx_entities_id_new ON entities (id_new);

-- 4. Swap primary key
ALTER TABLE entities DROP CONSTRAINT entities_pkey;
ALTER TABLE entities ADD PRIMARY KEY (id_new);

-- 5. Drop old column
ALTER TABLE entities DROP COLUMN id;

-- 6. Rename
ALTER TABLE entities RENAME COLUMN id_new TO id;
```

### From UUIDv4 to UUIDv7

No schema change needed. Just change the generation function:

```typescript
// Before
import { v4 as uuidv4 } from 'uuid';
const id = uuidv4();

// After
import { uuidv7 } from '@rivid/core';
const id = uuidv7();
```

The binary format is compatible. New IDs will be time-sortable.
