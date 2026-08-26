#!/usr/bin/env bash
# Stop the PostgreSQL benchmark instance (data persists in the container).
set -euo pipefail
cd "$(dirname "$0")"
docker compose down || true
echo "postgres stopped"
