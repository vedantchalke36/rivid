# `rivid` (Python)

ULID / UUIDv7 generation for Python backed by the same Rust engine as `@rivid/core`.
PyO3 native module + SQLAlchemy `TypeDecorator`s (`ULID`, `MonotonicULID`, `UUIDv7`).

```bash
pip install rivid            # after first publish
```

Local dev: `uv venv && uv pip install maturin pytest "sqlalchemy>=2" && maturin develop --release && pytest`
