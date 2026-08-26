-- Canonical benchmark schema. Every language/ORM maps its models onto
-- these tables 1:1 (id, email, created_at, name) — no business logic.
-- Each identifier layout gets its own table so index characteristics are
-- measured independently (BENCHMARK_METHODOLOGY.md §8).

CREATE TABLE IF NOT EXISTS bench_uuid4 (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_uuid7 (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_ulid_char26 (
  id CHAR(26) PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_ulid_varchar26 (
  id VARCHAR(26) PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_binary16 (
  id BYTEA PRIMARY KEY CHECK (octet_length(id) = 16),
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL
);
