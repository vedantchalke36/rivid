#!/usr/bin/env bash
# Cross-platform identifier benchmark — single entry point.
#
#   ./bench.sh                          # all detected languages, full workloads
#   ./bench.sh --quick                  # short developer benchmark
#   ./bench.sh --language node          # one ecosystem (node|rust|python|go|java)
#   ./bench.sh --language node,rust     # several
#   ./bench.sh --platform-info          # print machine/runtime matrix and exit
#   ./bench.sh --db                     # PostgreSQL end-to-end suite (starts Docker)
#   ./bench.sh --report-only            # regenerate reports from stored results
set -euo pipefail

cd "$(dirname "$0")"

LANGS=()
QUICK=""
DB=""
REPORT_ONLY=""
PLATFORM_INFO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --language) LANGS=(--language="$2"); shift 2 ;;
    --language=*) LANGS=("$1"); shift ;;
    --quick) QUICK="--quick"; shift ;;
    --db) DB="1"; shift ;;
    --report-only) REPORT_ONLY="--report-only"; shift ;;
    --platform-info) PLATFORM_INFO="1"; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "$PLATFORM_INFO" ]]; then
  node benchmarks/runner/run.mjs --language=__none__ --skip-install || true
  node -e "
const m = JSON.parse(require('fs').readFileSync('benchmarks/reports/platform-matrix.json','utf8'));
console.log(JSON.stringify(m, null, 2));
"
  exit 0
fi

if [[ -z "$REPORT_ONLY" ]]; then
  echo "==> building @rivid/core (release)"
  npx napi build --platform --release >/dev/null

  RUNNER_ARGS=($QUICK "${LANGS[@]:-}")
  echo "==> running suites"
  # Suite failures are reported by the runner; report generation always runs
  # so results from successful suites are never lost.
  node benchmarks/runner/run.mjs "${RUNNER_ARGS[@]}" || true
fi

echo "==> generating report"
node benchmarks/runner/report.mjs

if [[ -n "$DB" ]]; then
  echo "==> PostgreSQL suite"
  ./benchmarks/db/start.sh
  DB_BENCH_ROWS="${DB_BENCH_ROWS:-1000000}" \
  DATABASE_URL="postgres://postgres:bench@localhost:54329/ids" \
    node --import tsx benchmarks/db-postgres.mts
  ./benchmarks/db/stop.sh
fi

echo "done. results in benchmarks/results/, reports in benchmarks/reports/"
