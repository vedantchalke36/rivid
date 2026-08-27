# Microservices Guide

## Identifier Selection by Role

| Role | Recommended | Why |
|------|-------------|-----|
| Entity ID | UUIDv7 or ULID | Time-sortable, globally unique, no coordination |
| Request ID | UUIDv7 | Standard format, traceable across services |
| Correlation ID | UUIDv7 | Standard format, time-ordered for debugging |
| Event ID | Monotonic ULID | Strictly increasing within a process |
| Job ID | ULID | Compact, URL-safe, time-sortable |
| Idempotency Key | ULID bytes | 80-bit random component for collision resistance |

## Service Communication Pattern

```
Service A
  │
  ├─ Generate entity_id (ULID/UUIDv7)
  ├─ Generate request_id (UUIDv7)
  ├─ Generate correlation_id (UUIDv7)
  │
  ↓
Message Queue (Kafka/NATS/RabbitMQ/SQS)
  │
  ├─ Message contains:
  │   - entity_id: unique business identifier
  │   - request_id: tracks the original request
  │   - correlation_id: links related events
  │   - event_id: unique event identifier
  │
  ↓
Service B
  │
  ├─ Deduplicate by event_id
  ├─ Process idempotently by idempotency_key
  ├─ Store with entity_id as PK
  ├─ Forward correlation_id for tracing
```

## ID Generation Overhead

Measured on Intel i5-10210U:

| Operation | Rust (ns) | Node (ns) | Overhead |
|-----------|----------:|----------:|---------:|
| ULID generation | 54 | 132 | 78 ns |
| UUIDv7 generation | 87 | 165 | 78 ns |
| Monotonic ULID | 43 | 154 | 111 ns |
| ULID → UUID conversion | — | 252 | — |

**Key insight**: ID generation is ~1000x faster than a network round-trip (~100µs).
The overhead is negligible in any distributed system.

## Serialization Size

| Format | String | Binary | JSON key |
|--------|-------:|-------:|---------:|
| UUIDv7 | 36 chars | 16 bytes | 36 chars |
| ULID | 26 chars | 16 bytes | 26 chars |
| Compact sortable | 22 chars | 16 bytes | 22 chars |

For high-volume event streams, ULID saves 28% bandwidth vs UUIDv7 in text form.

## Best Practices

1. **Always generate IDs in the producer** — don't rely on database auto-increment
2. **Use time-sortable IDs** — enables efficient range queries and debugging
3. **Store as native uuid** — 16 bytes, not 26–36 bytes of text
4. **Include correlation_id** — enables distributed tracing without external systems
5. **Use monotonic IDs for event sourcing** — guarantees insertion order
