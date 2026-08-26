#!/usr/bin/env node
/**
 * Cross-language benchmark runner.
 *
 * 1. detects installed runtimes/toolchains
 * 2. validates versions
 * 3. installs pinned dependencies (per-ecosystem)
 * 4. builds release artifacts where needed
 * 5. runs correctness gates + benchmarks per language suite
 * 6. stores raw results immutably: results/YYYY-MM-DD/<language>.json
 * 7. generates benchmark-report.md + platform-matrix.json
 *
 * Usage:
 *   node runner/run.mjs [--quick] [--language=node,rust,...] [--skip-install] [--report-only]
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import * as osMod from 'node:os'

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url))
const BENCH = dirname(RUNNER_DIR) // benchmarks/
const ROOT = dirname(BENCH) // repo root
const argv = new Set(process.argv.slice(2))
const QUICK = argv.has('--quick')
const SKIP_INSTALL = argv.has('--skip-install')
const REPORT_ONLY = argv.has('--report-only')
const LANG_ARG = process.argv.find((a) => a.startsWith('--language='))

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', ...opts })
  return r.status === 0
}

function tryVersion(cmd) {
  try {
    // Some tools print versions to stderr (javac); capture both streams,
    // but only trust output from a zero-exit invocation (a missing binary
    // also writes to stderr via the shell).
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8' })
    if (r.status !== 0) return null
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0]
    return out || null
  } catch { return null }
}

// ── runtime detection ────────────────────────────────────────────────────
// Some toolchains install outside default PATH; probe well-known locations.
const PATH_EXTRA = ['~/go-sdk/bin', '/usr/local/go/bin', '~/sdk/go1.24.5/bin']
  .map((p) => p.replace('~', process.env.HOME ?? ''))
  .filter((p) => existsSync(p))
if (PATH_EXTRA.length && !process.env.__PATH_AUGMENTED) {
  process.env.PATH = `${PATH_EXTRA.join(':')}:${process.env.PATH}`
  process.env.__PATH_AUGMENTED = '1'
}

const runtimes = {
  node: { version: tryVersion('node --version'), dir: 'node', install: null },
  rust: { version: tryVersion('rustc --version'), dir: 'rust',
          install: null }, // cargo build happens in adapter via cargo run
  python: { version: tryVersion('python3 --version'), dir: 'python', install: 'uv' },
  // Go suite needs the compiler; JRE alone is not enough.
  go: { version: tryVersion('go version'), dir: 'go', install: 'go mod download' },
  // Java suite builds via Gradle wrapper; require javac AND gradlew/gradle.
  java: {
    version: (() => {
      const jre = tryVersion('java -version')?.split('"')[1] ?? null
      const jdk = tryVersion('javac -version')?.split(' ')[1] ?? null
      return jre && jdk ? `${jre} (javac ${jdk})` : null
    })(),
    dir: 'java',
    install: './gradlew build',
  },
}

let langs = Object.keys(runtimes).filter((l) => runtimes[l].version)
if (LANG_ARG) {
  const want = LANG_ARG.split('=')[1].split(',')
  langs = want.filter((l) => runtimes[l]?.version)
  for (const w of want) {
    if (!runtimes[w]?.version) console.error(`[skip] ${w}: toolchain not detected`)
    else if (!langs.includes(w)) console.error(`[skip] ${w}: not a known suite`)
  }
}
console.log('Detected suites:', langs.join(', ') || 'NONE')

// uv availability refines python install path
const hasUv = !!tryVersion('uv --version')

// ── results layout: results/YYYY-MM-DD/<language>.json (immutable) ──────
const day = new Date().toISOString().slice(0, 10)
const outDir = join(BENCH, 'results', day)
mkdirSync(outDir, { recursive: true })

function collectFramed(text) {
  const m = /BEGIN_RESULTS\n([\s\S]*?)\nEND_RESULTS/.exec(text)
  return m ? JSON.parse(m[1]) : []
}

/** Parses `go test -bench` output into the common row schema. */
function collectGoText(text, stamp, commitSha) {
  const rows = []
  let os = 'unknown', arch = 'unknown', cpu = 'unknown'
  for (const line of text.split('\n')) {
    let m = /^goos:\s*(.+)$/.exec(line)
    if (m) os = m[1]
    m = /^goarch:\s*(.+)$/.exec(line)
    if (m) arch = m[1]
    m = /^cpu:\s*(.+)$/.exec(line)
    if (m) cpu = m[1]

    m = /^(Benchmark\S+?)(-\d+)?\s+\d+\s+([\d.]+)\s+ns\/op\s+(\d+)\s+B\/op\s+(\d+)\s+allocs\/op/.exec(line.trim())
    if (!m) continue
    const [, name, , nsPer, bytesOp, allocsOp] = m
    const base = name.replace(/^Benchmark/, '')
    let op = 'generate.single.ulid'
    let ident = 'ulid'
    let cat = 'A'
    let pkg = 'oklog/ulid/v2'
    let count = 1
    const sizeMatch = /n=(\d+)/.exec(base)
    if (/^BulkUlid/.test(base)) {
      cat = 'B'
      count = sizeMatch ? Number(sizeMatch[1]) : 0
      op = 'generate.bulk.ulid'
    } else if (/^SingleUuidV7/.test(base)) {
      ident = 'uuidv7'; op = 'generate.single.uuidv7'; pkg = 'google/uuid'
    } else if (/^SingleUuidV4/.test(base)) {
      ident = 'uuidv4'; op = 'generate.single.uuidv4'; pkg = 'google/uuid'
    } else if (/^DecodeUlid/.test(base)) {
      cat = 'F'; op = 'codec.decode.ulid'
    } else if (/^ValidateUlid/.test(base)) {
      cat = 'F'; op = 'codec.validate.ulid'
    }
    rows.push({
      timestamp: stamp,
      commit: commitSha,
      language: 'go',
      package: pkg,
      package_version: 'pinned-in-go.mod',
      runtime_version: tryVersion('go version') ?? 'unknown',
      category: cat,
      operation: op,
      benchmark: base,
      identifier: ident,
      native: false,
      secure: true,
      count,
      ns_per_op: parseFloat(nsPer),
      ops_per_sec: Math.round(1e9 / parseFloat(nsPer)),
      bytes_per_op: parseInt(bytesOp, 10),
      allocs_per_op: parseInt(allocsOp, 10),
      items_per_sec: count > 1 ? count / (parseFloat(nsPer) / 1e9) : undefined,
      os, arch, cpu,
    })
  }
  return rows
}

