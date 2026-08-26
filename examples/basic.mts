/**
 * Minimal usage — the first thing most users should try.
 *
 * Run:  node --import tsx examples/basic.mts
 */
import { ulid, monotonicUlid, isValid, decodeTime } from '../src/index.js'

const id = ulid()
console.log('ulid()             :', id)
console.log('isValid?           :', isValid(id))
console.log('timestamp (ISO)    :', new Date(decodeTime(id)).toISOString())

console.log('\nmonotonicUlid() (strictly increasing even within one ms):')
let prev = monotonicUlid()
for (let i = 0; i < 5; i++) {
  const next = monotonicUlid()
  console.log(`  ${next} ${next > prev ? '✓' : '✗'}`)
  prev = next
}
