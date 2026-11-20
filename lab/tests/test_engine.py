import json
import os
import unittest
from datetime import date, timedelta

from qm import engine
from qm.store import PriceStore

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(LAB)
D0 = date(2026, 11, 20)


def cfg(**over):
    with open(os.path.join(ROOT, "config", "portfolio.json"), encoding="utf-8") as f:
        c = json.load(f)
    c.update(over)
    return c


def row(d, kind, inst="", units=0.0, price=0.0, amount=0.0, fee=0.0):
    return {"date": d, "type": kind, "instrument": inst, "units": units, "price": price,
            "amount": amount, "fee": fee, "note": ""}


def store(*rows):
    return PriceStore([{"date": d.isoformat(), "instrument": i, "price": p} for d, i, p in rows])


def buy(d, inst, amount, price):
    return row(d, "buy", inst, units=amount / price, price=price, amount=amount)


class PlanTests(unittest.TestCase):
    def test_first_deposit_splits_60_20_20(self):
        c = cfg()
        ledger = [row(D0, "deposit", amount=2000)]
        s = engine.summary(c, ledger, store(), D0)
        got = {o["bucket"]: o["amount"] for o in s["plan"]["orders"]}
        self.assertEqual(got, {"cash": 1200, "gold": 400, "index": 400})

    def test_orders_always_sum_to_investable_and_never_sell(self):
        c = cfg()
        prices = store((D0, "CASH", 1.0), (D0, "GOLD", 6500.0), (D0, "INDEX", 2.0))
        # gold badly overweight
        ledger = [row(D0, "deposit", amount=6000), buy(D0, "GOLD", 3000, 6500.0),
                  buy(D0, "CASH", 500, 1.0), buy(D0, "INDEX", 500, 2.0)]
        s = engine.summary(c, ledger, prices, D0)
        orders = {o["bucket"]: o["amount"] for o in s["plan"]["orders"]}
        self.assertAlmostEqual(sum(orders.values()), 2000)
        self.assertNotIn("gold", orders)
        self.assertTrue(all(v > 0 for v in orders.values()))

    def test_stage_two_adds_active_fund(self):
        c = cfg()
        prices = store((D0, "CASH", 1.0), (D0, "GOLD", 6500.0), (D0, "INDEX", 2.0))
        ledger = [row(D0, "deposit", amount=8000), buy(D0, "CASH", 4800, 1.0),
                  buy(D0, "GOLD", 1600, 6500.0), buy(D0, "INDEX", 1600, 2.0)]
        s = engine.summary(c, ledger, prices, D0, add=2000)
        self.assertEqual(s["stage"]["name"], "1")
        self.assertEqual(s["plan"]["stage"]["name"], "2")
        self.assertTrue(s["plan"]["stage_changed"])
        orders = {o["bucket"]: o["amount"] for o in s["plan"]["orders"]}
        self.assertIn("active", orders)
        self.assertAlmostEqual(sum(orders.values()), 2000)

    def test_real_estate_is_parked_then_bought_in_whole_lots(self):
        c = cfg()
        prices = store((D0, "CASH", 1.0), (D0, "GOLD", 6500.0), (D0, "INDEX", 2.0), (D0, "ACTIVE", 2.0))
        ledger = [row(D0, "deposit", amount=24000), buy(D0, "CASH", 12000, 1.0),
                  buy(D0, "GOLD", 4800, 6500.0), buy(D0, "INDEX", 4800, 2.0), buy(D0, "ACTIVE", 2400, 2.0)]
        s = engine.summary(c, ledger, prices, D0, add=2000)
        p = s["plan"]
        self.assertEqual(p["stage"]["name"], "3")
        self.assertNotIn("real_estate", {o["bucket"] for o in p["orders"]})
        self.assertIn("real_estate", p["parked"])
        self.assertEqual([t["amount"] for t in p["transfers"]], [])  # cash not yet above its own target by a lot

        # more cash than its 40% target by over one lot -> one 5,000 share proposed
        ledger2 = [row(D0, "deposit", amount=30000), buy(D0, "CASH", 20000, 1.0),
                   buy(D0, "GOLD", 4000, 6500.0), buy(D0, "INDEX", 4000, 2.0), buy(D0, "ACTIVE", 2000, 2.0)]
        p2 = engine.summary(c, ledger2, prices, D0)["plan"]
        self.assertEqual([(t["to"], t["amount"]) for t in p2["transfers"]], [("REALESTATE", 5000.0)])

    def test_crypto_respects_minimum_order(self):
        c = cfg()
        c["crypto"]["enabled"] = True
        prices = store((D0, "CASH", 1.0), (D0, "GOLD", 6500.0), (D0, "INDEX", 2.0))
        ledger = [row(D0, "deposit", amount=5000), buy(D0, "CASH", 3000, 1.0),
                  buy(D0, "GOLD", 1000, 6500.0), buy(D0, "INDEX", 1000, 2.0)]
        p = engine.summary(c, ledger, prices, D0, add=2000)["plan"]
        crypto = [o["amount"] for o in p["orders"] if o["bucket"] == "crypto"]
        self.assertTrue(crypto and crypto[0] >= 400)

        small = engine.summary(c, ledger, prices, D0, add=300)["plan"]
        self.assertFalse([o for o in small["orders"] if o["bucket"] == "crypto"])
        self.assertIn("crypto", small["parked"])


