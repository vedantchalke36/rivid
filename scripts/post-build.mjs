// Post-compile fixes:
// 1. Marks dist/esm as ESM and dist/cjs as CommonJS via package.json markers.
// 2. Rewrites the native-binding specifier inside dist: sources live one
//    directory shallower than their compiled output, so `../index.js`
//    (correct for src/*.ts type-checking against the generated root
//    binding) becomes `../../index.js` at runtime.
// 3. Aligns the root NAPI-generated index.d.ts with the hand-authored
//    public signatures (readonly array parameter for `sort`).
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = [
  ['dist/esm/package.json', { type: 'module' }],
  ['dist/cjs/package.json', { type: 'commonjs' }],
]
for (const [rel, obj] of files) {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n')
}

let fixed = 0
let remaining = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|d\.ts)$/.test(name)) {
      let src = readFileSync(p, 'utf8')
      const before = src
      // Only touch the exact binding specifier, never other relative imports.
      src = src
        .replaceAll("'../index.js'", "'../../index.js'")
        .replaceAll('"../index.js"', '"../../index.js"')
      if (src !== before) {
        writeFileSync(p, src)
        fixed++
      } else if (/['"]\.\.\/index\.js['"]/.test(src)) {
        // Unrewritten specifier that our replace should have caught.
        remaining++
      }
    }
  }
}
walk(join(root, 'dist'))

// The generated root declaration is stricter than the authored API: the
// public `sort()` accepts readonly arrays. Patch it so consumers importing
// types from the package root see the same signature.
let declFixed = 0
{
  const p = join(root, 'index.d.ts')
  const src = readFileSync(p, 'utf8')
  let patched = src.replace(
    /export declare function sort\(ids: Array<string>\): Array<string>/,
    'export declare function sort(ids: ReadonlyArray<string>): Array<string>',
  )
  // Raw-array bindings return JsObject internally; the public surface is
  // string[] (elements are ASCII latin1 strings created natively).
  const declFixes = [
    [
      /export declare function sort\(ids: Array<string>\): Array<string>/,
      'export declare function sort(ids: ReadonlyArray<string>): Array<string>',
    ],
    [/export declare function generateMany\(([^)]*)\): object/, 'export declare function generateMany($1): string[]'],
    [/export declare function decodeMany\(([^)]*)\): Uint8Array/, 'export declare function decodeMany($1): Uint8Array'],
    [/nextMany\(([^)]*)\): object/, 'nextMany($1): string[]'],
    [/monotonicMany\(([^)]*)\): object/, 'monotonicMany($1): string[]'],
    [/export declare function decodeInto\(([^)]*)\): void/, 'export declare function decodeInto($1): void'],
  ]
  for (const [re, sub] of declFixes) patched = patched.replace(re, sub)
  if (patched !== src) {
    writeFileSync(p, patched)
    declFixed++
  }
}

if (remaining > 0) {
  throw new Error(
    `post-build: ${remaining} file(s) still reference '../index.js' after rewriting — the NAPI generator output shape changed; update scripts/post-build.mjs`,
  )
}
console.log(
  `post-build fixes applied (${fixed} files rewritten${
    declFixed ? ', index.d.ts signatures aligned' : ''
  })`,
)
