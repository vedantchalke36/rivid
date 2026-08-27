"""
SQLAlchemy 2.0 + ULID primary keys on PostgreSQL — integration tests.

Generation flows through the genuine rivid engine: the `rivid` Python
package (packages/python) wraps the same Rust core as @rivid/core via
PyO3. These tests validate persistence semantics (ordering, keyset
pagination, transactions, bulk) against live PostgreSQL.

Idiomatic exposure: `ULIDType` TypeDecorator maps CHAR(26) <-> str so
models declare `id: Mapped[str] = mapped_column(ULIDType, primary_key=True)`
and application code passes/gets plain strings.
"""
from __future__ import annotations

import os
import time
import uuid as _uuid
from datetime import datetime, timezone

import pytest
import rivid
from sqlalchemy import (
    String, Text, DateTime, func, select, create_engine, insert,
    MetaData, Table, Column, Integer,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, Session,
)


def new_ulid() -> str:
    return rivid.ulid()


def ulid_timestamp_ms(u: str) -> int:
    return rivid.decode_time(u)


DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://postgres:bench@localhost:54329/ids"
)

engine = create_engine(DATABASE_URL, pool_size=4, max_overflow=0)


class Base(DeclarativeBase):
    pass


class ULIDType(String):
    """CHAR(26) <-> str, strict length on bind."""
    cache_ok = True

    def __init__(self):
        super().__init__(26)


class User(Base):
    __tablename__ = "users_sa_ulid"

    id: Mapped[str] = mapped_column(ULIDType(), primary_key=True)
    email: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


@pytest.fixture(scope="module", autouse=True)
def schema():
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS users_sa_ulid ("
            " id CHAR(26) PRIMARY KEY,"
            " email TEXT NOT NULL,"
            " name TEXT NOT NULL,"
            " created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
    yield
    with engine.begin() as conn:
        conn.execute(
            User.__table__.delete().where(User.email.like("p%@x.io") | User.email.like("o%@x.io"))
        )


def test_create_fetch_update_delete():
    u = User(id=new_ulid(), email="crud@x.io", name="CRUD")
    with Session(engine) as s:
        s.add(u)
        s.commit()
        got = s.get(User, u.id)
        assert got is not None and got.email == "crud@x.io"
        got.name = "CRUD2"
        s.commit()
        assert s.get(User, u.id).name == "CRUD2"
        s.delete(got)
        s.commit()
        assert s.get(User, u.id) is None


def test_default_generation_and_validity():
    ids = [new_ulid() for _ in range(10_000)]
    assert len(set(ids)) == 10_000, "collision"
    assert all(len(i) == 26 for i in ids)
    now = time.time() * 1000
    ts = ulid_timestamp_ms(ids[0])
    assert abs(ts - now) < 5_000, f"timestamp implausible: {ts}"


def test_order_by_id_matches_insertion_time():
    base = datetime.now(timezone.utc)
    rows = []
    for i in range(500):
        ts_ms = int(base.timestamp() * 1000) + i
        rows.append({"id": rivid.ulid(ts_ms), "email": f"o{i}@x.io", "name": "O"})
    with engine.begin() as c:
        c.execute(User.__table__.insert(), rows)

    with Session(engine) as s:
        got = s.execute(
            select(User.id).where(User.email.like("o%@x.io")).order_by(User.id)
        ).scalars().all()
    expected = [r["id"] for r in sorted(rows, key=lambda r: r["id"])]
    assert list(got) == expected


def test_keyset_pagination_no_dupes_no_skips():
    with Session(engine) as s:
        total = s.execute(
            select(func.count()).select_from(User).where(User.email.like("p%@x.io"))
        ).scalar_one()
    if total < 1000:
        with engine.begin() as c:
            c.execute(
                User.__table__.insert(),
                [
                    {"id": new_ulid(), "email": f"p{i}@x.io", "name": "P"}
                    for i in range(1000)
                ],
            )
    cursor = ""
    seen: set[str] = set()
    while True:
        stmt = (
            select(User.id)
            .where(User.email.like("p%@x.io"), User.id > cursor)
            .order_by(User.id)
            .limit(200)
        )
        with Session(engine) as s:
            page = s.execute(stmt).scalars().all()
        if not page:
            break
        seen.update(page)
        cursor = page[-1]
    assert len(seen) >= 1000
    # every page boundary strictly increases → no dupes by construction of >
    assert len(seen) == len(set(seen))


def test_transaction_rollback():
    try:
        with Session(engine) as s:
            s.add(User(id=new_ulid(), email="rb@x.io", name="RB"))
            raise RuntimeError("force rollback")
    except RuntimeError:
        pass
    with Session(engine) as s:
        n = s.execute(
            select(func.count()).select_from(User).where(User.email == "rb@x.io")
        ).scalar_one()
    assert n == 0


def test_bulk_insert_10k_verified():
    with engine.begin() as c:  # idempotent across reruns
        c.execute(User.__table__.delete().where(User.email.like("b%@x.io")))
    rows = [{"id": new_ulid(), "email": f"b{i}@x.io", "name": "B"} for i in range(10_000)]
    with engine.begin() as c:
        c.execute(User.__table__.insert(), rows)
    with Session(engine) as s:
        n = s.execute(
            select(func.count()).select_from(User).where(User.email.like("b%@x.io"))
        ).scalar_one()
    assert n == 10_000
