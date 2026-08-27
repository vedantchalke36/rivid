# CLI — `rivid`

Ships with the `@rivid/core` npm package (`npx rivid …`) or run from a
checkout with `node cli/rivid.mjs`.

## Commands

| Command | Description |
|---|---|
| `rivid ulid [--count N] [--monotonic] [--json]` | Generate ULIDs (default 1) |
| `rivid uuidv7 [--count N] [--json]` | Generate UUIDv7s |
| `rivid bytes16` | One raw ULID as 32 hex chars |
| `rivid decode <ulid>` | Timestamp (ms + ISO), hex bytes, UUID form |
| `rivid validate <ulid>...` | Exit 0 if all valid; invalid ones listed on stderr |
| `rivid check [path] [--json] [--strict]` | Identifier governance audit (see below) |
| `rivid benchmark [--quick]` | Run the benchmark suite (repo checkout only) |
| `rivid version` | Print package version |

`--count` accepts 1–100,000,000. Every command exits non-zero on invalid
input; `--json` produces machine-readable output.

## Identifier governance — `rivid check`

Scans SQL DDL (`*.sql`), Prisma schemas (`*.prisma`), and Drizzle/ORM table
definitions (`*.ts`) for identifier inconsistencies:

- UUID semantics stored in `TEXT`/`VARCHAR`/`CHAR(36)` columns
- Unbounded `TEXT` identifier columns
- Foreign-key / primary-key representation mismatches
- Primary-key representation drift across tables (with a policy)
- Accidental ULID/UUID mixing

Intentional conventions are declared in `.rivid.yml` / `.rivid.json` at the
scan root and are never flagged:

```yaml
rivid:
  database: uuidv7       # expected primary-key family (uuidv7 | ulid)
  public_ids: ulid       # family for public-id style columns
  events: uuidv7
  idempotency: random128
  allow:
    - table: legacy_users
      column: id
      reason: "frozen legacy schema"
```

Output modes and flags:

```bash
rivid check                # human-readable summary + findings
rivid check path/to/schema # scan a subdirectory
rivid check --json         # machine-readable report on stdout
rivid check --strict       # warnings also fail (exit 1)
```

Exit codes: `0` clean · `1` findings (errors, or warnings under `--strict`) ·
`2` usage/IO error.

### GitHub Actions

The composite action at [`.github/actions/rivid-check`](../.github/actions/rivid-check)
installs the CLI, runs `rivid check`, and converts findings into inline PR
annotations (`::error` / `::warning` with file locations). It never modifies
files.

```yaml
- uses: vedantchalke36/rivid/.github/actions/rivid-check@main
  with:
    path: .
    strict: false
```