class PerformanceTests(unittest.TestCase):
    def test_deposits_do_not_move_nav(self):
        c = cfg()
        d1 = D0 + timedelta(days=30)
        prices = store((D0, "CASH", 1.0), (d1, "CASH", 1.0))
        ledger = [row(D0, "deposit", amount=2000), buy(D0, "CASH", 2000, 1.0),
                  row(d1, "deposit", amount=2000), buy(d1, "CASH", 2000, 1.0)]
        s = engine.summary(c, ledger, prices, d1)
        self.assertAlmostEqual(s["nav"], 1.0)
        self.assertAlmostEqual(s["total"], 4000)
        self.assertAlmostEqual(s["drawdown"], 0.0)

    def test_nav_tracks_price_and_drawdown(self):
        c = cfg()
        d1, d2 = D0 + timedelta(days=30), D0 + timedelta(days=60)
        prices = store((D0, "INDEX", 2.0), (d1, "INDEX", 2.4), (d2, "INDEX", 1.8))
        ledger = [row(D0, "deposit", amount=1000), buy(D0, "INDEX", 1000, 2.0)]
        s = engine.summary(c, ledger, prices, d2)
        self.assertAlmostEqual(s["nav"], 0.9)
        self.assertAlmostEqual(s["drawdown"], 1.8 / 2.4 - 1)
        self.assertEqual(s["alerts"][0]["code"], "stop_drawdown")
        self.assertTrue(s["plan"]["stopped"])

    def test_stop_rule_sends_new_money_to_cash_and_gold_only(self):
        c = cfg()
        d1, d2 = D0 + timedelta(days=30), D0 + timedelta(days=60)
        prices = store((D0, "INDEX", 2.0), (d1, "INDEX", 2.4), (d2, "INDEX", 1.6))
        ledger = [row(D0, "deposit", amount=1000), buy(D0, "INDEX", 1000, 2.0)]
        p = engine.summary(c, ledger, prices, d2, add=2000)["plan"]
        self.assertEqual({o["bucket"] for o in p["orders"]}, {"cash", "gold"})
        self.assertAlmostEqual(sum(o["amount"] for o in p["orders"]), 2000)

    def test_first_day_fee_shows_in_nav(self):
        c = cfg()
        prices = store((D0, "GOLD", 6500.0))
        fee_buy = row(D0, "buy", "GOLD", units=990 / 6500.0, price=6500.0, amount=1000, fee=10)
        s = engine.summary(c, [row(D0, "deposit", amount=1000), fee_buy], prices, D0)
        self.assertAlmostEqual(s["nav"], 0.99)
        self.assertAlmostEqual(s["pnl"], -10)

    def test_all_cash_portfolio_equals_benchmark(self):
        c = cfg()
        d1, d2 = D0 + timedelta(days=30), D0 + timedelta(days=60)
        prices = store((D0, "CASH", 1.0), (d1, "CASH", 1.015), (d2, "CASH", 1.03))
        ledger = [row(D0, "deposit", amount=2000), buy(D0, "CASH", 2000, 1.0),
                  row(d1, "deposit", amount=2000), buy(d1, "CASH", 2000, 1.015)]
        s = engine.summary(c, ledger, prices, d2)
        self.assertTrue(s["benchmark"]["meaningful"])
        self.assertAlmostEqual(s["benchmark"]["value"], s["total"])
        self.assertAlmostEqual(s["cash_yield"], 1.03 ** (365 / 60) - 1)

    def test_income_and_withdraw(self):
        c = cfg()
        prices = store((D0, "CERT", 1.0))
        ledger = [row(D0, "deposit", amount=5000), buy(D0, "CERT", 5000, 1.0),
                  row(D0 + timedelta(days=31), "income", "CERT", amount=80),
                  row(D0 + timedelta(days=32), "withdraw", amount=50)]
        s = engine.summary(c, ledger, prices, D0 + timedelta(days=32))
        self.assertAlmostEqual(s["wallet"], 30)
        self.assertAlmostEqual(s["contributions"], 4950)
        self.assertAlmostEqual(s["pnl"], 80)
        self.assertAlmostEqual(s["nav"], 5080 / 5000)


