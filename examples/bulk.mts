/**
 * Bulk generation: amortizes timestamp reads, RNG reseeding and the NAPI
 * boundary across an entire batch.
 *
 * Run: node --import tsx examples/bulk.mts
 */
import {
  generateMany,
  generateBytes,
  generateInto,
  decode,
  decodeTime,
  encode,
} from '../src/index.js'

const N = 1_000_000

console.log(`Generating ${N.toLocaleString()} IDs as strings…`)
let t = performance.now()
const ids = generateMany(N)
console.log(`  ${((performance.now() - t) / 1000).toFixed(2)}s`)

console.log(`\nGenerating ${N.toLocaleString()} IDs into a single buffer…`)
t = performance.now()
const buf = generateBytes(N)
console.log(`  ${((performance.now() - t) / 1000).toFixed(2)}s   (${(buf.length / 1024 / 1024).toFixed(1)} MiB)`)

console.log('\nWith caller-owned allocation (`generateInto` — zero heap surprises):')
const prealloc = new Uint8Array(N * 16)
t = performance.now()
const wrote = generateInto(prealloc)
console.log(`  wrote ${wrote} IDs in ${((performance.now() - t) / 1000).toFixed(2)}s`)

console.log('\nRandom sample round trip:')
const sample = ids[500_000]!
console.log(
  `  ${sample} timestamp → ${new Date(decodeTime(sample)).toISOString()}`,
)
// Round trip: string -> bytes -> string must be exact.
const b = prealloc.subarray(500_000 * 16, 500_000 * 16 + 16)
const fromBytes = encode(b)
const rt = encode(decode(sample))
console.log(`  16 bytes → ULID: ${fromBytes}`)
console.log(`  string → bytes → string identical: ${rt === sample}`)
