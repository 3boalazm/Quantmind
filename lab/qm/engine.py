"""Portfolio maths. Pure functions over (config, ledger rows, PriceStore); no file access.

Conventions
- `amount` on a buy is the total cash that left the wallet (fee included);
  on a sell it is the net cash that came back.
- The wallet is money deposited but not yet invested. It counts in the total
  but belongs to no bucket: `plan` is what assigns it.
- Performance is measured with a unitised NAV, so monthly deposits do not show
  up as "returns" and drawdown stays meaningful while the portfolio grows.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta

from .store import PriceStore

EPS = 1e-9
ANNUALISE_MIN_DAYS = 90  # a yearly rate from less history than this is noise


# --------------------------------------------------------------------------
# positions and valuation
# --------------------------------------------------------------------------
def positions(ledger: list[dict], asof: date | None = None) -> dict:
    units: dict[str, float] = defaultdict(float)
    last_trade: dict[str, float] = {}
    flows: dict[date, float] = defaultdict(float)
    wallet = 0.0
    contributions = 0.0
    first_date = None
    for r in ledger:
        if asof is not None and r["date"] > asof:
            continue
        if first_date is None or r["date"] < first_date:
            first_date = r["date"]
        kind, inst = r["type"], r["instrument"]
        if kind == "deposit":
            wallet += r["amount"]
            contributions += r["amount"]
            flows[r["date"]] += r["amount"]
        elif kind == "withdraw":
            wallet -= r["amount"]
            contributions -= r["amount"]
            flows[r["date"]] -= r["amount"]
        elif kind == "buy":
            units[inst] += r["units"]
            wallet -= r["amount"]
            if r["price"] > 0:
                last_trade[inst] = r["price"]
        elif kind == "sell":
            units[inst] -= r["units"]
            wallet += r["amount"]
            if r["price"] > 0:
                last_trade[inst] = r["price"]
        elif kind == "income":
            wallet += r["amount"]
        elif kind == "fee":
            wallet -= r["amount"]
    return {
        "units": {k: v for k, v in units.items() if abs(v) > EPS},
        "wallet": wallet,
        "contributions": contributions,
        "flows": dict(flows),
        "last_trade": last_trade,
        "first_date": first_date,
    }


def _price(inst: str, pos: dict, prices: PriceStore, asof: date):
    p, d = prices.get(inst, asof)
    if p is None:
        p, d = pos["last_trade"].get(inst), None
    if p is None:
        raise ValueError(f"no price for {inst} on or before {asof}")
    return p, d


def valuation(config: dict, ledger: list[dict], prices: PriceStore, asof: date) -> dict:
    pos = positions(ledger, asof)
    stale_days = config["rules"]["stale_days"]
    holdings = []
    buckets: dict[str, float] = defaultdict(float)
    invested = 0.0
    for inst in sorted(pos["units"]):
        if inst not in config["instruments"]:
            raise ValueError(f"instrument {inst!r} is in the ledger but not in config")
        meta = config["instruments"][inst]
        u = pos["units"][inst]
        p, d = _price(inst, pos, prices, asof)
        value = u * p
        invested += value
        buckets[meta["bucket"]] += value
        holdings.append(
            {
                "instrument": inst,
                "name": meta["name"],
                "bucket": meta["bucket"],
                "unit": meta.get("unit", ""),
                "units": u,
                "price": p,
                "price_date": d.isoformat() if d else None,
                "stale": not meta.get("fixed_price") and (d is None or (asof - d).days > meta.get("stale_days", stale_days)),
                "value": value,
            }
        )
    return {
        "asof": asof,
        "holdings": holdings,
        "buckets": dict(buckets),
        "invested": invested,
        "wallet": pos["wallet"],
        "total": invested + pos["wallet"],
        "contributions": pos["contributions"],
        "positions": pos,
    }


# --------------------------------------------------------------------------
# targets
# --------------------------------------------------------------------------
def targets_for(config: dict, total: float):
    """Stage and bucket targets (percent, summing to 100) for a portfolio of size `total`."""
    stages = sorted(config["stages"], key=lambda s: s["min_value"])
    stage = stages[0]
    for s in stages:
        if total + EPS >= s["min_value"]:
            stage = s
    targets = {k: float(v) for k, v in stage["targets"].items()}
    crypto = config.get("crypto", {})
    if crypto.get("enabled") and total + EPS >= crypto.get("from_value", 0):
        pct = float(crypto["target_pct"])
        scale = (100.0 - pct) / 100.0
        targets = {k: v * scale for k, v in targets.items() if k != "crypto"}
        targets["crypto"] = pct
    s = sum(targets.values())
    if abs(s - 100.0) > 1e-6:
        raise ValueError(f"targets of stage {stage['name']} sum to {s}, expected 100")
    return stage, targets


# --------------------------------------------------------------------------
# performance: unitised NAV, drawdown, benchmark
# --------------------------------------------------------------------------
def nav_series(config: dict, ledger: list[dict], prices: PriceStore, asof: date) -> list[tuple]:
    """[(date, value, nav)]. Deposits/withdrawals on a day are treated as start-of-day flows."""
    rows = [r for r in ledger if r["date"] <= asof]
    if not rows:
        return []
    start = min(r["date"] for r in rows)
    held = {r["instrument"] for r in rows if r["instrument"]}
    days = {r["date"] for r in rows} | {asof}
    days |= {d for d in prices.all_dates(held) if start <= d <= asof}
    out = []
    nav, prev = 1.0, None
    for d in sorted(days):
        pos = positions(rows, d)
        value = pos["wallet"]
        for inst, u in pos["units"].items():
            value += u * _price(inst, pos, prices, d)[0]
        flow = pos["flows"].get(d, 0.0)
        if prev is None or prev <= EPS:
            if flow > EPS:
                nav *= value / flow  # same-day costs on the very first investment
        else:
            nav *= (value - flow) / prev
        prev = value
        out.append((d, value, nav))
    return out


def drawdown(navs: list[tuple]) -> dict:
    peak, current, worst = 0.0, 0.0, 0.0
    for _, _, nav in navs:
        peak = max(peak, nav)
        current = nav / peak - 1.0 if peak > 0 else 0.0
        worst = min(worst, current)
    return {"current": current, "max": worst, "peak_nav": peak}


def benchmark(config: dict, pos: dict, prices: PriceStore, asof: date) -> dict:
    """What the same deposits would be worth if all of them had gone to the cash instrument."""
    inst = config["buckets"]["cash"]["instrument"]
    series = prices.series(inst, asof)
    if not series:
        return {"value": pos["contributions"], "meaningful": False}
    first_price = series[0][1]
    units = 0.0
    for d in sorted(pos["flows"]):
        p, _ = prices.get(inst, d)
        units += pos["flows"][d] / (p if p else first_price)
    span = (series[-1][0] - series[0][0]).days
    return {"value": units * series[-1][1], "meaningful": len(series) >= 2 and span >= 25}


def annualised_yield(series: list[tuple], window_days: int = 120, min_span: int = 25):
    """Annualised growth of a price series over roughly the last `window_days`."""
    if len(series) < 2:
        return None
    last_d, last_p = series[-1]
    start = next(((d, p) for d, p in series if d >= last_d - timedelta(days=window_days)), series[0])
    if (last_d - start[0]).days < min_span:
        start = series[0]
    span = (last_d - start[0]).days
    if span < min_span or start[1] <= 0:
        return None
    return (last_p / start[1]) ** (365.0 / span) - 1.0


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------
def trend_state(rule: dict, prices: PriceStore, asof: date) -> dict:
    """below=True when the last `confirm_days` closes are all under the moving average."""
    n, c = int(rule["sma_days"]), int(rule["confirm_days"])
    closes = [p for _, p in prices.series(rule["series"], asof)]
    need = n + c - 1
    if len(closes) < need:
        return {"ready": False, "have": len(closes), "need": need}
    below = []
    for i in range(len(closes) - c, len(closes)):
        sma = sum(closes[i - n + 1 : i + 1]) / n
        below.append(closes[i] < sma)
    return {"ready": True, "below": all(below), "above": not any(below)}


def blocked_buckets(config: dict, prices: PriceStore, asof: date) -> dict:
    """Buckets whose entry rule says "not now": {bucket: reason}.

    A bucket whose instrument carries a trend rule is closed to new money while
    the rule is in a downtrend, and also while there is not enough price history
    to evaluate it. The same states drive the alerts, so the buy list and the
    alerts can never disagree. A bucket that is switched off is not in the
    targets at all, so it never shows up here in practice.
    """
    out = {}
    for bucket, cfg in config["buckets"].items():
        rule = config["instruments"].get(cfg["instrument"], {}).get("trend_rule")
        if not rule:
            continue
        st = trend_state(rule, prices, asof)
        if not st["ready"]:
            out[bucket] = "trend_no_data"
        elif st["below"]:
            out[bucket] = "trend_below"
    return out


def plan(config: dict, val: dict, investable: float, current_drawdown: float = 0.0, blocked: dict | None = None) -> dict:
    """Split `investable` across buckets to move toward targets without selling anything.

    Buckets with a `min_order` are bought in whole lots: a monthly share smaller
    than one lot is parked in cash, and once enough has built up there the plan
    proposes moving a lot across.

    No new money goes to a bucket in `blocked` (an entry rule says wait). Under
    the stop rule only the buckets in `rules.stop_buckets` stay open; without
    that list, every bucket flagged `risk` is closed.
    """
    rules = config["rules"]
    bucket_cfg = config["buckets"]
    values = defaultdict(float, val["buckets"])
    total_after = val["invested"] + investable
    stage_now, _ = targets_for(config, val["total"])
    stage, targets = targets_for(config, total_after)
    stopped = current_drawdown <= -rules["stop_drawdown"] + EPS
    blocked = blocked or {}
    stop_open = rules.get("stop_buckets")

    def closed(b: str) -> bool:
        if b in blocked:
            return True
        if not stopped:
            return False
        return b not in stop_open if stop_open else bool(bucket_cfg[b].get("risk"))

    target_value = {b: pct / 100.0 * total_after for b, pct in targets.items()}
    deficit = {b: 0.0 if closed(b) else max(0.0, target_value[b] - values[b]) for b in targets}
    total_deficit = sum(deficit.values())

    alloc = {b: 0.0 for b in targets}
    if investable > EPS:
        if total_deficit > investable:
            for b in targets:
                alloc[b] = investable * deficit[b] / total_deficit
        else:
            # With some buckets closed, the open ones can need less than there is to place:
            # fill them to target and keep the rest in cash rather than overshooting a target.
            for b in targets:
                alloc[b] = deficit[b]
            alloc["cash"] = alloc.get("cash", 0.0) + (investable - total_deficit)

    parked = {}
    for b in list(alloc):
        lot = bucket_cfg[b].get("min_order", 0)
        if lot and 0 < alloc[b] < lot:
            parked[b] = alloc[b]
            alloc["cash"] = alloc.get("cash", 0.0) + alloc[b]
            alloc[b] = 0.0

    # whole pounds; the rounding remainder stays in cash
    floored = {b: float(math.floor(a + 1e-6)) for b, a in alloc.items()}
    floored["cash"] = floored.get("cash", 0.0) + (math.floor(investable + 1e-6) - sum(floored.values()))
    alloc = floored

    transfers = []
    cash_excess = values["cash"] + alloc.get("cash", 0.0) - target_value.get("cash", 0.0)
    for b in targets:
        lot = bucket_cfg[b].get("min_order", 0)
        if not lot or closed(b):
            continue
        gap = target_value[b] - values[b] - alloc[b]
        lots = math.floor(min(gap, cash_excess) / lot + 1e-9)
        if lots >= 1:
            amount = lots * lot
            transfers.append(
                {
                    "from": bucket_cfg["cash"]["instrument"],
                    "to": bucket_cfg[b]["instrument"],
                    "to_bucket": b,
                    "to_name": config["instruments"][bucket_cfg[b]["instrument"]]["name"],
                    "amount": float(amount),
                }
            )
            cash_excess -= amount

    orders = []
    for b, amount in alloc.items():
        if amount >= 1:
            inst = bucket_cfg[b]["instrument"]
            orders.append(
                {
                    "bucket": b,
                    "label": bucket_cfg[b]["label"],
                    "instrument": inst,
                    "name": config["instruments"][inst]["name"],
                    "amount": amount,
                }
            )
    orders.sort(key=lambda o: -o["amount"])
    return {
        "investable": investable,
        "orders": orders,
        "parked": {b: round(v, 2) for b, v in parked.items()},
        "transfers": transfers,
        "stage": stage,
        "stage_changed": stage["name"] != stage_now["name"],
        "targets": targets,
        "stopped": stopped,
        "blocked": sorted(b for b in targets if b in blocked),
    }


# --------------------------------------------------------------------------
# everything the report needs
# --------------------------------------------------------------------------
def summary(config: dict, ledger: list[dict], prices: PriceStore, asof: date, add: float = 0.0) -> dict:
    """Full state for one date. `add` is money you intend to deposit now, not yet in the ledger."""
    rules = config["rules"]
    val = valuation(config, ledger, prices, asof)
    pos = val["positions"]
    navs = nav_series(config, ledger, prices, asof)
    dd = drawdown(navs)
    bm = benchmark(config, pos, prices, asof)
    cash_inst = config["buckets"]["cash"]["instrument"]
    cash_yield = annualised_yield(prices.series(cash_inst, asof))
    investable = val["wallet"] + add
    blocked = blocked_buckets(config, prices, asof)
    pl = plan(config, val, investable, dd["current"], blocked)
    stage, targets = targets_for(config, val["total"])

    total = val["total"]
    allocation = []
    for b in sorted(set(targets) | set(val["buckets"]), key=lambda x: -targets.get(x, 0)):
        v = val["buckets"].get(b, 0.0)
        w = 100.0 * v / total if total > EPS else 0.0
        allocation.append(
            {
                "bucket": b,
                "label": config["buckets"][b]["label"],
                "value": v,
                "weight": w,
                "target": targets.get(b, 0.0),
                "gap": w - targets.get(b, 0.0),
            }
        )

    days_running = (asof - pos["first_date"]).days if pos["first_date"] else 0
    alerts = []

    def alert(level, code, text):
        alerts.append({"level": level, "code": code, "text": text})

    if dd["current"] <= -rules["stop_drawdown"] + EPS:
        alert("action", "stop_drawdown",
              f"المحفظة نازلة {abs(dd['current']):.1%} من أعلى قيمة. كل الإضافات متوقفة ما عدا النقد والذهب. القاعدة بتوقف الشراء بس ومش بتبيع حاجة.")
    elif dd["current"] <= -rules["warn_drawdown"] + EPS:
        alert("warn", "warn_drawdown",
              f"المحفظة نازلة {abs(dd['current']):.1%} من أعلى قيمة. كمّل بنفس المبلغ ومتزودش الإضافة الشهرية دلوقتي.")
    for h in val["holdings"]:
        if h["stale"]:
            when = h["price_date"] or "سعر آخر عملية"
            alert("warn", "stale_price", f"سعر {h['name']} قديم (آخر تحديث: {when}). حدّثه قبل ما تعتمد على الأرقام.")
    if cash_yield is not None and cash_yield < rules["min_cash_yield"]:
        alert("warn", "cash_yield",
              f"عائد صندوق النقد السنوي {cash_yield:.1%}، أقل من الحد {rules['min_cash_yield']:.0%}. قارن بالشهادات.")
    if bm["meaningful"] and total < rules["review_benchmark_ratio"] * bm["value"]:
        alert("warn", "below_benchmark",
              f"المحفظة أقل من خط الأساس بـ {bm['value'] - total:,.0f} جنيه (لو كل الفلوس كانت في صندوق النقد).")
    if val["wallet"] > max(1.0, 0.01 * total):
        alert("info", "idle_cash", f"فيه {val['wallet']:,.0f} جنيه في الرصيد لسه متوزعتش. نفّذ خطة الشراء.")
    if pl["stage_changed"]:
        alert("info", "stage_change", f"بعد الإضافة دي المحفظة هتدخل مرحلة {pl['stage']['label']}، والتوزيع المستهدف هيتغير.")
    macro = config.get("macro", {})
    if macro.get("as_of"):
        age = (asof - date.fromisoformat(macro["as_of"])).days
        if age > 45:
            alert("info", "macro_stale", f"أرقام الفايدة والتضخم في الإعدادات عمرها {age} يوم. حدّثها.")
    for inst, meta in config["instruments"].items():
        rule = meta.get("trend_rule")
        if not rule:
            continue
        held = pos["units"].get(inst, 0.0) > EPS
        enabled = config.get("crypto", {}).get("enabled") if meta["bucket"] == "crypto" else True
        if not (held or enabled):
            continue
        st = trend_state(rule, prices, asof)
        if not st["ready"]:
            alert("info", "trend_no_data",
                  f"قاعدة متوسط {rule['sma_days']} يوم لـ {meta['name']} محتاجة {st['need']} سعر يومي، الموجود {st['have']}. الشراء مؤجل لحد ما البيانات تكمل.")
        elif st["below"] and held:
            alert("action", "trend_exit",
                  f"{meta['name']} قفل تحت متوسط {rule['sma_days']} يوم {rule['confirm_days']} أيام ورا بعض. القاعدة: خروج.")
        elif st["below"]:
            alert("info", "trend_blocked", f"{meta['name']} تحت متوسط {rule['sma_days']} يوم. الدخول مؤجل حسب القاعدة.")

    if days_running < rules["review_min_days"] or not bm["meaningful"]:
        review = {"verdict": "early",
                  "text": f"لسه بدري على الحكم: {days_running} يوم من {rules['review_min_days']} مطلوبين."}
    elif total >= rules["review_benchmark_ratio"] * bm["value"] and dd["current"] > -rules["warn_drawdown"]:
        review = {"verdict": "on_track", "text": "المحفظة ماشية مع خط الأساس أو أحسن، والهبوط تحت الحد. كمّل بنفس الخطة؛ أي زيادة في المبلغ قرار يحتاج مراجعة يدوية."}
    else:
        review = {"verdict": "hold", "text": "كمّل بنفس المبلغ من غير زيادة لحد المراجعة الجاية."}

    nav_now = navs[-1][2] if navs else 1.0
    return {
        "asof": asof.isoformat(),
        "total": total,
        "invested": val["invested"],
        "wallet": val["wallet"],
        "contributions": val["contributions"],
        "pnl": total - val["contributions"],
        "pnl_pct": (total / val["contributions"] - 1.0) if val["contributions"] > EPS else 0.0,
        "nav": nav_now,
        # time-weighted return: what one pound that was in from day one became, deposits excluded
        "twr": nav_now - 1.0,
        "annualised": (nav_now ** (365.0 / days_running) - 1.0) if days_running >= ANNUALISE_MIN_DAYS and nav_now > 0 else None,
        "drawdown": dd["current"],
        "max_drawdown": dd["max"],
        "days_running": days_running,
        "benchmark": {"value": bm["value"], "diff": total - bm["value"], "meaningful": bm["meaningful"]},
        "cash_yield": cash_yield,
        "stage": {"name": stage["name"], "label": stage["label"], "notes": stage.get("notes", [])},
        "allocation": allocation,
        "holdings": val["holdings"],
        "plan": {
            "investable": pl["investable"],
            "orders": pl["orders"],
            "parked": pl["parked"],
            "transfers": pl["transfers"],
            "stage": {"name": pl["stage"]["name"], "label": pl["stage"]["label"], "notes": pl["stage"].get("notes", [])},
            "stage_changed": pl["stage_changed"],
            "stopped": pl["stopped"],
            "blocked": pl["blocked"],
        },
        "alerts": alerts,
        "review": review,
        "macro": macro,
        "history": [{"date": d.isoformat(), "value": v, "nav": n} for d, v, n in navs],
    }
