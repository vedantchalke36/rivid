//! SQLx + rivid-core integration: ULID primary keys on PostgreSQL.
//!
//! This is the genuine-Rivid Rust path — IDs come straight from
//! `rivid_core::ulid::generate()` (same engine as the npm package).
//! SQLx is a compile-checked SQL toolkit, not an ORM; it forms the
//! baseline layer under Diesel/SeaORM comparisons.

use rivid_core::ulid;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;

async fn pool() -> sqlx::PgPool {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:bench@localhost:54329/ids".into());
    PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .expect("connect")
}

async fn ensure_schema(p: &sqlx::PgPool) {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users_rs_ulid (
            id CHAR(26) PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    )
    .execute(p)
    .await
    .unwrap();
}

#[tokio::test]
async fn crud_round_trip_with_rivid_ids() {
    let p = pool().await;
    ensure_schema(&p).await;

    // mode A: application-generated via the real Rivid engine
    let id = ulid::generate();
    assert_eq!(id.len(), 26);
    assert!(ulid::is_valid(id.as_bytes()));

    sqlx::query("INSERT INTO users_rs_ulid (id,email,name) VALUES ($1,$2,$3)")
        .bind(&id)
        .bind("crud@x.io")
        .bind("CRUD")
        .execute(&p)
        .await
        .unwrap();

    let got: String = sqlx::query("SELECT id FROM users_rs_ulid WHERE id = $1")
        .bind(&id)
        .fetch_one(&p)
        .await
        .unwrap()
        .get(0);
    assert_eq!(got, id);

    // update + delete by PK
    sqlx::query("UPDATE users_rs_ulid SET name='CRUD2' WHERE id=$1")
        .bind(&id)
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users_rs_ulid WHERE id=$1")
        .bind(&id)
        .execute(&p)
        .await
        .unwrap();
    let n: i64 = sqlx::query("SELECT count(*) FROM users_rs_ulid WHERE id=$1")
        .bind(&id)
        .fetch_one(&p)
        .await
        .unwrap()
        .get(0);
    assert_eq!(n, 0);
}

#[tokio::test]
async fn ordering_and_keyset_pagination() {
    let p = pool().await;
    ensure_schema(&p).await;
    // idempotent across reruns
    sqlx::query("DELETE FROM users_rs_ulid WHERE email LIKE 'r%@x.io'")
        .execute(&p)
        .await
        .unwrap();

    const N: usize = 1000;
    let mut ids: Vec<String> = Vec::with_capacity(N);
    for _ in 0..N {
        ids.push(ulid::generate()); // fresh ms → mostly increasing; enforce below
    }
    // Guarantee strict increase like the engine's monotonic API does.
    let mut mono = rivid_core::monotonic::MonotonicState::new();
    for i in 0..N {
        ids[i] = mono.next_secure();
    }

    let mut tx = p.begin().await.unwrap();
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("INSERT INTO users_rs_ulid (id,email,name) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(format!("r{i}@x.io"))
            .bind("R")
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();

    // ORDER BY id == insertion order
    let rows = sqlx::query(
        "SELECT id FROM users_rs_ulid WHERE email LIKE 'r%@x.io' ORDER BY id",
    )
    .fetch_all(&p)
    .await
    .unwrap();
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row.get::<String, _>(0), ids[i], "ORDER BY mismatch at {i}");
    }

    // keyset pagination, page size 200, no dupes/skips
    let mut cursor = String::new();
    let mut seen = std::collections::HashSet::new();
    loop {
        // '' sorts before every ULID, so a single query shape covers page 1.
        let page = sqlx::query(
            "SELECT id FROM users_rs_ulid WHERE email LIKE 'r%@x.io' AND id > $1 ORDER BY id LIMIT 200",
        )
        .bind(&cursor)
        .fetch_all(&p)
        .await
        .unwrap();
        if page.is_empty() {
            break;
        }
        for r in &page {
            let id: String = r.get(0);
            cursor = id.clone();
            seen.insert(id);
        }
    }
    assert_eq!(seen.len(), N, "keyset pagination dupes/skips");

    sqlx::query("DELETE FROM users_rs_ulid WHERE email LIKE 'r%@x.io'")
        .execute(&p)
        .await
        .unwrap();
}

#[tokio::test]
async fn transaction_rollback_leaves_no_rows() {
    let p = pool().await;
    ensure_schema(&p).await;

    let mut tx = p.begin().await.unwrap();
    sqlx::query("INSERT INTO users_rs_ulid (id,email,name) VALUES ($1,'rb@x.io','RB')")
        .bind(ulid::generate())
        .execute(&mut *tx)
        .await
        .unwrap();
    drop(tx); // explicit rollback

    let n: i64 = sqlx::query("SELECT count(*) FROM users_rs_ulid WHERE email='rb@x.io'")
        .fetch_one(&p)
        .await
        .unwrap()
        .get(0);
    assert_eq!(n, 0, "rollback leaked rows");
}
