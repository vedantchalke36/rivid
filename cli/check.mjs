// rivid check — identifier governance scanner.
//
// Audits schemas, migrations and ORM models for identifier inconsistencies:
//   - UUIDs stored as VARCHAR/TEXT/CHAR(36) unnecessarily
//   - primary-key type drift across tables
//   - foreign-key / primary-key representation mismatches
//   - accidental ULID/UUID mixing (intentional mixes are policy-declarable)
//   - unbounded TEXT identifiers
//
// A project policy file (.rivid.yml or .rivid.json) declares intentional
// conventions so they are never flagged:
//
//   rivid:
//     database: uuidv7        # uuidv7 | ulid — expected PK representation
//     public_ids: ulid        # identifier family for *_public_id style columns
//     events: uuidv7
//     idempotency: random128
//     allow:
//       - table: legacy_users
//         column: id
//         reason: "frozen legacy schema"
//
// Exit codes: 0 = clean (warnings permitted), 1 = inconsistencies found,
// 2 = usage/IO error. `--strict` escalates warnings to failures.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname, sep } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'target', 'build', '.next', '.venv',
  'venv', '__pycache__', '.gradle', 'coverage', '.pytest_cache', 'pkg',
])
const SCAN_EXT = new Set([
  '.sql', '.prisma', '.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.yml', '.yaml',
])

// PostgreSQL/ORM column types that can hold a 128-bit identifier, mapped to
// a canonical representation name used throughout the report.
const SQL_TYPES = [
  { re: /\buuid\b/i, rep: 'uuid', width: 16 },
  { re: /\bbytea\b/i, rep: 'bytea(16)', width: 16 },
  { re: /\bchar\s*\(\s*36\s*\)/i, rep: 'char(36)', width: 36 },
  { re: /(?:var)?char\s*\(\s*36\s*\)/i, rep: 'varchar(36)', width: 36 },
  { re: /\bchar\s*\(\s*26\s*\)/i, rep: 'char(26)', width: 26 },
  { re: /(?:var)?char\s*\(\s*26\s*\)/i, rep: 'varchar(26)', width: 26 },
  { re: /\btext\b/i, rep: 'text', width: null },
  { re: /\bbigint\b|\bbigserial\b/i, rep: 'bigint', width: 8 },
]

