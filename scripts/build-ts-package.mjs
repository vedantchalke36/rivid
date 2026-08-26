// Builds a dual ESM+CJS TypeScript subpackage from ./src.
// Prefers per-package tsconfig.{esm,cjs}.json (paths-mapped deps);
// falls back to generic CLI flags for simple packages.
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

// Runs inside the invoking package directory (npm scripts set cwd there).
mkdirSync('dist', { recursive: true })

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

if (existsSync('tsconfig.esm.json')) {
  sh('npx tsc -p tsconfig.esm.json')
  sh('npx tsc -p tsconfig.cjs.json')
} else {
  const base = ['--strict', '--skipLibCheck', '--declaration', '--declarationMap', 'false',
    '--target', 'ES2022', '--types', 'node']
  sh(`npx tsc src/index.ts ${base.join(' ')} --outDir dist/esm --module ESNext --moduleResolution Bundler`)
  sh(`npx tsc src/index.ts ${base.join(' ')} --outDir dist/cjs --module CommonJS --moduleResolution Node10`)
}

writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n')
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
console.log('built dist/{esm,cjs}')
