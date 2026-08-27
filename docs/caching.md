# Caching Guide

## Cache Key Design

ULID's compactness and time-sortability make it ideal for cache keys.

| Pattern | Key Format | Size | Example |
|---------|-----------|-----:|---------|
| Entity cache | `{prefix}:{ulid}` | 30+ chars | `user:01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Versioned cache | `{prefix}:{ulid}:v{ver}` | 35+ chars | `user:01ARZ3...:v3` |
| TTL cache | `{prefix}:{ulid}:{ttl}` | 35+ chars | `user:01ARZ3...:3600` |
| Composite key | `{prefix}:{ulid}:{sub}` | 35+ chars | `user:01ARZ3...:profile` |

**vs UUIDv7**: ULID keys are 28% shorter (26 vs 36 chars), reducing memory overhead in Redis and key-value stores.

## Cache Invalidation by Time

ULID's embedded timestamp enables efficient cache invalidation:

```typescript
import { decodeTime, ulid } from '@rivid/core';

// Extract creation time from ULID
function getAge(id: string): number {
  const created = decodeTime(id);
  return Date.now() - created;
}

// Invalidate if older than 1 hour
function shouldInvalidate(id: string, maxAgeMs: number): boolean {
  return getAge(id) > maxAgeMs;
}

// Batch invalidation: find IDs older than threshold
function findExpired(ids: string[], maxAgeMs: number): string[] {
  const cutoff = Date.now() - maxAgeMs;
  return ids.filter(id => decodeTime(id) < cutoff);
}
```

## Redis Patterns

### Entity Cache

```typescript
import { ulid, toUuid } from '@rivid/core';

// Set with ULID as key
const id = ulid();
await redis.set(`user:${id}`, JSON.stringify(userData), 'EX', 3600);

// Get
const cached = await redis.get(`user:${id}`);

// Invalidation
await redis.del(`user:${id}`);
```

### Time-Range Invalidation

```typescript
import { ulid, decodeTime } from '@rivid/core';

// Find all keys older than threshold
async function invalidateOld(redis: Redis, prefix: string, maxAgeMs: number) {
  const keys = await redis.keys(`${prefix}:*`);
  const cutoff = Date.now() - maxAgeMs;

  const toDelete = keys.filter(key => {
    const id = key.split(':')[1];
    return decodeTime(id) < cutoff;
  });

  if (toDelete.length > 0) {
    await redis.del(...toDelete);
  }
}
```

### Sorted Set for Rate Limiting

```typescript
import { ulid } from '@rivid/core';

// Rate limit: max 100 requests per minute per user
async function checkRateLimit(redis: Redis, userId: string, limit: number) {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const window = 60000; // 1 minute

  // Add current request
  await redis.zadd(key, now, ulid());

  // Remove old entries
  await redis.zremrangebyscore(key, 0, now - window);

  // Count remaining
  const count = await redis.zcard(key);

  // Set expiry
  await redis.expire(key, Math.ceil(window / 1000));

  return count <= limit;
}
```

## Cache Stampede Prevention

```typescript
import { ulid } from '@rivid/core';

// Lock key using ULID for ordering
async function cacheWithLock(redis: Redis, key: string, fetcher: () => Promise<any>) {
  const lockKey = `lock:${key}`;
  const lockId = ulid();

  // Try to acquire lock
  const acquired = await redis.set(lockKey, lockId, 'NX', 'EX', 10);

  if (acquired) {
    try {
      const data = await fetcher();
      await redis.set(key, JSON.stringify(data), 'EX', 3600);
      return data;
    } finally {
      // Release lock (only if we own it)
      const current = await redis.get(lockKey);
      if (current === lockId) {
        await redis.del(lockKey);
      }
    }
  }

  // Another process is fetching, wait and retry
  await new Promise(resolve => setTimeout(resolve, 100));
  return JSON.parse(await redis.get(key));
}
```

## Key Insights

1. **28% less memory per key** vs UUIDv7 in Redis
2. **Embedded timestamp** enables time-based invalidation without separate metadata
3. **Time-sortable** enables efficient sorted set operations
4. **Monotonic ULIDs** prevent race conditions in concurrent cache updates
5. **Binary format** (`ulidBytes()`) reduces serialization overhead for high-throughput caches
