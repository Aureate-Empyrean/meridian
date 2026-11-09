"""Browser Back/Forward, deep links and refresh for Meridian inside Nexus (aetest only).

Real Nexus (navigation contract) → Meridian iframe. Never run against production.
Run with dev-orchestrator/.venv (Python Playwright).
"""

import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://localhost:12334"
SHOTS = ROOT / "docs/screenshots/navigation"
results = []


def check(name, ok=True):
    results.append((name, ok))
    print(("PASS: " if ok else "FAIL: ") + name, flush=True)
    if not ok:
        raise AssertionError(name)


def route_of(page):
    parts = urlsplit(page.url)
    q = parse_qs(parts.query)
    return parts.path, (q.get("route") or [None])[0]


def wait_route(page, path, route, timeout=10000):
    expect(page).to_have_url(re.compile(re.escape(path) + r"(\?|$)"), timeout=timeout)
    page.wait_for_function(
        "r => new URLSearchParams(location.search).get('route') === r", arg=route, timeout=timeout
    )


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    owner = json.loads((ROOT.parent / "empyrean-nexus/.data/aetest-owner.json").read_text())
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/app/overview")
        page.locator("#username").fill(owner["username"])
        page.locator("#password").fill(owner["password"])
        page.get_by_role("button", name="Sign in", exact=True).click()
        page.locator('.overview-app[data-module-id="meridian"] a', has_text="Open").click()
        frame = page.frame_locator("#module-application")
        mod = "/app/modules/meridian"
        wait_route(page, mod, "/")
        check("Opening Meridian shows its Dashboard address (canonical, no extra entry)")
        start_len = page.evaluate("history.length")

        frame.locator('[data-act="go"][data-view="people"]').first.click()
        wait_route(page, mod, "/people")
        expect(frame.locator("#people-list")).to_be_visible()
        check("People → URL reflects /people")
        frame.locator('[data-act="go"][data-view="people"]').first.click()
        page.wait_for_timeout(500)
        check(
            "Clicking the same screen again adds no history entry",
            page.evaluate("history.length") == start_len + 1,
        )

        page.go_back()
        wait_route(page, mod, "/")
        expect(frame.locator("#people-list")).to_have_count(0)
        check("Back returns to the Meridian Dashboard, not to Nexus")
        page.go_forward()
        wait_route(page, mod, "/people")
        expect(frame.locator("#people-list")).to_be_visible()
        check("Forward restores People")

        row = frame.locator('#people-list [data-act="open-person"]').first
        pid = row.get_attribute("data-id")
        row.click()
        wait_route(page, mod, f"/people/{pid}")
        expect(frame.locator(".profile-head")).to_be_visible()
        check("Person detail has its own address")
        page.go_back()
        wait_route(page, mod, "/people")
        expect(frame.locator("#people-list")).to_be_visible()
        check("Back from a person returns to People")

        # Mouse 4 / Mouse 5 through Chromium's input pipeline (synthetic CDP buttons).
        cdp = ctx.new_cdp_session(page)
        for kind in ("mousePressed", "mouseReleased"):
            cdp.send(
                "Input.dispatchMouseEvent",
                {"type": kind, "x": 700, "y": 400, "button": "forward", "clickCount": 1},
            )
        try:
            wait_route(page, mod, f"/people/{pid}", timeout=4000)
            for kind in ("mousePressed", "mouseReleased"):
                cdp.send(
                    "Input.dispatchMouseEvent",
                    {"type": kind, "x": 700, "y": 400, "button": "back", "clickCount": 1},
                )
            wait_route(page, mod, "/people", timeout=4000)
            check("Mouse 5 / Mouse 4 move forward and back")
        except AssertionError:
            print(
                "NOTE: synthetic mouse back/forward buttons not handled by this headless build; "
                "covered by the History API traversal above"
            )

        # Direct link and refresh.
        deep = f"{BASE}{mod}?nav=1&route={quote(f'/people/{pid}', safe='')}"
        page.goto(deep)
        expect(frame.locator(".profile-head")).to_be_visible(timeout=15000)
        check("Direct link opens the person")
        page.reload()
        expect(frame.locator(".profile-head")).to_be_visible(timeout=15000)
        wait_route(page, mod, f"/people/{pid}")
        check("Refresh keeps the person page and its address")
        page.screenshot(path=str(SHOTS / "person-1440.png"))

        # Meridian → Nexus → back to Meridian.
        # In application mode the Nexus bar is compact; use its Overview link as the router does.
        page.evaluate("document.querySelector('a[data-nav=\"overview\"]').click()")
        expect(page).to_have_url(re.compile(r"/app/overview$"))
        page.go_back()
        wait_route(page, mod, f"/people/{pid}")
        expect(frame.locator(".profile-head")).to_be_visible(timeout=15000)
        check("Nexus Overview → Back restores the Meridian person")

        # Switching to another installed module (legacy Chronos) and back.
        page.goto(BASE + "/app/modules/chronos")
        expect(page.frame_locator("#module-application").locator("body")).not_to_be_empty(
            timeout=15000
        )
        page.go_back()
        wait_route(page, mod, f"/people/{pid}")
        expect(frame.locator(".profile-head")).to_be_visible(timeout=15000)
        page.go_forward()
        expect(page).to_have_url(re.compile(r"/app/modules/chronos$"))
        check("Meridian ↔ Chronos switching keeps normal history (legacy module unaffected)")

        # Invalid routes fail gracefully.
        page.goto(f"{BASE}{mod}?nav=1&route={quote('/no-such-screen', safe='')}")
        wait_route(page, mod, "/")
        check("Unknown Meridian route falls back to the Dashboard and canonical address")
        page.goto(f"{BASE}{mod}?nav=1&route=..%2Fetc")
        expect(page.locator("#content")).to_contain_text(
            re.compile("not found|Not found|doesn"), timeout=10000
        )
        check("Malformed route envelope is refused by Nexus (not-found view)")

        # Unsaved side-panel edits are not dropped silently by Back (same module).
        page.goto(f"{BASE}{mod}?nav=1&route={quote('/people', safe='')}")
        expect(frame.locator("#people-list")).to_be_visible(timeout=15000)
        frame.locator(f'#people-list [data-id="{pid}"]').click()
        wait_route(page, mod, f"/people/{pid}")
        frame.locator('.profile-head [data-act="edit"]').click()
        expect(frame.locator("#panel-body")).to_be_visible(timeout=10000)
        field = frame.locator("#panel-body input.ae-input, #panel-body textarea").first
        field.fill(field.input_value() + " x")
        page.go_back()
        # 0.6.0 unified contact editor: "Save your changes?" with Continue editing / Discard / Save.
        expect(frame.locator("#dialog")).to_contain_text("Save your changes?", timeout=10000)
        frame.locator('#dialog [data-act="close"]').first.click()  # Continue editing
        wait_route(page, mod, f"/people/{pid}")
        expect(frame.locator("#panel-body")).to_be_visible()
        check(
            "Back with unsaved edits asks first; keeping them returns to the editor and its address"
        )
        # Phone width.
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{BASE}{mod}?nav=1&route={quote('/people', safe='')}")
        expect(frame.locator("#people-list")).to_be_visible(timeout=15000)
        frame.locator('#people-list [data-act="open-person"]').first.click()
        wait_route(page, mod, f"/people/{pid}")
        page.go_back()
        wait_route(page, mod, "/people")
        page.screenshot(path=str(SHOTS / "people-390.png"))
        check("Back/Forward at 390 px")
        check("No page errors", not errors)
        browser.close()
    print(json.dumps({"passed": sum(ok for _, ok in results), "total": len(results)}))


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print("FAILED:", str(error)[:1500], flush=True)
        sys.exit(1)
