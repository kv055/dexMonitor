#!/bin/bash
set -e

BISQ_VERSION=${BISQ_VERSION:-1.9.22}
BISQ_DAEMON_DIR="/opt/bisq/bisq-daemon-${BISQ_VERSION}"

echo "=== Starting Bisq Daemon ==="

# Wait for Tor to be available
echo "Waiting for Tor SOCKS proxy on 127.0.0.1:9050..."
for i in $(seq 1 30); do
    if curl -s --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip > /dev/null 2>&1; then
        echo "Tor is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "Warning: Tor not reachable after 60s, starting Bisq anyway..."
    fi
    sleep 2
done

export MALLOC_ARENA_MAX=4


cd "$BISQ_DAEMON_DIR"
exec java \
    -Xmx2g \
    -XX:MaxMetaspaceSize=256m \
    -XX:ReservedCodeCacheSize=128m \
    -XX:MaxDirectMemorySize=128m \
    -jar daemon.jar \
    --apiPort=9998 \
    --apiPassword="" \
    --appDataDir=/home/appuser/.local/share/Bisq \
    --nodePort=9999
