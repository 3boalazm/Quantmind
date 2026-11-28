"""Browser walk-through of the crypto paper books against a running local build.

    BASE_URL=http://localhost:3210 APP_PASSWORD=... python tests/e2e/lab.py [screenshot_dir]

Run it last: it overwrites the stored Bitcoin and exchange-rate series with a made-up rising
series, so the outcome does not depend on what the market did.
"""
import datetime as dt
import os
import re
import sys
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3210")
PASSWORD = os.environ["APP_PASSWORD"]
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
START = dt.date(2026, 11, 28)  # config/crypto-lab.json


def shot(page, name, full=True):
    if SHOTS:
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full, animations="disabled")


def post(page, payload):
    return page.evaluate(
        """async (payload) => {
            const r = await fetch('/api/lab', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
            return {status: r.status, body: await r.json()};
        }""",
        payload,
    )


def main():
    problems = []
    expect.set_options(timeout=15_000)
    today = dt.datetime.now(ZoneInfo("Africa/Cairo")).date()
    first = dt.date(2025, 6, 1)
    days = [first + dt.timedelta(days=i) for i in range((today - first).days + 1)]
    btc = [[d.isoformat(), round(40_000 * 1.002 ** i, 2)] for i, d in enumerate(days)]
    fx = [[d.isoformat(), 50] for d in days]
    deposits = sum(1 for d in days if d >= START and d.day == 28)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ar-EG")
        page = ctx.new_page()
        page.on("console", lambda m: problems.append(f"console {m.type}: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))

        page.goto(BASE + "/login")
        page.get_by_label("كلمة السر").fill(PASSWORD)
        page.get_by_role("button", name="دخول").click()
        expect(page.get_by_role("heading", name="لوحة المحفظة", level=1)).to_be_visible()

        # --- the import refuses bad rows and writes nothing
        bad = post(page, {"op": "import", "series": "btc", "rows": [["2026-13-40", 1]]})
        assert bad["status"] == 400, bad
        future = post(page, {"op": "import", "series": "fx", "rows": [[(today + dt.timedelta(days=2)).isoformat(), 50]]})
        assert future["status"] == 400, future
        assert post(page, {"op": "import", "series": "gold", "rows": [["2026-01-01", 1]]})["status"] == 400

        # --- seed a made-up rising market
        for series, rows in (("btc", btc), ("fx", fx)):
            for i in range(0, len(rows), 1000):
                done = post(page, {"op": "import", "series": series, "rows": rows[i:i + 1000]})
                assert done["status"] == 200, done

        # --- the screen, reached from the menu of the investing interface
        page.get_by_role("link", name="دفاتر الكريبتو", exact=True).first.click()
        expect(page).to_have_url(re.compile(r"/lab$"))
        expect(page.get_by_role("heading", name="دفاتر الكريبتو التجريبية", level=1)).to_be_visible()
        expect(page.get_by_text("مفيش شراء حقيقي ولا اتصال بأي منصة")).to_be_visible()
        expect(page.get_by_text("شرط الاتجاه متحقق")).to_be_visible()
        expect(page.get_by_text("الدفتر D: الإيداع الجاي يدخل بيتكوين")).to_be_visible()
        expect(page.get_by_role("heading", name="القواعد المسجلة")).to_be_visible()

        state = page.evaluate("fetch('/api/lab').then(r => r.json())")
        assert state["config"]["version"] == "v1", state["config"]
        assert state["paid"] == 1000 * deposits, (state["paid"], deposits)
        if deposits:
            assert state["asof"] == today.isoformat(), state["asof"]
            rows = page.locator("table tbody tr")
            expect(rows).to_have_count(6)  # five books and the shadow portfolio
            # a steady rise: every book buys on every deposit day, so all five hold the same
            values = {b["id"]: b["value"] for b in state["books"]}
            assert len(values) == 5 and max(values.values()) - min(values.values()) < 0.01, values
            kinds = {d["kind"] for d in state["decisions"]}
            assert kinds == {"buy"}, kinds
            assert len(state["decisions"]) == 5 * deposits
            expect(page.get_by_role("heading", name="آخر القرارات")).to_be_visible()
            expect(page.get_by_text("شراء دوري من غير شروط").first).to_be_visible()
        else:
            expect(page.get_by_text("أول إيداع افتراضي لسه ماتحسبش")).to_be_visible()
        shot(page, "30-lab")

        # --- phone
        page.set_viewport_size({"width": 390, "height": 844})
        page.reload()
        expect(page.get_by_role("heading", name="دفاتر الكريبتو التجريبية", level=1)).to_be_visible()
        expect(page.get_by_text("شرط الاتجاه متحقق")).to_be_visible()
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 1, f"page scrolls sideways on a phone by {overflow}px"
        shot(page, "31-lab-phone")

        # --- the budget interface does not show it
        page.goto(BASE + "/budget")
        expect(page.get_by_role("link", name="دفاتر الكريبتو", exact=True)).to_have_count(0)

        browser.close()

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print(f"lab e2e ok ({deposits} deposit day(s) so far)")


if __name__ == "__main__":
    main()
