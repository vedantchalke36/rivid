# Idempotency Guide

## Why ULID for Idempotency Keys

| Property | Benefit |
|----------|---------|
| 80-bit random component | Collision-resistant across distributed systems |
| Compact (26 chars) | Efficient as HTTP headers, queue metadata |
| Time-sortable | Enables debugging and ordering |
| URL-safe encoding | No escaping needed in query strings |
| Binary format | Efficient storage and comparison |

**vs UUIDv4**: Both have 128-bit randomness. ULID adds time-sortability and compactness at no cost.

## Implementation Patterns

### HTTP Idempotency Key

```typescript
import { ulid } from '@rivid/core';

// Client sends idempotency key
async function createOrder(orderData: any, idempotencyKey?: string) {
  const key = idempotencyKey || ulid();

  // Check if already processed
  const existing = await db.query(
    'SELECT * FROM idempotency_keys WHERE key = $1',
    [key]
  );

  if (existing) {
    return existing.response;  // Return cached response
  }

  // Process order
  const order = await processOrder(orderData);

  // Cache response
  await db.query(
    'INSERT INTO idempotency_keys (key, response, created_at, expires_at) VALUES ($1, $2, now(), now() + interval '24 hours')',
    [key, JSON.stringify(order)]
  );

  return order;
}
```

### Database Schema

```sql
CREATE TABLE idempotency_keys (
    key uuid PRIMARY KEY,                   -- ULID as uuid
    request_method text,
    request_path text,
    response jsonb NOT NULL,
    status_code int,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    processed_by text                       -- which service processed it
);

-- Auto-cleanup
CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);

-- Periodic cleanup
DELETE FROM idempotency_keys WHERE expires_at < now();
```

### Queue Idempotency

```typescript
import { ulidBytes } from '@rivid/core';

// For high-throughput queues, use binary keys
const idempotencyKey = ulidBytes();  // Uint8Array(16)

// Store in message metadata
await queue.publish({
  id: ulid(),
  idempotency_key: Array.from(idempotencyKey),  // JSON-serializable
  payload: orderData,
});

// Check before processing
const keyBuffer = Buffer.from(idempotencyKey);
const existing = await redis.get(`dedup:${keyBuffer.toString('hex')}`);
if (existing) {
  return;  // Already processed
}
```

### Distributed Idempotency

```sql
-- Cross-service idempotency
CREATE TABLE service_idempotency (
    service_name text NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash bytea NOT NULL,            -- SHA-256 of request
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (service_name, idempotency_key)
);

-- Detect duplicate with different request
SELECT * FROM service_idempotency
WHERE service_name = $1 AND idempotency_key = $2;
```

## Collision Resistance

ULID's 80-bit random component provides:

| Random Bits | Collision Probability (1M items) |
|------------:|---------------------------------:|
| 80 bits | 1 in 10^18 |
| 64 bits | 1 in 2^32 ≈ 4 billion |
| 48 bits | 1 in 2^16 ≈ 65K |

For idempotency keys, 80-bit randomness is sufficient for any practical scale.

## Cleanup Strategy

```sql
-- Partition by creation time for efficient cleanup
CREATE TABLE idempotency_keys (
    key uuid NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE idempotency_keys_2026_01 PARTITION OF idempotency_keys
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Drop entire partition when expired
DROP TABLE idempotency_keys_2026_01;
```

## Key Insights

1. **ULID's 80-bit randomness** is sufficient for idempotency keys
2. **Compact format** works well as HTTP headers and queue metadata
3. **Time-sortability** enables efficient range queries for cleanup
4. **Binary format** reduces storage overhead for high-throughput systems
5. **Native UUID storage** saves 34.8% vs CHAR(26)
