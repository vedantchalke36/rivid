// Assembles the publishable @rivid/wasm npm package from wasm-pack outputs.
//
//   node scripts/package-wasm.mjs            # builds nothing; expects
//                                            # crates/wasm/{pkg,pkg-web} present
// Produces crates/wasm/npm/ ready for `npm publish`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(root, 'crates/wasm')
const out = join(srcRoot, 'npm')

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = process.env.RELEASE_VERSION?.replace(/^v/, '') ?? rootPkg.version

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'web'), { recursive: true })
mkdirSync(join(out, 'nodejs'), { recursive: true })
cpSync(join(srcRoot, 'pkg-web'), join(out, 'web'), { recursive: true })
cpSync(join(srcRoot, 'pkg'), join(out, 'nodejs'), { recursive: true })

// Strip wasm-pack's own manifest AND its `*` .gitignore — npm would otherwise
// treat that gitignore as an npmignore and drop every file from the tarball.
for (const dir of ['web', 'nodejs']) {
  rmSync(join(out, dir, 'package.json'), { force: true })
  rmSync(join(out, dir, '.gitignore'), { force: true })
}

// Root manifest is ESM; pin the CJS nodejs build explicitly so Node parses
// its __dirname-based loader correctly.
writeFileSync(join(out, 'nodejs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))

const manifest = {
  name: '@rivid/wasm',
  version,
  description: 'WebAssembly build of the rivid ID engine — spec-compatible ULIDs and UUIDv7 for browsers',
  author: rootPkg.author,
  license: 'MIT',
  homepage: rootPkg.homepage,
  repository: rootPkg.repository,
  bugs: rootPkg.bugs,
  keywords: ['ulid', 'uuid', 'uuidv7', 'wasm', 'webassembly', 'identifier', 'sortable', 'base32'],
  type: 'module',
  sideEffects: false,
  engines: { node: '>=18' },
  exports: {
    '.': {
      types: './web/rivid_wasm.d.ts',
      node: './nodejs/rivid_wasm.js',
      default: './web/rivid_wasm.js',
    },
  },
  main: './web/rivid_wasm.js',
  files: ['web/', 'nodejs/', 'README.md', 'LICENSE'],
}

writeFileSync(join(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

const readme = [
  '# `@rivid/wasm`',
  '',
  '**[ULID](https://github.com/ulid/spec) / UUIDv7 generation for browsers and Wasm runtimes**,',
  `compiled from the same Rust engine as [\`@rivid/core\`](${rootPkg.homepage}) (${version}).`,
  '',
  '```ts',
  "import init, { ulid, isValid, decodeTime } from '@rivid/wasm'",
  '',
  'await init() // fetches + instantiates the .wasm asset',
  "ulid() // '01ARZ3NDEKTSV4RRFFQ69G5FAV'",
  '```',
  '',
  '- ChaCha12 CSPRNG seeded via `crypto.getRandomValues`',
  '- ~63 kB .wasm (~29 kB gzip)',
  '- Node.js resolves the CJS build automatically; bundlers get the ESM/web build',
  '',
  '| API | Notes |',
  '|---|---|',
  '| `ulid(seedTime?)` / `monotonicUlid(seedTime?)` | canonical 26-char ULID |',
  '| `generateMany(n)` / `generateBytes(n)` | batch, one shared timestamp |',
  '| `isValid` / `decodeTime` / `encodeTime` / `compare` | codec + ordering |',
  '| `decode` / `encode` / `ulidBytes` | 16-byte binary form |',
  '| `uuidv7` / `uuidv7Bytes` / `generateUuidV7Many` / `uuidv7Time` | RFC 9562 |',
  '| `ulidToUuid` / `uuidToUlid` | lossless conversion |',
  '| `MonotonicGenerator` | isolated ordered stream class |',
  '',
].join('\n')
writeFileSync(join(out, 'README.md'), readme)

cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))

console.log(`@rivid/wasm ${version} packaged → ${out}`)
