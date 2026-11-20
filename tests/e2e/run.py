"""Browser walk-through against a running local build.

    BASE_URL=http://localhost:3210 APP_PASSWORD=... python tests/e2e/run.py [screenshot_dir]

Uses the paper book only. Start from an empty database: the script asserts exact numbers.
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3210")
PASSWORD = os.environ["APP_PASSWORD"]
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None


def shot(page, name, full=True):
    if SHOTS:
        page.wait_for_timeout(350)
        # animations off: the full-page capture resizes the viewport, which would catch the rail mid-transition
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full, animations="disabled")


def main():
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ar-EG")
        page = ctx.new_page()
        # refused requests (wrong password, overspending) are part of the script; only script errors count
        page.on("console", lambda m: problems.append(f"console {m.type}: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))

        # --- sign in
        page.goto(BASE + "/")
        expect(page).to_have_url(re.compile(r"/login$"))
        shot(page, "01-login")
        page.get_by_label("كلمة السر").fill("definitely-wrong")
        page.get_by_role("button", name="دخول").click()
        expect(page.locator(".field__error")).to_contain_text("كلمة السر غلط")
        page.get_by_label("كلمة السر").fill(PASSWORD)
        page.get_by_role("button", name="دخول").click()
        expect(page.get_by_role("heading", name="لوحة المحفظة", level=1)).to_be_visible()
        expect(page.get_by_text("ابدأ بتسجيل أول إيداع")).to_be_visible()
        shot(page, "02-dashboard-empty")

        # --- deposit 2,000
        page.get_by_role("link", name="تسجيل عملية").click()
        expect(page.get_by_role("heading", name="العمليات", level=1)).to_be_visible()
        page.get_by_label("المبلغ بالجنيه").fill("2000")
        page.get_by_role("button", name="تسجيل إيداع").click()
        expect(page.get_by_role("status")).to_contain_text("إيداع")
        expect(page.locator("table tbody tr")).to_have_count(1)

        # --- the plan splits it 60/20/20
        page.get_by_role("link", name="خطة الشراء").first.click()
        expect(page.get_by_role("heading", name="خطة الشراء", level=1)).to_be_visible()
        rows = page.locator(".list__row")
        expect(rows).to_have_count(3)
        expect(rows.nth(0)).to_contain_text("1,200")
        expect(rows.nth(1)).to_contain_text("400")
        expect(rows.nth(2)).to_contain_text("400")
        shot(page, "03-plan")

        # --- record the three buys through the pre-filled form
        prices = {"CASH": None, "GOLD": "6765", "INDEX": "2.07"}
        links = [a.get_attribute("href") for a in page.get_by_role("link", name="سجّل الشراء").all()]
        assert len(links) == 3, links
        for href in links:
            page.goto(BASE + href)
            expect(page.get_by_role("tab", name="شراء")).to_have_attribute("aria-selected", "true")
            inst = page.get_by_label("الأداة").input_value()
            if prices[inst]:
                page.get_by_label(re.compile("سعر الوحدة")).fill(prices[inst])
            if inst == "GOLD":
                page.get_by_label(re.compile("الرسوم")).fill("1")
            page.get_by_role("button", name="تسجيل شراء").click()
            expect(page.get_by_role("status")).to_contain_text("شراء")
        expect(page.locator("table tbody tr")).to_have_count(4)
        shot(page, "04-ledger")

        # --- overspending is refused
        page.get_by_role("tab", name="شراء").click()
        page.get_by_label("المبلغ بالجنيه").fill("500")
        page.get_by_role("button", name="تسجيل شراء").click()
        expect(page.get_by_role("status")).to_contain_text("الرصيد غير الموزع")
        expect(page.locator("table tbody tr")).to_have_count(4)

        # --- deleting the deposit is refused while buys depend on it
        last_row = page.locator("table tbody tr").last
        last_row.get_by_role("button", name="حذف العملية").click()
        last_row.get_by_role("button", name="تأكيد الحذف").click()
        expect(page.get_by_role("status")).to_contain_text("مينفعش تتحذف")
        expect(page.locator("table tbody tr")).to_have_count(4)

        # --- mark the cash fund's balance up, as the broker app would show it
        page.get_by_role("link", name="الأسعار والأرصدة").first.click()
        expect(page.get_by_role("heading", name="الأسعار والأرصدة", level=1)).to_be_visible()
        page.get_by_label(re.compile("القيمة الحالية لـ كلاودز")).fill("1218")
        page.locator(".jline", has_text="كلاودز").get_by_role("button", name="حدّث").click()
        expect(page.get_by_role("status")).to_contain_text("1,218.00")
        shot(page, "05-prices")

        # --- a typo-sized balance is held for confirmation, and declining stores nothing
        page.get_by_label(re.compile("القيمة الحالية لـ كلاودز")).fill("12")
        page.locator(".jline", has_text="كلاودز").get_by_role("button", name="حدّث").click()
        expect(page.get_by_role("alertdialog")).to_contain_text("آخر قراءة")
        shot(page, "05b-confirm", full=False)
        page.get_by_role("button", name="رجوع للتصحيح").click()
        expect(page.get_by_role("alertdialog")).to_have_count(0)
        expect(page.locator(".jline", has_text="كلاودز")).to_contain_text("1,218.00")

        # --- dashboard now shows the gain: 1218 + 396 (gold after 1% fee) + 400 = 2,014
        page.get_by_role("link", name="لوحة المحفظة").first.click()
        expect(page.get_by_role("heading", name="لوحة المحفظة", level=1)).to_be_visible()
        expect(page.locator(".stat-card").nth(0)).to_contain_text("2,014")
        expect(page.locator(".stat-card").nth(1)).to_contain_text("+14")
        shot(page, "06-dashboard")

        # --- next month's plan appears when cash is not waiting
        expect(page.get_by_label("مبلغ الإضافة بالجنيه")).to_have_value("2000")
        expect(page.locator(".span-7 .list__row")).to_have_count(3)

        # --- settings: change the monthly amount, turn crypto on and off again
        page.get_by_role("link", name="الإعدادات").first.click()
        page.get_by_label("المبلغ بالجنيه").fill("2500")
        page.get_by_role("button", name="حفظ", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("تم حفظ الإعدادات")
        page.get_by_role("switch", name="تفعيل خانة الكريبتو").click()
        expect(page.get_by_text("مفعّلة")).to_be_visible()
        page.get_by_role("switch", name="تفعيل خانة الكريبتو").click()
        expect(page.get_by_text("متوقفة", exact=True)).to_be_visible()
        page.get_by_label("المبلغ بالجنيه").fill("2000")
        page.get_by_role("button", name="حفظ", exact=True).click()
        expect(page.get_by_role("status")).to_contain_text("تم حفظ الإعدادات")
        shot(page, "07-settings")

        # --- the real book is separate and still empty
        page.get_by_label("الدفتر").select_option("real")
        page.get_by_role("link", name="لوحة المحفظة").first.click()
        expect(page.get_by_text("ابدأ بتسجيل أول إيداع")).to_be_visible()
        page.get_by_label("الدفتر").select_option("paper")
        expect(page.locator(".stat-card").nth(0)).to_contain_text("2,014")

        # --- collapsed rail, dark theme
        page.get_by_role("button", name="طي القائمة").click()
        shot(page, "08-dashboard-collapsed", full=False)
        page.get_by_role("button", name="الوضع الداكن").click()
        expect(page.locator("html")).to_have_class(re.compile("dark"))
        shot(page, "09-dashboard-dark")
        page.get_by_role("button", name="الوضع الفاتح").click()
        page.get_by_role("button", name="توسيع القائمة").click()

        # --- phone
        phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-EG",
                                    storage_state=ctx.storage_state(), is_mobile=True, has_touch=True)
        mp = phone.new_page()
        mp.on("pageerror", lambda e: problems.append(f"mobile pageerror: {e}"))
        mp.goto(BASE + "/")
        expect(mp.get_by_role("heading", name="لوحة المحفظة", level=1)).to_be_visible()
        overflow = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 1:
            problems.append(f"mobile dashboard scrolls sideways by {overflow}px")
        shot(mp, "10-mobile-dashboard")
        mp.get_by_role("button", name="فتح القائمة").click()
        shot(mp, "11-mobile-menu", full=False)
        mp.get_by_role("link", name="العمليات").first.click()
        expect(mp.get_by_role("heading", name="العمليات", level=1)).to_be_visible()
        overflow = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 1:
            problems.append(f"mobile ledger scrolls sideways by {overflow}px")
        shot(mp, "12-mobile-ledger")
        for path, name in (("/plan", "13-mobile-plan"), ("/prices", "14-mobile-prices")):
            mp.goto(BASE + path)
            mp.wait_for_selector(".page-head")
            overflow = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if overflow > 1:
                problems.append(f"mobile {path} scrolls sideways by {overflow}px")
            shot(mp, name)
        phone.close()

        # --- sign out closes everything again
        page.get_by_role("button", name="تسجيل الخروج").first.click()
        expect(page).to_have_url(re.compile(r"/login$"))
        page.goto(BASE + "/ledger")
        expect(page).to_have_url(re.compile(r"/login$"))
        browser.close()

    if problems:
        print("PROBLEMS:")
        for item in problems:
            print("  -", item)
        sys.exit(1)
    print("e2e ok")


if __name__ == "__main__":
    main()
