CREATE TABLE snapshot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchanges_ok TEXT NOT NULL,
    offer_ids TEXT NOT NULL,
    offers_count INTEGER NOT NULL
);
