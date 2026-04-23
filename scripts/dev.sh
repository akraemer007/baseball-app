#!/usr/bin/env bash
# Start the local dev servers (Express + Vite) pointed at the real
# Databricks warehouse, with a fresh OAuth token.
#
# OAuth tokens expire ~hourly, so re-run this script anytime pages start
# showing "Failed to load data".
#
# Flags:
#   --mock     Run with USE_REAL_SQL=false (no warehouse round-trips,
#              serves deterministic mocks).
#
# Usage:
#   ./scripts/dev.sh
#   ./scripts/dev.sh --mock

set -euo pipefail

PROFILE="${AK_DATABRICKS_PROFILE:-fe-vm-production-forecasting}"
WAREHOUSE_ID="${AK_WAREHOUSE_ID:-6f1ac903576b114a}"
HOST="${AK_DATABRICKS_HOST:-https://fevm-production-forecasting.cloud.databricks.com}"
CATALOG="${AK_CATALOG:-production_forecasting_catalog}"
SCHEMA="${AK_SCHEMA:-ak_baseball}"

USE_REAL_SQL=true
for arg in "$@"; do
  case "$arg" in
    --mock) USE_REAL_SQL=false ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/app"

# --- kill anything already running on our ports --------------------------
echo "→ stopping any existing dev servers..."
pkill -9 -f "tsx watch" 2>/dev/null || true
pkill -9 -f "concurrently" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
sleep 1
lsof -ti:5173 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -ti:8000 2>/dev/null | xargs -r kill -9 2>/dev/null || true

# --- fetch a fresh OAuth token (only if we'll need it) -------------------
TOKEN=""
if [[ "$USE_REAL_SQL" == "true" ]]; then
  echo "→ fetching fresh Databricks OAuth token (profile: $PROFILE)..."
  TOKEN=$(databricks auth token -p "$PROFILE" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  if [[ -z "$TOKEN" ]]; then
    echo "  could not fetch token — try: databricks auth login -p $PROFILE" >&2
    exit 1
  fi
  echo "  token: ${TOKEN:0:20}…"
fi

# --- start the dev servers -----------------------------------------------
cd "$APP_DIR"
echo "→ starting dev servers (USE_REAL_SQL=$USE_REAL_SQL)..."
export NODE_ENV=development
export USE_REAL_SQL
export DATABRICKS_HOST="$HOST"
export DATABRICKS_WAREHOUSE_ID="$WAREHOUSE_ID"
export DATABRICKS_CATALOG="$CATALOG"
export DATABRICKS_SCHEMA="$SCHEMA"
[[ -n "$TOKEN" ]] && export DATABRICKS_TOKEN="$TOKEN"

# Foreground so Ctrl-C kills everything cleanly. npm run dev wraps
# concurrently which already handles SIGINT propagation.
exec npm run dev
