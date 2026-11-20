"""Monthly report: a self-contained Arabic (RTL) HTML page, plus the same data as JSON."""
from __future__ import annotations

import html
import json
import re

BOOK_LABEL = {"paper": "دفتر تجريبي", "real": "دفتر حقيقي"}
LEVEL = {
    "action": ("⛔", "إجراء مطلوب", "critical"),
    "warn": ("⚠️", "تنبيه", "warning"),
    "info": ("ℹ️", "معلومة", "info"),
}
VERDICT = {"early": "بدري على الحكم", "increase": "كمّل وزوّد", "hold": "كمّل من غير زيادة"}

CSS = """
.qm{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--line:#e4e3de;--ink:#0b0b0b;--ink2:#52514e;--ink3:#7b7a75;
--fill:#2a78d6;--track:#cde2fb;--mark:#0b0b0b;--good:#0ca30c;--warning:#fab219;--critical:#d03b3b;--info:#2a78d6}
@media (prefers-color-scheme:dark){.qm{color-scheme:dark;--surface:#1a1a19;--panel:#222221;--line:#3a3a37;--ink:#f0efec;
--ink2:#c3c2b7;--ink3:#96958d;--fill:#3987e5;--track:#104281;--mark:#f0efec;--info:#3987e5}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface)}
.qm{background:var(--surface);color:var(--ink);font-family:"Segoe UI",Tahoma,"Noto Sans Arabic",Arial,sans-serif;
line-height:1.6;padding:24px 16px 48px}
.wrap{max-width:920px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:32px 0 12px}
.sub{color:var(--ink2);font-size:14px}
.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:12px;color:var(--ink2);margin-inline-start:8px}
.banner{border:1px dashed var(--ink3);border-radius:8px;padding:8px 12px;margin:12px 0;color:var(--ink2);font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}
@media (max-width:560px){.tiles{grid-template-columns:repeat(2,1fr)}}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile .l{font-size:12px;color:var(--ink2)}
.tile .v{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;direction:ltr;text-align:right}
.tile .d{font-size:12px;color:var(--ink3)}
table{width:100%;border-collapse:collapse;font-size:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;color:var(--ink2);font-weight:600}
tr:last-child td{border-bottom:0}
td.n,th.n{font-variant-numeric:tabular-nums;direction:ltr;text-align:left;white-space:nowrap}
.meter{position:relative;height:8px;border-radius:999px;background:var(--track);min-width:140px;direction:ltr}
.meter i{position:absolute;inset-block:0;left:0;border-radius:999px;background:var(--fill)}
.meter b{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--mark);box-shadow:0 0 0 2px var(--panel)}
.note{font-size:12px;color:var(--ink3);margin-top:6px}
.alerts{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.alerts li{background:var(--panel);border:1px solid var(--line);border-inline-start:4px solid var(--c);border-radius:8px;padding:9px 12px;font-size:14px}
.alerts .k{font-weight:600;margin-inline-end:6px}
.critical{--c:var(--critical)}.warning{--c:var(--warning)}.info{--c:var(--info)}
.empty{color:var(--ink3);font-size:14px}
ul.plain{margin:6px 0 0;padding-inline-start:20px;font-size:14px;color:var(--ink2)}
footer{margin-top:36px;font-size:12px;color:var(--ink3)}
"""


_LTR = re.compile(
    r"\d{4}-\d{2}-\d{2}"                              # dates
    r"|(?<!\d)(?:[+\-−]\s?)?\d[\d,]*(?:\.\d+)?%"        # percentages
    r"|(?<!\d)[+\-−]\s?\d[\d,]*(?:\.\d+)?"              # signed numbers
    r"|\d[\d,]*\+"                                    # "10,000+"
)


def _e(x) -> str:
    return html.escape(str(x))


def _t(x) -> str:
    """Escape, then isolate numbers so signs and % stay on the correct side inside Arabic text."""
    return _LTR.sub(lambda m: f"<span dir='ltr'>{m.group(0)}</span>", _e(x))


