"""SQLAlchemy column types for rivid identifiers.

```python
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from rivid.sqlalchemy import ULID, MonotonicULID, UUIDv7

class Base(DeclarativeBase): ...

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(ULID, primary_key=True, default=ulid_default)  # CHAR(26)
```

Values are generated client-side on flush when left unset, so inserts never
round-trip to the database for a default and `ORDER BY id` equals insertion
order (with `MonotonicULID` or batch-generated keys).
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import CHAR
from sqlalchemy.types import TypeDecorator

import rivid

__all__ = ["ULID", "MonotonicULID", "UUIDv7", "ulid_default", "monotonic_ulid_default", "uuidv7_default"]


def ulid_default():
    """Column default callable — `mapped_column(ULID, default=ulid_default)`."""
    return rivid.ulid()


def monotonic_ulid_default():
    return rivid.monotonic_ulid()


def uuidv7_default():
    return rivid.uuidv7()


class _RidType(TypeDecorator):
    """Base: canonicalises stored values; pair with a `default=` callable
    (`ulid_default()` family) so missing PKs are filled before flush —
    SQLAlchemy keys the identity map prior to bind-parameter processing."""

    impl = CHAR
    cache_ok = True
    _generator: Any = staticmethod(rivid.ulid)
    _length = 26

    def __init__(self, **kw: Any) -> None:
        super().__init__(length=self._length, **kw)

    def process_bind_param(self, value: Optional[str], dialect: Any) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip()

    def process_result_value(self, value: Optional[str], dialect: Any) -> Optional[str]:
        return value


class ULID(_RidType):
    cache_ok = True
    """Canonical 26-char Crockford Base32 ULID — `CHAR(26)`."""


class MonotonicULID(_RidType):
    cache_ok = True
    """Strictly-increasing ULIDs within the same millisecond — `CHAR(26)`."""

    _generator = staticmethod(rivid.monotonic_ulid)


class UUIDv7(_RidType):
    cache_ok = True
    """RFC 9562 time-ordered UUID in hyphenated form — `CHAR(36)`."""

    _generator = staticmethod(rivid.uuidv7)
    _length = 36
