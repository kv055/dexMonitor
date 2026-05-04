# dexMonitor

`dexMonitor` serves the operator dashboard and its monitor-facing API for the dexArbTrading stack.

It reads the shared Postgres database populated by `dexUnifiedApi`, serves the React/Vite frontend, exposes historical and live offer endpoints, computes trade-cost overlays, and proxies selected `dexMmController` transaction data for the UI.

The monitor no longer owns the Bisq node, Tor container, snapshot worker, or shared schema setup. Those runtime responsibilities live in `dexUnifiedApi` and the root Compose stack.

## What It Does

- Serves the React dashboard on `http://localhost:5000`.
- Exposes REST and WebSocket endpoints for live offers, historical offers, stats, OHLC data, snapshot logs, payment method groups, and trading account administration.
- Computes premium views using shared CEX price and trade-cost logic from `commons`.
- Tracks offer lifecycle data and payment method grouping.
- Proxies MM controller transaction endpoints under `/api/mm-controller/*`.
- Provides an optional standalone `bisqstats` helper for reading closed-trade stats from a Bisq app data directory.

## Directory Layout

```text
dexMonitor/
+-- cmd/server/              # Dashboard HTTP server and API handlers
+-- cmd/bisqstats/           # Optional closed-trades stats helper
+-- internal/accounthealth/  # Account health models used by dashboard flows
+-- internal/lifecycle/      # Offer lifecycle repository
+-- internal/mmproxy/        # Proxy client for dexMmController
+-- internal/ohlc/           # OHLC aggregation
+-- internal/pastorders/     # Historical order aggregation
+-- internal/paymentmethods/ # Payment method grouping service
+-- internal/snapshotlog/    # Snapshot log repository
+-- internal/tradingaccounts/# Trading account and secret admin repository
+-- react-frontend/          # React + Vite dashboard
+-- api-collection/          # REST/WebSocket request examples
+-- Dockerfile
```

## Quick Start

From the parent repo:

```bash
docker compose up --build -d app nginx
```

For the full stack:

```bash
docker compose up --build -d
```

Dashboard:

```text
http://localhost:5000
```

Health check:

```bash
curl http://localhost:5000/health
```

## API Surface

Main endpoints:

- `GET /health`
- `GET /api/live_offers`
- `GET /ws/live_offers`
- `GET /api/past_offers`
- `GET /api/past_offers/{id}/lifecycle`
- `GET /api/past_order_stats`
- `GET /api/past_profitable_orders`
- `GET /api/general_stats/overview`
- `GET /api/general_stats/open_premiums`
- `GET /api/general_stats/past_premiums`
- `GET /api/general_stats/lifetimes`
- `GET /api/general_stats/payment_methods`
- `GET /api/stats`
- `GET /api/ohlc`
- `GET /api/snapshot-log`
- `GET /api/snapshot-log/{id}`
- `GET /api/payment_method_groups`
- `GET /api/trade_cost_config`

MM controller proxy endpoints:

- `GET /api/mm-controller/transactions`
- `GET /api/mm-controller/transactions/{id}`

Trading account administration:

- `GET /api/trading/accounts`
- `POST /api/trading/accounts`
- `PUT /api/trading/accounts/{id}`
- `DELETE /api/trading/accounts/{id}`
- `POST /api/trading/accounts/{id}/health_check`
- `POST /api/trading/accounts/{id}/totp_secrets`
- `POST /api/trading/accounts/{id}/passkey_credentials`
- `POST /api/trading/accounts/{id}/seeds`
- `POST /api/trading/accounts/{id}/api_keys`
- `PUT` / `DELETE` secret records by their individual IDs

Internal endpoint:

- `POST /internal/live_offers`

## Environment

Copy the example file:

```bash
cp .env.example .env
```

Variables:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://dex_monitor:dex_monitor@localhost:5432/dexarb?sslmode=disable` | Shared Postgres connection |
| `SNAPSHOT_INTERVAL_MIN` | `1` | Interval size used by OHLC/snapshot-derived views |
| `FRONTEND_DIR` | `./react-frontend/dist` | Built frontend directory |
| `MM_CONTROLLER_API_URL` | `http://localhost:5001` | Upstream MM controller API |
| `TOR_PROXY_ADDR` | `127.0.0.1:9050` | SOCKS5 proxy for network lookups that need Tor |
| `DEXMONITOR_HEDGE_CONFIG` | unset | Optional hedge config override |
| `STATS_API_ADDR` | `:9997` | Optional `bisqstats` helper listen address |
| `BISQ_APP_DATA_DIR` | `/home/appuser/.local/share/Bisq` | Bisq data dir for the optional stats helper |

## Frontend Development

```bash
cd react-frontend
npm install
npm run dev
```

The dev server proxies API calls according to the Vite config. For full behavior, keep the Go server and backing services running.

Build frontend assets:

```bash
cd react-frontend
npm run build
```

## Backend Development

Run the server:

```bash
go run ./cmd/server
```

Run tests:

```bash
go test ./...
```

Run the optional Bisq stats helper:

```bash
go run ./cmd/bisqstats
```

## Operational Notes

- Historical snapshot ingestion and schema ownership live in `dexUnifiedApi`.
- The monitor expects shared tables such as offers, snapshot logs, account data, and lifecycle records to exist before all views can be populated.
- The live-offer WebSocket is recalculated when CEX price feeds update, so UI premiums can move even before the next DEX snapshot.
- `bisqstats` remains here as a helper but is not part of the default Compose service graph.
