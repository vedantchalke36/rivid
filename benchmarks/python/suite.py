#!/usr/bin/env python3
"""
Cross-language identifier benchmark — Python suite.

Executes the central spec (../spec/workloads.json) against mature Python
implementations. Emits one JSON result object per workload on stdout
(framed between BEGIN_RESULTS/END_RESULTS) so the runner can collect them.

Methodology (mirrors benchmarks/harness.mts so numbers are comparable):
- single-call: batch calibration to ~5ms, then timed batches for target_ms;
  per-batch mean latency recorded, percentiles over batch means.
- bulk: best-of-reps wall clock after warmup.
- correctness gate runs BEFORE any timing; failure aborts the suite.

Run:
  uv sync && uv run python suite.py [--quick] [--json out.json]
  # or: pip install -e . && python suite.py ...
"""
from __future__ import annotations

import argparse
import json
import platform
import resource
import sys
import time
import uuid as pyuuid

VERSIONS = {}

# `ulid` import name is owned by EITHER python-ulid or ulid-py (mutually
# exclusive installs). Detect which one actually bound.
try:
    import ulid as _ulidmod
    if hasattr(_ulidmod, "api"):  # ulid-py marker
        UlidPyMod = _ulidmod
        PyUlid = None
        VERSIONS["ulid-py"] = "1.1.0"
    else:
        PyUlid = _ulidmod.ULID
        UlidPyMod = None
        VERSIONS["python-ulid"] = "2.7.0"
except ImportError:
    PyUlid = None
    UlidPyMod = None

try:
    import uuid_utils  # Rust-backed uuid crate bindings
    VERSIONS["uuid-utils"] = uuid_utils.__version__
except ImportError:
    uuid_utils = None


def lib(name: str):
    if name in VERSIONS:
        return True
    return False


# ── timing primitives (mirror JS harness) ────────────────────────────────

def now_ns() -> int:
    return time.perf_counter_ns()


