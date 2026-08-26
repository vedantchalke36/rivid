/**
 * Encoding comparison: compactness of different 128-bit serializations.
 *
 * Run: node --import tsx examples/encodings.mts
 */
import {
  ulid,
  encodeBase58,
  encodeBase64Url,
  encodeSortable,
  ulidBytes,
} from '../src/index.js'

const id = ulid()
const bytes = ulidBytes()

console.log(`ULID string      26 chars  ${id}`)
console.log(`  timestamp (ms) : ${Date.now()}  (first 10 chars = ${id.slice(0, 10)})`)
console.log(`\nEncodes of ${bytes.length} bytes (same 128 bits):`)
console.log(`  Crockford Base32 : ${26} chars  (canonical ULID)`)
console.log(`  Base58 (Bitcoin) : ${encodeBase58(bytes).length} chars  ${encodeBase58(bytes)}`)
console.log(`  Base64URL        : ${encodeBase64Url(bytes).length} chars  ${encodeBase64Url(bytes)}`)
console.log(`  Sortable         : ${encodeSortable(bytes).length} chars  ${encodeSortable(bytes)}`)
console.log(`\nRound trips: all decoders are strict (non-canonical inputs throw).\n`)
console.log(`  Base64URL vs Sortable length: same (22), only Sortable preserves order.`)
