# dexMonitor

`dexMonitor` now serves the monitor dashboard and its REST/WebSocket API on top of the shared Postgres database populated by the unified stack.

It no longer owns the Bisq node, snapshot worker, or Tor container. Those runtime responsibilities now live under `dexUnifiedApi`.

## Quick Start

```bash
docker compose up --build -d
```

Dashboard and API are available at `http://localhost:5000`.

## Current Role

- Serve the React dashboard
- Expose monitor endpoints like `/api/past_offers`, `/api/live_offers`, `/api/ohlc`, and `/api/snapshot-log`
- Compute trade-cost overlays and hedge estimates for the dashboard
- Optionally provide the standalone `bisqstats` helper for later use

## Environment Variables

### App

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://dex_monitor:dex_monitor@localhost:5432/dexarb?sslmode=disable` | Postgres connection for the monitor app |
| `SNAPSHOT_INTERVAL_MIN` | `1` | Used by the monitor server for OHLC interval sizing |
| `FRONTEND_DIR` | `./react-frontend/dist` | Path to built React assets |
| `MM_CONTROLLER_API_URL` | `http://localhost:5001` | Upstream MM controller API |
| `TOR_PROXY_ADDR` | `127.0.0.1:9050` | SOCKS5 proxy used for Robosats and fee/network lookups |

### Optional `bisqstats` Helper

| Variable | Default | Description |
|----------|---------|-------------|
| `STATS_API_ADDR` | `:9997` | Listen address for the standalone `bisqstats` helper |
| `BISQ_APP_DATA_DIR` | `/home/appuser/.local/share/Bisq` | Bisq app data directory to read closed trade stats from |

## Main Files

```text
dexMonitor/
├── cmd/server/             # Monitor HTTP/WebSocket server
├── cmd/bisqstats/          # Optional Bisq closed-trades stats helper
├── internal/bitcoin/       # Fee prediction and network analysis
├── internal/hedge/         # Hedge optimizer and venue inputs
├── internal/pastorders/    # Historical order aggregation
├── internal/paymentmethods/# Payment method grouping
├── react-frontend/         # React + Vite dashboard
├── Dockerfile              # Monitor app container
├── api-collection/         # REST client examples
└── .env.example
```

## Notes

- Historical snapshot ingestion and schema ownership live in `dexUnifiedApi`
- `bisqstats` is intentionally still kept in this repository for later use
