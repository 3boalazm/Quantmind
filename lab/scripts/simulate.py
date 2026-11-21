"""End-to-end dry run: 14 monthly cycles driven through the real CLI commands.

PRICES HERE ARE MADE UP. The point is to exercise every moving part (deposits,
the buy plan, fees, stage changes, the certificate, whole-lot real-estate
purchases, income, alerts, the report), not to forecast anything.

    python scripts/simulate.py [output_dir]
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from datetime import date

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(LAB)  # repo root, where config/ lives
sys.path.insert(0, LAB)

from qm import cli, engine  # noqa: E402
from qm.store import Workspace  # noqa: E402

START = date(2026, 11, 20)
MONTHS = 14
CONTRIBUTION = 2000
CASH_RATE = 0.18
CERT_RATE = 0.19
RENT_RATE = 0.10

# invented monthly moves, in percent
GOLD = [0, -4, -3, 2, 5, 3, -2, 4, 6, -1, 2, 3, -5, 4]
INDEX = [0, 3, -6, 4, 5, -12, -9, 7, 6, 4, -3, 5, 2, 6]
ACTIVE = [0, 4, -8, 5, 7, -15, -10, 9, 7, 5, -4, 6, 3, 7]
REALESTATE = [0] + [1.2] * 13
START_PRICE = {"GOLD": 6500.0, "INDEX": 2.07, "ACTIVE": 1.94, "REALESTATE": 5000.0}
PATHS = {"GOLD": GOLD, "INDEX": INDEX, "ACTIVE": ACTIVE, "REALESTATE": REALESTATE}


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, min(d.day, 28))


def main(out_dir: str) -> None:
    root = tempfile.mkdtemp(prefix="qm-sim-")
    shutil.copytree(os.path.join(HERE, "config"), os.path.join(root, "config"))
    # the dry run is about the mechanics, so it runs with the stock gate open
    path = os.path.join(root, "config", "portfolio.json")
    with open(path, encoding="utf-8") as f:
        sim_config = json.load(f)
    sim_config["buckets"]["index"]["gate"]["closed"] = False
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sim_config, f, ensure_ascii=False, indent=2)
    ws = Workspace(root, "sim")

    def run(day: date, *args) -> None:
        cli.main(["--root", root, "--book", "sim", "--date", day.isoformat(), *map(str, args)])

    price = dict(START_PRICE)
    cert_bought = False
    log = []
    for m in range(MONTHS):
        day = add_months(START, m)
        if m == 0:
            run(day, "init")
        else:
            run(day, "accrue", "CASH", "--rate", CASH_RATE)
        for inst, path in PATHS.items():
            price[inst] *= 1 + path[m] / 100.0
            run(day, "price", inst, f"{price[inst]:.6f}", "--source", "simulated")

        pos = engine.positions(ws.ledger(), day)
        if pos["units"].get("CERT"):
            run(day, "income", "CERT", round(pos["units"]["CERT"] * CERT_RATE / 12, 2))
        if pos["units"].get("REALESTATE"):
            run(day, "income", "REALESTATE", round(pos["units"]["REALESTATE"] * price["REALESTATE"] * RENT_RATE / 12, 2))

        run(day, "deposit", CONTRIBUTION)
        s = engine.summary(ws.config(), ws.ledger(), ws.prices(), day)
        for od in s["plan"]["orders"]:
            extra = ["--fee-pct", 1] if od["instrument"] == "GOLD" else []
            run(day, "buy", od["instrument"], "--amount", od["amount"], *extra)
        for t in s["plan"]["transfers"]:
            cash_price = ws.prices().get("CASH", day)[0]
            run(day, "sell", "CASH", "--units", repr(t["amount"] / cash_price))
            run(day, "buy", t["to"], "--amount", t["amount"])

        # stage 2 note: move 5,000 of accumulated cash into the certificate, once
        after = engine.summary(ws.config(), ws.ledger(), ws.prices(), day)
        cash_held = after["holdings"] and next((h["value"] for h in after["holdings"] if h["instrument"] == "CASH"), 0)
        if not cert_bought and after["stage"]["name"] != "1" and cash_held >= 5500:
            cash_price = ws.prices().get("CASH", day)[0]
            run(day, "sell", "CASH", "--units", repr(5000 / cash_price))
            run(day, "buy", "CERT", "--amount", 5000)
            cert_bought = True
            after = engine.summary(ws.config(), ws.ledger(), ws.prices(), day)

        assert after["wallet"] < 1.0, f"month {m}: {after['wallet']} left uninvested"
        assert abs(after["invested"] + after["wallet"] - after["total"]) < 1e-6
        log.append((m, day, after))

    print("\n month  date         total  paid-in     P/L   drawdown  stage  alerts")
    for m, day, s in log:
        codes = ",".join(a["code"] for a in s["alerts"]) or "-"
        print(f" {m:>4}   {day}  {s['total']:>8,.0f}  {s['contributions']:>7,.0f}  {s['pnl']:>+6,.0f}"
              f"   {s['drawdown']:>7.2%}   {s['stage']['name']:>3}    {codes}")

    final_day = log[-1][1]
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "sample-simulation.html")
    cli.main(["--root", root, "--book", "sim", "--date", final_day.isoformat(), "report", "--out", out,
              "--add", str(CONTRIBUTION), "--title", "تقرير المحفظة (محاكاة)",
              "--banner", "محاكاة لاختبار النظام: الأسعار هنا افتراضية ومش بيانات حقيقية ولا توقع."])
    shutil.copy(ws.ledger_path, os.path.join(out_dir, "sample-simulation-ledger.csv"))
    shutil.rmtree(root)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(LAB, "reports"))
