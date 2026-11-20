"""Files on disk: config, the shared price history, and one ledger per book.

Layout under the workspace root:
    config/portfolio.json      targets, instruments, rules
    data/prices.csv            date,instrument,price,source   (shared by all books)
    books/<book>/ledger.csv    date,type,instrument,units,price,amount,fee,note
"""
from __future__ import annotations

import bisect
import csv
import json
import os
from collections import defaultdict
from datetime import date, datetime

LEDGER_FIELDS = ["date", "type", "instrument", "units", "price", "amount", "fee", "note"]
PRICE_FIELDS = ["date", "instrument", "price", "source"]
LEDGER_TYPES = {"deposit", "withdraw", "buy", "sell", "income", "fee"}


def parse_date(value) -> date:
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()


def _num(value) -> float:
    if value is None or str(value).strip() == "":
        return 0.0
    return float(value)


class PriceStore:
    """Price history per instrument. A later row for the same day replaces the earlier one."""

    def __init__(self, rows=()):
        by_inst: dict[str, dict[date, float]] = defaultdict(dict)
        for r in rows:
            by_inst[r["instrument"]][parse_date(r["date"])] = float(r["price"])
        self._dates: dict[str, list[date]] = {}
        self._prices: dict[str, list[float]] = {}
        for inst, d in by_inst.items():
            days = sorted(d)
            self._dates[inst] = days
            self._prices[inst] = [d[x] for x in days]

    def get(self, instrument: str, asof: date):
        """Latest price on or before `asof` as (price, date), or (None, None)."""
        days = self._dates.get(instrument)
        if not days:
            return None, None
        i = bisect.bisect_right(days, asof) - 1
        if i < 0:
            return None, None
        return self._prices[instrument][i], days[i]

    def series(self, instrument: str, asof: date | None = None):
        days = self._dates.get(instrument, [])
        prices = self._prices.get(instrument, [])
        out = list(zip(days, prices))
        if asof is not None:
            out = [(d, p) for d, p in out if d <= asof]
        return out

    def all_dates(self, instruments=None) -> set:
        out = set()
        for inst, days in self._dates.items():
            if instruments is None or inst in instruments:
                out.update(days)
        return out


class Workspace:
    def __init__(self, root: str, book: str = "paper"):
        self.root = os.path.abspath(root)
        self.book = book
        self.config_path = os.path.join(self.root, "config", "portfolio.json")
        self.prices_path = os.path.join(self.root, "data", "prices.csv")
        self.ledger_path = os.path.join(self.root, "books", book, "ledger.csv")

    # -- config -----------------------------------------------------------
    def config(self) -> dict:
        with open(self.config_path, encoding="utf-8") as f:
            return json.load(f)

    # -- ledger -----------------------------------------------------------
    def ledger(self) -> list[dict]:
        if not os.path.exists(self.ledger_path):
            return []
        rows = []
        with open(self.ledger_path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                if not r.get("date"):
                    continue
                kind = r["type"].strip().lower()
                if kind not in LEDGER_TYPES:
                    raise ValueError(f"unknown ledger type {kind!r} in {self.ledger_path}")
                rows.append(
                    {
                        "date": parse_date(r["date"]),
                        "type": kind,
                        "instrument": (r.get("instrument") or "").strip(),
                        "units": _num(r.get("units")),
                        "price": _num(r.get("price")),
                        "amount": _num(r.get("amount")),
                        "fee": _num(r.get("fee")),
                        "note": r.get("note") or "",
                    }
                )
        rows.sort(key=lambda r: r["date"])
        return rows

    def append_ledger(self, **row) -> None:
        os.makedirs(os.path.dirname(self.ledger_path), exist_ok=True)
        new = not os.path.exists(self.ledger_path) or os.path.getsize(self.ledger_path) == 0
        out = {k: row.get(k, "") for k in LEDGER_FIELDS}
        out["date"] = parse_date(out["date"]).isoformat()
        with open(self.ledger_path, "a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=LEDGER_FIELDS)
            if new:
                w.writeheader()
            w.writerow(out)

    # -- prices -----------------------------------------------------------
    def price_rows(self) -> list[dict]:
        if not os.path.exists(self.prices_path):
            return []
        with open(self.prices_path, encoding="utf-8", newline="") as f:
            return [r for r in csv.DictReader(f) if r.get("date")]

    def prices(self) -> PriceStore:
        return PriceStore(self.price_rows())

    def append_price(self, day, instrument: str, price: float, source: str = "manual") -> None:
        if price <= 0:
            raise ValueError("price must be positive")
        os.makedirs(os.path.dirname(self.prices_path), exist_ok=True)
        new = not os.path.exists(self.prices_path) or os.path.getsize(self.prices_path) == 0
        with open(self.prices_path, "a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=PRICE_FIELDS)
            if new:
                w.writeheader()
            w.writerow(
                {
                    "date": parse_date(day).isoformat(),
                    "instrument": instrument,
                    "price": repr(float(price)),
                    "source": source,
                }
            )
