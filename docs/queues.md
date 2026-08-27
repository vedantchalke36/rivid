# Queue Integration Guide

## Identifier Selection by Queue Role

| Role | Recommended | Why |
|------|-------------|-----|
| Message ID | ULID | Compact, URL-safe, time-sortable |
| Job ID | ULID | Compact, human-readable, time-sortable |
| Deduplication Key | ULID bytes | 80-bit random component |
| Idempotency Key | ULID bytes | 80-bit random component |
| Retry ID | ULID | Time-sortable for debugging |
| Workflow ID | UUIDv7 | Standard format, traceable |

## Queue System Patterns

### Kafka

```typescript
import { ulid, toUuid } from '@rivid/core';

// Producer
const messageId = ulid();
await kafka.send({
  topic: 'orders',
  messages: [{
    key: toUuid(aggregateId),           // Partition key (ensures ordering per aggregate)
    value: JSON.stringify({
      event_id: ulid(),                  // Unique event ID
      aggregate_id: aggregateId,         // Business entity
      correlation_id: correlationId,     // Request trace
      type: 'order.created',
      payload: orderData,
    }),
    headers: {
      'x-message-id': messageId,         // For deduplication
      'x-correlation-id': correlationId,  // For tracing
    },
  }],
});
```

### NATS

```typescript
import { ulid } from '@rivid/core';

// Publish
const msgId = ulid();
nc.publish('orders.created', JSON.stringify({
  event_id: msgId,
  aggregate_id: aggregateId,
  payload: orderData,
}), {
  'Nats-Msg-Id': msgId,  // Exactly-once delivery
});
```

### RabbitMQ

```typescript
import { ulid } from '@rivid/core';

// Publish with deduplication
const msgId = ulid();
channel.sendToQueue('orders', Buffer.from(JSON.stringify({
  event_id: msgId,
  aggregate_id: aggregateId,
  payload: orderData,
})), {
  messageId: msgId,           // RabbitMQ deduplication
  correlationId: correlationId, // Built-in correlation
  expiration: '86400000',     // 24h TTL
});
```

### SQS

```typescript
import { ulid } from '@rivid/core';

// Send with deduplication (FIFO queues)
const msgId = ulid();
await sqs.sendMessage({
  QueueUrl: queueUrl,
  MessageBody: JSON.stringify({
    event_id: msgId,
    aggregate_id: aggregateId,
    payload: orderData,
  }),
  MessageGroupId: aggregateId,           // Partition by aggregate
  MessageDeduplicationId: msgId,         // Deduplication
}).promise();
```

## Deduplication Strategy

```sql
-- Message deduplication table
CREATE TABLE message_dedup (
    message_id uuid PRIMARY KEY,           -- ULID as uuid
    topic text NOT NULL,
    partition_key text,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (message_id)
);

-- Check before processing
INSERT INTO message_dedup (message_id, topic, received_at)
VALUES ($1, $2, now())
ON CONFLICT (message_id) DO NOTHING
RETURNING message_id;  -- NULL if duplicate

-- Cleanup old entries
DELETE FROM message_dedup
WHERE received_at < now() - interval '7 days';
```

## Dead Letter Queue

```sql
CREATE TABLE dead_letter_queue (
    id uuid PRIMARY KEY,                    -- monotonic ULID
    original_message_id uuid NOT NULL,      -- links to original
    topic text NOT NULL,
    payload jsonb NOT NULL,
    error_message text,
    retry_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    next_retry_at timestamptz
);

-- Get messages ready for retry
SELECT * FROM dead_letter_queue
WHERE next_retry_at <= now()
ORDER BY id ASC
LIMIT 100;
```

## Key Insights

1. **ULID's compactness matters for queues** — 26 chars vs 36 chars = 28% less metadata overhead per message
2. **Time-sortability helps debugging** — messages naturally sort by creation time
3. **Binary APIs reduce serialization** — `ulidBytes()` avoids string encoding overhead
4. **Monotonic ULIDs preserve order** — critical for event sourcing through queues
