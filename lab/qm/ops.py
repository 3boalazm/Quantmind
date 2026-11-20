"""Write operations, shared by the command line and the web API.

Each function validates against the current ledger, appends to the store and
returns a short message. User mistakes raise OpError.

A store is anything with: config(), ledger(), prices(), append_ledger(**row),
append_price(day, instrument, price, source) and a `book` attribute.
"""
from __future__ import annotations

from datetime import date

from . import engine

EPS = 1e-9
TOL = 0.005  # half a piastre


class OpError(ValueError):
    pass


def _positive(value, name: str) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise OpError(f"{name} must be a number") from None
    if not value > 0 or value != value or value == float("inf"):
        raise OpError(f"{name} must be greater than zero")
    return value


def _instrument(store, inst: str) -> str:
    inst = (inst or "").strip().upper()
    known = store.config()["instruments"]
    if inst not in known:
        raise OpError(f"unknown instrument {inst!r}. Known: {', '.join(known)}")
    return inst


def _fee(base: float, fee, fee_pct) -> float:
    if fee is not None:
        fee = float(fee)
    else:
        fee = base * float(fee_pct or 0.0) / 100.0
    if fee < 0:
        raise OpError("fee cannot be negative")
    return fee


def init(store, day: date) -> str:
    prices = store.prices()
    for inst, meta in store.config()["instruments"].items():
        if meta["bucket"] == "cash" and prices.get(inst, day)[0] is None:
            store.append_price(day, inst, 1.0, "init")
    return f"ready (book: {store.book})"


def deposit(store, day: date, amount, note: str = "") -> str:
    amount = _positive(amount, "amount")
    store.append_ledger(date=day, type="deposit", amount=amount, note=note or "")
    return f"deposit {amount:,.2f}"


def withdraw(store, day: date, amount, note: str = "") -> str:
    amount = _positive(amount, "amount")
    wallet = engine.positions(store.ledger(), day)["wallet"]
    if amount > wallet + TOL:
        raise OpError(f"wallet has {wallet:,.2f}; sell something first")
    store.append_ledger(date=day, type="withdraw", amount=amount, note=note or "")
    return f"withdraw {amount:,.2f}"


def buy(store, day: date, instrument: str, amount, units=None, price=None, fee=None, fee_pct=None, note: str = "") -> str:
    inst = _instrument(store, instrument)
    amount = _positive(amount, "amount")
    wallet = engine.positions(store.ledger(), day)["wallet"]
    if amount > wallet + TOL:
        raise OpError(f"wallet has {wallet:,.2f}, need {amount:,.2f}. Record a deposit first.")
    fee = _fee(amount, fee, fee_pct)
    net = amount - fee
    if net <= 0:
        raise OpError("fee is larger than the amount")
    if units:
        units = _positive(units, "units")
        price = net / units
    else:
        price = _positive(price, "price") if price else store.prices().get(inst, day)[0]
        if not price:
            raise OpError(f"no price known for {inst}: give the price or the units received")
        units = net / price
    store.append_ledger(date=day, type="buy", instrument=inst, units=units, price=price,
                        amount=amount, fee=fee, note=note or "")
    store.append_price(day, inst, price, "trade")
    return f"buy {inst}: {units:,.6f} @ {price:,.4f} = {amount:,.2f} (fee {fee:,.2f})"


def sell(store, day: date, instrument: str, units=None, sell_all: bool = False, price=None, fee=None,
         fee_pct=None, note: str = "") -> str:
    inst = _instrument(store, instrument)
    held = engine.positions(store.ledger(), day)["units"].get(inst, 0.0)
    units = held if sell_all else (_positive(units, "units") if units else 0.0)
    if units <= EPS or units > held + EPS:
        raise OpError(f"holding {held:,.6f} {inst}; cannot sell {units:,.6f}")
    price = _positive(price, "price") if price else store.prices().get(inst, day)[0]
    if not price:
        raise OpError(f"no price known for {inst}: give the price")
    gross = units * price
    fee = _fee(gross, fee, fee_pct)
    if fee > gross:
        raise OpError("fee is larger than the proceeds")
    store.append_ledger(date=day, type="sell", instrument=inst, units=units, price=price,
                        amount=gross - fee, fee=fee, note=note or "")
    store.append_price(day, inst, price, "trade")
    return f"sell {inst}: {units:,.6f} @ {price:,.4f} -> {gross - fee:,.2f} to wallet (fee {fee:,.2f})"


