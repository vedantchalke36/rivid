"""rivid — ULID / UUIDv7 generation backed by the rivid Rust engine.

>>> import rivid
>>> len(rivid.ulid())
26
"""

from ._native import (
    compare,
    decode_time,
    encode_time,
    generate_many,
    generate_uuidv7_many,
    is_valid,
    monotonic_ulid,
    ulid,
    uuidv7,
    version,
)

__all__ = [
    "ulid",
    "monotonic_ulid",
    "is_valid",
    "decode_time",
    "encode_time",
    "compare",
    "generate_many",
    "uuidv7",
    "generate_uuidv7_many",
    "version",
]
__version__ = version()
