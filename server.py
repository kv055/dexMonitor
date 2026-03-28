#!/usr/bin/env python3
"""
Flask web server for orderbook data with OpenAPI documentation
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flasgger import Swagger
import sqlite3
import os
import requests
from datetime import datetime

# Use /app/data for Docker, default to local path for development
DB_PATH = os.environ.get('DB_PATH', '/home/claudio_clawd_bot/orderbook/orderbook.db')
SNAPSHOT_INTERVAL_MIN = int(os.environ.get('SNAPSHOT_INTERVAL_MIN', 15))

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
CORS(app)
swagger = Swagger(app)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'react-frontend', 'dist')


@app.route('/')
def serve_frontend():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'assets'), filename)


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.route('/api/offers', methods=['GET'])
def get_offers():
    """
    Get all offers
    ---
    tags:
      - Offers
    parameters:
      - name: limit
        in: query
        type: integer
        default: 1000
        description: Maximum number of offers to return
    responses:
      200:
        description: List of offers
        schema:
          type: array
          items:
            $ref: '#/definitions/Offer'
    """
    limit = request.args.get('limit', 1000, type=int)

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM offers ORDER BY last_seen DESC LIMIT ?", (limit,))
    offers = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify(offers)


@app.route('/api/premium_offers', methods=['GET'])
def get_premium_offers():
    """
    Get offers with a price premium
    ---
    tags:
      - Offers
    parameters:
      - name: limit
        in: query
        type: integer
        default: 1000
        description: Maximum number of offers to return
      - name: hours
        in: query
        type: integer
        description: Only return offers from the last N hours (omit for all time)
    responses:
      200:
        description: Sell offers below ref price and buy offers above ref price
        schema:
          type: array
          items:
            $ref: '#/definitions/Offer'
    """
    limit = request.args.get('limit', 1000, type=int)
    hours = request.args.get('hours', type=int)

    conn = get_db_connection()
    cursor = conn.cursor()

    if hours:
        cursor.execute("""
            SELECT * FROM offers
            WHERE ((direction = 'sell' AND price < ref_price)
               OR  (direction = 'buy'  AND price > ref_price))
              AND last_seen >= datetime('now', ?)
            ORDER BY price_diff_percent DESC
            LIMIT ?
        """, (f'-{hours} hours', limit))
    else:
        cursor.execute("""
            SELECT * FROM offers
            WHERE (direction = 'sell' AND price < ref_price)
               OR (direction = 'buy'  AND price > ref_price)
            ORDER BY price_diff_percent DESC
            LIMIT ?
        """, (limit,))
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
    
    # Offer count by exchange (deduplicated)
    cursor.execute("""
        SELECT exchange, COUNT(*) as offer_count
        FROM offers
        WHERE last_seen >= datetime('now', ?)
        GROUP BY exchange
    """, (f'-{hours} hours',))
    
    offer_counts = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        'price_stats': price_stats,
        'offer_counts': offer_counts,
        'hours': hours
    })


@app.route('/api/ohlc', methods=['GET'])
def get_ohlc():
    """
    Get Kraken OHLC candles and DEX offers for chart overlay
    ---
    tags:
      - Charts
    parameters:
      - name: hours
        in: query
        type: integer
        default: 24
        description: Hours of history
    responses:
      200:
        description: OHLC candles and offer dots
    """
    hours = request.args.get('hours', 24, type=int)

    # Fetch Kraken OHLC candles at the snapshot interval
    candles = []
    try:
        resp = requests.get(
            'https://api.kraken.com/0/public/OHLC',
            params={'pair': 'XBTEUR', 'interval': SNAPSHOT_INTERVAL_MIN},
            timeout=15,
        )
        data = resp.json()
        result = data.get('result', {})
        ohlc_data = result.get(next(
            (k for k in result if k != 'last'), ''
        ), [])
        cutoff = datetime.utcnow().timestamp() - hours * 3600
        for c in ohlc_data:
            if c[0] >= cutoff:
                candles.append({
                    'time': datetime.utcfromtimestamp(c[0]).isoformat(),
                    'open': float(c[1]),
                    'high': float(c[2]),
                    'low': float(c[3]),
                    'close': float(c[4]),
                })
    except Exception as e:
        print(f"[OHLC] Kraken error: {e}")

    # Fetch offers from DB for the same period
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT price, price_diff_percent, payment_method,
               exchange, direction, first_seen
        FROM offers
        WHERE last_seen >= datetime('now', ?)
          AND ((direction = 'sell' AND price <= ref_price)
            OR (direction = 'buy' AND price >= ref_price))
    """, (f'-{hours} hours',))
    offers = [{
        'time': row['first_seen'],
        'price': row['price'],
        'premium': row['price_diff_percent'],
        'exchange': row['exchange'],
        'direction': row['direction'],
        'payment_method': row['payment_method'],
    } for row in cursor.fetchall()]
    conn.close()

    return jsonify({
        'candles': candles,
        'offers': offers,
        'interval_min': SNAPSHOT_INTERVAL_MIN,
    })


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
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5000, debug=debug)