def _money(x: float, sign: bool = False) -> str:
    if sign and abs(x) < 0.5:
        return "0"
    s = f"{x:+,.0f}" if sign else f"{x:,.0f}"
    return s.replace("+", "+ ").replace("-", "− ") if sign else s


def _pct(x: float, sign: bool = False, digits: int = 1) -> str:
    s = f"{x * 100:+.{digits}f}%" if sign else f"{x * 100:.{digits}f}%"
    return s.replace("-", "−")


def render_html(s: dict, book: str, title: str = "تقرير المحفظة", banner: str | None = None) -> str:
    o = []
    o.append("<!DOCTYPE html><html lang='ar' dir='rtl'><head><meta charset='utf-8'>")
    o.append("<meta name='viewport' content='width=device-width,initial-scale=1'>")
    o.append(f"<title>{_e(title)} — {_e(s['asof'])}</title><style>{CSS}</style></head>")
    o.append("<body><div class='qm'><div class='wrap'>")
    o.append(f"<h1>{_e(title)}<span class='badge'>{_e(BOOK_LABEL.get(book, book))}</span></h1>")
    o.append(f"<div class='sub'>بتاريخ {_t(s['asof'])} · المرحلة: {_t(s['stage']['label'])} · {s['days_running']} يوم من البداية</div>")
    if banner:
        o.append(f"<div class='banner'>{_t(banner)}</div>")

    bm = s["benchmark"]
    tiles = [
        ("قيمة المحفظة", _money(s["total"]), "جنيه"),
        ("إجمالي اللي دفعته", _money(s["contributions"]), "جنيه"),
        ("الربح أو الخسارة", _money(s["pnl"], sign=True), _pct(s["pnl_pct"], sign=True) + " على المدفوع"),
        ("الهبوط من أعلى قيمة", _pct(s["drawdown"]), "أسوأ هبوط: " + _pct(s["max_drawdown"])),
    ]
    if bm["meaningful"]:
        tiles.append(("مقابل خط الأساس", _money(bm["diff"], sign=True), "لو كل الفلوس في صندوق النقد: " + _money(bm["value"])))
    else:
        tiles.append(("مقابل خط الأساس", "—", "محتاج شهر على الأقل من أسعار صندوق النقد"))
    if s["cash_yield"] is not None:
        tiles.append(("عائد صندوق النقد (سنوي)", _pct(s["cash_yield"]), "التضخم: " + _pct(s["macro"].get("inflation_urban", 0))))
    o.append("<div class='tiles'>")
    for label, value, detail in tiles:
        o.append(f"<div class='tile'><div class='l'>{_e(label)}</div><div class='v'>{_e(value)}</div><div class='d'>{_t(detail)}</div></div>")
    o.append("</div>")

    # -- this month's orders ---------------------------------------------
    p = s["plan"]
    o.append("<h2>قائمة شراء الشهر</h2>")
    if p["orders"]:
        o.append(f"<div class='sub'>المبلغ المتاح للتوزيع: {_money(p['investable'])} جنيه</div>")
        o.append("<table><thead><tr><th>البند</th><th>الأداة</th><th class='n'>المبلغ (جنيه)</th></tr></thead><tbody>")
        for od in p["orders"]:
            o.append(f"<tr><td>{_e(od['label'])}</td><td>{_e(od['name'])}</td><td class='n'>{_money(od['amount'])}</td></tr>")
        o.append("</tbody></table>")
    else:
        o.append("<div class='empty'>مفيش مبلغ متاح للتوزيع. سجّل الإيداع الأول أو استخدم <code>--add</code>.</div>")
    extra = []
    for b, amount in p["parked"].items():
        label = next((a["label"] for a in s["allocation"] if a["bucket"] == b), b)
        extra.append(f"نصيب «{label}» الشهر ده ({_money(amount)} جنيه) اتحط في النقد لحد ما يكمّل أقل مبلغ شراء.")
    for t in p["transfers"]:
        extra.append(f"تحويل مقترح: {_money(t['amount'])} جنيه من النقد إلى «{t['to_name']}».")
    if p["stopped"]:
        extra.append("قاعدة حد الخسارة مفعّلة: مفيش إضافات للأسهم أو الكريبتو.")
    if p["stage_changed"]:
        extra.extend(p["stage"]["notes"])
    if extra:
        o.append("<ul class='plain'>" + "".join(f"<li>{_t(x)}</li>" for x in extra) + "</ul>")

    # -- alerts -----------------------------------------------------------
    o.append("<h2>التنبيهات</h2>")
    if s["alerts"]:
        o.append("<ul class='alerts'>")
        for a in s["alerts"]:
            icon, label, cls = LEVEL[a["level"]]
            o.append(f"<li class='{cls}'><span class='k'>{icon} {_e(label)}:</span>{_t(a['text'])}</li>")
        o.append("</ul>")
    else:
        o.append("<div class='empty'>مفيش تنبيهات.</div>")
    o.append(f"<div class='note'>حكم المراجعة: <strong>{_e(VERDICT[s['review']['verdict']])}</strong> — {_t(s['review']['text'])}</div>")

    # -- allocation -------------------------------------------------------
    o.append("<h2>التوزيع: الفعلي مقابل المستهدف</h2>")
    if s["total"] > 0 and s["allocation"]:
        scale = max(max(a["weight"], a["target"]) for a in s["allocation"]) or 1.0
        scale = max(scale, 1.0)
        o.append("<table><thead><tr><th>البند</th><th>الفعلي والمستهدف</th><th class='n'>الفعلي</th>"
                 "<th class='n'>المستهدف</th><th class='n'>القيمة (جنيه)</th></tr></thead><tbody>")
        for a in s["allocation"]:
            w = min(100.0, 100.0 * a["weight"] / scale)
            t = min(100.0, 100.0 * a["target"] / scale)
            tip = f"{a['label']}: الفعلي {a['weight']:.1f}% · المستهدف {a['target']:.1f}% · {_money(a['value'])} جنيه"
            o.append(
                f"<tr><td>{_e(a['label'])}</td>"
                f"<td><div class='meter' title='{_e(tip)}' role='img' aria-label='{_e(tip)}'>"
                f"<i style='width:{w:.2f}%'></i><b style='left:calc({t:.2f}% - 1px)'></b></div></td>"
                f"<td class='n'>{a['weight']:.1f}%</td><td class='n'>{a['target']:.1f}%</td>"
                f"<td class='n'>{_money(a['value'])}</td></tr>"
            )
        o.append("</tbody></table>")
        o.append("<div class='note'>الشريط = النسبة الفعلية · الخط الرأسي = النسبة المستهدفة. الرصيد غير المستثمر مش داخل في أي بند.</div>")
    else:
        o.append("<div class='empty'>لسه مفيش استثمارات مسجلة.</div>")

    # -- holdings ---------------------------------------------------------
    o.append("<h2>المراكز</h2>")
    if s["holdings"] or s["wallet"] > 0:
        o.append("<table><thead><tr><th>الأداة</th><th class='n'>الكمية</th><th class='n'>السعر</th>"
                 "<th class='n'>تاريخ السعر</th><th class='n'>القيمة (جنيه)</th></tr></thead><tbody>")
        for h in s["holdings"]:
            when = h["price_date"] or "آخر عملية"
            flag = " ⚠️" if h["stale"] else ""
            o.append(f"<tr><td>{_e(h['name'])}</td><td class='n'>{h['units']:,.4f} {_e(h['unit'])}</td>"
                     f"<td class='n'>{h['price']:,.4f}</td><td class='n'>{_e(when)}{flag}</td>"
                     f"<td class='n'>{_money(h['value'])}</td></tr>")
        if s["wallet"] > 0.5:
            o.append(f"<tr><td>رصيد غير مستثمر</td><td class='n'>—</td><td class='n'>—</td><td class='n'>—</td>"
                     f"<td class='n'>{_money(s['wallet'])}</td></tr>")
        o.append("</tbody></table>")
    else:
        o.append("<div class='empty'>مفيش مراكز.</div>")

    # -- history ----------------------------------------------------------
    hist = s["history"][-8:]
    if len(hist) > 1:
        o.append("<h2>آخر القراءات</h2>")
        o.append("<table><thead><tr><th class='n'>التاريخ</th><th class='n'>القيمة (جنيه)</th>"
                 "<th class='n'>مؤشر الأداء (البداية = 1)</th></tr></thead><tbody>")
        for h in reversed(hist):
            o.append(f"<tr><td class='n'>{_e(h['date'])}</td><td class='n'>{_money(h['value'])}</td><td class='n'>{h['nav']:.4f}</td></tr>")
        o.append("</tbody></table>")
        o.append("<div class='note'>مؤشر الأداء بيستبعد أثر الإيداعات، فبيقيس أداء الاستثمار نفسه.</div>")

    notes = s["stage"]["notes"]
    if notes and not p["stage_changed"]:
        o.append("<h2>ملاحظات المرحلة الحالية</h2><ul class='plain'>" + "".join(f"<li>{_t(n)}</li>" for n in notes) + "</ul>")

    m = s["macro"]
    o.append("<footer>")
    if m:
        o.append(_t(f"مرجع: فايدة الإيداع عند المركزي {_pct(m.get('cbe_deposit_rate', 0))} · تضخم المدن "
                    f"{_pct(m.get('inflation_urban', 0))} (بتاريخ {m.get('as_of', '')}).") + "<br>")
    o.append("التقرير ده حساب آلي على البيانات المسجلة، ومش توصية استثمارية. التنفيذ والقرار عندك.</footer>")
    o.append("</div></div></body></html>")
    return "".join(o)


