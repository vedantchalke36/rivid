/**
 * Stateful ULID generator.
 *
 * Use a generator when you need **isolated monotonic state** (per worker /
 * per stream / deterministic fixtures) or an object-oriented handle.
 * For raw single-call throughput the module-level `ulid()` function is
 * faster (class method dispatch adds roughly 100-150ns); for volume use the
 * bulk APIs.
 *
 * ## Security model
 *
 * | Mode                     | Randomness                          | Use            |
 * |--------------------------|-------------------------------------|----------------|
 * | `new UlidGenerator()`    | OS-seeded ChaCha12 (CSPRNG)         | production     |
 * | `new UlidGenerator({ seed })` | Xoshiro256\*\*, reproducible   | tests/fixtures |
 *
 * Deterministic mode is opt-in **only** via an explicit `seed` and must
 * never be used where unpredictability matters.
 */
export { UlidGenerator } from '../index.js'
export type { UlidGeneratorOptions } from '../index.js'
