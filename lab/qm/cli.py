"""Command line: python -m qm [--root DIR] [--book paper|real] <command> ..."""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date

from . import engine, ops, report
from .store import Workspace, parse_date

def _today(args) -> date:
    return parse_date(args.date) if args.date else date.today()


def _summary(ws: Workspace, day: date, add: float = 0.0) -> dict:
    return engine.summary(ws.config(), ws.ledger(), ws.prices(), day, add=add)


def cmd_init(ws, args):
    os.makedirs(os.path.dirname(ws.ledger_path), exist_ok=True)
    ops.init(ws, _today(args))
    print(f"ready: {ws.root} (book: {ws.book})")


def cmd_deposit(ws, args):
    print(ops.deposit(ws, _today(args), args.amount, args.note))


def cmd_withdraw(ws, args):
    print(ops.withdraw(ws, _today(args), args.amount, args.note))


def cmd_buy(ws, args):
    print(ops.buy(ws, _today(args), args.instrument, args.amount, units=args.units, price=args.price,
                  fee=args.fee, fee_pct=args.fee_pct, note=args.note))


def cmd_sell(ws, args):
    print(ops.sell(ws, _today(args), args.instrument, units=args.units, sell_all=args.all, price=args.price,
                   fee=args.fee, fee_pct=args.fee_pct, note=args.note))


def cmd_income(ws, args):
    print(ops.income(ws, _today(args), args.instrument, args.amount, args.note))


def cmd_price(ws, args):
    print(ops.set_price(ws, _today(args), args.instrument, args.price, args.source))


def cmd_mark(ws, args):
    print(ops.mark(ws, _today(args), args.instrument, args.value))


def cmd_accrue(ws, args):
    print(ops.accrue(ws, _today(args), args.instrument, args.rate))


def cmd_status(ws, args):
    print(report.render_text(_summary(ws, _today(args), args.add), ws.book))


def cmd_report(ws, args):
    s = _summary(ws, _today(args), args.add)
    out = args.out or os.path.join(ws.root, "reports", f"{ws.book}-{s['asof']}.html")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(report.render_html(s, ws.book, title=args.title, banner=args.banner))
    json_path = os.path.splitext(out)[0] + ".json"
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(report.render_json(s, ws.book))
    print(report.render_text(s, ws.book))
    print(f"\nwrote {out}\nwrote {json_path}")


def cmd_fetch(ws, args):
    from . import fetch

    res = fetch.fetch_all(ws, _today(args))
    for line in res["ok"]:
        print("ok    ", line)
    for name, err in res["failed"].items():
        print("FAILED", name, err)
    if res["failed"] and not res["ok"]:
        raise SystemExit(1)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="qm", description="Portfolio tracker and monthly buy planner")
    p.add_argument("--root", default=os.environ.get("QM_ROOT", "."), help="workspace folder (default: . or $QM_ROOT)")
    p.add_argument("--book", default=os.environ.get("QM_BOOK", "paper"), help="ledger to use: paper or real")
    p.add_argument("--date", help="YYYY-MM-DD (default: today)")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        sp = sub.add_parser(name, help=help_)
        sp.set_defaults(fn=fn)
        return sp

    add("init", cmd_init, "create the book and seed cash prices at 1.0")
    for name, fn in (("deposit", cmd_deposit), ("withdraw", cmd_withdraw)):
        sp = add(name, fn, f"{name} money to/from the wallet")
        sp.add_argument("amount", type=float)
        sp.add_argument("--note")
    sp = add("buy", cmd_buy, "buy an instrument with wallet money")
    sp.add_argument("instrument")
    sp.add_argument("--amount", type=float, required=True, help="total cash paid, fee included")
    sp.add_argument("--units", type=float, help="units received (price is derived)")
    sp.add_argument("--price", type=float, help="price per unit (units are derived)")
    sp.add_argument("--fee", type=float)
    sp.add_argument("--fee-pct", type=float)
    sp.add_argument("--note")
    sp = add("sell", cmd_sell, "sell units back to the wallet")
    sp.add_argument("instrument")
    sp.add_argument("--units", type=float)
    sp.add_argument("--all", action="store_true")
    sp.add_argument("--price", type=float)
    sp.add_argument("--fee", type=float)
    sp.add_argument("--fee-pct", type=float)
    sp.add_argument("--note")
    sp = add("income", cmd_income, "cash paid out by an instrument (e.g. certificate return)")
    sp.add_argument("instrument")
    sp.add_argument("amount", type=float)
    sp.add_argument("--note")
    sp = add("price", cmd_price, "record a price")
    sp.add_argument("instrument")
    sp.add_argument("price", type=float)
    sp.add_argument("--source", default="manual")
    sp = add("mark", cmd_mark, "record the balance the app shows for a holding")
    sp.add_argument("instrument")
    sp.add_argument("value", type=float)
    sp = add("accrue", cmd_accrue, "grow a price at an annual rate (paper books)")
    sp.add_argument("instrument")
    sp.add_argument("--rate", type=float, required=True, help="annual rate, e.g. 0.18")
    for name, fn, help_ in (("status", cmd_status, "print status and the buy plan"),
                            ("report", cmd_report, "write the HTML + JSON report")):
        sp = add(name, fn, help_)
        sp.add_argument("--add", type=float, default=0.0, help="money you are about to deposit (not yet recorded)")
        if name == "report":
            sp.add_argument("--out")
            sp.add_argument("--title", default="تقرير المحفظة")
            sp.add_argument("--banner")
    add("fetch", cmd_fetch, "pull reference prices (needs internet)")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    ws = Workspace(args.root, args.book)
    if not os.path.exists(ws.config_path):
        raise SystemExit(f"config not found: {ws.config_path}. Run from the project folder or pass --root.")
    try:
        args.fn(ws, args)
    except ValueError as e:  # includes ops.OpError
        raise SystemExit(f"error: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
