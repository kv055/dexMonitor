CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchange TEXT NOT NULL,
    fiat_currency TEXT NOT NULL,
    direction TEXT NOT NULL,
    btc_price REAL NOT NULL
);

CREATE TABLE offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    direction TEXT NOT NULL,
    price REAL NOT NULL,
    price_diff_percent REAL,
    btc_min REAL,
    btc_max REAL,
    fiat_min INTEGER,
    fiat_max INTEGER,
    payment_method TEXT,
    offer_id TEXT,
    ref_price REAL,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_live BOOLEAN NOT NULL DEFAULT 0,
    duration INTEGER,
    historical_analysis_status TEXT,
    avg_ref_price_10m REAL,
    avg_premium_10m_pct REAL,
    avg_trade_cost_pct_10m REAL,
    avg_trade_cost_btc_10m REAL,
    avg_net_premium_10m_pct REAL,
    avg_estimated_profit_btc_10m REAL,
    avg_estimated_profit_fiat_10m REAL,
    avg_btc_amount_10m REAL,
    best_route_cex_10m TEXT,
    best_route_method_10m TEXT,
    price_type TEXT
);

CREATE INDEX idx_snapshots_time ON snapshots(timestamp);
CREATE INDEX idx_snapshots_exchange ON snapshots(exchange);
CREATE INDEX idx_offers_exchange ON offers(exchange);
CREATE INDEX idx_offers_direction ON offers(direction);
CREATE INDEX idx_offers_last_seen ON offers(last_seen);
CREATE INDEX idx_offers_fingerprint ON offers(exchange, direction, price, btc_min, btc_max, payment_method);
CREATE UNIQUE INDEX idx_offers_offer_id ON offers(offer_id) WHERE offer_id IS NOT NULL;

CREATE TABLE snapshot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchanges TEXT NOT NULL,
    offers_count INTEGER NOT NULL
);

CREATE TABLE kraken_ohlc (
    time  DATETIME PRIMARY KEY,
    open  REAL NOT NULL,
    high  REAL NOT NULL,
    low   REAL NOT NULL,
    close REAL NOT NULL
);
