# dexMonitor

Monitors P2P Bitcoin exchange orderbooks (Bisq, HodlHodl, Robosats), stores snapshots in SQLite, and serves a React dashboard with a REST API.

## Quick Start

```bash
docker compose up --build -d
```

Dashboard and API available at http://localhost:5000

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Data Flow                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Bisq node ──gRPC──────────────────┐                             │
│  HodlHodl API ──REST──────────────►│ snapshot (Go) ──► SQLite    │
│  Robosats API ──Tor onion──────────┘        ▲                    │
│                                             │                     │
│  Tor ──SOCKS5 proxy──────────────────────── ┘                    │
│                                                                    │
│  SQLite ──────────────────────────► server (Go) ──► React UI     │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Description |
|---------|-------------|
| **tor** | Tor daemon — SOCKS5 proxy on port 9050 for Robosats and price feeds |
| **bisq** | Bisq desktop node — exposes gRPC API on port 9998 |
| **snapshot** | Go binary — fetches offers every `SNAPSHOT_INTERVAL_MIN` minutes, upserts into SQLite |
| **app** | Go binary — serves REST API + React frontend on port 5000 |

## Docker Compose

```bash
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Environment Variables

**app / snapshot (shared):**

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `/app/data/orderbook.db` | SQLite database path |
| `SNAPSHOT_INTERVAL_MIN` | `15` | Snapshot interval (minutes); also sets Kraken OHLC candle width |

**snapshot only:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BISQ_GRPC_HOST` | `localhost:9998` | Bisq gRPC endpoint |
| `PRICE_PROVIDER` | `bisq_tor` | BTC reference price source (`bisq_tor`, `kraken`, `coingecko`) |
| `SERVER_INTERNAL_URL` | `http://localhost:5000` | App server URL for pushing live offers |

**app only:**

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_DIR` | `<exe dir>/react-frontend/dist` | Path to built React assets |

### Ports

| Port | Service |
|------|---------|
| `5000` | REST API + React dashboard |
| `9050` | Tor SOCKS5 proxy |
| `9998` | Bisq gRPC |

### Resource Limits

| Service | Memory | CPU |
|---------|--------|-----|
| tor | 256M | 0.5 |
| bisq | 3072M | 1.5 |
| app | 64M | 0.25 |
| snapshot | 64M | 0.25 |

## API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | React dashboard |
| GET | `/api/live_offers` | Currently live offers with cost breakdown |
| GET | `/api/past_offers` | Historical offers, ordered by `last_seen` |
| WS | `/ws/live_offers` | WebSocket — pushes full offer array on connect, then on every price tick |
| GET | `/api/stats` | Price stats and offer counts per exchange |
| GET | `/api/ohlc` | Kraken OHLC candles + offer overlay data |
| GET | `/api/snapshot-log` | Recent snapshot run history |
| GET | `/health` | Health check |
| POST | `/internal/live_offers` | Internal — snapshot tool pushes live offers to the server hub |

### Query Parameters

| Parameter | Endpoints | Description |
|-----------|-----------|-------------|
| `limit` | past_offers, snapshot-log | Max results (default: 1000 / 50) |
| `hours` | past_offers, stats, ohlc | Lookback window in hours (default: 24 / 24 / 24) |

### Example Requests

```bash
# Currently live offers
curl http://localhost:5000/api/live_offers

# Past offers from the last 6 hours
curl "http://localhost:5000/api/past_offers?hours=6"

# Price stats for last 24 hours
curl http://localhost:5000/api/stats

# OHLC candles + offer overlay
curl "http://localhost:5000/api/ohlc?hours=48"

# Last 10 snapshot runs
curl "http://localhost:5000/api/snapshot-log?limit=10"

# WebSocket (requires wscat or similar)
wscat -c ws://127.0.0.1:5000/ws/live_offers
```

## Database Schema

### snapshots

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When the snapshot was taken |
| exchange | TEXT | Exchange name |
| fiat_currency | TEXT | Fiat currency (EUR, USD, etc.) |
| direction | TEXT | `buy` or `sell` |
| btc_price | REAL | Reference BTC price in fiat |

### offers

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| exchange | TEXT | Exchange name |
| direction | TEXT | `buy` or `sell` |
| price | REAL | Price per BTC in fiat |
| price_diff_percent | REAL | Deviation from reference price (%) |
| btc_min / btc_max | REAL | BTC trade size range |
| fiat_min / fiat_max | INTEGER | Fiat trade size range |
| payment_method | TEXT | Payment method (SEPA, Revolut, etc.) |
| offer_id | TEXT | Exchange-specific offer ID (unique) |
| ref_price | REAL | Reference BTC price at time of snapshot |
| first_seen | DATETIME | When offer was first observed |
| last_seen | DATETIME | When offer was last seen (updated on each snapshot) |
| is_live | BOOLEAN | Whether the offer is currently live |
| duration | INTEGER | How long the offer has been active (seconds) |

### snapshot_log

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When the snapshot ran |
| exchanges | TEXT | JSON object with per-exchange offer counts |
| offers_count | INTEGER | Total offers upserted |

### kraken_ohlc

| Column | Type | Description |
|--------|------|-------------|
| time | DATETIME | Candle timestamp (primary key) |
| open | REAL | Open price |
| high | REAL | High price |
| low | REAL | Low price |
| close | REAL | Close price |

## E2E Tests

The frontend has a Playwright E2E test suite that runs against mocked API data (no backend needed).

```bash
cd react-frontend

# Install Playwright browsers (first time only)
npx playwright install --with-deps chromium

# Run all tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Update visual regression baselines after intentional UI changes
npm run test:e2e:update
```

Tests cover all 4 dashboard panels (ControlPanel, OffersTable, OHLCChart, DepthChart) plus cross-component filter integration. Visual regression screenshots for canvas-based charts are committed under `e2e/tests/*.spec.ts-snapshots/`.

## Project Structure

```
.
├── cmd/
│   ├── server/main.go       # REST API + WebSocket server
│   └── snapshot/main.go     # Snapshot fetcher
├── bisq_grpc/
│   ├── go/                  # Generated gRPC stubs
│   └── grpc.proto           # Bisq gRPC source definitions
├── api-collection/          # REST Client API collection (.http files)
├── db/schema.sql            # SQLite schema
├── react-frontend/          # React + Vite dashboard
│   └── e2e/                 # Playwright E2E tests
├── Dockerfile               # app container (Node + Go multi-stage)
├── Dockerfile.snapshot      # snapshot container (Go multi-stage)
├── Dockerfile.bisq          # Bisq node container
├── Dockerfile.tor           # Tor daemon container
└── docker-compose.yml
```

## License

MIT
