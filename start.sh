#!/bin/bash
set -e

echo "=== Starting Orderbook App Container ==="

# Set environment variables for Docker
export DB_PATH=${DB_PATH:-/app/data/orderbook.db}
export NOKYC_DIR=${NOKYC_DIR:-/app/nokyc}

# ============================================================================
# 1. Initialize SQLite database
# ============================================================================
echo "[1/3] Initializing database..."
cd /app
if [ ! -f "$DB_PATH" ]; then
    mkdir -p /app/data
    sqlite3 "$DB_PATH" < schema.sql
    echo "Database created at $DB_PATH"
else
    echo "Database already exists at $DB_PATH"
fi

# ============================================================================
# 2. Set up cron for snapshots
# ============================================================================
echo "[2/3] Setting up cron..."
BISQ_VERSION=${BISQ_VERSION:-1.9.22}
INTERVAL=${SNAPSHOT_INTERVAL_MIN:-15}
echo "*/${INTERVAL} * * * * cd /app && DB_PATH=$DB_PATH NOKYC_DIR=$NOKYC_DIR VENV_PYTHON=/app/venv/bin/python BISQ_CLI_JAR=/opt/bisq/bisq-cli-${BISQ_VERSION}/cli.jar PRICE_PROVIDER=${PRICE_PROVIDER:-bisq_tor} /app/venv/bin/python /app/snapshot.py >> /app/snapshot.log 2>&1" > /tmp/orderbook-cron
crontab /tmp/orderbook-cron
cron 2>/dev/null || true

# Run initial snapshot (best-effort — Bisq may not be ready yet)
echo "Running initial snapshot..."
cd /app
DB_PATH=$DB_PATH NOKYC_DIR=$NOKYC_DIR VENV_PYTHON=/app/venv/bin/python BISQ_CLI_JAR=/opt/bisq/bisq-cli-${BISQ_VERSION}/cli.jar PRICE_PROVIDER=${PRICE_PROVIDER:-bisq_tor} /app/venv/bin/python /app/snapshot.py >> /app/snapshot.log 2>&1 || true

# ============================================================================
# 3. Start Flask API server
# ============================================================================
echo "[3/3] Starting Flask API server..."
cd /app
exec env DB_PATH=$DB_PATH SNAPSHOT_INTERVAL_MIN=${SNAPSHOT_INTERVAL_MIN:-15} /app/venv/bin/python /app/server.py
