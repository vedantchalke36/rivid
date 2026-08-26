#!/usr/bin/env bash
# Start the pinned PostgreSQL benchmark instance and wait for readiness.
set -euo pipefail
cd "$(dirname "$0")"

if docker ps --format '{{.Names}}' | grep -q '^rivid-bench-pg$'; then
  echo "postgres already running"
else
  docker compose up -d
fi

for i in $(seq 1 30); do
  if docker exec rivid-bench-pg pg_isready -U postgres -d ids >/dev/null 2>&1; then
    echo "postgres ready (port 54329)"
    exit 0
  fi
  sleep 1
done
echo "postgres failed to become ready" >&2
exit 1
