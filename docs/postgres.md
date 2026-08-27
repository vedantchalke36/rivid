# PostgreSQL Guide

## Setup

```sql
-- For application-generated UUIDv7, no database extension needed.
-- Rivid generates UUIDv7 in the application layer.

-- For database-generated UUID fallback:
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

## Schema Design

### UUIDv7 as Primary Key (recommended)

```sql
CREATE TABLE orders (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- BRIN index for time-range queries (highly effective for time-ordered UUIDs)
CREATE INDEX idx_orders_id_brin ON orders USING brin (id);
```

### ULID Stored as UUID (recommended for ULID users)

```sql
CREATE TABLE events (
    id uuid PRIMARY KEY,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- BRIN index for time-range queries
CREATE INDEX idx_events_id_brin ON events USING brin (id);
```

Application layer:
```typescript
import { ulid, toUuid, fromUuid } from '@rivid/core';

// Generate ULID, store as UUID
const id = ulid();
const uuid = toUuid(id);
await db.query('INSERT INTO events (id, ...) VALUES ($1, ...)', [uuid]);

// Retrieve and convert back
const row = await db.query('SELECT id FROM events WHERE id = $1', [uuid]);
const ulidString = fromUuid(row.id);
```

### ULID as CHAR(26) (when readability needed)

```sql
CREATE TABLE audit_log (
    id char(26) PRIMARY KEY,
    action text NOT NULL,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

**Trade-off**: 34.8% more storage, 37.9% slower inserts vs native uuid.

## Performance Characteristics

### Insert Throughput (10M rows, batch 10K)

| Representation | rows/sec | Table+Index |
|---------------|---------:|------------:|
| ULID as native uuid | 117,451 | 1,226 MB |
| ULID as BYTEA | 101,095 | 1,420 MB |
| UUIDv7 as native uuid | 93,193 | 1,222 MB |
| ULID as VARCHAR(26) | 75,936 | 1,651 MB |
| UUIDv7 as CHAR(36) | 74,870 | 1,869 MB |
| ULID as CHAR(26) | 72,969 | 1,647 MB |

### Point Lookup (1000 random PK lookups)

| Representation | avg (µs) | p50 (µs) | p99 (µs) |
|:---------------|---------:|---------:|---------:|
| ULID as BYTEA | 284 | 266 | 597 |
| ULID as native uuid | 331 | 302 | 809 |
| UUIDv7 as native uuid | 353 | 314 | 830 |
| ULID as CHAR(26) | 368 | 349 | 972 |
| ULID as VARCHAR(26) | 412 | 333 | 2,201 |

## Bulk Insert Optimization

```sql
-- Disable indexes during bulk load, re-enable after
ALTER TABLE entities DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS idx_entities_pkey;

-- Bulk insert
INSERT INTO entities (id, data) SELECT ... FROM generate_series(1, 1000000);

-- Re-create index
ALTER TABLE entities ADD PRIMARY KEY (id);
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
```

## Connection Pooling

For high-throughput identifier generation:
- Use PgBouncer or pgcat for connection pooling
- Batch inserts in transactions (10K rows per transaction optimal)
- Avoid single-row inserts without explicit transaction

## Partitioning

For very large tables with time-ordered IDs:

```sql
CREATE TABLE events (
    id uuid NOT NULL,
    data jsonb
) PARTITION BY RANGE (id);

-- Create partitions by time range
CREATE TABLE events_2026_q1 PARTITION OF events
    FOR VALUES FROM ('01900000-0000-7000-8000-000000000000') TO ('019FFFFFFF-FFFF-7FFF-BFFF-FFFFFFFFFFFF');
```

UUIDv7 and ULID values naturally partition by time because their first bytes encode the timestamp.

## UUIDv7 Advantages in PostgreSQL

1. **Native `uuid` type**: 16-byte storage, indexed efficiently
2. **`gen_random_uuid()` compatibility**: Can use as fallback for database-generated IDs
3. **Time-range queries**: `WHERE id > $1` efficiently scans time-ordered ranges
4. **BRIN indexes**: Tiny indexes that perform well for append-only workloads
5. **Partitioning**: Natural time-based partitioning via UUID prefix

## ULID in PostgreSQL

### As native UUID (recommended)

```sql
-- Store ULID as UUID (zero-cost binary reinterpretation)
INSERT INTO entities (id) VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAV'::uuid);
```

### As text

```sql
-- Store as CHAR(26) for direct readability
CREATE TABLE entities (
    id char(26) PRIMARY KEY CHECK (length(id) = 26)
);
```

### Timestamp extraction

```sql
-- Extract creation time from UUIDv7 (first 6 bytes = timestamp)
SELECT
    id,
    to_char(
        to_timestamp(('x' || ltrim(encode(substring(id::bytea from 1 for 6), 'hex'), '0'))::bit(48)::bigint / 1000),
        'YYYY-MM-DD HH24:MI:SS.US'
    ) AS created_at
FROM entities;
```

## Monitoring

```sql
-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'entities';

-- Check table bloat
SELECT
    pg_size_pretty(pg_total_relation_size('entities')) AS total_size,
    pg_size_pretty(pg_relation_size('entities')) AS table_size,
    pg_size_pretty(pg_indexes_size('entities')) AS index_size;
```

## Benchmark Configuration

The benchmark PostgreSQL instance uses:

```yaml
# benchmarks/db/docker-compose.yml
services:
  postgres:
    image: postgres:16.4-alpine
    command:
      - postgres
      - -cshared_buffers=256MB
      - -cfsync=on
      - -csynchronous_commit=on
```

For production, consider:
- `shared_buffers`: 25% of RAM
- `effective_cache_size`: 75% of RAM
- `work_mem`: 64MB–256MB for bulk operations
- `maintenance_work_mem`: 1GB
