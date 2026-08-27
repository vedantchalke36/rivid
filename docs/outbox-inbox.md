# Transactional Outbox Pattern

## Purpose

The outbox pattern ensures reliable event publishing from database transactions.
Instead of publishing events directly to a queue, events are stored in an outbox table
within the same transaction, then published asynchronously.

## Schema

```sql
-- Outbox table
CREATE TABLE outbox (
    id uuid PRIMARY KEY,                    -- monotonic ULID as uuid
    aggregate_type text NOT NULL,           -- e.g., 'order'
    aggregate_id uuid NOT NULL,             -- business entity
    event_type text NOT NULL,               -- e.g., 'order.created'
    payload jsonb NOT NULL,                 -- event data
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,               -- NULL = not yet published
    publish_attempts int NOT NULL DEFAULT 0
);

-- Publishing index (ordered by creation time)
CREATE INDEX idx_outbox_unpublished ON outbox (created_at)
    WHERE published_at IS NULL;

-- Aggregate lookup
CREATE INDEX idx_outbox_aggregate ON outbox (aggregate_type, aggregate_id);
```

## Application Pattern

```typescript
import { ulid, toUuid } from '@rivid/core';

// Within a transaction
async function createOrder(orderData: any) {
  return await db.transaction(async (tx) => {
    // 1. Create the entity
    const orderId = ulid();
    await tx.query(
      'INSERT INTO orders (id, ...) VALUES ($1, ...)',
      [orderId, ...]
    );

    // 2. Store event in outbox (same transaction)
    const eventId = ulid();
    await tx.query(
      'INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, $3, $4, $5)',
      [eventId, 'order', toUuid(orderId), 'order.created', JSON.stringify(orderData)]
    );

    return { orderId, eventId };
  });
}
```

## Publisher

```typescript
// Async publisher (polling)
async function publishOutboxEvents() {
  const events = await db.query(
    'SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED'
  );

  for (const event of events) {
    try {
      await queue.publish(event.event_type, event.payload);

      await db.query(
        'UPDATE outbox SET published_at = now() WHERE id = $1',
        [event.id]
      );
    } catch (error) {
      await db.query(
        'UPDATE outbox SET publish_attempts = publish_attempts + 1 WHERE id = $1',
        [event.id]
      );
    }
  }
}
```

## Key Insights

1. **ULID's monotonic property** ensures events are published in creation order
2. **Time-sortable IDs** enable efficient range queries for the publisher
3. **Binary format** reduces storage overhead for high-throughput outbox tables
4. **Native UUID storage** saves 34.8% vs CHAR(26) for outbox entries
5. **Monotonic ULIDs** prevent race conditions in concurrent publishers
