-- Refactor snapshot_log: replace flat exchanges_ok + offer_ids columns
-- with a single exchanges JSON column keyed by exchange name.
-- Example value: {"bisq": {"count": 71, "ids": ["abc1", ...]}, ...}

DROP TABLE snapshot_log;

CREATE TABLE snapshot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchanges TEXT NOT NULL,
    offers_count INTEGER NOT NULL
);
