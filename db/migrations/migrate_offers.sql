-- Migration: move from snapshot-linked offers to deduplicated offers with first_seen/last_seen

-- Create new offers table
CREATE TABLE offers_new (
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
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Migrate existing data: deduplicate by composite key, keep earliest/latest timestamps
INSERT INTO offers_new (exchange, direction, price, price_diff_percent, btc_min, btc_max, fiat_min, fiat_max, payment_method, offer_id, ref_price, first_seen, last_seen)
SELECT
    s.exchange,
    s.direction,
    o.price,
    o.price_diff_percent,
    o.btc_min,
    o.btc_max,
    o.fiat_min,
    o.fiat_max,
    o.payment_method,
    o.offer_id,
    s.btc_price,
    MIN(s.timestamp),
    MAX(s.timestamp)
FROM offers o
JOIN snapshots s ON o.snapshot_id = s.id
GROUP BY s.exchange, s.direction, o.price, o.btc_min, o.btc_max, o.payment_method;

-- Swap tables
DROP TABLE offers;
ALTER TABLE offers_new RENAME TO offers;

-- Recreate indexes
CREATE INDEX idx_offers_exchange ON offers(exchange);
CREATE INDEX idx_offers_direction ON offers(direction);
CREATE INDEX idx_offers_last_seen ON offers(last_seen);
CREATE INDEX idx_offers_fingerprint ON offers(exchange, direction, price, btc_min, btc_max, payment_method);
CREATE UNIQUE INDEX idx_offers_offer_id ON offers(offer_id) WHERE offer_id IS NOT NULL;