def measure_single(fn, target_ms: float = 400.0) -> dict:
    """Batch-calibrated ops/sec + percentiles over batch-mean latencies."""
    for _ in range(2000):  # warmup
        fn()
    batch = 1000
    while True:
        t0 = now_ns()
        for _ in range(batch):
            fn()
        el_ms = (now_ns() - t0) / 1e6
        if el_ms >= 4 or batch > (1 << 24):
            break
        batch = min(int(batch * max(2, 5 / max(el_ms, 0.01))), 1 << 24)
    latencies: list[float] = []
    total_ns = 0
    total_ops = 0
    deadline = now_ns() + int(target_ms * 1e6)
    while total_ops < 20_000 or now_ns() < deadline:
        t0 = now_ns()
        for _ in range(batch):
            fn()
        el = now_ns() - t0
        total_ns += el
        total_ops += batch
        latencies.append(el / batch)
        if now_ns() > deadline and total_ops >= 20_000:
            break
    latencies.sort()
    ns = total_ns / total_ops
    return {
        "ops_per_sec": 1e9 / ns,
        "ns_per_op": ns,
        "p50_ns": latencies[len(latencies) // 2],
        "p95_ns": latencies[int(len(latencies) * 0.95)],
        "p99_ns": latencies[int(len(latencies) * 0.99)],
    }


def measure_bulk(fn, reps: int) -> dict:
    fn()  # warmup with full size? no — warmup small below
    best = float("inf")
    for _ in range(reps):
        t0 = now_ns()
        r = fn()
        best = min(best, now_ns() - t0)
    n = len(r) if hasattr(r, "__len__") else r
    return {"ns_total": best, "items": n}


def rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


# ── implementations under test ───────────────────────────────────────────

IMPLS: dict[str, dict] = {}


def reg(name, **kw):
    IMPLS[name] = kw


if PyUlid is not None:
    reg(
        "python-ulid",
        pkg="python-ulid", ver=VERSIONS["python-ulid"], native=False, secure=True,
        gen=lambda: str(PyUlid()),
        gen_bulk=lambda n: [str(PyUlid()) for _ in range(n)],
        validate=lambda s: PyUlid.from_str(s) is not None,
        decode_time=None,  # python-ulid exposes .timestamp via datetime; keep out of hot path parity
        sort=lambda ids: sorted(ids),
    )
if UlidPyMod is not None:
    _new = UlidPyMod.new
    reg(
        "ulid-py",
        pkg="ulid-py", ver=VERSIONS["ulid-py"], native=False, secure=True,
        gen=lambda: str(_new()),
        gen_bulk=lambda n: [str(_new()) for _ in range(n)],
        validate=lambda s: UlidPyMod.parse(s) is not None,
        decode_time=lambda s: UlidPyMod.parse(s).timestamp,
        sort=lambda ids: sorted(ids),
    )
if uuid_utils is not None:
    _u7 = uuid_utils.uuid7
    _u4 = uuid_utils.uuid4
    reg(
        "uuid-utils",
        pkg="uuid-utils", ver=VERSIONS["uuid-utils"], native=True, secure=True,
        gen_v4=lambda: str(_u4()),
        gen_v7=lambda: str(_u7()),
        gen_v7_bulk=lambda n: [str(_u7()) for _ in range(n)],
    )

reg(
    "stdlib-uuid",
    pkg="cpython-uuid", ver=platform.python_version(), native=False, secure=True,
    gen_v4=lambda: str(pyuuid.uuid4()),
)


# ── correctness gate (must pass before any timing) ───────────────────────

def correctness_gate() -> list[str]:
    failures = []
    for name, impl in IMPLS.items():
        gen = impl.get("gen") or impl.get("gen_v4") or impl.get("gen_v7")
        if gen is None:
            continue
        sample = {gen() for _ in range(10_000)}
        if len(sample) != 10_000:
            failures.append(f"{name}: uniqueness failed ({len(sample)}/10000)")
        s = next(iter(sample))
        if impl.get("validate"):
            if not impl["validate"](s):
                failures.append(f"{name}: self-validation failed on own output")
        if impl.get("decode_time"):
            ts = impl["decode_time"](s)
            if not (1_400_000_000_000 < ts < 4_000_000_000_000):
                failures.append(f"{name}: implausible timestamp {ts}")
    # monotonic ordering is a generator-level property tested in JS/Rust suites;
    # Python references here are non-monotonic ULIDs.
    return failures


# ── workload execution ───────────────────────────────────────────────────

def run(quick: bool) -> list[dict]:
    results = []
    meta_common = {"os": platform.system(), "arch": platform.machine(),
                   "cpu": platform.processor() or platform.machine(),
                   "python": platform.python_version()}
    rss0 = rss_mb()

    def emit(op, ident, impl_name, cat, **metrics):
        impl = IMPLS.get(impl_name, {})
        row = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "language": "python",
            "package": impl.get("pkg", impl_name),
            "package_version": impl.get("ver", "?"),
            "native": impl.get("native", False),
            "secure": impl.get("secure", True),
            "category": cat,
            "operation": op,
            "identifier": ident,
            **meta_common,
            **metrics,
        }
        results.append(row)

    # noise baseline
    r = measure_single(lambda: None, 150)
    emit("noop", None, "framework", "A", **r)

    # A: single string generation
    for name in ("python-ulid", "ulid-py"):
        if name in IMPLS:
            emit("generate.single.ulid", "ulid", name, "A", **measure_single(IMPLS[name]["gen"]))
    if "uuid-utils" in IMPLS:
        emit("generate.single.uuidv7", "uuidv7", "uuid-utils", "A", **measure_single(IMPLS["uuid-utils"]["gen_v7"]))
        emit("generate.single.uuidv4", "uuidv4", "uuid-utils", "A", **measure_single(IMPLS["uuid-utils"]["gen_v4"]))
    emit("generate.single.uuidv4", "uuidv4", "stdlib-uuid", "A", **measure_single(IMPLS["stdlib-uuid"]["gen_v4"]))

    # B: bulk string generation
    sizes = [1_000, 10_000] + ([] if quick else [100_000, 1_000_000])
    for n in sizes:
        for name in ("python-ulid", "ulid-py"):
            if name not in IMPLS:
                continue
            b = measure_bulk(lambda: IMPLS[name]["gen_bulk"](n), reps=1 if n >= 1_000_000 else 3)
            emit("generate.bulk.ulid", "ulid", name, "B",
                 count=n, ms=b["ns_total"] / 1e6,
                 items_per_sec=n * 1e9 / b["ns_total"],
                 ns_per_item=b["ns_total"] / n)
    if "uuid-utils" in IMPLS and not quick:
        n = 1_000_000
        b = measure_bulk(lambda: IMPLS["uuid-utils"]["gen_v7_bulk"](n), reps=1)
        emit("generate.bulk.uuidv7", "uuidv7", "uuid-utils", "B",
             count=n, ms=b["ns_total"] / 1e6,
             items_per_sec=n * 1e9 / b["ns_total"],
             ns_per_item=b["ns_total"] / n)

    # F: codec workloads where the library supports them
    if "ulid-py" in IMPLS:
        impl = IMPLS["ulid-py"]
        sample = impl["gen"]()
        emit("time_extract.ulid", "ulid", "ulid-py", "F",
             **measure_single(lambda: impl["decode_time"](sample)))
        pair = (impl["gen"](), impl["gen"]())
        emit("compare.ulid", "ulid", "ulid-py", "F",
             **measure_single(lambda: (pair[0] < pair[1]) - (pair[0] > pair[1])))
        ids10k = impl["gen_bulk"](10_000)
        emit("sort.10k", "ulid", "ulid-py", "F",
             count=10_000, **{k: v for k, v in [
                 ("ms", measure_bulk(lambda: impl["sort"](list(ids10k)), 5)["ns_total"] / 1e6)]})

    peak_delta = rss_mb() - rss0
    for rrow in results:
        rrow["peak_rss_delta_mb"] = round(peak_delta, 1)
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--json", help="also write full results array to file")
    args = ap.parse_args()

    fails = correctness_gate()
    if fails:
        print("CORRECTNESS GATE FAILED:", file=sys.stderr)
        for f in fails:
            print("  -", f, file=sys.stderr)
        return 1

    rows = run(args.quick)
    blob = json.dumps(rows, indent=1)
    print("BEGIN_RESULTS")
    print(blob)
    print("END_RESULTS")
    if args.json:
        with open(args.json, "w") as fh:
            fh.write(blob)
    return 0


if __name__ == "__main__":
    sys.exit(main())
