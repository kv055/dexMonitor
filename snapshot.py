#!/usr/bin/env python3
"""
Orderbook snapshot script - captures orderbook data from Bisq, HodlHodl, and Robosats
"""

import json
import sqlite3
import os
import sys
import requests
import grpc

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'bisq_grpc'))
import grpc_pb2
import grpc_pb2_grpc

# Use /app/data for Docker, default to local path for development
DB_PATH = os.environ.get('DB_PATH', '/home/claudio_clawd_bot/orderbook/orderbook.db')
BISQ_GRPC_HOST = os.environ.get('BISQ_GRPC_HOST', 'localhost:9998')
PRICE_PROVIDER = os.environ.get('PRICE_PROVIDER', 'bisq_tor')

ROBOSATS_ONIONS = [
    'http://ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd.onion',
    'http://mmhaqzuirth5rx7gl24d4773lknltjhik57k7ahec5iefktezv4b3uid.onion',
    'http://4t4jxmivv6uqej6xzx2jx3fxh75gtt65v3szjoqmc4ugdlhipzdat6yd.onion',
    'http://otmoonrndnrddqdlhu6b36heunmbyw3cgvadqo2oqeau3656wfv7fwad.onion',
]

def _tor_session():
    session = requests.Session()
    session.proxies = {
        'http': 'socks5h://127.0.0.1:9050',
        'https': 'socks5h://127.0.0.1:9050',
    }
    return session

def _price_bisq_tor(fiat):
    """Bisq's price node — aggregates prices from major centralized exchanges, accessed via Tor"""
    url = 'http://ro7nv73awqs3ga2qtqeqawrjpbxwarsazznszvr6whv7tes5ehffopid.onion/getAllMarketPrices'
    resp = _tor_session().get(url, timeout=30)
    for currency in resp.json()['data']:
        if currency['currencyCode'].lower() == fiat:
            return int(float(currency['price']))
    return 0

def _price_kraken(fiat):
    """Kraken REST API — no Tor needed"""
    pair = f"XBT{fiat.upper()}"
    resp = requests.get(f'https://api.kraken.com/0/public/Ticker?pair={pair}', timeout=15)
    data = resp.json()
    result = data['result']
    ticker = result[next(iter(result))]
    return int(float(ticker['c'][0]))

def _price_coingecko(fiat):
    """CoinGecko free API — no Tor needed"""
    resp = requests.get(
        'https://api.coingecko.com/api/v3/simple/price',
        params={'ids': 'bitcoin', 'vs_currencies': fiat},
        timeout=15,
    )
    return int(resp.json()['bitcoin'][fiat])

PRICE_PROVIDERS = {
    'bisq_tor': _price_bisq_tor,
    'kraken': _price_kraken,
    'coingecko': _price_coingecko,
}

