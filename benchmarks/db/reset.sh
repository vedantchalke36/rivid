#!/usr/bin/env bash
# Full reset: destroy container + volumes, restart, re-apply canonical schema.
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v || true
./start.sh
echo "postgres reset complete (fresh schema applied)"
