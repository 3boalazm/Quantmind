"""Write tests/fixtures/golden.json: inputs plus the Python engine's answers.

The TypeScript engine (src/lib/engine.ts) must reproduce these. Run after any
change to lab/qm/engine.py:

    python lab/scripts/golden.py
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import sys
import tempfile
from datetime import date, timedelta

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(LAB)
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.join(LAB, "scripts"))

import simulate  # noqa: E402
from qm import engine  # noqa: E402
from qm.store import PriceStore, Workspace  # noqa: E402


def run_simulation():
    made = []
    real_mkdtemp, real_rmtree = tempfile.mkdtemp, shutil.rmtree
    tempfile.mkdtemp = lambda *a, **k: made.append(real_mkdtemp(*a, **k)) or made[-1]
    shutil.rmtree = lambda *a, **k: None
    out = real_mkdtemp(prefix="qm-golden-out-")
    try:
        stdout, sys.stdout = sys.stdout, open(os.devnull, "w")
        try:
            simulate.main(out)
        finally:
            sys.stdout.close()
            sys.stdout = stdout
    finally:
        tempfile.mkdtemp, shutil.rmtree = real_mkdtemp, real_rmtree
    ws = Workspace(made[0], "sim")
    data = ws.config(), ws.ledger(), ws.price_rows()
    real_rmtree(made[0])
    real_rmtree(out)
    return data


def jl(ledger):
    return [{**r, "date": r["date"].isoformat(), "id": i + 1} for i, r in enumerate(ledger)]


def jp(rows):
    return [{"date": str(r["date"]), "instrument": r["instrument"], "price": float(r["price"])} for r in rows]


def main():
    config, ledger, price_rows = run_simulation()
    scenarios = []

    def add(name, cfg, led, rows, asof, extra=0.0):
        expected = engine.summary(cfg, led, PriceStore(rows), asof, extra)
        scenarios.append({"name": name, "config": cfg, "ledger": jl(led), "prices": jp(rows),
                          "asof": asof.isoformat(), "add": extra, "expected": expected})

    days = sorted({r["date"] for r in ledger})
    for i, d in enumerate(days):
        add(f"sim month {i}", config, ledger, price_rows, d)
        if i % 3 == 0:
            add(f"sim month {i} +2000", config, ledger, price_rows, d, 2000.0)
    last = days[-1]
    add("sim mid-month (stale prices)", config, ledger, price_rows, days[5] + timedelta(days=17), 2000.0)
    add("sim +50 days after last", config, ledger, price_rows, last + timedelta(days=50), 750.5)
    add("sim large top-up", config, ledger, price_rows, days[3], 30000.0)

    add("empty", config, [], [], date(2026, 11, 20))
    add("empty +2000", config, [], [], date(2026, 11, 20), 2000.0)
    one = [{"date": date(2026, 11, 20), "type": "deposit", "instrument": "", "units": 0.0, "price": 0.0,
            "amount": 2000.0, "fee": 0.0, "note": ""}]
    add("single deposit", config, one, [{"date": "2026-11-20", "instrument": "CASH", "price": 1.0}], date(2026, 11, 20))

    # the shipped default: the stock gate is closed, so its share is reserved in cash
    gated = copy.deepcopy(config)
    gated["buckets"]["index"]["gate"]["closed"] = True
    add("gated: empty +2000", gated, [], [], date(2026, 11, 20), 2000.0)
    add("gated: single deposit", gated, one, [{"date": "2026-11-20", "instrument": "CASH", "price": 1.0}], date(2026, 11, 20))
    for i in (0, 5, len(days) - 1):
        add(f"gated: sim month {i} +2000", gated, ledger, price_rows, days[i], 2000.0)

    # crash: risk assets lose 60% a week after the last month -> review rule, buying goes on
    crash_day = last + timedelta(days=7)
    crash = list(price_rows)
    ps = PriceStore(price_rows)
    for inst in ("INDEX", "ACTIVE", "GOLD", "REALESTATE"):
        crash.append({"date": crash_day.isoformat(), "instrument": inst, "price": ps.get(inst, last)[0] * 0.4})
    add("crash review rule", config, ledger, crash, crash_day, 2000.0)
    add("gated: crash review rule", gated, ledger, crash, crash_day, 2000.0)
    mild = list(price_rows)
    for inst in ("INDEX", "ACTIVE", "GOLD"):
        mild.append({"date": crash_day.isoformat(), "instrument": inst, "price": ps.get(inst, last)[0] * 0.72})
    add("mild fall warn rule", config, ledger, mild, crash_day, 2000.0)

    # stage 3 after a deep fall: the review fires and every bucket stays open
    big_day = date(2026, 6, 1)
    big = [
        {"date": big_day, "type": "deposit", "instrument": "", "units": 0.0, "price": 0.0, "amount": 60000.0, "fee": 0.0, "note": ""},
        {"date": big_day, "type": "buy", "instrument": "CASH", "units": 24000.0, "price": 1.0, "amount": 24000.0, "fee": 0.0, "note": ""},
        {"date": big_day, "type": "buy", "instrument": "GOLD", "units": 4000.0 / 6500.0, "price": 6500.0, "amount": 4000.0, "fee": 0.0, "note": ""},
        {"date": big_day, "type": "buy", "instrument": "INDEX", "units": 8000.0, "price": 2.0, "amount": 16000.0, "fee": 0.0, "note": ""},
        {"date": big_day, "type": "buy", "instrument": "ACTIVE", "units": 8000.0, "price": 2.0, "amount": 16000.0, "fee": 0.0, "note": ""},
    ]
    big_px = [{"date": big_day.isoformat(), "instrument": i, "price": p}
              for i, p in (("CASH", 1.0), ("GOLD", 6500.0), ("INDEX", 2.0), ("ACTIVE", 2.0))]
    add("stage 3 calm: real-estate lot bought", config, big, big_px, big_day + timedelta(days=30), 12000.0)
    fall_day = big_day + timedelta(days=60)
    big_fall = big_px + [{"date": fall_day.isoformat(), "instrument": i, "price": 0.2} for i in ("INDEX", "ACTIVE")]
    add("stage 3 review rule: buying goes on", config, big, big_fall, fall_day, 12000.0)
    no_list = copy.deepcopy(config)
    del no_list["rules"]["review_buckets"]
    add("stage 3 deep fall, no review buckets", no_list, big, big_fall, fall_day, 12000.0)

    # crypto on, with a made-up BTC series
    cfg = copy.deepcopy(config)
    cfg["crypto"]["enabled"] = True
    add("crypto on, no series", cfg, ledger, price_rows, last, 2000.0)
    start = last - timedelta(days=259)
    down = [{"date": (start + timedelta(days=i)).isoformat(), "instrument": "REF_BTCUSD", "price": 90000.0 - 110.0 * i}
            for i in range(260)]
    up = [{"date": (start + timedelta(days=i)).isoformat(), "instrument": "REF_BTCUSD", "price": 50000.0 + 90.0 * i}
          for i in range(260)]
    add("crypto on, downtrend", cfg, ledger, price_rows + down, last, 2000.0)
    add("crypto on, uptrend", cfg, ledger, price_rows + up, last, 2000.0)
    short = down[-150:]
    add("crypto on, short series", cfg, ledger, price_rows + short, last, 2000.0)
    held = ledger + [
        {"date": last, "type": "deposit", "instrument": "", "units": 0.0, "price": 0.0, "amount": 800.0, "fee": 0.0, "note": ""},
        {"date": last, "type": "buy", "instrument": "BTC", "units": 0.0002, "price": 4000000.0, "amount": 800.0, "fee": 0.0, "note": ""},
    ]
    btc_px = [{"date": last.isoformat(), "instrument": "BTC", "price": 4000000.0}]
    add("crypto held, downtrend -> exit", cfg, held, price_rows + down + btc_px, last, 0.0)
    add("crypto held, crypto disabled", config, held, price_rows + down + btc_px, last + timedelta(days=3), 2000.0)

    # withdrawal and a fee row
    wd = ledger + [
        {"date": last + timedelta(days=2), "type": "sell", "instrument": "CASH", "units": 1000.0, "price": 1.2, "amount": 1200.0, "fee": 0.0, "note": ""},
        {"date": last + timedelta(days=2), "type": "withdraw", "instrument": "", "units": 0.0, "price": 0.0, "amount": 1000.0, "fee": 0.0, "note": ""},
        {"date": last + timedelta(days=3), "type": "fee", "instrument": "", "units": 0.0, "price": 0.0, "amount": 12.5, "fee": 0.0, "note": ""},
    ]
    add("withdraw and fee", config, wd, price_rows, last + timedelta(days=5), 0.0)

    out = os.path.join(ROOT, "tests", "fixtures", "golden.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"scenarios": scenarios}, f, ensure_ascii=False, default=str)
    print(f"{len(scenarios)} scenarios -> {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
