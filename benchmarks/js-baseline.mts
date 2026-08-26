/**
 * Pure-JS ULID baseline (no dependencies) used as a floor comparison.
 *
 * Mirrors the reference `ulid` package's algorithm: Date.now() + Math.random
 * with per-char encoding. NOT cryptographically secure; included only to
 * quantify what plain JavaScript can achieve.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function jsUlid(): string {
  const now = Date.now()
  let time = ''
  let n = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[n % 32] + time
    n = Math.floor(n / 32)
  }
  let random = ''
  for (let i = 0; i < 16; i++) {
    random += ENCODING[Math.floor(Math.random() * 32)]
  }
  return time + random
}

/** Batch variant that hoists the timestamp read (bulk-style JS). */
export function jsUlidMany(count: number): string[] {
  const now = Date.now()
  let time = ''
  let n = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[n % 32] + time
    n = Math.floor(n / 32)
  }
  const out: string[] = new Array(count)
  for (let j = 0; j < count; j++) {
    let random = ''
    for (let i = 0; i < 16; i++) {
      random += ENCODING[(Math.random() * 32) | 0]
    }
    out[j] = time + random
  }
  return out
}