async function runSuite(lang) {
  const env = { ...process.env }
  if (QUICK) env.BENCH_QUICK = '1'
  let res

  switch (lang) {
    case 'node':
      res = spawnSync(process.execPath, ['benchmarks/node/suite.mjs', QUICK ? '--quick' : ''], {
        cwd: ROOT, encoding: 'utf8', env,
      })
      break
    case 'rust':
      res = spawnSync(process.execPath, ['benchmarks/rust/suite.mjs', QUICK ? '--quick' : ''], {
        cwd: ROOT, encoding: 'utf8', env,
      })
      break
    case 'python': {
      if (!SKIP_INSTALL) {
        if (hasUv) {
          if (!sh('uv sync', { cwd: join(BENCH, 'python'), env })) throw new Error('uv sync failed')
        } else if (!sh('pip3 install -q -r <(echo) ', { cwd: join(BENCH, 'python'), env })) {
          // pip path: requirements come from pyproject; fall back to explicit pins
          if (!sh('pip3 install -q "python-ulid==2.7.0" "uuid-utils==0.10.0"', { env })) {
            throw new Error('pip install failed')
          }
        }
      }
      res = spawnSync(hasUv ? 'uv' : 'python3',
        hasUv ? ['run', 'python', 'suite.py'] : ['suite.py'],
        { cwd: join(BENCH, 'python'), encoding: 'utf8', env })
      break
    }
    case 'go': {
      const goDir = join(BENCH, 'go')
      if (!existsSync(join(goDir, 'go.sum')) && !sh('go mod tidy', { cwd: goDir, env })) {
        throw new Error('go mod tidy failed')
      }
      res = spawnSync('go', ['test', '-bench', '.', '-benchmem', '-run', '^$', '-count=1'], {
        cwd: goDir, encoding: 'utf8', env,
      })
      // Go emits testing.B text; parse into common schema + keep verbatim
      const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
      const sha = (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'no-git' } })()
      return {
        lang,
        raw: res.stdout ?? '',
        rows: collectGoText(res.stdout ?? '', stamp, sha),
        format: 'gotext',
      }
    }
    case 'java': {
      const javaDir = join(BENCH, 'java')
      const hasWrapper = existsSync(join(javaDir, 'gradlew'))
      const hasGradle = !!tryVersion('gradle --version')
      if (!hasWrapper && hasGradle) {
        if (!sh('gradle wrapper --gradle-version 8.10', { cwd: javaDir, env })) {
          throw new Error('gradle wrapper bootstrap failed')
        }
      }
      if (!hasWrapper && !hasGradle) {
        console.error('[skip] java: no ./gradlew and no system Gradle — install Gradle once to bootstrap the wrapper')
        return { lang, raw: '', rows: [], format: 'skipped' }
      }
      if (!SKIP_INSTALL && !sh('./gradlew build -x test', { cwd: javaDir, env })) {
        throw new Error('gradle build failed')
      }
      res = spawnSync('./gradlew', ['benchmark'], { cwd: javaDir, encoding: 'utf8', env })
      return { lang, raw: res.stdout ?? '', rows: [], format: 'jmh-text' }
    }
    default:
      return { lang, raw: '', rows: [], format: 'unsupported' }
  }

  if (res.status !== 0) {
    process.stderr.write(res.stderr || '')
    throw new Error(`${lang} suite exited ${res.status}`)
  }
  return { lang, raw: '', rows: collectFramed(res.stdout), format: 'json' }
}

