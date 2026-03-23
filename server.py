#!/usr/bin/env python3
"""
Flask web server for orderbook data
"""

from flask import Flask, jsonify, request
import sqlite3
from datetime import datetime, timedelta

app = Flask(__name__)
DB_PATH = "/home/claudio_clawd_bot/orderbook/orderbook.db"

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/snapshots', methods=['GET'])
def get_snapshots():
    """Get all snapshots, optionally filtered by exchange and time range"""
    exchange = request.args.get('exchange')
    limit = request.args.get('limit', 100, type=int)
    hours = request.args.get('hours', 24, type=int)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM snapshots WHERE timestamp >= datetime('now', ?)"
    params = [f'-{hours} hours']
    
    if exchange:
        query += " AND exchange = ?"
        params.append(exchange)
    
    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)
    
    cursor.execute(query, params)
    snapshots = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(snapshots)

@app.route('/api/snapshots/<int:snapshot_id>', methods=['GET'])
def get_snapshot(snapshot_id):
    """Get a single snapshot with its offers"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,))
    snapshot = dict(cursor.fetchone()) if cursor.fetchone() else None
    
    if snapshot:
        cursor.execute("SELECT * FROM offers WHERE snapshot_id = ?", (snapshot_id,))
        snapshot['offers'] = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    if snapshot:
        return jsonify(snapshot)
    return jsonify({'error': 'Snapshot not found'}), 404

@app.route('/api/offers', methods=['GET'])
def get_offers():
    """Get offers with optional filters"""
    exchange = request.args.get('exchange')
    limit = request.args.get('limit', 1000, type=int)
    hours = request.args.get('hours', 24, type=int)
    direction = request.args.get('direction', 'sell')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        SELECT o.*, s.exchange, s.timestamp, s.fiat_currency, s.btc_price as ref_price
        FROM offers o
        JOIN snapshots s ON o.snapshot_id = s.id
        WHERE s.timestamp >= datetime('now', ?) AND s.direction = ?
    """
    params = [f'-{hours} hours', direction]
    
    if exchange:
        query += " AND s.exchange = ?"
        params.append(exchange)
    
    query += " ORDER BY s.timestamp DESC LIMIT ?"
    params.append(limit)
    
    cursor.execute(query, params)
    offers = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(offers)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get summary statistics"""
    hours = request.args.get('hours', 24, type=int)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Price stats by exchange
    cursor.execute("""
        SELECT 
            exchange,
            COUNT(*) as snapshot_count,
            MIN(btc_price) as min_price,
            MAX(btc_price) as max_price,
            AVG(btc_price) as avg_price
        FROM snapshots
        WHERE timestamp >= datetime('now', ?)
        GROUP BY exchange
    """, (f'-{hours} hours',))
    
    price_stats = [dict(row) for row in cursor.fetchall()]
    
    # Offer count by exchange
    cursor.execute("""
        SELECT s.exchange, COUNT(o.id) as offer_count
        FROM offers o
        JOIN snapshots s ON o.snapshot_id = s.id
        WHERE s.timestamp >= datetime('now', ?)
        GROUP BY s.exchange
    """, (f'-{hours} hours',))
    
    offer_counts = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        'price_stats': price_stats,
        'offer_counts': offer_counts,
        'hours': hours
    })

@app.route('/api/latest', methods=['GET'])
def get_latest():
    """Get latest snapshot from each exchange"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT s.*, 
               (SELECT COUNT(*) FROM offers WHERE snapshot_id = s.id) as offer_count
        FROM snapshots s
        WHERE s.timestamp = (
            SELECT MAX(s2.timestamp) 
            FROM snapshots s2 
            WHERE s2.exchange = s.exchange
        )
    """)
    
    latest = [dict(row) for row in cursor.fetchall()]
    
    # Get offers for each
    for snapshot in latest:
        cursor.execute("SELECT * FROM offers WHERE snapshot_id = ?", (snapshot['id'],))
        snapshot['offers'] = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return jsonify(latest)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': datetime.utcnow().isoformat()})

if __name__ == '__main__':
    print("Starting orderbook API server on http://127.0.0.1:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)