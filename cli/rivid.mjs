#!/usr/bin/env node
// rivid CLI — lightweight wrapper around @rivid/core.
//
//   rivid ulid [--count N] [--monotonic]
//   rivid uuidv7 [--count N]
//   rivid decode <ulid>
//   rivid validate <ulid>...
//   rivid benchmark [--quick]
//   rivid version
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)

function load() {
  // Works both from a checked-out repo (root binding) and an installed
  // package (binding ships alongside).
  for (const p of ['../index.js', '../../index.js', '@rivid/core']) {
    try {
      return require(p)
    } catch {
      /* try next */
    }
  }
  console.error('error: unable to load the @rivid/core native module')
  process.exit(1)
}

const core = load()

function usage() {
  console.log(`rivid — ULID & UUIDv7 toolkit

Usage:
  rivid ulid [--count <n>] [--monotonic] [--json]
  rivid uuidv7 [--count <n>] [--json]
  rivid bytes16
  rivid decode <ulid>            Print timestamp + binary form as hex/UUID
  rivid validate <ulid>...       Exit 0 if all valid, 1 otherwise
  rivid benchmark [--quick]      Run the benchmark suite
  rivid version

Options:
  --count <n>     Number of IDs to generate (default 1; max 100000000)
  --monotonic     Use monotonic generation for sequential output
  --json          Output JSON array instead of one ID per line
`)
}

const MAX_COUNT = 100_000_000

function argNum(argv, name, fallback) {
  const i = argv.indexOf(name)
  if (i === -1) return fallback
  const v = Number(argv[i + 1])
  if (!Number.isInteger(v) || v < 0) {
    console.error(`error: ${name} expects a non-negative integer`)
    process.exit(1)
  }
  if (v > MAX_COUNT) {
    console.error(`error: ${name} must be at most ${MAX_COUNT}`)
    process.exit(1)
  }
  return v
}

function commandHelp(cmd) {
  const lines = {
    ulid: `rivid ulid — generate ULIDs

Usage: rivid ulid [--count <n>] [--monotonic] [--json]

Options:
  --count <n>     Number of IDs (default 1; max ${MAX_COUNT})
  --monotonic     Strictly increasing output (same-ms increments)
  --json          Output a JSON array instead of one ID per line`,
    uuidv7: `rivid uuidv7 — generate UUIDv7s

Usage: rivid uuidv7 [--count <n>] [--json]

Options:
  --count <n>     Number of IDs (default 1; max ${MAX_COUNT})
  --json          Output a JSON array instead of one ID per line`,
    decode: `rivid decode — inspect a ULID

Usage: rivid decode <ulid>

Prints the embedded timestamp (ms + ISO), the raw 16 bytes as hex and the
hyphenated UUID form.`,
    validate: `rivid validate — check ULID strings

Usage: rivid validate <ulid>...

Exits 0 when every argument is a valid ULID, 1 otherwise (invalid ones are
listed on stderr).`,
    benchmark: `rivid benchmark — run the benchmark suite

Usage: rivid benchmark [--quick]

Requires a checked-out repository (the harness lives in benchmarks/).`,
  }
  const text = lines[cmd]
  if (!text) return false
  console.log(text)
  return true
}

const [cmd = 'ulid', ...rest] = process.argv.slice(2)

if (rest.includes('--help') || rest.includes('-h')) {
  if (!commandHelp(cmd)) usage()
  process.exit(0)
}

switch (cmd) {
  case 'ulid': {
    const count = argNum(rest, '--count', 1)
    const json = rest.includes('--json')
    if (rest.includes('--monotonic')) {
      const ids = Array.from({ length: count }, () => core.monotonicUlid())
      emit(json, ids)
    } else if (count <= 1 && !rest.includes('--count')) {
      emit(false, [core.ulid()])
    } else {
      emit(json, core.generateMany(count))
    }
    break
  }

  case 'uuidv7': {
    const count = argNum(rest, '--count', 1)
    const json = rest.includes('--json')
    if (count <= 1 && !rest.includes('--count')) {
      emit(false, [core.uuidv7()])
    } else {
      emit(json, core.generateUuidV7Many(count))
    }
    break
  }

  case 'bytes16': {
    console.log(Buffer.from(core.ulidBytes()).toString('hex'))
    break
  }

  case 'decode': {
    const id = rest[0]
    if (!id) {
      usage()
      process.exit(1)
    }
    if (rest.length > 1) {
      console.error(`error: decode takes exactly one ULID (${rest.length - 1} extra argument(s) ignored)`)
      process.exit(1)
    }
    try {
      const ts = core.decodeTime(id)
      const bytes = Buffer.from(core.decode(id)).toString('hex')
      console.log(JSON.stringify({ ulid: id, timestampMs: ts, isoTime: new Date(ts).toISOString(), bytes, uuid: core.ulidToUuid(id) }, null, 2))
    } catch (e) {
      console.error(`error: ${e.message}`)
      process.exit(1)
    }
    break
  }

  case 'validate': {
    if (rest.length === 0) {
      usage()
      process.exit(1)
    }
    const bad = rest.filter((id) => !core.isValid(id))
    if (bad.length > 0) {
      for (const id of bad) console.error(`invalid: ${id}`)
      process.exit(1)
    }
    console.log(`ok (${rest.length} valid)`)
    break
  }

  case 'benchmark': {
    const quick = rest.includes('--quick') ? '--quick' : ''
    // Only works from a checked-out repo; the harness is not shipped in the
    // npm tarball.
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'benchmarks/run.mts', quick].filter(Boolean), {
      stdio: 'inherit',
      cwd: new URL('../..', import.meta.url).pathname,
    })
    process.exit(r.status ?? 1)
    break
  }

  case 'version':
    console.log(core.version())
    break

  case 'help':
  case '--help':
  case '-h':
    usage()
    break

  default:
    console.error(`unknown command: ${cmd}`)
    usage()
    process.exit(1)
}

function emit(asJson, values) {
  if (asJson) console.log(JSON.stringify(values))
  else for (const v of values) console.log(v)
}
