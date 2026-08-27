/**
 * Comprehensive PostgreSQL Storage Representation Benchmark
 *
 * Compares:
 *   1. UUIDv7 stored as native uuid (16 bytes)
 *   2. UUIDv7 stored as CHAR(36) (36 bytes text)
 *   3. ULID stored as native uuid via reinterpretation (16 bytes)
 *   4. ULID stored as CHAR(26) (26 bytes text)
 *   5. ULID stored as VARCHAR(26) (26 bytes text, variable storage)
 *   6. ULID stored as BYTEA (16 bytes binary)
 *
 * Measures:
 *   - Insert throughput (100K, 1M, 10M rows)
 *   - Table size + index size
 *   - Point lookup latency
 *   - Range query latency
 *   - ORDER BY performance
 *   - Keyset pagination
 *   - Concurrent inserts (10, 50, 100 workers)
 */
import pg from 'pg';
import { ulid, uuidv7, toUuid, uuidv7Bytes, ulidBytes } from '../src/index.ts';

const { Client } = pg;

const CFG = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'bench',
  database: process.env.PGDATABASE ?? 'ids',
};

const BATCH_SIZE = 10_000;

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

const SCHEMAS = {
  uuidv7_native: {
    name: 'UUIDv7 as native uuid',
    create: `
      CREATE TABLE IF NOT EXISTS bench_uuidv7_native (
        id uuid PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => uuidv7(),
    formatParam: (id: string) => id,
  },
  uuidv7_char36: {
    name: 'UUIDv7 as CHAR(36)',
    create: `
      CREATE TABLE IF NOT EXISTS bench_uuidv7_char36 (
        id char(36) PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => uuidv7(),
    formatParam: (id: string) => id,
  },
  ulid_native_uuid: {
    name: 'ULID as native uuid (reinterpret)',
    create: `
      CREATE TABLE IF NOT EXISTS bench_ulid_native_uuid (
        id uuid PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => toUuid(ulid()),
    formatParam: (id: string) => id,
  },
  ulid_char26: {
    name: 'ULID as CHAR(26)',
    create: `
      CREATE TABLE IF NOT EXISTS bench_ulid_char26 (
        id char(26) PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => ulid(),
    formatParam: (id: string) => id,
  },
  ulid_varchar26: {
    name: 'ULID as VARCHAR(26)',
    create: `
      CREATE TABLE IF NOT EXISTS bench_ulid_varchar26 (
        id varchar(26) PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => ulid(),
    formatParam: (id: string) => id,
  },
  ulid_bytea: {
    name: 'ULID as BYTEA (16 bytes)',
    create: `
      CREATE TABLE IF NOT EXISTS bench_ulid_bytea (
        id bytea PRIMARY KEY,
        payload text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    insertCols: 'id, payload',
    genId: () => Buffer.from(ulidBytes()),
    formatParam: (buf: Buffer) => buf,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dropTables(client: pg.Client) {
  for (const key of Object.keys(SCHEMAS)) {
    const table = `bench_${key}`;
    await client.query(`DROP TABLE IF EXISTS ${table}`);
  }
}

async function getTableSize(client: pg.Client, table: string) {
  const r = await client.query(
    `SELECT pg_size_pretty(pg_total_relation_size($1)) as total,
            pg_size_pretty(pg_relation_size($1)) as table_size,
            pg_size_pretty(pg_indexes_size($1)) as index_size,
            pg_total_relation_size($1) as total_bytes,
            pg_relation_size($1) as table_bytes,
            pg_indexes_size($1) as index_bytes`,
    [table],
  );
  return r.rows[0];
}

async function createIndex(client: pg.Client, table: string) {
  await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_created ON ${table} (created_at)`);
}

async function getRowCount(client: pg.Client, table: string) {
  const r = await client.query(`SELECT count(*)::int as n FROM ${table}`);
  return r.rows[0].n;
}

// ---------------------------------------------------------------------------
// Insert benchmark
// ---------------------------------------------------------------------------

async function benchInsert(
  client: pg.Client,
  schema: (typeof SCHEMAS)[keyof typeof SCHEMAS],
  rowCount: number,
): Promise<{ ms: number; rowsPerSec: number }> {
  const table = `bench_${Object.keys(SCHEMAS).find(k => (SCHEMAS as Record<string, typeof schema>)[k] === schema)}`;

  // Generate all IDs upfront (measures ID generation separately)
  const ids: any[] = [];
  const genStart = performance.now();
  for (let i = 0; i < rowCount; i++) {
    ids.push(schema.genId());
  }
  const genMs = performance.now() - genStart;

  // Batch insert
  const insertStart = performance.now();
  const batchSize = BATCH_SIZE;
  for (let i = 0; i < rowCount; i += batchSize) {
    const end = Math.min(i + batchSize, rowCount);
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (let j = i; j < end; j++) {
      placeholders.push(`($${idx}, $${idx + 1})`);
      values.push(schema.formatParam(ids[j]), `payload_${j}`);
      idx += 2;
    }
    await client.query(
      `INSERT INTO ${table} (${schema.insertCols}) VALUES ${placeholders.join(', ')}`,
      values,
    );
  }
  const insertMs = performance.now() - insertStart;

  const rowsPerSec = Math.round((rowCount / insertMs) * 1000);
  return { ms: Math.round(insertMs), rowsPerSec };
}

// ---------------------------------------------------------------------------
// Point lookup benchmark
// ---------------------------------------------------------------------------

async function benchPointLookup(
  client: pg.Client,
  table: string,
  count: number = 1000,
): Promise<{ avgUs: number; p50Us: number; p95Us: number; p99Us: number }> {
  // Get random IDs to look up
  const r = await client.query(
    `SELECT id FROM ${table} ORDER BY random() LIMIT $1`,
    [count],
  );
  const ids = r.rows.map((row: any) => row.id);

  const latencies: number[] = [];
  for (const id of ids) {
    const start = performance.now();
    await client.query(`SELECT payload FROM ${table} WHERE id = $1`, [id]);
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  return {
    avgUs: Math.round(avg * 1000),
    p50Us: Math.round((latencies[Math.floor(count * 0.5)] ?? 0) * 1000),
    p95Us: Math.round((latencies[Math.floor(count * 0.95)] ?? 0) * 1000),
    p99Us: Math.round((latencies[Math.floor(count * 0.99)] ?? 0) * 1000),
  };
}

// ---------------------------------------------------------------------------
// Range query benchmark (ORDER BY id, LIMIT 100)
// ---------------------------------------------------------------------------

async function benchRangeQuery(
  client: pg.Client,
  table: string,
  count: number = 200,
): Promise<{ avgUs: number; p50Us: number; p95Us: number }> {
  const latencies: number[] = [];
  for (let i = 0; i < count; i++) {
    // Random starting point
    const r = await client.query(
      `SELECT id FROM ${table} ORDER BY random() LIMIT 1`,
    );
    const startId = r.rows[0].id;

    const start = performance.now();
    await client.query(
      `SELECT id, payload FROM ${table} WHERE id > $1 ORDER BY id LIMIT 100`,
      [startId],
    );
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  return {
    avgUs: Math.round(avg * 1000),
    p50Us: Math.round((latencies[Math.floor(count * 0.5)] ?? 0) * 1000),
    p95Us: Math.round((latencies[Math.floor(count * 0.95)] ?? 0) * 1000),
  };
}

// ---------------------------------------------------------------------------
// Keyset pagination benchmark
// ---------------------------------------------------------------------------

async function benchKeysetPagination(
  client: pg.Client,
  table: string,
  pageSize: number = 100,
): Promise<{ totalPages: number; avgMsPerPage: number; totalMs: number }> {
  let cursor = '';
  let totalPages = 0;
  const pageLatencies: number[] = [];

  const start = performance.now();
  for (;;) {
    const pageStart = performance.now();
    let r;
    if (cursor) {
      r = await client.query(
        `SELECT id FROM ${table} WHERE id > $1 ORDER BY id LIMIT ${pageSize}`,
        [cursor],
      );
    } else {
      r = await client.query(
        `SELECT id FROM ${table} ORDER BY id LIMIT ${pageSize}`,
      );
    }
    pageLatencies.push(performance.now() - pageStart);

    if (r.rows.length === 0) break;
    cursor = r.rows[r.rows.length - 1].id;
    totalPages++;
  }
  const totalMs = performance.now() - start;

  return {
    totalPages,
    avgMsPerPage: Math.round(totalMs / totalPages),
    totalMs: Math.round(totalMs),
  };
}

// ---------------------------------------------------------------------------
// Concurrent insert benchmark
// ---------------------------------------------------------------------------

async function benchConcurrentInsert(
  client: pg.Client,
  table: string,
  schema: (typeof SCHEMAS)[keyof typeof SCHEMAS],
  totalRows: number,
  workers: number,
): Promise<{ ms: number; rowsPerSec: number }> {
  const rowsPerWorker = Math.floor(totalRows / workers);
  const insertStart = performance.now();

  const workerPromises = Array.from({ length: workers }, async (_, workerIdx) => {
    // Each worker gets its own client
    const workerClient = new Client(CFG);
    await workerClient.connect();
    try {
      for (let i = 0; i < rowsPerWorker; i += BATCH_SIZE) {
        const end = Math.min(i + BATCH_SIZE, rowsPerWorker);
        const values: any[] = [];
        const placeholders: string[] = [];
        let idx = 1;
        for (let j = i; j < end; j++) {
          placeholders.push(`($${idx}, $${idx + 1})`);
          const id: any = schema.genId();
          values.push(schema.formatParam(id), `w${workerIdx}_p${j}`);
          idx += 2;
        }
        await workerClient.query(
          `INSERT INTO ${table} (${schema.insertCols}) VALUES ${placeholders.join(', ')}`,
          values,
        );
      }
    } finally {
      await workerClient.end();
    }
  });

  await Promise.all(workerPromises);
  const insertMs = performance.now() - insertStart;
  const rowsPerSec = Math.round((totalRows / insertMs) * 1000);
  return { ms: Math.round(insertMs), rowsPerSec };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = new Client(CFG);
  await client.connect();

  const ROW_COUNTS = [100_000, 1_000_000, 10_000_000];
  const CONCURRENT_WORKERS = [1, 10, 50, 100];

  console.log('# PostgreSQL Storage Representation Benchmark');
  console.log(`# Date: ${new Date().toISOString()}`);
  console.log(`# PostgreSQL: 16.4-alpine`);
  console.log(`# Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Drop and recreate all tables
  console.log('## Setup');
  await dropTables(client);
  for (const schema of Object.values(SCHEMAS)) {
    await client.query(schema.create);
  }
  console.log('Tables created.');
  console.log('');

  // =========================================================================
  // INSERT BENCHMARK
  // =========================================================================
  console.log('## Insert Throughput');
  console.log('');
  console.log('| Rows | Representation | Insert (ms) | rows/sec | Table Size | Index Size | Total |');
  console.log('|-----:|:---------------|------------:|---------:|:-----------|:-----------|:------|');

  for (const rowCount of ROW_COUNTS) {
    for (const [key, schema] of Object.entries(SCHEMAS)) {
      const table = `bench_${key}`;
      const result = await benchInsert(client, schema, rowCount);
      await createIndex(client, table);
      const sizes = await getTableSize(client, table);
      console.log(
        `| ${rowCount.toLocaleString()} | ${schema.name} | ${result.ms.toLocaleString()} | ${result.rowsPerSec.toLocaleString()} | ${sizes.table_size} | ${sizes.index_size} | ${sizes.total} |`,
      );
    }
    console.log('');
  }

  // =========================================================================
  // POINT LOOKUP BENCHMARK
  // =========================================================================
  console.log('## Point Lookup (1000 random PK lookups)');
  console.log('');
  console.log('| Representation | avg (µs) | p50 (µs) | p95 (µs) | p99 (µs) |');
  console.log('|:---------------|---------:|---------:|---------:|---------:|');

  for (const [key, schema] of Object.entries(SCHEMAS)) {
    const table = `bench_${key}`;
    const result = await benchPointLookup(client, table);
    console.log(
      `| ${schema.name} | ${result.avgUs} | ${result.p50Us} | ${result.p95Us} | ${result.p99Us} |`,
    );
  }
  console.log('');

  // =========================================================================
  // RANGE QUERY BENCHMARK
  // =========================================================================
  console.log('## Range Query (WHERE id > x ORDER BY id LIMIT 100)');
  console.log('');
  console.log('| Representation | avg (µs) | p50 (µs) | p95 (µs) |');
  console.log('|:---------------|---------:|---------:|---------:|');

  for (const [key, schema] of Object.entries(SCHEMAS)) {
    const table = `bench_${key}`;
    const result = await benchRangeQuery(client, table);
    console.log(
      `| ${schema.name} | ${result.avgUs} | ${result.p50Us} | ${result.p95Us} |`,
    );
  }
  console.log('');

  // =========================================================================
  // KEYSET PAGINATION BENCHMARK
  // =========================================================================
  console.log('## Keyset Pagination (page size 100)');
  console.log('');
  console.log('| Representation | Total Pages | Avg ms/page | Total ms |');
  console.log('|:---------------|------------:|------------:|---------:|');

  for (const [key, schema] of Object.entries(SCHEMAS)) {
    const table = `bench_${key}`;
    const result = await benchKeysetPagination(client, table);
    console.log(
      `| ${schema.name} | ${result.totalPages.toLocaleString()} | ${result.avgMsPerPage} | ${result.totalMs.toLocaleString()} |`,
    );
  }
  console.log('');

  // =========================================================================
  // CONCURRENT INSERT BENCHMARK
  // =========================================================================
  console.log('## Concurrent Insert (1M rows)');
  console.log('');
  console.log('| Workers | Representation | Insert (ms) | rows/sec |');
  console.log('|--------:|:---------------|------------:|---------:|');

  // Only test with 1M rows for concurrent
  for (const workers of CONCURRENT_WORKERS) {
    for (const [key, schema] of Object.entries(SCHEMAS)) {
      const table = `bench_${key}`;
      // Clear table first
      await client.query(`DELETE FROM ${table}`);
      const result = await benchConcurrentInsert(client, table, schema, 1_000_000, workers);
      console.log(
        `| ${workers} | ${schema.name} | ${result.ms.toLocaleString()} | ${result.rowsPerSec.toLocaleString()} |`,
      );
    }
    console.log('');
  }

  // =========================================================================
  // STORAGE ANALYSIS
  // =========================================================================
  console.log('## Storage Analysis (10M rows)');
  console.log('');
  console.log('| Representation | Bytes/row | Table GB | Index GB | Total GB | vs UUID native |');
  console.log('|:---------------|----------:|---------:|---------:|---------:|---------------:|');

  // Get sizes for the 10M row tables (last iteration)
  let baselineTotal = 0;
  for (const [key, schema] of Object.entries(SCHEMAS)) {
    const table = `bench_${key}`;
    const sizes = await getTableSize(client, table);
    const rowCount = await getRowCount(client, table);
    const bytesPerRow = Math.round(sizes.total_bytes / rowCount);
    const tableGB = (sizes.table_bytes / (1024 ** 3)).toFixed(3);
    const indexGB = (sizes.index_bytes / (1024 ** 3)).toFixed(3);
    const totalGB = (sizes.total_bytes / (1024 ** 3)).toFixed(3);
    if (key === 'uuidv7_native') baselineTotal = sizes.total_bytes;
    const ratio = baselineTotal > 0 ? ((sizes.total_bytes / baselineTotal) * 100 - 100).toFixed(1) : '0.0';
    console.log(
      `| ${schema.name} | ${bytesPerRow.toLocaleString()} | ${tableGB} | ${indexGB} | ${totalGB} | +${ratio}% |`,
    );
  }
  console.log('');

  // Cleanup
  await dropTables(client);
  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