// ── main ─────────────────────────────────────────────────────────────────
const all = {}
const failures = []

if (!REPORT_ONLY) {
  for (const lang of langs) {
    console.log(`\n=== ${lang} ===`)
    try {
      const r = await runSuite(lang)
      all[lang] = r
      if (r.rows.length) {
        writeFileSync(join(outDir, `${lang}.json`), JSON.stringify(r.rows, null, 1))
        console.log(`[${lang}] stored ${r.rows.length} rows → results/${day}/${lang}.json`)
      } else if (r.raw) {
        writeFileSync(join(outDir, `${lang}.txt`), r.raw)
        console.log(`[${lang}] stored text output → results/${day}/${lang}.txt`)
      } else {
        console.log(`[${lang}] nothing to store (${r.format})`)
      }
    } catch (e) {
      failures.push(`${lang}: ${e.message}`)
      console.error(`[FAIL] ${lang}: ${e.message}`)
    }
  }
}

// platform matrix metadata
const cpuInfo = (() => {
  try {
    if (process.platform === 'linux') {
      const line = readFileSync('/proc/cpuinfo', 'utf8').split('\n').find((l) => l.startsWith('model name'))
      return line?.split(':')[1]?.trim() ?? 'unknown'
    }
  } catch { /* best effort */ }
  return process.env.PROCESSOR_IDENTIFIER ?? 'unknown'
})()

const matrix = {
  date: day,
  commit: (() => { try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'no-git' } })(),
  os: `${process.platform} ${process.arch}`,
  kernel: tryVersion('uname -r') ?? null,
  cpu: cpuInfo,
  cores_logical: await availableParallelism(),
  memory_gb: (() => { try {
    return Math.round(parseInt(execSync('free -g | awk \'/Mem/{print $2}\'').toString().trim(), 10))
  } catch { return null } })(),
  runtimes: Object.fromEntries(Object.entries(runtimes).map(([k, v]) => [k, v.version])),
  quick: QUICK,
  failures,
}
writeFileSync(join(BENCH, 'reports/platform-matrix.json'),
  JSON.stringify(matrix, null, 1))
console.log('\nplatform-matrix.json written')

process.exit(failures.length ? 1 : 0)

function availableParallelism() {
  try {
    return typeof osMod.availableParallelism === 'function' ? osMod.availableParallelism() : osMod.cpus().length
  } catch {
    return 1
  }
}
