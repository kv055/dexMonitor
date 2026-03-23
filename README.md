# Orderbook Snapshot

Captures P2P Bitcoin exchange orderbook data from Bisq, HodlHodl, and Robosats, stores it in SQLite, and provides a REST API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Data Flow                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  HodlHodl API ──Tor──► nokyc.py ──terminal output──► snapshot.py ──► SQLite │
│  Robosats API ──Tor──► nokyc.py ──terminal output──► snapshot.py ──► SQLite │
│                                                                              │
│  Bisq P2P Network ──► local bisq-daemon ──► bisq CLI ──► snapshot.py ──► DB │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **nokyc** - Fetches offers from HodlHodl and Robosats over Tor
2. **local Bisq daemon** - Connects to the Bisq P2P network, exposes CLI API on port 9998
3. **snapshot.py** - Runs every 10 minutes (via cron), parses terminal output from nokyc and bisq CLI, stores in SQLite
4. **server.py** - Flask REST API serving the captured data

## Setup

### Prerequisites

- Python 3 with venv support
- Java 17 (for Bisq daemon)
- Tor daemon running on port 9050
- SQLite3

### Installation

```bash
# Install Python dependencies
pip3 install flask flasgger

# Install SQLite (if not present)
sudo apt install sqlite3

# Install Java for Bisq daemon
sudo apt install openjdk-17-jdk-headless
```

### Running the Components

1. **Start Tor** (if not already running):
   ```bash
   sudo systemctl start tor
   ```

2. **Start Bisq daemon** (headless):
   ```bash
   cd bisq-daemon-1.9.22
   java -Xmx2000m -jar daemon.jar --maxMemory=1500
   ```

3. **Initialize the database**:
   ```bash
   sqlite3 orderbook.db < schema.sql
   ```

4. **Start the API server**:
   ```bash
   python3 server.py
   ```

5. **The cron job** (runs every 10 minutes):
   ```
   */10 * * * * cd /home/claude_clawd_bot/orderbook && python3 snapshot.py
   ```

## API

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api` | List all available endpoints |
| `GET /api/snapshots` | Get all snapshots with optional filters |
| `GET /api/snapshots/<id>` | Get a specific snapshot with its offers |
| `GET /api/offers` | Get all offers with optional filters |
| `GET /api/stats` | Get summary statistics |
| `GET /api/latest` | Get latest snapshot from each exchange |
| `GET /apidocs` | Interactive Swagger API documentation |
| `GET /health` | Health check |

### Query Parameters

- `exchange` - Filter by exchange (bisq, hodlhodl, robosats)
- `hours` - Only return data from the last N hours (default: 24)
- `limit` - Maximum number of results (default varies by endpoint)
- `direction` - Trade direction (buy or sell, default: sell)

### Example Requests

```bash
# Get latest offers from all exchanges
curl http://127.0.0.1:5000/api/latest

# Get Bisq stats for the last hour
curl "http://127.0.0.1:5000/api/stats?hours=1&exchange=bisq"

# Get HodlHodl offers from the last 6 hours
curl "http://127.0.0.1:5000/api/offers?exchange=hodlhodl&hours=6"
```

## Database Schema

### snapshots

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When the snapshot was taken |
| exchange | TEXT | Exchange name (bisq, hodlhodl, robosats) |
| fiat_currency | TEXT | Fiat currency (EUR, USD, etc.) |
| direction | TEXT | buy or sell |
| btc_price | REAL | Reference BTC price in fiat |

### offers

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| snapshot_id | INTEGER | Foreign key to snapshots |
| price | REAL | Price per BTC |
| price_diff_percent | REAL | Difference from reference price |
| btc_min | REAL | Minimum BTC amount |
| btc_max | REAL | Maximum BTC amount |
| fiat_min | INTEGER | Minimum fiat amount |
| fiat_max | INTEGER | Maximum fiat amount |
| payment_method | TEXT | Payment method (SEPA, Revolut, etc.) |
| offer_id | TEXT | Exchange-specific offer ID |

## Files

- `snapshot.py` - Cron script that captures orderbook data
- `server.py` - Flask API server with OpenAPI/Swagger docs
- `schema.sql` - SQLite database schema
- `orderbook.db` - SQLite database (not in git)

## License

MIT