#!/bin/bash
set -e

echo "=== Starting Orderbook Docker Container ==="

# Set environment variables for Docker
export DB_PATH=/app/data/orderbook.db
export NOKYC_DIR=/app/nokyc

# ============================================================================
# 1. Start Tor
# ============================================================================
echo "[1/4] Starting Tor..."
tor --RunAsDaemon 1 --CookieAuthentication 0 --HashedControlPassword "" --ControlPort 9050 --SocksPort 9050 &
sleep 5

# Verify Tor is running
if ! curl -s --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip > /dev/null 2>&1; then
    echo "Warning: Tor may not be fully configured, continuing anyway..."
fi
echo "Tor started"

# ============================================================================
# 2. Initialize SQLite database
# ============================================================================
echo "[2/4] Initializing database..."
cd /app
if [ ! -f $DB_PATH ]; then
    # Create directory if it doesn't exist
    mkdir -p /app/data
    # Initialize database using the schema
    sqlite3 $DB_PATH < schema.sql
    echo "Database created at $DB_PATH"
else
    echo "Database already exists at $DB_PATH"
fi

# ============================================================================
# 3. Set up cron for snapshots
# ============================================================================
echo "[3/4] Setting up cron..."
# Create required directory for cron (already created in Dockerfile)
# Create the cron job
echo "*/10 * * * * cd /app && DB_PATH=$DB_PATH NOKYC_DIR=$NOKYC_DIR /app/venv/bin/python /app/snapshot.py >> /app/snapshot.log 2>&1" > /tmp/orderbook-cron
crontab /tmp/orderbook-cron
# Start cron
cron 2>/dev/null || true

# Run initial snapshot
echo "Running initial snapshot..."
cd /app
DB_PATH=$DB_PATH NOKYC_DIR=$NOKYC_DIR /app/venv/bin/python /app/snapshot.py >> /app/snapshot.log 2>&1 || true

# ============================================================================
# 4. Start Flask API server
# ============================================================================
echo "[4/4] Starting Flask API server..."
cd /app
# Run with environment variable set
exec env DB_PATH=$DB_PATH /app/venv/bin/python /app/server.py