/** Parse a minimal YAML subset: nested maps, scalar lists, inline strings. */
function parsePolicyYaml(text) {
  const root = {}
  const stack = [{ indent: -1, obj: root }]
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const line = rawLine.trim()
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop()
    const parent = stack.at(-1).obj
    const listMatch = line.match(/^-\s+(.*)$/)
    if (listMatch) {
      // List item — belongs to the most recent bare `key:` on the stack.
      let holder = null
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].lastKey) { holder = stack[i]; break }
      }
      if (holder) {
        const key = holder.lastKey
        if (!Array.isArray(holder.obj[key])) {
          // Placeholder from the bare `key:` line becomes the array.
          holder.obj[key] =
            holder.obj[key] && typeof holder.obj[key] === 'object' && Object.keys(holder.obj[key]).length === 0
              ? []
              : [holder.obj[key]]
        }
        const kv = listMatch[1].match(/^([\w][\w-]*):\s*(.*)$/)
        if (kv) {
          const item = {}
          item[kv[1]] = coerce(kv[2])
          holder.obj[key].push(item)
          stack.push({ indent: indent + 2, obj: item })
        } else {
          holder.obj[key].push(coerce(listMatch[1]))
        }
      }
      continue
    }
    const kv = line.match(/^([\w][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    if (value === '' || value === undefined) {
      parent[key] = {}
      stack.at(-1).lastKey = key
      stack.push({ indent, obj: parent[key] })
    } else {
      parent[key] = coerce(value)
      stack.at(-1).lastKey = key
    }
  }
  return root
}

function coerce(v) {
  const s = String(v).trim().replace(/^["']|["']$/g, '')
  if (s === 'true') return true
  if (s === 'false') return false
  return s
}

/** Load .rivid.yml / .rivid.json policy from the scan root (or ancestors). */
export function loadPolicy(root) {
  for (const name of ['.rivid.yml', '.rivid.yaml', '.rivid.json']) {
    const p = join(root, name)
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8')
        const parsed = name.endsWith('.json') ? JSON.parse(raw) : parsePolicyYaml(raw)
        return { config: parsed?.rivid ?? parsed ?? {}, path: p }
      } catch (e) {
        return { config: {}, path: p, error: `failed to parse ${name}: ${e.message}` }
      }
    }
  }
  return { config: {}, path: null }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract identifier columns from SQL DDL.
 * Returns [{ table, column, rep, pk, fk, file, line }]
 */
function extractSql(text, file) {
  const out = []
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([\w.]+)["`]?\s*\(([^;]+?)\);/gis
  for (const m of text.matchAll(tableRe)) {
    const table = m[1]
    const body = m[2]
    for (const rawLine of body.split(/\r?\n|\s*,\s*(?![^(]*\))/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('--')) continue
      const col = line.match(/^["`]?(\w+)["`]?\s+(.+)$/i)
      if (!col) continue
      const [, name, rest] = col
      if (!/\bprimary\s+key\b/i.test(rest) && !/^id$|_id$|_key$/i.test(name)) continue
      const fk = rest.match(/references\s+["`]?([\w.]+)["`]?\s*\(\s*["`]?(\w+)["`]?\s*\)/i)
      const type = SQL_TYPES.find((t) => t.re.test(rest))
      if (!type) continue
      out.push({
        table, column: name, rep: type.rep, width: type.width,
        pk: /\bprimary\s+key\b/i.test(rest),
        unique: /\bunique\b/i.test(rest),
        fk: fk ? { table: fk[1], column: fk[2] } : null,
        file, line: null,
      })
    }
  }
  return out
}

/** Extract identifier fields from a Prisma schema. */
function extractPrisma(text, file) {
  const out = []
  const modelRe = /^\s*model\s+(\w+)\s*\{([^}]*)}/gm
  for (const m of text.matchAll(modelRe)) {
    const table = m[1]
    for (const rawLine of m[2].split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const parts = line.split(/\s+/)
      if (parts.length < 2) continue
      const [name, type, ...attrs] = parts
      const attrStr = attrs.join(' ')
      const isId = /@id/.test(attrStr) || /^id$|_id$|_key$/i.test(name)
      if (!isId && !/@db\.(Uuid|Char)/i.test(attrStr)) continue
      let rep = null
      let width = null
      if (/@db\.Uuid/i.test(attrStr) || type === 'Uuid') { rep = 'uuid'; width = 16 }
      else if (/@db\.Char\s*\(\s*26\s*\)/i.test(attrStr)) { rep = 'char(26)'; width = 26 }
      else if (/@db\.Char\s*\(\s*36\s*\)/i.test(attrStr)) { rep = 'char(36)'; width = 36 }
      else if (type === 'String') { rep = 'text'; width = null }
      else if (type === 'Bytes') { rep = 'bytea(16)'; width = 16 }
      else if (type === 'BigInt') { rep = 'bigint'; width = 8 }
      if (!rep) continue
      const fk = /@relation/.test(attrStr) ? { table: null, column: name } : null
      out.push({ table, column: name, rep, width, pk: /@id/.test(attrStr), unique: /@unique/.test(attrStr), fk, file, line: null })
    }
  }
  return out
}

/** Extract identifier columns from Drizzle-style TypeScript schemas. */
function extractDrizzleTs(text, file) {
  const out = []
  const tableRe = /(pgTable|mysqlTable|sqliteTable)\s*\(\s*["'`](\w+)["'`]\s*,\s*\{([\s\S]*?)\n\s*\}/g
  for (const m of text.matchAll(tableRe)) {
    const table = m[2]
    const body = m[3]
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim()
      const col = line.match(/^(\w+)\s*:\s*(uuid|char|varchar|text|bytea)\s*\(\s*["'`](\w+)["'`](?:\s*,\s*(\{[^}]*\}))?\s*\)/i)
      if (!col) continue
      const [, propName, fn, colName, opts = ''] = col
      const isId = /\.primaryKey\(\)/.test(line) || /^id$|_id$|_key$/i.test(propName)
      if (!isId) continue
      let rep = null
      let width = null
      if (fn === 'uuid') { rep = 'uuid'; width = 16 }
      else if (fn === 'bytea') { rep = 'bytea(16)'; width = 16 }
      else if (fn === 'text') { rep = 'text'; width = null }
      else {
        const len = opts.match(/length\s*:\s*(\d+)/)
        const l = len ? Number(len[1]) : null
        if (l === 26) { rep = fn === 'char' ? 'char(26)' : 'varchar(26)'; width = 26 }
        else if (l === 36) { rep = fn === 'char' ? 'char(36)' : 'varchar(36)'; width = 36 }
        else { rep = `${fn}(?)`; width = l }
      }
      out.push({ table, column: colName, rep, width, pk: /\.primaryKey\(\)/.test(line), unique: /\.unique\(\)/.test(line), fk: null, file, line: null })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const UUIDLIKE = (rep) => rep === 'uuid' || rep === 'char(36)' || rep === 'varchar(36)'
const TEXTLIKE = (rep) => rep === 'text' || rep.startsWith('char(') || rep.startsWith('varchar(')

function classify(col, policy) {
  const name = col.column.toLowerCase()
  if (/(^|_)public_?id$/.test(name) || /^publicid$/i.test(col.column)) return policy.public_ids ?? 'ulid'
  if (/idempot/.test(name)) return policy.idempotency ?? 'random128'
  if (/event/.test(col.table.toLowerCase()) && policy.events) return policy.events
  return policy.database ?? null
}

/**
 * @param {Array} cols extracted identifier columns
 * @param {object} policy resolved rivid policy ({} when none)
 * @returns {{ findings: Array, summary: object }}
 */
export function analyze(cols, policy = {}) {
  const findings = []
  const allow = new Set((policy.allow ?? []).map((a) => `${a.table}.${a.column}`))
  const allowed = (c) => allow.has(`${c.table}.${c.column}`) || allow.has(`${c.table}.*`)

  const byTable = new Map()
  for (const c of cols) {
    if (!byTable.has(c.table)) byTable.set(c.table, [])
    byTable.get(c.table).push(c)
  }

  for (const c of cols) {
    if (allowed(c)) continue
    const family = classify(c, policy)

    // 1. UUID semantics forced into a text column.
    if (family === 'uuidv7' && TEXTLIKE(c.rep)) {
      findings.push({
        severity: c.rep === 'text' ? 'error' : 'warning',
        rule: 'uuid-as-text',
        message: `${c.table}.${c.column}: expected uuid storage, found ${c.rep}`,
        detail: c.rep === 'text'
          ? 'unbounded text with no explicit width — declare uuid (16 bytes) or an explicit char(36)'
          : `char(36) costs 2.25× the 16-byte native uuid — use the uuid type`,
        column: c,
      })
    }

    // 2. Unbounded text identifiers.
    if (TEXTLIKE(c.rep) && c.rep === 'text') {
      findings.push({
        severity: 'warning',
        rule: 'unbounded-text-id',
        message: `${c.table}.${c.column}: identifier declared as unbounded TEXT`,
        detail: 'prefer uuid, char(26) (ULID) or char(36) — unbounded text hides intent and cost',
        column: c,
      })
    }

    // 3. Policy-declared family drift.
    if (family === 'ulid' && UUIDLIKE(c.rep) && policy.database === 'ulid') {
      findings.push({
        severity: 'warning',
        rule: 'ulid-as-uuid',
        message: `${c.table}.${c.column}: policy expects ULID, found ${c.rep}`,
        detail: 'ULID-as-uuid is valid binary reinterpretation — flag only if unintentional (declare in policy.allow to silence)',
        column: c,
      })
    }
  }

  // 4. FK → PK representation mismatches.
  const byKey = new Map(cols.map((c) => [`${c.table}.${c.column}`, c]))
  for (const c of cols) {
    if (!c.fk || allowed(c)) continue
    const target = c.fk.table && byKey.get(`${c.fk.table}.${c.fk.column}`)
    if (!target || allowed(target)) continue
    if (target.rep !== c.rep) {
      findings.push({
        severity: 'error',
        rule: 'fk-mismatch',
        message: `${c.table}.${c.column}: ${c.rep} references ${target.table}.${target.column}: ${target.rep}`,
        detail: 'foreign key and referenced key should share one representation',
        column: c,
      })
    }
  }

  // 5. Primary-key representation drift across tables (only with a policy).
  if (policy.database) {
    const pkReps = new Map()
    for (const c of cols) {
      if (!c.pk || allowed(c)) continue
      const family = classify(c, policy)
      if (family !== policy.database) continue // intentional per-column policy
      const bucket = UUIDLIKE(c.rep) ? 'uuid-like' : TEXTLIKE(c.rep) ? 'text-like' : c.rep
      pkReps.set(c.table, bucket)
    }
    const distinct = [...new Set(pkReps.values())]
    if (distinct.length > 1) {
      const offenders = [...pkReps.entries()].filter(([, r]) => r !== distinct[0])
      findings.push({
        severity: 'warning',
        rule: 'pk-drift',
        message: `primary keys mix ${distinct.join(' and ')} across tables`,
        detail: `e.g. ${offenders.map(([t, r]) => `${t}: ${r}`).join(', ')} — pick one representation or declare intent in .rivid.yml`,
        column: null,
      })
    }
  }

  const summary = {
    identifiers: cols.length,
    byRep: {},
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  }
  for (const c of cols) summary.byRep[c.rep] = (summary.byRep[c.rep] ?? 0) + 1
  return { findings, summary }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, files)
    else if (SCAN_EXT.has(extname(name))) files.push(p)
  }
  return files
}

/** Extract identifier columns from every supported file under `root`. */
export function extractAll(root) {
  const cols = []
  let scanned = 0
  for (const file of walk(root)) {
    if (file.includes(`${sep}integrations${sep}`) || file.includes(`${sep}benchmarks${sep}`)) continue
    scanned++
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = relative(root, file)
    if (extname(file) === '.sql') cols.push(...extractSql(text, rel))
    else if (extname(file) === '.prisma') cols.push(...extractPrisma(text, rel))
    else if (['.ts', '.mts', '.tsx'].includes(extname(file)) && /pgTable|mysqlTable|sqliteTable/.test(text)) {
      cols.push(...extractDrizzleTs(text, rel))
    }
  }
  return { cols, scanned }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runCheck(args, root = process.cwd()) {
  const json = args.includes('--json')
  const strict = args.includes('--strict')
  const paths = args.filter((a) => !a.startsWith('--'))
  const scanRoot = paths[0] ?? root

  const { config: policy, path: policyPath, error: policyError } = loadPolicy(scanRoot)
  if (policyError) {
    console.error(`rivid check: ${policyError}`)
    return 2
  }
  if (!existsSync(scanRoot)) {
    console.error(`rivid check: path not found: ${scanRoot}`)
    return 2
  }

  const { cols, scanned } = extractAll(scanRoot)
  const { findings, summary } = analyze(cols, policy)

  if (json) {
    console.log(JSON.stringify({
      tool: 'rivid check',
      policy: policyPath,
      filesScanned: scanned,
      summary,
      findings: findings.map((f) => ({
        severity: f.severity,
        rule: f.rule,
        message: f.message,
        detail: f.detail,
        file: f.column?.file ?? null,
      })),
    }, null, 2))
  } else {
    if (policyPath) console.log(`policy: ${relative(scanRoot, policyPath) || policyPath}`)
    console.log(`✓ ${summary.identifiers} identifiers analyzed across ${scanned} files`)
    for (const [rep, n] of Object.entries(summary.byRep).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)} × ${rep}`)
    }
    if (findings.length === 0) {
      console.log('✓ no inconsistencies found')
    } else {
      console.log('')
      for (const f of findings) {
        const icon = f.severity === 'error' ? '✗' : '⚠'
        console.log(`${icon} ${f.message}`)
        if (f.column?.file) console.log(`    at ${f.column.file}`)
        console.log(`    ${f.detail}`)
      }
    }
  }

  // GitHub Actions annotations (rendered inline on the PR diff).
  if (process.env.GITHUB_ACTIONS === 'true' && !json) {
    for (const f of findings) {
      const cmd = f.severity === 'error' ? 'error' : 'warning'
      const file = f.column?.file ? `file=${f.column.file},` : ''
      console.log(`::${cmd} ${file}title=rivid check (${f.rule})::${f.message}`)
    }
  }

  const failures = summary.errors + (strict ? summary.warnings : 0)
  return failures > 0 ? 1 : 0
}
