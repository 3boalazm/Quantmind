"""Optional reference prices from free public endpoints (no API keys).

These give *reference* levels only. What your holdings are actually worth is
whatever the app shows, so use `mark` for Thndr balances and fund NAVs.

Written against the public documentation of each endpoint but NOT exercised
live in the environment where this was built (it had no outbound access), so
the first run on your machine is the real test. Every source fails on its own
without stopping the others.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import date, datetime, timezone

GRAMS_PER_TROY_OUNCE = 31.1034768
UA = {"User-Agent": "quantmind/0.1 (personal portfolio tracker)"}


def _get(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def btc_daily(limit: int = 260) -> list[tuple[date, float]]:
    """Daily BTCUSDT closes from Binance spot klines, oldest first."""
    data = _get(f"https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit={limit}")
    out = []
    for k in data:
        day = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).date()
        out.append((day, float(k[4])))
    return out


def usd_egp() -> float:
    data = _get("https://open.er-api.com/v6/latest/USD")
    return float(data["rates"]["EGP"])


def xau_usd() -> float:
    data = _get("https://api.gold-api.com/price/XAU")
    return float(data["price"])


def fetch_all(ws, today: date) -> dict:
    """Append what could be fetched to the workspace price file. Returns {'ok': [...], 'failed': {...}}."""
    ok, failed = [], {}
    rate = None
    try:
        rate = usd_egp()
        ws.append_price(today, "REF_USDEGP", rate, "open.er-api.com")
        ok.append(f"REF_USDEGP {rate:.4f}")
    except Exception as e:  # noqa: BLE001 - one bad source must not stop the rest
        failed["REF_USDEGP"] = repr(e)
    try:
        ounce = xau_usd()
        ws.append_price(today, "REF_XAUUSD", ounce, "gold-api.com")
        ok.append(f"REF_XAUUSD {ounce:.2f}")
        if rate:
            gram = ounce / GRAMS_PER_TROY_OUNCE * rate
            ws.append_price(today, "REF_GOLD24_EGP", gram, "derived")
            ok.append(f"REF_GOLD24_EGP {gram:.2f} (global price x official rate; local price is usually higher)")
    except Exception as e:  # noqa: BLE001
        failed["REF_XAUUSD"] = repr(e)
    try:
        known = {d for d, _ in ws.prices().series("REF_BTCUSD")}
        closes = btc_daily()
        new = [(d, p) for d, p in closes if d not in known and d < today]  # skip today's unfinished candle
        for d, p in new:
            ws.append_price(d, "REF_BTCUSD", p, "binance")
        ok.append(f"REF_BTCUSD +{len(new)} daily closes (last {closes[-2][1]:.0f})")
    except Exception as e:  # noqa: BLE001
        failed["REF_BTCUSD"] = repr(e)
    return {"ok": ok, "failed": failed}
