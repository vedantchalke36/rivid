import re
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

import rivid
from rivid.sqlalchemy import (
    MonotonicULID,
    ULID,
    UUIDv7,
    monotonic_ulid_default,
    ulid_default,
    uuidv7_default,
)

ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(ULID, primary_key=True, default=ulid_default)
    session_key: Mapped[str] = mapped_column(MonotonicULID, default=monotonic_ulid_default)
    alt: Mapped[str] = mapped_column(UUIDv7, default=uuidv7_default)
    name: Mapped[str] = mapped_column(sa.String(64))


@pytest.fixture()
def engine():
    eng = sa.create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_native_reference_vectors():
    assert len(rivid.ulid()) == 26
    assert rivid.decode_time("01ARZ3NDEKTSV4RRFFQ69G5FAV") == 1469922850259
    assert rivid.encode_time(1469918176385) == "01ARYZ6S41"
    assert rivid.is_valid("01ARZ3NDEKTSV4RRFFQ69G5FAV")
    assert not rivid.is_valid("01ARZ3NDEKTSV4RRFFQ69G5FA")


def test_bulk_one_crossing():
    ids = rivid.generate_many(50_000)
    assert len(ids) == 50_000
    assert len(set(ids)) == 50_000


def test_sqlite_roundtrip_autogenerates(engine):
    with sa.orm.Session(engine) as s:
        users = [User(name=f"u{i}") for i in range(3)]
        s.add_all(users)
        s.commit()
        for u in users:
            assert ULID_RE.match(u.id)
            assert UUID_RE.match(u.alt)
        rows = s.scalars(sa.select(User)).all()
        assert {u.id for u in rows} == {u.id for u in users}


def test_monotonic_order_matches_insertion(engine):
    with sa.orm.Session(engine) as s:
        users = [User(name=f"n{i}") for i in range(200)]
        s.add_all(users)
        s.flush()  # column defaults fire here; instances now hold their keys
        keys = [u.session_key for u in users]
        s.commit()
    assert keys == sorted(keys), "MonotonicULID must preserve insertion order"


def test_explicit_ids_are_respected(engine):
    fixed = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    with sa.orm.Session(engine) as s:
        u = User(id=fixed, session_key=rivid.monotonic_ulid(), alt=rivid.uuidv7(), name="fixed")
        s.add(u)
        s.commit()
        got = s.get(User, fixed)
    assert got is not None and got.id == fixed


def test_timestamp_decodes_to_now():
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    t = rivid.decode_time(rivid.ulid())
    assert abs(now - t) < 5000
