#!/usr/bin/env python3
"""
Flask web server for orderbook data with OpenAPI documentation
"""

from flask import Flask, jsonify, request
from flasgger import Swagger
import sqlite3
from datetime import datetime

app = Flask(__name__)

# OpenAPI/Swagger configuration
app.config['SWAGGER'] = {
    'title': 'Orderbook API',
    'description': 'API for querying P2P Bitcoin exchange orderbook snapshots from Bisq, HodlHodl, and Robosats',
    'version': '1.0.0',
    'contact': {
        'name': 'API Support',
        'url': 'https://github.com/your-repo/orderbook'
    }
}
swagger = Swagger(app)

DB_PATH = "/home/claudio_clawd_bot/orderbook/orderbook.db"

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/snapshots', methods=['GET'])
def get_snapshots():
    """
    Get all snapshots, optionally filtered by exchange and time range
    ---
    tags:
      - Snapshots
    parameters:
      - name: exchange
        in: query
        type: string
        description: Filter by exchange (bisq, hodlhodl, robosats)
      - name: limit
        in: query
        type: integer
        default: 100
        description: Maximum number of snapshots to return
      - name: hours
        in: query
        type: integer
        default: 24
        description: Only return snapshots from the last N hours
    responses:
      200:
        description: List of snapshots
        schema:
          type: array
          items:
            $ref: '#/definitions/Snapshot'
    """
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
    """
    Get a single snapshot with its offers
    ---
    tags:
      - Snapshots
    parameters:
      - name: snapshot_id
        in: path
        type: integer
        required: true
        description: ID of the snapshot
    responses:
      200:
        description: Snapshot with offers
        schema:
          $ref: '#/definitions/SnapshotWithOffers'
      404:
        description: Snapshot not found
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,))
    row = cursor.fetchone()
    snapshot = dict(row) if row else None
    
    if snapshot:
        cursor.execute("SELECT * FROM offers WHERE snapshot_id = ?", (snapshot_id,))
        snapshot['offers'] = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    if snapshot:
        return jsonify(snapshot)
    return jsonify({'error': 'Snapshot not found'}), 404

@app.route('/api/offers', methods=['GET'])
def get_offers():
    """
    Get offers with optional filters
    ---
    tags:
      - Offers
    parameters:
      - name: exchange
        in: query
        type: string
        description: Filter by exchange (bisq, hodlhodl, robosats)
      - name: limit
        in: query
        type: integer
        default: 1000
        description: Maximum number of offers to return
      - name: hours
        in: query
        type: integer
        default: 24
        description: Only return offers from the last N hours
      - name: direction
        in: query
        type: string
        default: sell
        description: Trade direction (buy or sell)
    responses:
      200:
        description: List of offers
        schema:
          type: array
          items:
            $ref: '#/definitions/Offer'
    """
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
    """
    Get summary statistics
    ---
    tags:
      - Statistics
    parameters:
      - name: hours
        in: query
        type: integer
        default: 24
        description: Only include data from the last N hours
    responses:
      200:
        description: Summary statistics
        schema:
          type: object
          properties:
            price_stats:
              type: array
              items:
                $ref: '#/definitions/PriceStats'
            offer_counts:
              type: array
              items:
                type: object
                properties:
                  exchange:
                    type: string
                  offer_count:
                    type: integer
            hours:
              type: integer
    """
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
    """
    Get latest snapshot from each exchange
    ---
    tags:
      - Snapshots
    description: Returns the most recent snapshot for each exchange along with its offers
    responses:
      200:
        description: Latest snapshots with offers
        schema:
          type: array
          items:
            $ref: '#/definitions/SnapshotWithOffers'
    """
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
    """
    Health check endpoint
    ---
    tags:
      - Health
    responses:
      200:
        description: Service is healthy
        schema:
          type: object
          properties:
            status:
              type: string
              example: ok
            timestamp:
              type: string
              example: 2026-03-23T05:00:00
    """
    return jsonify({'status': 'ok', 'timestamp': datetime.utcnow().isoformat()})

@app.route('/api', methods=['GET'])
def api_root():
    """
    API Root - List available endpoints
    ---
    tags:
      - API
    responses:
      200:
        description: Available endpoints
    """
    return jsonify({
        'endpoints': {
            '/api/snapshots': 'Get all snapshots with optional filters',
            '/api/snapshots/<id>': 'Get a specific snapshot with its offers',
            '/api/offers': 'Get all offers with optional filters',
            '/api/stats': 'Get summary statistics',
            '/api/latest': 'Get latest snapshot from each exchange',
            '/health': 'Health check',
            '/apidocs': 'Interactive API documentation (Swagger UI)'
        },
        'version': '1.0.0'
    })

# OpenAPI definitions (added to swagger spec)
app.config['SWAGGER']['definitions'] = {
    'Snapshot': {
        'type': 'object',
        'properties': {
            'id': {'type': 'integer'},
            'timestamp': {'type': 'string', 'format': 'date-time'},
            'exchange': {'type': 'string', 'enum': ['bisq', 'hodlhodl', 'robosats']},
            'fiat_currency': {'type': 'string'},
            'direction': {'type': 'string', 'enum': ['buy', 'sell']},
            'btc_price': {'type': 'number'}
        }
    },
    'SnapshotWithOffers': {
        'type': 'object',
        'properties': {
            'id': {'type': 'integer'},
            'timestamp': {'type': 'string', 'format': 'date-time'},
            'exchange': {'type': 'string'},
            'fiat_currency': {'type': 'string'},
            'direction': {'type': 'string'},
            'btc_price': {'type': 'number'},
            'offer_count': {'type': 'integer'},
            'offers': {
                'type': 'array',
                'items': {'$ref': '#/definitions/Offer'}
            }
        }
    },
    'Offer': {
        'type': 'object',
        'properties': {
            'id': {'type': 'integer'},
            'snapshot_id': {'type': 'integer'},
            'price': {'type': 'number'},
            'price_diff_percent': {'type': 'number'},
            'btc_min': {'type': 'number'},
            'btc_max': {'type': 'number'},
            'fiat_min': {'type': 'integer'},
            'fiat_max': {'type': 'integer'},
            'payment_method': {'type': 'string'},
            'offer_id': {'type': 'string', 'nullable': True}
        }
    },
    'PriceStats': {
        'type': 'object',
        'properties': {
            'exchange': {'type': 'string'},
            'snapshot_count': {'type': 'integer'},
            'min_price': {'type': 'number'},
            'max_price': {'type': 'number'},
            'avg_price': {'type': 'number'}
        }
    }
}

if __name__ == '__main__':
    print("Starting orderbook API server on http://127.0.0.1:5000")
    print("API docs available at http://127.0.0.1:5000/apidocs")
    app.run(host='127.0.0.1', port=5000, debug=True)