def fetch_reference_price(fiat='eur'):
    """Fetch BTC reference price using the configured provider"""
    provider_fn = PRICE_PROVIDERS.get(PRICE_PROVIDER)
    if not provider_fn:
        print(f"[RefPrice] Unknown provider '{PRICE_PROVIDER}', available: {list(PRICE_PROVIDERS.keys())}")
        return 0
    try:
        price = provider_fn(fiat)
        print(f"[RefPrice] {PRICE_PROVIDER}: {price} {fiat.upper()}")
        return price
    except Exception as e:
        print(f"[RefPrice] Error from {PRICE_PROVIDER}: {e}")
    return 0

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def save_snapshot(exchange, fiat, direction, btc_price, offers):
    if not offers:
        print(f"[{exchange}] No offers to save")
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    # Record the snapshot for ref price history
    cursor.execute(
        "INSERT INTO snapshots (exchange, fiat_currency, direction, btc_price) VALUES (?, ?, ?, ?)",
        (exchange, fiat, direction, btc_price)
    )

    updated = 0
    inserted = 0
    for offer in offers:
        offer_id = offer.get('offer_id')
        price = offer['price']
        diff = offer.get('price_diff_percent')
        btc_min = offer.get('btc_min')
        btc_max = offer.get('btc_max')
        fiat_min = offer.get('fiat_min')
        fiat_max = offer.get('fiat_max')
        payment = offer.get('payment_method')

        # Try to find existing offer by offer_id or composite fingerprint
        if offer_id:
            cursor.execute(
                "SELECT id FROM offers WHERE offer_id = ?", (offer_id,)
            )
        else:
            cursor.execute("""
                SELECT id FROM offers
                WHERE exchange = ? AND direction = ? AND price = ?
                  AND btc_min = ? AND btc_max = ? AND payment_method = ?
            """, (exchange, direction, price, btc_min, btc_max, payment))

        row = cursor.fetchone()
        if row:
            cursor.execute("""
                UPDATE offers
                SET last_seen = CURRENT_TIMESTAMP, price_diff_percent = ?, ref_price = ?
                WHERE id = ?
            """, (diff, btc_price, row[0]))
            updated += 1
        else:
            cursor.execute("""
                INSERT INTO offers
                (exchange, direction, price, price_diff_percent, btc_min, btc_max,
                 fiat_min, fiat_max, payment_method, offer_id, ref_price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (exchange, direction, price, diff, btc_min, btc_max,
                  fiat_min, fiat_max, payment, offer_id, btc_price))
            inserted += 1

    conn.commit()
    conn.close()
    print(f"[{exchange}] {inserted} new, {updated} updated ({direction})")

def fetch_bisq(direction='sell', btc_price=None):
    """Fetch offers from Bisq daemon via gRPC"""
    if not btc_price:
        btc_price = fetch_reference_price('eur')
    if not btc_price:
        print("[Bisq] Could not get reference price")
        return None

    offers = []
    try:
        channel = grpc.insecure_channel(BISQ_GRPC_HOST)
        stub = grpc_pb2_grpc.OffersStub(channel)
        reply = stub.GetOffers(
            grpc_pb2.GetOffersRequest(direction=direction.upper(), currency_code='EUR'),
            metadata=[('password', '')],
            timeout=60,
        )
        for o in reply.offers:
            price = float(o.price)
            offers.append({
                'price': price,
                'price_diff_percent': round((price / btc_price - 1) * 100, 2) if btc_price else None,
                'btc_min': o.min_amount / 1e8,
                'btc_max': o.amount / 1e8,
                'fiat_min': int(float(o.min_volume)),
                'fiat_max': int(float(o.volume)),
                'payment_method': o.payment_method_short_name,
                'offer_id': o.id,
            })
        channel.close()
    except Exception as e:
        print(f"[Bisq] Error getting {direction} offers: {e}")

    return {'btc_price': btc_price, 'offers': offers}

def fetch_hodlhodl(direction='sell', btc_price=None):
    """Fetch offers directly from HodlHodl REST API"""
    try:
        resp = requests.get(
            'https://hodlhodl.com/api/v1/offers',
            params={
                'filters[side]': direction,
                'filters[include_global]': 'true',
                'filters[currency_code]': 'EUR',
                'filters[only_working_now]': 'true',
                'sort[by]': 'price',
            },
            timeout=30,
        )
        offers = []
        for o in resp.json().get('offers', []):
            try:
                price = float(o['price'])
                fiat_min = int(float(o['min_amount']))
                fiat_max = int(float(o['max_amount']))
                if direction == 'buy':
                    method = o['payment_methods'][0]['name']
                else:
                    method = o['payment_method_instructions'][0]['payment_method_name']
                if 'SEPA' in method:
                    method = 'SEPA'
                elif 'Any national bank' in method:
                    method = 'NATIONAL_BANK'
                offers.append({
                    'offer_id': o['id'],
                    'price': price,
                    'price_diff_percent': round((price / btc_price - 1) * 100, 2) if btc_price else None,
                    'btc_min': round(fiat_min / price, 8),
                    'btc_max': round(fiat_max / price, 8),
                    'fiat_min': fiat_min,
                    'fiat_max': fiat_max,
                    'payment_method': method,
                })
            except (KeyError, IndexError, ValueError, ZeroDivisionError):
                continue
        print(f"[HodlHodl] Found {len(offers)} {direction} offers")
        return {'btc_price': btc_price or 0, 'offers': offers}
    except Exception as e:
        print(f"[HodlHodl] Error: {e}")
        return {'btc_price': 0, 'offers': []}

def fetch_robosats(direction='sell', btc_price=None):
    """Fetch offers directly from Robosats via Tor. EUR=2; sell=type1, buy=type0."""
    offer_type = 1 if direction == 'sell' else 0
    session = _tor_session()
    for onion in ROBOSATS_ONIONS:
        try:
            resp = session.get(
                f'{onion}/api/book/',
                params={'currency': 2, 'type': offer_type},
                timeout=30,
            )
            offers = []
            for line in resp.json():
                if line == 'not_found':
                    break
                try:
                    price = float(line['price'])
                    if line['amount'] is not None:
                        fiat_min = fiat_max = int(float(line['amount']))
                    else:
                        fiat_min = int(float(line['min_amount']))
                        fiat_max = int(float(line['max_amount']))
                    offers.append({
                        'offer_id': str(line['id']),
                        'price': price,
                        'price_diff_percent': round(float(line['premium']), 2),
                        'btc_min': round(fiat_min / price, 8) if price else None,
                        'btc_max': round(fiat_max / price, 8) if price else None,
                        'fiat_min': fiat_min,
                        'fiat_max': fiat_max,
                        'payment_method': line['payment_method'],
                    })
                except (KeyError, ValueError, ZeroDivisionError):
                    continue
            print(f"[Robosats] Found {len(offers)} {direction} offers")
            return {'btc_price': btc_price or 0, 'offers': offers}
        except Exception as e:
            print(f"[Robosats] {onion} failed: {e}, trying next...")
    print("[Robosats] All onion addresses failed")
    return {'btc_price': 0, 'offers': []}

def write_snapshot_log(exchange_data):
    """exchange_data: {exchange: set_of_offer_ids}"""
    exchanges = {
        ex: {'count': len(ids), 'ids': list(ids)}
        for ex, ids in exchange_data.items()
    }
    total = sum(len(ids) for ids in exchange_data.values())
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO snapshot_log (exchanges, offers_count) VALUES (?, ?)",
        (json.dumps(exchanges), total)
    )
    conn.commit()
    conn.close()

def fetch_and_save(exchange, fetch_fn, direction, ref_price):
    """Fetch offers for a given exchange and direction, then save.
    Returns set of captured offer IDs if exchange responded, None otherwise."""
    data = fetch_fn(direction, btc_price=ref_price)
    if data and data['offers']:
        price = data['btc_price'] or ref_price
        save_snapshot(exchange, 'EUR', direction, price, data['offers'])
        return {o['offer_id'] for o in data['offers'] if o.get('offer_id')}
    return None

def main():
    print("=== Starting orderbook snapshot ===")

    ref_price = fetch_reference_price('eur')
    if not ref_price:
        print("Could not get reference price, aborting")
        return
    print(f"Reference price: {ref_price} EUR")

    exchange_data = {}  # {exchange: set of unique offer IDs seen this run}

    for direction in ('sell', 'buy'):
        print(f"\n--- Fetching {direction} offers ---")
        for exchange, fn in [('bisq', fetch_bisq), ('hodlhodl', fetch_hodlhodl), ('robosats', fetch_robosats)]:
            ids = fetch_and_save(exchange, fn, direction, ref_price)
            if ids is not None:
                exchange_data.setdefault(exchange, set()).update(ids)

    write_snapshot_log(exchange_data)
    total = sum(len(ids) for ids in exchange_data.values())
    print(f"\n=== Snapshot complete — {total} offers from {sorted(exchange_data)} ===")

if __name__ == "__main__":
    main()
