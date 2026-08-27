/**
 * rivid check — CLI governance scanner tests.
 *
 * Exercises SQL/Prisma/Drizzle extraction, policy handling, FK mismatch and
 * json output by running the CLI against temp fixtures.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const CLI = fileURLToPath(new URL('../cli/rivid.mjs', import.meta.url))

function fixture() {
  return mkdtempSync(join(tmpdir(), 'rivid-check-'))
}

/** Run `rivid check` in `dir`; resolves { stdout, json?, code } never rejects. */
async function run(dir: string, ...args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await exec(process.execPath, [CLI, 'check', dir, ...args], { encoding: 'utf8' })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; code?: number }
    return { stdout: e.stdout ?? '', code: e.code ?? 1 }
  }
}

interface Finding {
  severity: 'error' | 'warning'
  rule: string
  message: string
}

interface CheckReport {
  tool: string
  policy: string | null
  filesScanned: number
  summary: { identifiers: number; errors: number; warnings: number; byRep: Record<string, number> }
  findings: Finding[]
}

test('check: clean SQL schema passes with exit 0', async () => {
  const dir = fixture()
  try {
    writeFileSync(
      join(dir, 'schema.sql'),
      `CREATE TABLE users (
          id uuid PRIMARY KEY,
          email text NOT NULL
        );
        CREATE TABLE orders (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id)
        );`,
    )
    const { stdout, code } = await run(dir)
    assert.match(stdout, /identifiers analyzed/)
    assert.match(stdout, /no inconsistencies found/)
    assert.equal(code, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: flags unbounded-text id and fk mismatch, exit 1', async () => {
  const dir = fixture()
  try {
    writeFileSync(
      join(dir, 'schema.sql'),
      `CREATE TABLE users (
          id uuid PRIMARY KEY
        );
        CREATE TABLE events (
          id uuid PRIMARY KEY,
          user_id char(36) REFERENCES users(id)
        );
        CREATE TABLE legacy (
          id text PRIMARY KEY
        );`,
    )
    const { stdout, code } = await run(dir)
    assert.match(stdout, /references users\.id/)
    assert.match(stdout, /unbounded TEXT/i)
    assert.equal(code, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: --json emits machine-readable report', async () => {
  const dir = fixture()
  try {
    writeFileSync(join(dir, 'schema.sql'), 'CREATE TABLE t (id text PRIMARY KEY);')
    const { stdout } = await run(dir, '--json')
    const report = JSON.parse(stdout) as CheckReport
    assert.equal(report.tool, 'rivid check')
    assert.equal(typeof report.summary.identifiers, 'number')
    assert.ok(Array.isArray(report.findings))
    assert.ok(report.findings.some((f: Finding) => f.rule === 'unbounded-text-id'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: .rivid.yml policy declares intentional mixed conventions', async () => {
  const dir = fixture()
  try {
    writeFileSync(
      join(dir, 'schema.sql'),
      `CREATE TABLE users (id uuid PRIMARY KEY);
       CREATE TABLE public_profiles (public_id char(26) PRIMARY KEY);`,
    )
    writeFileSync(
      join(dir, '.rivid.yml'),
      `rivid:
  database: uuidv7
  public_ids: ulid
  allow:
    - table: public_profiles
      column: public_id
      reason: intentional
`,
    )
    const { stdout, code } = await run(dir, '--json')
    const report = JSON.parse(stdout) as CheckReport
    assert.equal(report.summary.errors, 0)
    assert.equal(report.summary.warnings, 0)
    assert.equal(code, 0)
    assert.ok(report.policy)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: pk-drift warning when policy declares a single family', async () => {
  const dir = fixture()
  try {
    writeFileSync(
      join(dir, 'schema.sql'),
      `CREATE TABLE users (id uuid PRIMARY KEY);
       CREATE TABLE orders (id char(26) PRIMARY KEY);`,
    )
    writeFileSync(join(dir, '.rivid.yml'), 'rivid:\n  database: uuidv7\n')
    const { stdout, code } = await run(dir)
    assert.match(stdout, /mix uuid-like and text-like/)
    assert.equal(code, 0) // warnings alone do not fail the run
    assert.equal((await run(dir, '--strict')).code, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: prisma schema extraction and uuid-as-text detection', async () => {
  const dir = fixture()
  try {
    writeFileSync(
      join(dir, 'schema.prisma'),
      `model User {
        id String @id @db.Uuid
      }
      model Session {
        id String @id @db.Char(36)
        userId String @db.Uuid
      }`,
    )
    writeFileSync(join(dir, '.rivid.yml'), 'rivid:\n  database: uuidv7\n')
    const { stdout } = await run(dir, '--json')
    const report = JSON.parse(stdout) as CheckReport
    assert.ok(report.summary.identifiers >= 2)
    assert.ok(report.findings.some((f: Finding) => f.rule === 'uuid-as-text'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: drizzle ts schema extraction', async () => {
  const dir = fixture()
  try {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'src', 'schema.ts'),
      `import { pgTable, uuid, char } from 'drizzle-orm/pg-core'
       export const users = pgTable('users', {
         id: uuid('id').primaryKey(),
       })
       export const tokens = pgTable('tokens', {
         id: char('id', { length: 26 }).primaryKey(),
       })`,
    )
    const { stdout } = await run(dir, '--json')
    const report = JSON.parse(stdout) as CheckReport
    assert.ok(report.summary.identifiers >= 2)
    assert.ok((report.summary.byRep['char(26)'] ?? 0) >= 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check: missing path exits 2', async () => {
  const { code } = await run('/nonexistent/rivid-check-path-xyz')
  assert.equal(code, 2)
})
