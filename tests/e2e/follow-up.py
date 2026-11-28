"""Browser walk-through of the periodic reviews against a running local build.

    BASE_URL=http://localhost:3210 APP_PASSWORD=... python tests/e2e/follow-up.py [screenshot_dir]

Run it after tests/e2e/run.py (and budget.py) on the same database: it expects no review recorded yet.
The notes written here are made up for the test.
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3210")
PASSWORD = os.environ["APP_PASSWORD"]
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None

MIXED = "ردّ الاستفتاء: الأسهم المختلطة"  # open from day one, one-off
BANK = "سؤال الدعم: بنك الوكالة"  # open from day one, one-off
CUSTODY = "سؤال الدعم: تخصيص السبائك"  # open from day one, one-off
PLAN_RATE = "قرار الفايدة عند المركزي"  # recurring, open from day one
SAFE = "منصة SAFE قبل أول حصة"  # waits for the portfolio to reach a size


def shot(page, name, full=True):
    if SHOTS:
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full, animations="disabled")


def row(page, title):
    return page.locator(".review", has_text=title)


def open_row(page, title):
    r = row(page, title)
    r.get_by_role("button", name="راجع وسجّل").click()
    return r


def main():
    problems = []
    expect.set_options(timeout=15_000)

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

        # --- the dashboard says what waits on a review, and the menu carries the count
        card = page.locator(".card", has=page.get_by_role("heading", name="المراجعات", exact=True))
        expect(card).to_be_visible()
        # the first day has many questions open: the card shows five and says how many more wait
        expect(card.locator(".list__row")).to_have_count(5)
        expect(card.get_by_text(re.compile(r"^و\d+ كمان في المتابعة"))).to_be_visible()
        link = page.get_by_role("link", name=re.compile(r"^المتابعة، \d+ مستحقة$"))
        expect(link).to_be_visible()
        waiting = int(re.search(r"(\d+)", link.get_attribute("aria-label")).group(1))
        if waiting < 3:
            problems.append(f"expected at least the three day-one questions waiting, the menu says {waiting}")
        shot(page, "f01-dashboard")

        # --- the follow-up screen groups the items per investment
        link.click()
        expect(page).to_have_url(re.compile(r"/follow-up$"))
        expect(page.get_by_role("heading", name="المتابعة", level=1)).to_be_visible()
        for title in (MIXED, BANK, CUSTODY, PLAN_RATE):
            expect(row(page, title)).to_be_visible()
        # an item that waits for a condition is listed apart, not among the open ones
        expect(row(page, SAFE)).to_have_count(0)
        expect(page.get_by_text("لسه مش مفعّلة")).to_be_visible()
        expect(page.get_by_text(SAFE)).to_be_visible()
        shot(page, "f02-screen")

        # --- a problem needs a note, and says when it will come back
        r = open_row(page, MIXED)
        expect(r.get_by_text("اللي تراجعه")).to_be_visible()
        save = r.get_by_role("button", name="سجّل المراجعة")
        expect(save).to_be_disabled()  # no result chosen yet
        expect(r.get_by_text("اختار نتيجة المراجعة الأول")).to_be_visible()  # and it says why
        r.get_by_role("button", name="مشكلة", exact=True).click()
        expect(r.get_by_role("button", name="مشكلة", exact=True)).to_have_attribute("aria-pressed", "true")
        expect(save).to_be_disabled()  # a problem without a note
        expect(r.get_by_text("اكتب الملاحظة عشان تقدر تسجّل")).to_be_visible()
        expect(r.get_by_text("اكتب ملاحظة قصيرة")).to_be_visible()
        r.get_by_label(re.compile("^ملاحظة")).fill("الرد جه: مش واضح، محتاج أسأل تاني")
        expect(r.get_by_text("المراجعة الجاية")).to_be_visible()
        # a day count outside the range is refused before it is sent
        r.get_by_label(re.compile("راجعني تاني بعد")).fill("0")
        expect(r.get_by_text("رقم صحيح من 1")).to_be_visible()
        expect(save).to_be_disabled()
        r.get_by_label(re.compile("راجعني تاني بعد")).fill("3")
        expect(save).to_be_enabled()
        shot(page, "f03-form")
        save.click()
        expect(status.filter(has_text="اتسجلت كمشكلة")).to_be_visible()
        expect(row(page, MIXED).get_by_text("مشكلة مفتوحة")).to_be_visible()
        expect(row(page, MIXED).get_by_text("الرد جه: مش واضح")).to_be_visible()
        # the open problem stays first on the page
        first = page.locator(".review").first
        expect(first).to_contain_text(MIXED)
        shot(page, "f04-problem")

        # --- a one-off review that comes back fine closes the item
        r = open_row(page, BANK)
        r.get_by_role("button", name="تمام", exact=True).click()
        expect(r.get_by_text("البند هيتقفل")).to_be_visible()
        r.get_by_role("button", name="سجّل المراجعة").click()
        expect(row(page, BANK)).to_have_count(0)
        closed = page.locator(".card", has=page.get_by_role("heading", name="اتقفلت", exact=True))
        expect(closed.get_by_text(BANK)).to_be_visible()

        # --- "needs watching" brings it back on the chosen day, and the history keeps both
        r = open_row(page, CUSTODY)
        r.get_by_role("button", name="محتاج متابعة", exact=True).click()
        r.get_by_label(re.compile("^ملاحظة")).fill("مستني رد الدعم")
        r.get_by_role("button", name="سجّل المراجعة").click()
        expect(row(page, CUSTODY).get_by_text("متابعة", exact=True)).to_be_visible()
        expect(row(page, CUSTODY).get_by_text("مستني رد الدعم")).to_be_visible()

        # --- a recurring item schedules its next review from the rhythm
        r = open_row(page, PLAN_RATE)
        r.get_by_role("button", name="تمام", exact=True).click()
        r.get_by_role("button", name="سجّل المراجعة").click()
        expect(row(page, PLAN_RATE).get_by_text("تمام", exact=True)).to_be_visible()
        expect(row(page, PLAN_RATE).get_by_text(re.compile(r"بعد \d+ يوم"))).to_be_visible()

        # --- it survives a reload, and the dashboard follows
        page.reload()
        expect(page.get_by_role("heading", name="المتابعة", level=1)).to_be_visible()
        expect(row(page, MIXED).get_by_text("مشكلة مفتوحة")).to_be_visible()
        expect(row(page, BANK)).to_have_count(0)
        page.get_by_role("link", name="لوحة المحفظة").click()
        card = page.locator(".card", has=page.get_by_role("heading", name="المراجعات", exact=True))
        expect(card.get_by_text(MIXED)).to_be_visible()
        expect(card.get_by_text(BANK)).to_have_count(0)
        shot(page, "f05-dashboard-after")

        # --- the same submission sent twice is stored once
        body = {"op": "record", "item": "gold_fees", "result": "ok", "note": "", "op_id": "e2e-same-submission-1"}
        first_reply = ctx.request.post(BASE + "/api/reviews", data=body)
        second_reply = ctx.request.post(BASE + "/api/reviews", data=body)
        if not (first_reply.ok and second_reply.ok):
            problems.append(f"record failed: {first_reply.status} / {second_reply.status}")
        elif "قبل كده" not in second_reply.json().get("message", ""):
            problems.append("a repeated submission was not recognised")
        states = ctx.request.get(BASE + "/api/reviews").json()["states"]
        fees = next(s for s in states if s["item"]["id"] == "gold_fees")
        if len(fees["history"]) != 1:
            problems.append(f"expected one stored review, found {len(fees['history'])}")
        # and a request that is not valid is refused with a reason
        bad = ctx.request.post(BASE + "/api/reviews", data={"op": "record", "item": "gold_fees", "result": "problem", "note": "", "op_id": "e2e-bad-note-1"})
        if bad.status == 200:
            problems.append("a problem without a note was accepted")
        unknown = ctx.request.post(BASE + "/api/reviews", data={"op": "record", "item": "no_such_item", "result": "ok", "op_id": "e2e-unknown-1"})
        if unknown.status != 400:
            problems.append(f"an unknown item answered {unknown.status}")

        # --- undo takes the newest review back, after a confirmation
        page.goto(BASE + "/follow-up")
        r = open_row(page, MIXED)
        r.get_by_role("button", name="تراجع عن آخر مراجعة").click()
        r.get_by_role("button", name="أيوه، شيل آخر مراجعة").click()
        expect(status.filter(has_text="اتشالت آخر مراجعة")).to_be_visible()
        expect(row(page, MIXED).get_by_text("مشكلة مفتوحة")).to_have_count(0)
        expect(row(page, MIXED).get_by_text("لسه ماتراجعتش")).to_be_visible()
        shot(page, "f06-undone")


        # --- phone notifications: the settings card, and the API refusing what it should
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(BASE + "/settings")
        expect(page.get_by_role("heading", name="إشعارات المراجعات")).to_be_visible()
        # the test server has no VAPID keys, so the card says what is missing instead of offering a button
        expect(page.get_by_text(re.compile("الخادم لسه مش مجهّز للإشعارات"))).to_be_visible()
        expect(page.get_by_role("button", name=re.compile("فعّل الإشعارات"))).to_have_count(0)
        shot(page, "f08-push-card")
        info = ctx.request.get(BASE + "/api/push").json()
        if info.get("configured") is not False or info.get("devices") != 0:
            problems.append(f"unexpected push status: {info}")
        device = {"endpoint": "https://fcm.googleapis.com/fcm/send/e2e-device", "keys": {
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
            "auth": "tBHItJI5svbpez7KI4CCXg"}}
        for op, extra in (("subscribe", {"subscription": device}), ("test", {})):
            reply = ctx.request.post(BASE + "/api/push", data={"op": op, **extra})
            if reply.status != 400:
                problems.append(f"push {op} without server keys answered {reply.status}, expected a refusal")
        bad_host = ctx.request.post(BASE + "/api/push", data={"op": "unsubscribe", "endpoint": "https://example.com/x"})
        if bad_host.status != 400:
            problems.append(f"an endpoint outside the push services answered {bad_host.status}")
        unauth = ctx.browser.new_context().request.post(BASE + "/api/push", data={"op": "test"})
        if unauth.status == 200:
            problems.append("push test worked without signing in")
        secret = os.environ.get("CRON_SECRET")
        cron = ctx.browser.new_context().request
        if cron.get(BASE + "/api/cron/reviews").status not in (401, 503):
            problems.append("the reviews cron answered without the secret")
        if secret:
            done = cron.get(BASE + "/api/cron/reviews", headers={"Authorization": f"Bearer {secret}"})
            if not done.ok or done.json().get("status") != "not_configured":
                problems.append(f"the reviews cron did not report missing keys: {done.status} {done.text()[:120]}")

        # --- the phone: nothing spills sideways, the menu still shows the count
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/follow-up")
        expect(page.get_by_role("heading", name="المتابعة", level=1)).to_be_visible()
        open_row(page, PLAN_RATE)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 0:
            problems.append(f"follow-up scrolls sideways on a phone by {overflow}px")
        shot(page, "f07-phone")

        browser.close()

    if problems:
        print("PROBLEMS:")
        for line in problems:
            print(" -", line)
        sys.exit(1)
    print("follow-up: ok")


if __name__ == "__main__":
    main()
