#!/usr/bin/env python3
"""
Orderbook snapshot script - captures orderbook data from Bisq, HodlHodl, and Robosats
"""

import sqlite3
import subprocess
import json
import os
import sys
import re
import requests

# Use /app/data for Docker, default to local path for development
DB_PATH = os.environ.get('DB_PATH', '/home/claudio_clawd_bot/orderbook/orderbook.db')
NOKYC_DIR = os.environ.get('NOKYC_DIR', '/home/claudio_clawd_bot/nokyc')
VENV_PYTHON = os.environ.get('VENV_PYTHON', f"{NOKYC_DIR}/venv/bin/python")
BISQ_CLI_JAR = os.environ.get('BISQ_CLI_JAR', '/opt/bisq/bisq-cli-1.9.22/cli.jar')
PRICE_PROVIDER = os.environ.get('PRICE_PROVIDER', 'bisq_tor')

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
    """Fetch offers from local Bisq daemon"""
    offers = []
    if not btc_price:
        btc_price = fetch_reference_price('eur')
    if not btc_price:
        print("[Bisq] Could not get reference price")
        return None

    dir_upper = direction.upper()
    try:
        result = subprocess.run(
            ["java", "-jar", BISQ_CLI_JAR, "--port", "9998", "--password=", "getoffers", f"--direction={direction}", "--currency-code=EUR"],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            for line in lines[1:]:
                if not line.strip() or line.startswith('Buy/Sell'):
                    continue
                parts = line.split()
                if len(parts) >= 4 and parts[0] == dir_upper:
                    try:
                        price = float(parts[1].replace(',', ''))
                        btc_min = float(parts[2])
                        btc_max = btc_min
                        fiat_min = int(parts[3].replace(',', ''))
                        fiat_max = fiat_min
                        payment_method = ' '.join(parts[4:-2]) if len(parts) > 4 else 'Unknown'

                        offers.append({
                            'price': price,
                            'price_diff_percent': round((price / btc_price - 1) * 100, 2) if btc_price else None,
                            'btc_min': btc_min,
                            'btc_max': btc_max,
                            'fiat_min': fiat_min,
                            'fiat_max': fiat_max,
                            'payment_method': payment_method,
                            'offer_id': parts[-1]
                        })
                    except (ValueError, IndexError):
                        continue
    except Exception as e:
        print(f"[Bisq] Error getting {direction} offers: {e}")

    return {
        'btc_price': btc_price,
        'offers': offers
    }

def parse_nokyc_output(output, exchange_name):
    """Parse nokyc output for offers"""
    offers = []
    btc_price = 0
    
    # First, extract the reference price
    for line in output.split('\n'):
        if 'Price:' in line:
            try:
                price_match = re.search(r'Price:\s*(\d+)', line)
                if price_match:
                    btc_price = float(price_match.group(1))
            except:
                pass
    
    if not btc_price:
        return {'btc_price': 0, 'offers': []}
    
    # Parse offer lines
    # Format: Exchange Price EUR Dif BTC_min BTC_max Fiat_min Fiat_max Payment_Method
    for line in output.split('\n'):
        if exchange_name in line and 'EUR' in line:
            # Use regex for more robust parsing
            match = re.search(
                rf'{exchange_name}\s+(\d+)\s+EUR\s+([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(.+)',
                line
            )
            if match:
                try:
                    price = float(match.group(1))
                    dif_pct = float(match.group(2))
                    btc_min = float(match.group(3))
                    btc_max = float(match.group(4))
                    fiat_min = int(match.group(5))
                    fiat_max = int(match.group(6))
                    payment_method = match.group(7).strip()
                    
                    offers.append({
                        'price': price,
                        'price_diff_percent': dif_pct,
                        'btc_min': btc_min,
                        'btc_max': btc_max,
                        'fiat_min': fiat_min,
                        'fiat_max': fiat_max,
                        'payment_method': payment_method,
                        'offer_id': None
                    })
                except (ValueError, IndexError):
                    continue
    
    return {
        'btc_price': btc_price,
        'offers': offers
    }

def fetch_hodlhodl(direction='sell'):
    """Fetch offers from HodlHodl via nokyc"""
    try:
        result = subprocess.run(
            [VENV_PYTHON, f"{NOKYC_DIR}/nokyc.py", "-f", "eur", "-t", direction, "-d", "5", "-e", "hodlhodl"],
            capture_output=True, text=True, timeout=60, cwd=NOKYC_DIR
        )
        output = result.stdout + result.stderr
        data = parse_nokyc_output(output, 'HodlHodl')
        print(f"[HodlHodl] Found {len(data['offers'])} {direction} offers, ref price: {data['btc_price']}")
        return data
    except Exception as e:
        print(f"[HodlHodl] Error: {e}")
        return {'btc_price': 0, 'offers': []}

def fetch_robosats(direction='sell'):
    """Fetch offers from Robosats via nokyc"""
    try:
        result = subprocess.run(
            [VENV_PYTHON, f"{NOKYC_DIR}/nokyc.py", "-f", "eur", "-t", direction, "-d", "5", "-e", "robosats"],
            capture_output=True, text=True, timeout=60, cwd=NOKYC_DIR
        )
        output = result.stdout + result.stderr
        data = parse_nokyc_output(output, 'Robosats')
        print(f"[Robosats] Found {len(data['offers'])} offers, ref price: {data['btc_price']}")
        return data
    except Exception as e:
        print(f"[Robosats] Error: {e}")
        return {'btc_price': 0, 'offers': []}

def fetch_and_save(exchange, fetch_fn, direction, ref_price):
    """Fetch offers for a given exchange and direction, then save"""
    if fetch_fn == fetch_bisq:
        data = fetch_fn(direction, btc_price=ref_price)
    else:
        data = fetch_fn(direction)
    if data and data['offers']:
        price = data['btc_price'] or ref_price
        save_snapshot(exchange, 'EUR', direction, price, data['offers'])

def main():
    print("=== Starting orderbook snapshot ===")

    ref_price = fetch_reference_price('eur')
    if not ref_price:
        print("Could not get reference price, aborting")
        return
    print(f"Reference price: {ref_price} EUR")

    for direction in ('sell', 'buy'):
        print(f"\n--- Fetching {direction} offers ---")
        fetch_and_save('bisq', fetch_bisq, direction, ref_price)
        fetch_and_save('hodlhodl', fetch_hodlhodl, direction, ref_price)
        fetch_and_save('robosats', fetch_robosats, direction, ref_price)

    print("\n=== Snapshot complete ===")

if __name__ == "__main__":
    main()
