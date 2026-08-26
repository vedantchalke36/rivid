// database/sql baseline integration (pgx stdlib driver over PostgreSQL).
//
// HONESTY NOTE: no rivid-go binding exists yet, so ID *generation* here uses
// oklog/ulid v2 (same 128-bit layout). These tests validate the persistence
// layer (schema, ordering, pagination, transactions) that ANY generator must
// pass. Swap `newULID()` for the future rivid-go call without touching tests.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	oklog "github.com/oklog/ulid/v2"
)

func dsn() string {
	if s := os.Getenv("DATABASE_URL"); s != "" {
		return s
	}
	return "postgres://postgres:bench@localhost:54329/ids?sslmode=disable"
}

func newULID(t time.Time) string {
	return oklog.MustNew(oklog.Timestamp(t), rand.Reader).String()
}

func setupDB(b testing.TB) *sql.DB {
	db, err := sql.Open("pgx", dsn())
	if err != nil {
		b.Fatal(err)
	}
	mustExec(db, `CREATE TABLE IF NOT EXISTS users_ulid (
		id CHAR(26) PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
	return db
}

func mustExec(db *sql.DB, q string, args ...any) sql.Result {
	r, err := db.Exec(q, args...)
	if err != nil {
		panic(fmt.Sprintf("%s: %v", q, err))
	}
	return r
}

// ── correctness gate ─────────────────────────────────────────────────────

func TestCorrectnessAndCRUD(t *testing.T) {
	db := setupDB(t)
	defer db.Close()

	id := newULID(time.Now())
	if len(id) != 26 {
		t.Fatalf("bad length %d", len(id))
	}
	// insert / fetch / update / delete round trip
	mustExec(db, `INSERT INTO users_ulid (id,email,name) VALUES ($1,$2,$3)`,
		id, "crud@x.io", "CRUD")
	var got string
	if err := db.QueryRow(`SELECT id FROM users_ulid WHERE id=$1`, id).Scan(&got); err != nil || got != id {
		t.Fatalf("fetch mismatch: %v %q", err, got)
	}
	mustExec(db, `UPDATE users_ulid SET name='CRUD2' WHERE id=$1`, id)
	mustExec(db, `DELETE FROM users_ulid WHERE id=$1`, id)
	err := db.QueryRow(`SELECT id FROM users_ulid WHERE id=$1`, id).Scan(&got)
	if err != sql.ErrNoRows {
		t.Fatalf("delete failed: %v", err)
	}

	// uniqueness at scale within one process
	seen := make(map[string]struct{}, 10000)
	for i := 0; i < 10_000; i++ {
		u := newULID(time.Now())
		if _, dup := seen[u]; dup {
			t.Fatal("collision")
		}
		seen[u] = struct{}{}
	}
}

func TestOrderingRangeKeyset(t *testing.T) {
	db := setupDB(t)
	defer db.Close()
	ctx := context.Background()

	const N = 2000
	tx, _ := db.BeginTx(ctx, nil)
	base := time.Now()
	stmt, _ := tx.Prepare(`INSERT INTO users_ulid (id,email,name) VALUES ($1,$2,$3)`)
	ids := make([]string, N)
	for i := 0; i < N; i++ {
		ids[i] = newULID(base.Add(time.Duration(i)*time.Millisecond))
		if _, err := stmt.Exec(ids[i], fmt.Sprintf("o%d@x.io", i), "O"); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	rows, err := db.Query(`SELECT id FROM users_ulid WHERE email LIKE 'o%@x.io' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		got = append(got, id)
	}
	for i := range ids {
		if got[i] != ids[i] {
			t.Fatalf("ORDER BY mismatch at %d", i)
		}
	}

	// keyset pagination, page size 500, verify count + no dupes
	cursor := ""
	total, uniq := 0, map[string]bool{}
	for {
		q := `SELECT id FROM users_ulid WHERE email LIKE 'o%@x.io' AND ($1='' OR id>$1) ORDER BY id LIMIT 500`
		rows, err := db.Query(q, cursor)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			uniq[id] = true
			cursor = id
			n++
			total++
		}
		rows.Close()
		if n == 0 {
			break
		}
	}
	if total != N || len(uniq) != N {
		t.Fatalf("pagination total=%d uniq=%d want %d", total, len(uniq), N)
	}
	cleanup(db)
}

func TestTransactionRollback(t *testing.T) {
	db := setupDB(t)
	defer db.Close()
	tx, _ := db.Begin()
	_, _ = tx.Exec(`INSERT INTO users_ulid (id,email,name) VALUES ($1,'rb@x.io','RB')`, newULID(time.Now()))
	_ = tx.Rollback()
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM users_ulid WHERE email='rb@x.io'`).Scan(&n)
	if n != 0 {
		t.Fatalf("rollback leaked %d rows", n)
	}
}

// pool smoke: pgxpool with max conns recorded (§12 metadata)
func TestPoolConfig(t *testing.T) {
	cfg, err := pgxpool.ParseConfig(dsn())
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if pool.Stat().MaxConns() != 4 {
		t.Fatalf("max conns %d", pool.Stat().MaxConns())
	}
	cleanup(setupDB(t))
}

func cleanup(db *sql.DB) {
	mustExec(db, `DELETE FROM users_ulid WHERE email LIKE '%@x.io'`)
}
