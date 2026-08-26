/**
 * N-API boundary component probes.
 *
 * Isolates the cost of each crossing primitive so per-API numbers can be
 * decomposed into: argument import, work, result export.
 *
 * Run: node --import tsx benchmarks/profile/boundary.mts
 */
import { measureOps } from '../harness.mts'
import { native, ulid, decode, ulidBytes, generateBytes } from '../../src/index.js'

const rows: Array<Record<string, number | string>> = []
const t = (label: string, fn: () => unknown) => {
  const r = measureOps(label, fn, { targetMs: 250 })
  rows.push({ label, ns: Math.round(r.nsPerOp), opsPerSec: Math.round(r.opsPerSec) })
}

// 0. pure JS baseline
t('js no-op closure', () => { /* nothing */ })
t('js new Uint8Array(16)', () => new Uint8Array(16))
t('js Buffer.allocUnsafe(16)', () => Buffer.allocUnsafe(16))

// 1. boundary crossings by shape
t('noop()                      (void → void)', () => native.noop())
t('noop + const number arg', () => native.noopArg(7))
t('return u32', () => native.versionLen())
t('pass 26-char string in', () => native.consumeString('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
t('return 26-char ASCII string', () => native.constUlidString())
t('return Uint8Array(16)', () => ulidBytes())
t('return Uint8Array(256)', () => native.bytesN(256))
t('return Uint8Array(16384)', () => native.bytesN(16384))
t('pass Uint8Array(16) in', () => native.consumeBytes(new Uint8Array(16)))
t('pass prebuilt Uint8Array(16) in', (() => {
  const b = new Uint8Array(16)
  return () => native.consumeBytes(b)
})())

// 2. real ops for decomposition
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
t('ulid() end-to-end', () => ulid())
t('decode(str) end-to-end', () => decode(id))
t('generateBytes(1000)', () => generateBytes(1000))

console.log('| probe | ns/op |')
console.log('| --- | ---: |')
for (const r of rows) console.log(`| ${r.label} | ${r.ns} |`)