def income(store, day: date, instrument: str, amount, note: str = "") -> str:
    inst = _instrument(store, instrument)
    amount = _positive(amount, "amount")
    # a payout can arrive after the holding was sold, so "held at some point up to that day" is the test
    if not any(r["type"] == "buy" and r["instrument"] == inst and r["date"] <= day for r in store.ledger()):
        raise OpError(f"no purchase of {inst} recorded up to {day}: record the buy before its income")
    store.append_ledger(date=day, type="income", instrument=inst, amount=amount, note=note or "")
    return f"income {inst} {amount:,.2f}"


def set_price(store, day: date, instrument: str, price, source: str = "manual") -> str:
    inst = (instrument or "").strip().upper()
    if not inst:
        raise OpError("instrument is required")
    price = _positive(price, "price")
    store.append_price(day, inst, price, source or "manual")
    return f"price {inst} = {price}"


def mark(store, day: date, instrument: str, value) -> str:
    """Set the price so that units x price equals the balance the app shows."""
    inst = _instrument(store, instrument)
    value = _positive(value, "value")
    units = engine.positions(store.ledger(), day)["units"].get(inst, 0.0)
    if units <= EPS:
        raise OpError(f"no {inst} held in book {store.book!r} on {day}")
    price = value / units
    store.append_price(day, inst, price, f"mark:{store.book}")
    return f"mark {inst}: {units:,.6f} x {price:,.6f} = {value:,.2f}"


def accrue(store, day: date, instrument: str, rate) -> str:
    """Grow the last known price at an annual rate up to `day` (for paper books)."""
    inst = (instrument or "").strip().upper()
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        raise OpError("rate must be a number, e.g. 0.18") from None
    if not -0.99 < rate < 5:
        raise OpError("rate looks wrong: use 0.18 for 18% a year")
    last, when = store.prices().get(inst, day)
    if last is None:
        raise OpError(f"no earlier price for {inst}")
    days = (day - when).days
    price = last * (1.0 + rate) ** (days / 365.0)
    store.append_price(day, inst, price, f"accrue:{rate}")
    return f"accrue {inst}: {last:.6f} -> {price:.6f} over {days} days at {rate:.2%}/yr"


def check_removal(ledger: list[dict], row_id) -> None:
    """Refuse to delete a row if that would leave the wallet or a holding negative at any point."""
    rest = [r for r in ledger if r.get("id") != row_id]
    if len(rest) == len(ledger):
        raise OpError("entry not found")
    wallet = 0.0
    units: dict[str, float] = {}
    for r in sorted(rest, key=lambda r: (r["date"], r.get("id") or 0)):
        kind = r["type"]
        if kind in ("deposit", "income"):
            wallet += r["amount"]
        elif kind in ("withdraw", "fee"):
            wallet -= r["amount"]
        elif kind == "buy":
            wallet -= r["amount"]
            units[r["instrument"]] = units.get(r["instrument"], 0.0) + r["units"]
        elif kind == "sell":
            wallet += r["amount"]
            units[r["instrument"]] = units.get(r["instrument"], 0.0) - r["units"]
        if wallet < -TOL:
            raise OpError("cannot delete: later entries spend this money. Delete those first.")
        if any(u < -EPS for u in units.values()):
            raise OpError("cannot delete: a later sale depends on this purchase. Delete that first.")
