# Event-Driven Architecture Guide

## Event Identifier Model

Every event should carry these identifiers:

| Field | Type | Purpose |
|-------|------|---------|
| `event_id` | ULID (monotonic) | Unique event identifier, insertion order |
| `aggregate_id` | UUIDv7 or ULID | Business entity that caused the event |
| `causation_id` | UUIDv7 | The event that caused this event |
| `correlation_id` | UUIDv7 | Links all events in a request/transaction |
| `event_type` | String | Event classification |

## Schema

```sql
CREATE TABLE events (
    id uuid PRIMARY KEY,                    -- event_id (monotonic ULID as uuid)
    aggregate_id uuid NOT NULL,             -- business entity
    causation_id uuid,                      -- what caused this event
    correlation_id uuid NOT NULL,           -- request/transaction trace
    event_type text NOT NULL,               -- e.g., 'order.created'
    payload jsonb NOT NULL,                 -- event data
    metadata jsonb,                         -- trace context, headers
    created_at timestamptz NOT NULL DEFAULT now(),
    version int NOT NULL DEFAULT 1          -- optimistic concurrency
);

-- Time-range queries (append-only, BRIN is ideal)
CREATE INDEX idx_events_created_brin ON events USING brin (created_at);

-- Aggregate history queries
CREATE INDEX idx_events_aggregate ON events (aggregate_id, created_at);

-- Correlation tracing
CREATE INDEX idx_events_correlation ON events (correlation_id);
```

## Ordering Guarantees

| Level | Guarantee | How |
|-------|-----------|-----|
| **Lexicographic** | String sort == value sort | ULID, UUIDv7 |
| **Timestamp** | IDs created later sort higher | ULID, UUIDv7 |
| **Generation** | Strictly increasing within a process | Monotonic ULID |
| **Causal** | causation_id links cause → effect | Application-level |

**Important**: "time-sortable" does NOT mean "globally ordered." Two services generating IDs at the same millisecond may produce IDs in any relative order. Use monotonic ULID within a single process for strict ordering.

## Event Sourcing

```sql
-- Append-only event store
CREATE TABLE event_store (
    id uuid PRIMARY KEY,                    -- monotonic ULID
    aggregate_id uuid NOT NULL,
    aggregate_version int NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (aggregate_id, aggregate_version)  -- optimistic concurrency
);

-- Replay: get all events for an aggregate in order
SELECT * FROM event_store
WHERE aggregate_id = $1
ORDER BY id ASC;

-- Get events since a specific point in time
SELECT * FROM event_store
WHERE id > $1  -- ULID/UUIDv7 range query
ORDER BY id ASC
LIMIT 100;
```

## Deduplication

```sql
-- Idempotency table
CREATE TABLE idempotency_keys (
    key uuid PRIMARY KEY,                   -- idempotency key
    response jsonb NOT NULL,                -- cached response
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- Check before processing
INSERT INTO idempotency_keys (key, response, created_at, expires_at)
VALUES ($1, $2, now(), now() + interval '24 hours')
ON CONFLICT (key) DO NOTHING;
```

## Partitioning

Time-ordered IDs enable efficient partitioning:

```sql
CREATE TABLE events (
    id uuid NOT NULL,
    data jsonb
) PARTITION BY RANGE (id);

-- Monthly partitions
CREATE TABLE events_2026_01 PARTITION OF events
    FOR VALUES FROM ('019000000000000000000000000000') TO ('019100000000000000000000000000');
```

UUIDv7 and ULID values naturally partition by time because their first bytes encode the timestamp.
