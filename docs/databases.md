# Database Representation Guide

## Principle

The identifier's binary representation is its source of truth. Textual encoding is
a presentation concern. Database storage should prefer the native binary type.

## Key Finding: ULID Stored as Native UUID

**ULID and UUID share the same 128-bit binary layout.** A ULID's 16 bytes are identical
to a UUID's 16 bytes. PostgreSQL's native `uuid` type stores 16 bytes. Therefore:

- Storing a ULID as `uuid` uses **16 bytes** (same as native UUID)
- Storing a ULID as `CHAR(26)` uses **26 bytes** (62.5% more)
- The conversion is **zero-cost** — it's just a different text encoding of the same bytes

Rivid provides `toUuid()` and `fromUuid()` for this conversion.

## Representation Taxonomy

| Type | PostgreSQL | MySQL | SQLite | Storage |
|------|-----------|-------|--------|---------|
| UUID (128-bit) | `uuid` | `BINARY(16)` or `CHAR(36)` | `BLOB` or `TEXT` | 16 bytes |
| ULID as UUID | `uuid` | `BINARY(16)` | `BLOB` | 16 bytes |
| ULID as text | `CHAR(26)` | `CHAR(26)` | `TEXT` | 26 bytes |
| ULID as VARCHAR | `VARCHAR(26)` | `VARCHAR(26)` | `TEXT` | 26 bytes |
| ULID as binary | `BYTEA` | `BLOB` | `BLOB` | 16 bytes |

## Storage Impact (10M rows, PostgreSQL 16.4)

| Representation | Total Size | vs Native UUID |
|---------------|-----------|---------------:|
| UUIDv7 as native uuid | 1,222 MB | baseline |
| **ULID as native uuid** | **1,226 MB** | **+0.3%** |
| ULID as BYTEA | 1,420 MB | +16.2% |
| ULID as CHAR(26) | 1,647 MB | +34.8% |
| ULID as VARCHAR(26) | 1,651 MB | +35.1% |
| UUIDv7 as CHAR(36) | 1,869 MB | +53.0% |

**Key insight**: ULID-as-native-uuid has virtually identical storage to UUIDv7-as-native-uuid
(+0.3%). The 34.8% storage penalty of ULID comes entirely from `CHAR(26)` text storage,
not from the identifier itself.

## Insert Performance (10M rows, PostgreSQL 16.4)

| Representation | rows/sec | vs Fastest |
|---------------|---------:|-----------:|
| ULID as native uuid | 117,451 | baseline |
| ULID as BYTEA | 101,095 | -13.9% |
| UUIDv7 as native uuid | 93,193 | -20.7% |
| ULID as VARCHAR(26) | 75,936 | -35.4% |
| UUIDv7 as CHAR(36) | 74,870 | -36.3% |
| ULID as CHAR(26) | 72,969 | -37.9% |

**Key insight**: ULID-as-native-uuid is **37.9% faster** than ULID-as-CHAR(26) for bulk
insertion. It's also **20.7% faster** than UUIDv7-as-native-uuid (likely due to the
time-sortable prefix providing better B-tree insertion patterns).

## Point Lookup Performance (1000 random PK lookups)

| Representation | avg (µs) | p50 (µs) | p95 (µs) | p99 (µs) |
|:---------------|---------:|---------:|---------:|---------:|
| ULID as BYTEA | 284 | 266 | 428 | 597 |
| ULID as native uuid | 331 | 302 | 491 | 809 |
| UUIDv7 as native uuid | 353 | 314 | 534 | 830 |
| UUIDv7 as CHAR(36) | 364 | 351 | 507 | 701 |
| ULID as CHAR(26) | 368 | 349 | 514 | 972 |
| ULID as VARCHAR(26) | 412 | 333 | 492 | 2,201 |

**Key insight**: Binary representations (BYTEA, native uuid) have the lowest latency.
VARCHAR(26) has the worst p99 due to variable-length overhead.

## Recommendations

### For UUIDv7 (default recommendation)

```sql
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    -- ...
);
```

Use native `uuid` type. Application generates UUIDv7 via Rivid.

### For ULID (recommended: store as native uuid)

```sql
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    -- ...
);
```

Convert between ULID string and UUID in the application layer. Rivid provides
`toUuid()` and `fromUuid()` for zero-cost conversion.

**This is the recommended approach.** It provides:
- 16-byte storage (same as native UUID)
- Fastest insert performance
- Lowest point lookup latency
- Native PostgreSQL UUID type benefits
- Zero-cost conversion from ULID strings

### For ULID as CHAR(26) (only when readability needed)

```sql
CREATE TABLE entities (
    id char(26) PRIMARY KEY,
    -- ...
);
```

Use only when you need the ULID string representation directly in the database
(e.g., for debugging, logging, or direct display). Accept the 34.8% storage overhead
and 37.9% slower inserts.

### For ULID as BYTEA

```sql
CREATE TABLE entities (
    id bytea PRIMARY KEY,
    -- ...
);
```

Binary storage. Good for space efficiency but loses direct readability. Requires
application-level encoding/decoding for display. Slightly slower than native uuid
due to BYTEA overhead.

## Index Considerations

### B-tree (default)

All representations work well with B-tree indexes. Native `uuid` and binary types
have the smallest index footprint.

### BRIN (Block Range Index)

For time-ordered identifiers (UUIDv7, ULID), BRIN indexes are highly effective:

```sql
CREATE INDEX idx_entities_id_brin ON entities USING brin (id);
```

BRIN is much smaller than B-tree and performs well for append-only workloads where
data is naturally time-ordered.

### Partial indexes

For monotonically increasing IDs, partial indexes can be very efficient:

```sql
CREATE INDEX idx_recent ON entities (created_at) WHERE id > '...';
```

## Migration Strategy

When migrating from ULID-as-CHAR(26) to native `uuid`:

```sql
-- 1. Add a new uuid column
ALTER TABLE entities ADD COLUMN id_new uuid;

-- 2. Backfill (zero-cost: same 16 bytes, different encoding)
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

The conversion is zero-cost because ULID and UUID share the same binary layout.

## WAL Considerations

Larger identifiers (CHAR(26) vs uuid) generate more WAL traffic during bulk inserts.
This affects replication lag and backup sizes. Prefer native `uuid` for high-throughput
workloads.