class RuleTests(unittest.TestCase):
    def _btc(self, last5_below):
        c = cfg()
        c["crypto"]["enabled"] = True
        days = [D0 - timedelta(days=i) for i in range(209, -1, -1)]
        closes = [100.0] * 205 + ([80.0] * 5 if last5_below else [120.0] * 5)
        rows = [(d, "REF_BTCUSD", p) for d, p in zip(days, closes)]
        rows += [(D0, "BTC", 3_500_000.0), (D0, "CASH", 1.0)]
        ledger = [row(D0, "deposit", amount=1000), buy(D0, "BTC", 400, 3_500_000.0), buy(D0, "CASH", 600, 1.0)]
        return engine.summary(c, ledger, store(*rows), D0)

    def test_trend_exit_fires_only_when_all_confirm_days_below(self):
        self.assertIn("trend_exit", [a["code"] for a in self._btc(True)["alerts"]])
        self.assertNotIn("trend_exit", [a["code"] for a in self._btc(False)["alerts"]])

    def test_trend_needs_enough_history(self):
        c = cfg()
        c["crypto"]["enabled"] = True
        s = engine.summary(c, [row(D0, "deposit", amount=1000)], store((D0, "REF_BTCUSD", 100.0)), D0)
        self.assertIn("trend_no_data", [a["code"] for a in s["alerts"]])

    def test_stale_price_is_flagged(self):
        c = cfg()
        late = D0 + timedelta(days=40)
        ledger = [row(D0, "deposit", amount=1000), buy(D0, "GOLD", 1000, 6500.0)]
        s = engine.summary(c, ledger, store((D0, "GOLD", 6500.0)), late)
        self.assertIn("stale_price", [a["code"] for a in s["alerts"]])

    def test_review_is_early_then_decides(self):
        c = cfg()
        d1 = D0 + timedelta(days=200)
        prices = store((D0, "CASH", 1.0), (d1, "CASH", 1.09), (D0, "INDEX", 2.0), (d1, "INDEX", 2.6))
        ledger = [row(D0, "deposit", amount=2000), buy(D0, "CASH", 1000, 1.0), buy(D0, "INDEX", 1000, 2.0)]
        self.assertEqual(engine.summary(c, ledger, prices, D0 + timedelta(days=10))["review"]["verdict"], "early")
        self.assertEqual(engine.summary(c, ledger, prices, d1)["review"]["verdict"], "increase")

    def test_targets_must_sum_to_100(self):
        c = cfg()
        c["stages"][0]["targets"]["gold"] = 30
        with self.assertRaises(ValueError):
            engine.targets_for(c, 100)


if __name__ == "__main__":
    unittest.main()
