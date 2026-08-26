// Copies the wasm-pack `web`-target output into src/ so Vite resolves it as
// plain source — no file: dependency, no wasm asset pipeline surprises.
import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '../../crates/wasm/pkg-web')
const to = join(here, 'src/rivid-wasm')

rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log('rivid-wasm synced →', to)
