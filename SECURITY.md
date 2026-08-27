# Security Guide

## Threat Model

| Threat | Mitigation |
|--------|------------|
| ID prediction | 80-bit random component (ULID) or 122-bit random (UUIDv7) |
| Collision attacks | 80-bit randomness → 1 in 10^18 collision probability |
| Timing attacks | Constant-time comparison for binary IDs |
| Information leakage | Timestamp is public in ULID/UUIDv7; use UUIDv4 for sensitive contexts |
| Replay attacks | Idempotency keys with expiry |
| Brute force | Rate limiting + exponential backoff |

## Randomness Quality

### Rivid RNG Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Entropy Pool                              │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
│  │128b │ │128b │ │128b │ │128b │ │128b │ │128b │ │128b │ │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ │
│  32 × 128-bit words = 4096 bits = 512 bytes                  │
├─────────────────────────────────────────────────────────────┤
│                  ChaCha12 Core                               │
│  20 rounds → 512 bytes of pseudorandom output                │
├─────────────────────────────────────────────────────────────┤
│                  Output                                      │
│  80 bits (10 bytes) per ULID                                 │
│  122 bits (16 bytes) per UUIDv7                              │
└─────────────────────────────────────────────────────────────┘
```

### Security Properties

| Property | Value |
|----------|-------|
| RNG algorithm | ChaCha12 (reduced-round ChaCha20) |
| Entropy source | `getrandom()` / `arc4random()` (OS CSPRNG) |
| Pool size | 32 × 128-bit words (4096 bits) |
| Output per ID | 80 bits (ULID) / 122 bits (UUIDv7) |
| Refill threshold | 50% (refill when < 16 words remain) |
| Auto-refill | Yes, on every generation |

## Timing Attack Protection

```typescript
// Constant-time comparison for binary IDs
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// Usage
const id1 = ulidBytes();
const id2 = getStoredId();
if (constantTimeEqual(id1, id2)) {
  // Match
}
```

## ID Prediction Resistance

| Generator | Random Bits | Prediction Resistance |
|-----------|------------:|----------------------:|
| UUIDv4 | 122 bits | Excellent |
| UUIDv7 | 122 bits | Excellent |
| ULID | 80 bits | Good |
| Monotonic ULID | 80 bits | Good |
| Compact sortable | 80 bits | Good |

**ULID (80 bits)**: An attacker would need ~2^40 attempts to have a 50% chance of collision. This is sufficient for most applications.

**UUIDv7 (122 bits)**: Provides 122 bits of randomness, equivalent to UUIDv4 security.

## Sensitive Contexts

For highly sensitive identifiers (e.g., password reset tokens, API keys):

```typescript
import { ulidBytes } from '@rivid/core';

// Generate cryptographically secure token
function generateSecureToken(): string {
  const bytes = ulidBytes();
  // Use base64url encoding for URL-safe tokens
  return Buffer.from(bytes).toString('base64url');
}
```

## Secure Storage

```sql
-- Store IDs as native uuid (16 bytes, not 26 bytes of text)
CREATE TABLE sensitive_entities (
    id uuid PRIMARY KEY,
    -- ...
);

-- Never log raw IDs in production
-- Use masked versions for debugging
SELECT
    id,
    left(id::text, 8) || '...' AS masked_id
FROM sensitive_entities;
```

## Rate Limiting

```typescript
import { ulid, decodeTime } from '@rivid/core';

// Use ULID's timestamp for rate limiting
async function checkRateLimit(redis: Redis, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Add current request
  const requestId = ulid();
  await redis.zadd(`ratelimit:${key}`, now, requestId);

  // Remove old entries
  await redis.zremrangebyscore(`ratelimit:${key}`, 0, windowStart);

  // Count remaining
  const count = await redis.zcard(`ratelimit:${key}`);

  return count <= limit;
}
```

## Audit Trail

```sql
-- Use ULID for audit logs (time-sortable, tamper-evident)
CREATE TABLE audit_log (
    id uuid PRIMARY KEY,                    -- monotonic ULID
    user_id uuid NOT NULL,
    action text NOT NULL,
    resource_type text,
    resource_id uuid,
    ip_address inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Time-range queries for forensics
SELECT * FROM audit_log
WHERE id > $1 AND id < $2
ORDER BY id ASC;
```

## Best Practices

1. **Use native uuid storage** — 16 bytes, not 26–36 bytes of text
2. **Never log raw IDs** — mask them in production logs
3. **Use idempotency keys** — prevent replay attacks
4. **Rate limit by ID** — use ULID's embedded timestamp
5. **Use monotonic ULIDs** — for audit trails and event sourcing
6. **Validate ID format** — reject malformed IDs at the API boundary
7. **Use constant-time comparison** — for binary ID matching
8. **Rotate idempotency keys** — expire old keys regularly
