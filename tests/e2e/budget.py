"""Browser walk-through of the budget against a running local build.

    BASE_URL=http://localhost:3210 APP_PASSWORD=... python tests/e2e/budget.py [screenshot_dir]

Run it after tests/e2e/run.py, on the same database: it expects no budget yet and an empty real book.
All names and amounts here are made up for the test.
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


def shot(page, name, full=True):
    if SHOTS:
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full, animations="disabled")


def cairo_today():
    # the server dates entries by the day in Cairo
    return dt.datetime.now(ZoneInfo("Africa/Cairo")).date()


def main():
    problems = []
    expect.set_options(timeout=15_000)
    today = cairo_today()
    # A payday that makes yesterday-or-earlier fall in a cycle that has already ended.
    payday = min(today.day, 28)
    start = today.replace(day=payday)
    last_month = (start - dt.timedelta(days=1)).isoformat()  # last day of the previous cycle

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ar-EG")
        page = ctx.new_page()
        page.on("console", lambda m: problems.append(f"console {m.type}: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        status = page.get_by_role("status")

        page.goto(BASE + "/login")
        page.get_by_label("كلمة السر").fill(PASSWORD)
        page.get_by_role("button", name="دخول").click()
        expect(page.get_by_role("heading", name="لوحة المحفظة", level=1)).to_be_visible()

        # --- nothing is set up yet
        page.get_by_role("link", name="ميزانية الشهر").first.click()
        expect(page.get_by_text("الميزانية لسه ماتجهزتش")).to_be_visible()
        shot(page, "b01-not-ready")
        page.get_by_role("link", name="ابدأ الإعداد").click()
        expect(page.get_by_role("heading", name="إعداد الميزانية", level=1)).to_be_visible()

        # --- setup: payday, two places, four categories
        page.get_by_label(re.compile("يوم في الشهر")).fill(str(payday))
        page.get_by_role("button", name="احفظ", exact=True).click()
        expect(status).to_contain_text(f"يوم {payday}")

        add_account = page.locator("form.budget-add").nth(0)
        for name, kind in (("بنك تجريبي", "bank"), ("كاش", "cash")):
            add_account.get_by_label("اسم حساب جديد").fill(name)
            add_account.get_by_label("النوع").select_option(kind)
            add_account.get_by_role("button", name="أضف").click()
            expect(status).to_contain_text(name)

        add_category = page.locator("form.budget-add").nth(1)
        for name, amount, kind in (("أكل", "3000", "spend"), ("مواصلات", "1000", "spend"), ("عوارض", "400", "buffer"), ("استثمار", "1600", "invest")):
            add_category.get_by_label("اسم فئة جديدة").fill(name)
            add_category.get_by_label("المبلغ من كل مرتب").fill(amount)
            add_category.get_by_label("النوع").select_option(kind)
            add_category.get_by_role("button", name="أضف").click()
            expect(status).to_contain_text(name)
        expect(page.get_by_text("مجموع المبالغ")).to_contain_text("6,000")
        # a second investment category is refused
        expect(add_category.get_by_label("النوع").locator("option[value=invest]")).to_be_disabled()
        shot(page, "b02-setup")

        # --- last month's salary: split by the fixed amounts, 500 left to distribute by hand
        page.get_by_role("link", name="دخل وتوزيع").click()
        expect(page.get_by_role("heading", name="دخل وتوزيع", level=1)).to_be_visible()
        page.get_by_role("tab", name="المرتب").click()
        page.get_by_label("المبلغ بالجنيه").fill("6500")
        page.locator("form.form-grid select").first.select_option(label="بنك تجريبي")
        page.get_by_label("التاريخ").fill(last_month)
        expect(page.locator(".stmt__row--total")).to_contain_text("500.00")
        shot(page, "b03-income")
        page.get_by_role("button", name="سجّل المرتب").click()
        expect(status).to_contain_text("4 فئة")
        page.get_by_label("مبلغ أكل").fill("600")
        expect(page.get_by_text("المجموع أكبر من المبلغ المستني")).to_be_visible()
        page.get_by_label("مبلغ أكل").fill("")
        page.locator(".list__row", has_text="أكل").get_by_role("button", name="الباقي كله").click()
        expect(page.get_by_label("مبلغ أكل")).to_have_value("500")
        page.get_by_role("button", name="وزّع", exact=True).click()
        expect(status).to_contain_text("اتوزّع 500")
        expect(page.get_by_text("مفيش مبلغ مستني توزيع")).to_be_visible()

        # --- spending, still dated last month
        page.get_by_role("link", name="مصروف", exact=True).click()
        expect(page.get_by_role("heading", name="مصروف جديد", level=1)).to_be_visible()
        page.get_by_label("التاريخ").fill(last_month)
        amount = page.get_by_label("المبلغ بالجنيه")

        amount.fill("200")
        page.get_by_role("group", name="الفئة").get_by_role("button", name=re.compile("أكل")).click()
        page.get_by_role("group", name="اتدفع من").get_by_role("button", name="بنك تجريبي").click()
        page.get_by_role("button", name="سجّل المصروف").click()
        expect(status).to_contain_text("3,300")

        # 1,300 against 1,000: the missing 300 is lent by the food money
        amount.fill("1300")
        page.get_by_role("group", name="الفئة").get_by_role("button", name=re.compile("مواصلات")).click()
        expect(page.get_by_role("note")).to_contain_text("ناقص")
        lender = page.get_by_label("الناقص يتغطى من")
        lender.select_option(lender.locator("option", has_text="سلفة من أكل").get_attribute("value"))
        page.get_by_role("switch", name="مصروف عارض").click()
        page.get_by_label("ملاحظة").fill("تصليح")
        shot(page, "b04-spend-short")
        page.get_by_role("button", name="سجّل المصروف").click()
        expect(status).to_contain_text("استلفت 300")

        # 50 more with nothing left and no loan: asked first, then stored as a negative balance
        amount.fill("50")
        page.get_by_role("group", name="الفئة").get_by_role("button", name=re.compile("مواصلات")).click()
        page.get_by_role("button", name="سجّل المصروف").click()
        expect(page.get_by_role("alertdialog")).to_contain_text("بالسالب")
        page.get_by_role("button", name="الرقم صح، احفظ").click()
        expect(status).to_contain_text("-50")

        # --- overview: balances, the open loan, a cash withdrawal and a reconciliation
        page.get_by_role("link", name="نظرة عامة").click()
        expect(page.get_by_role("heading", name="ميزانية الشهر", level=1)).to_be_visible()
        expect(page.get_by_text("خلص ومستني إقفال")).to_be_visible()
        expect(page.locator(".stat-card").nth(3)).to_contain_text("4,950")
        expect(page.get_by_text("سلف بين الفئات")).to_be_visible()

        page.get_by_role("button", name="نقل", exact=True).click()
        move = page.locator("form.form-grid")
        move.locator("select").nth(0).select_option(label="بنك تجريبي")
        move.locator("select").nth(1).select_option(label="كاش")
        move.get_by_label("المبلغ بالجنيه").fill("1000")
        page.get_by_role("button", name="انقل").click()
        expect(status).to_contain_text("اتنقل 1,000")

        page.get_by_role("button", name="مطابقة").click()
        match = page.locator("form.form-grid")
        match.locator("select").nth(0).select_option(label="كاش")
        match.get_by_label("الرصيد الفعلي دلوقتي").fill("950")
        match.locator("select").nth(1).select_option(label="أكل")
        match.get_by_role("button", name="طابق", exact=True).click()
        expect(status).to_contain_text("ناقص 50")
        expect(page.locator(".stat-card").nth(3)).to_contain_text("4,900")
        shot(page, "b05-overview")

        # --- close last month. The 500 was distributed today, so it belongs to the new month:
        # 2,500 left in food, 50 covers the overspending, the loan stays open, 2,450 to invest
        page.get_by_role("link", name="التقارير والإقفال").first.click()
        expect(page.get_by_role("heading", name="التقارير والإقفال", level=1)).to_be_visible()
        grand = page.locator(".stmt__row--grand")
        expect(grand).to_contain_text("2,450.00")
        expect(page.get_by_text("سلف هتفضل مفتوحة")).to_contain_text("300.00")
        shot(page, "b06-close-before")
        page.get_by_role("button", name="اقفل الشهر").click()
        expect(status).to_contain_text("اتقفل الشهر")
        expect(page.get_by_text("مفيش شهر مستني إقفال")).to_be_visible()
        ready = page.locator(".card", has_text="جاهز للاستثمار")
        expect(ready).to_contain_text("4,050.00")

        # the closed month's report
        page.get_by_label("الشهر", exact=True).select_option(index=1)
        expect(page.locator("tr.row--total")).to_contain_text("1,550")
        expect(page.locator(".card", has_text="العوارض والسلف")).to_contain_text("تصليح")
        shot(page, "b07-report")
        page.get_by_label("الشهر", exact=True).select_option(index=0)

        # --- hand it to the portfolio: a deposit appears in the real book
        ready.locator("select").select_option(label="بنك تجريبي")
        ready.get_by_role("button", name="حوّل للمحفظة").click()
        expect(status).to_contain_text("إيداع في المحفظة")
        expect(page.locator(".card", has_text="جاهز للاستثمار")).to_contain_text("0.00")
        shot(page, "b08-invested")

        page.get_by_label("الدفتر").select_option("real")
        page.get_by_role("link", name="العمليات").first.click()
        expect(page.locator("table tbody tr")).to_have_count(1)
        expect(page.locator("table tbody tr")).to_contain_text("4,050.00")
        expect(page.locator("table tbody tr")).to_contain_text("من الميزانية")
        # the deposit belongs to the budget: it cannot be removed from here
        page.get_by_role("button", name="حذف العملية").click()
        page.get_by_role("button", name="تأكيد الحذف").click()
        expect(status).to_contain_text("جاي من الميزانية")
        expect(page.locator("table tbody tr")).to_have_count(1)

        # --- undoing the close is refused once its money was invested; removing the transfer frees it
        page.goto(BASE + "/budget/close")
        page.get_by_role("button", name="تراجع عن آخر إقفال").click()
        page.get_by_role("button", name="أيوه، الغيه").click()
        expect(status).to_contain_text("اتحوّل للمحفظة فعلًا")
        page.goto(BASE + "/budget")
        row = page.locator(".budget-entry", has_text="تحويل للمحفظة")
        row.get_by_role("button", name="حذف الحركة").click()
        row.get_by_role("button", name=re.compile("تأكيد الحذف")).click()
        expect(status).to_contain_text("اتحذفت الحركة")
        expect(page.locator(".stat-card").nth(2)).to_contain_text("4,050")
        page.get_by_role("link", name="العمليات").first.click()
        expect(page.get_by_text("مفيش عمليات")).to_be_visible()
        page.get_by_label("الدفتر").select_option("paper")

        # --- phone
        phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-EG",
                                    storage_state=ctx.storage_state(), is_mobile=True, has_touch=True)
        mp = phone.new_page()
        mp.on("pageerror", lambda e: problems.append(f"mobile pageerror: {e}"))
        for path, name in (("/budget", "b10-mobile-overview"), ("/budget/spend", "b11-mobile-spend"), ("/budget/income", "b12-mobile-income"),
                           ("/budget/close", "b13-mobile-close"), ("/budget/setup", "b14-mobile-setup")):
            mp.goto(BASE + path)
            mp.wait_for_selector(".bento .card")
            overflow = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if overflow > 1:
                problems.append(f"mobile {path} scrolls sideways by {overflow}px")
            shot(mp, name)
        # on a phone each setup row has one options button that opens full-size, labelled actions
        expect(mp.get_by_role("button", name="أرشفة")).to_have_count(0)
        mp.get_by_role("button", name="خيارات").first.click()
        menu = mp.locator(".budget-menu")
        for label in ("تعديل", "أرشفة", "لفوق", "لتحت", "حذف"):
            expect(menu.get_by_role("button", name=label, exact=True)).to_be_visible()
        sizes = menu.get_by_role("button").evaluate_all("els => els.map(e => e.getBoundingClientRect().height)")
        if min(sizes) < 40:
            problems.append(f"setup row actions are too small to tap: {sizes}")
        shot(mp, "b15-mobile-setup-menu")
        menu.get_by_role("button", name="حذف", exact=True).click()
        expect(mp.get_by_role("button", name="تأكيد الحذف")).to_be_visible()
        mp.get_by_role("button", name="إلغاء").click()
        phone.close()
        browser.close()

    if problems:
        print("PROBLEMS:")
        for item in problems:
            print("  -", item)
        sys.exit(1)
    print("budget e2e ok")


if __name__ == "__main__":
    main()
