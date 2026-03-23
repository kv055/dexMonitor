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
    snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    price_diff_percent REAL,
    btc_min REAL,
    btc_max REAL,
    fiat_min INTEGER,
    fiat_max INTEGER,
    payment_method TEXT,
    offer_id TEXT
);
CREATE INDEX idx_snapshots_time ON snapshots(timestamp);
CREATE INDEX idx_snapshots_exchange ON snapshots(exchange);
CREATE INDEX idx_offers_snapshot ON offers(snapshot_id);