def render_json(s: dict, book: str) -> str:
    return json.dumps({"book": book, **s}, ensure_ascii=False, indent=2)


def render_text(s: dict, book: str) -> str:
    """Short plain-text status for the terminal."""
    lines = [
        f"[{book}] {s['asof']}  stage {s['stage']['name']}  day {s['days_running']}",
        f"  total {s['total']:>12,.2f}   paid in {s['contributions']:>12,.2f}   P/L {s['pnl']:>+10,.2f} ({s['pnl_pct']:+.2%})",
        f"  wallet {s['wallet']:>11,.2f}   drawdown {s['drawdown']:.2%} (max {s['max_drawdown']:.2%})   nav {s['nav']:.4f}",
    ]
    if s["benchmark"]["meaningful"]:
        lines.append(f"  vs all-cash benchmark: {s['benchmark']['diff']:+,.2f}")
    if s["allocation"]:
        lines.append("  bucket         value     actual  target")
        for a in s["allocation"]:
            lines.append(f"  {a['bucket']:<12}{a['value']:>10,.0f}   {a['weight']:>5.1f}%  {a['target']:>5.1f}%")
    if s["plan"]["orders"]:
        lines.append(f"  plan for {s['plan']['investable']:,.0f}:")
        for od in s["plan"]["orders"]:
            lines.append(f"    buy {od['instrument']:<11}{od['amount']:>9,.0f}")
    for t in s["plan"]["transfers"]:
        lines.append(f"    move {t['amount']:,.0f} from {t['from']} to {t['to']}")
    for b, amount in s["plan"]["parked"].items():
        lines.append(f"    ({b}: {amount:,.0f} parked in cash until one lot is reached)")
    for a in s["alerts"]:
        lines.append(f"  ! {a['level']}: {a['code']}")
    lines.append(f"  review: {s['review']['verdict']}")
    return "\n".join(lines)
