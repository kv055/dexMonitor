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

DB_PATH = "/home/claudio_clawd_bot/orderbook/orderbook.db"
NOKYC_DIR = "/home/claudio_clawd_bot/nokyc"
VENV_PYTHON = f"{NOKYC_DIR}/venv/bin/python"
BISQ_CLI = "/home/claudio_clawd_bot/bisq-cli/bisq-cli-1.9.22"

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def save_snapshot(exchange, fiat, direction, btc_price, offers):
    if not offers:
        print(f"[{exchange}] No offers to save")
        return
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "INSERT INTO snapshots (exchange, fiat_currency, direction, btc_price) VALUES (?, ?, ?, ?)",
        (exchange, fiat, direction, btc_price)
    )
    snapshot_id = cursor.lastrowid
    
    for offer in offers:
        cursor.execute("""
            INSERT INTO offers (snapshot_id, price, price_diff_percent, btc_min, btc_max, fiat_min, fiat_max, payment_method, offer_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            snapshot_id,
            offer['price'],
            offer.get('price_diff_percent'),
            offer.get('btc_min'),
            offer.get('btc_max'),
            offer.get('fiat_min'),
            offer.get('fiat_max'),
            offer.get('payment_method'),
            offer.get('offer_id')
        ))
    
    conn.commit()
    conn.close()
    print(f"[{exchange}] Saved {len(offers)} offers (snapshot_id={snapshot_id})")

def fetch_bisq():
    """Fetch offers from local Bisq daemon"""
    offers = []
    btc_price = 0
    
    # Get BTC price
    try:
        result = subprocess.run(
            ["java", "-jar", f"{BISQ_CLI}/cli.jar", "--port", "9998", "--password=", "getbtcprice", "--currency-code=EUR"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            btc_price = float(result.stdout.strip().replace(',', ''))
            print(f"[Bisq] BTC price: {btc_price} EUR")
    except Exception as e:
        print(f"[Bisq] Error getting price: {e}")
        return None
    
    # Get offers
    try:
        result = subprocess.run(
            ["java", "-jar", f"{BISQ_CLI}/cli.jar", "--port", "9998", "--password=", "getoffers", "--direction=sell", "--currency-code=EUR"],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            for line in lines[1:]:  # Skip header
                if not line.strip() or line.startswith('Buy/Sell'):
                    continue
                # Parse: SELL 59135.1124 0.01 591 Revolut 2026-03-22T15:31:21Z ...
                parts = line.split()
                if len(parts) >= 4 and parts[0] == 'SELL':
                    try:
                        price = float(parts[1].replace(',', ''))
                        btc_min = float(parts[2])
                        btc_max = btc_min
                        fiat_min = int(parts[3].replace(',', ''))
                        fiat_max = fiat_min
                        
                        # Payment method is everything after the date (4th+ elements, skip the date)
                        # Format: SELL price btc amount fiat_amount PAYMENT_METHOD DATE ID
                        payment_method = ' '.join(parts[4:-2]) if len(parts) > 4 else 'Unknown'
                        
                        offers.append({
                            'price': price,
                            'price_diff_percent': round((price / btc_price - 1) * 100, 2) if btc_price else None,
                            'btc_min': btc_min,
                            'btc_max': btc_max,
                            'fiat_min': fiat_min,
                            'fiat_max': fiat_max,
                            'payment_method': payment_method,
                            'offer_id': None
                        })
                    except (ValueError, IndexError) as e:
                        continue
    except Exception as e:
        print(f"[Bisq] Error getting offers: {e}")
    
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

def fetch_hodlhodl():
    """Fetch offers from HodlHodl via nokyc"""
    try:
        result = subprocess.run(
            [VENV_PYTHON, f"{NOKYC_DIR}/nokyc.py", "-f", "eur", "-t", "sell", "-d", "5", "-e", "hodlhodl"],
            capture_output=True, text=True, timeout=60, cwd=NOKYC_DIR
        )
        output = result.stdout + result.stderr
        data = parse_nokyc_output(output, 'HodlHodl')
        print(f"[HodlHodl] Found {len(data['offers'])} offers, ref price: {data['btc_price']}")
        return data
    except Exception as e:
        print(f"[HodlHodl] Error: {e}")
        return {'btc_price': 0, 'offers': []}

def fetch_robosats():
    """Fetch offers from Robosats via nokyc"""
    try:
        result = subprocess.run(
            [VENV_PYTHON, f"{NOKYC_DIR}/nokyc.py", "-f", "eur", "-t", "sell", "-d", "5", "-e", "robosats"],
            capture_output=True, text=True, timeout=60, cwd=NOKYC_DIR
        )
        output = result.stdout + result.stderr
        data = parse_nokyc_output(output, 'Robosats')
        print(f"[Robosats] Found {len(data['offers'])} offers, ref price: {data['btc_price']}")
        return data
    except Exception as e:
        print(f"[Robosats] Error: {e}")
        return {'btc_price': 0, 'offers': []}

def main():
    print("=== Starting orderbook snapshot ===")
    
    # Bisq
    print("Fetching Bisq...")
    bisq_data = fetch_bisq()
    if bisq_data and bisq_data['offers']:
        save_snapshot('bisq', 'EUR', 'sell', bisq_data['btc_price'], bisq_data['offers'])
    
    # HodlHodl
    print("Fetching HodlHodl...")
    hodlhodl_data = fetch_hodlhodl()
    if hodlhodl_data and hodlhodl_data['offers']:
        ref_price = hodlhodl_data['btc_price']
        save_snapshot('hodlhodl', 'EUR', 'sell', ref_price, hodlhodl_data['offers'])
    
    # Robosats
    print("Fetching Robosats...")
    robosats_data = fetch_robosats()
    if robosats_data and robosats_data['offers']:
        ref_price = robosats_data['btc_price']
        save_snapshot('robosats', 'EUR', 'sell', ref_price, robosats_data['offers'])
    
    print("=== Snapshot complete ===")

if __name__ == "__main__":
    main()
