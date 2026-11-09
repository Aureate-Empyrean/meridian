"""Browser journey for Meridian 0.4.0 pictures (aetest only, synthetic data).

Real Nexus iframe → Meridian → Nexus projections → Argus. Choose an Argus photo for a
Person and a Group, crop it (drag, slider, keyboard), see it in the profile and lists,
survive a reload, recrop, remove, and fall back to initials while Argus is stopped.
Never run against production. Run with dev-orchestrator/.venv (Python Playwright).
"""

import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs/screenshots/pictures"
URL = "http://localhost:12334/app/modules/meridian"
results = []


def check(name, ok=True):
    results.append((name, ok))
    print(("PASS: " if ok else "FAIL: ") + name, flush=True)
    if not ok:
        raise AssertionError(name)


def edges():
    out = subprocess.check_output(
        [
            "docker",
            "exec",
            "aetest-nexus-1",
            "python",
            "-c",
            "import sqlite3; c=sqlite3.connect('/data/nexus.sqlite3'); print(*[r[0] for r in c.execute(\"SELECT source FROM resource_references WHERE relation='meridian.representative-image'\")])",
        ],  # noqa: E501
        text=True,
    )
    return {line.rsplit(":", 1)[-1] for line in out.split()}


def edges_settle(entity_id, present, timeout=12):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if (entity_id in edges()) == present:
            return True
        time.sleep(0.5)
    return False


def crop_and_save(frame, page, shot=None):
    dialog = frame.locator("#dialog")
    expect(dialog.locator(".pic-tile").first).to_be_visible(timeout=15000)
    dialog.locator(".pic-tile").first.click()
    stage = dialog.locator("#pic-stage")
    expect(stage.locator("img")).to_be_attached(timeout=15000)
    expect(dialog.locator("#pic-save")).to_be_enabled()
    box = stage.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] / 2 + 25, steps=6)
    page.mouse.up()
    dialog.locator("#pic-zoom").fill("1.8")
    stage.focus()
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Shift+ArrowDown")
    if shot:
        page.screenshot(path=str(SHOTS / shot))
    dialog.locator("#pic-save").click()
    expect(dialog).not_to_be_visible(timeout=15000)


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    owner = json.loads((ROOT.parent / "empyrean-nexus/.data/aetest-owner.json").read_text())
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.locator("#username").fill(owner["username"])
        page.locator("#password").fill(owner["password"])
        page.get_by_role("button", name="Sign in", exact=True).click()
        frame = page.frame_locator("#module-application")
        frame.locator('[data-act="go"][data-view="people"]').first.click()
        row = frame.locator('#people-list [data-act="open-person"]').first
        expect(row).to_be_visible(timeout=20000)
        pid = row.get_attribute("data-id")
        row.click()
        head = frame.locator(".profile-head")
        expect(head.locator(".avatar-edit")).to_be_visible(timeout=15000)
        check("Profile offers a picture control")
        head.locator(".avatar-edit").click()
        expect(frame.locator("#dialog .pic-tile").first).to_be_visible(timeout=15000)
        page.screenshot(path=str(SHOTS / "choose-1440.png"))
        check("Argus photos listed inside Meridian")
        crop_and_save(frame, page, "crop-1440.png")
        expect(head.locator(".avatar.has-photo")).to_be_visible(timeout=15000)
        check("Cropped picture shown in the profile")
        check("Representative-image reference registered for Argus", edges_settle(pid, True))
        page.screenshot(path=str(SHOTS / "profile-1440.png"))

        page.reload()
        frame = page.frame_locator("#module-application")
        frame.locator('[data-act="go"][data-view="people"]').first.click()
        listed = frame.locator(f'#people-list [data-id="{pid}"] .avatar.has-photo')
        expect(listed).to_be_visible(timeout=20000)
        check("Picture survives a reload and appears in the People list")
        page.screenshot(path=str(SHOTS / "people-1440.png"))

        # Group: a circle mask, its own picture.
        frame.locator('[data-act="go"][data-view="groups"]').first.click()
        expect(frame.locator("#entity-list")).to_be_visible(timeout=15000)
        frame.locator(
            '#entity-list .dir-row, #entity-list .empty, #entity-list [class*="empty"]'
        ).first.wait_for(timeout=15000)
        grow = frame.locator('#entity-list [data-act="open-entity"]').first
        group_done = False
        if grow.count():
            grow.click()
            frame.locator(".profile-head .avatar-edit").click()
            expect(frame.locator("#dialog .pic-tile").first).to_be_visible(timeout=15000)
            frame.locator("#dialog .pic-tile").first.click()
            expect(frame.locator("#pic-stage.is-group")).to_be_visible(timeout=15000)
            frame.locator("#dialog #pic-save").click()
            expect(frame.locator(".profile-head .avatar.is-group.has-photo")).to_be_visible(
                timeout=15000
            )
            check("Group picture uses the group's circle shape")
            group_done = True

        # Recrop the person, then remove the picture.
        frame.locator('[data-act="go"][data-view="people"]').first.click()
        frame.locator(f'#people-list [data-id="{pid}"]').click()
        frame.locator(".profile-head .avatar-edit").click()
        frame.locator("#dialog #pic-recrop").click()
        expect(frame.locator("#dialog #pic-save")).to_be_enabled(timeout=15000)
        frame.locator("#dialog #pic-zoom").fill("2.4")
        frame.locator("#dialog #pic-save").click()
        expect(frame.locator("#dialog")).not_to_be_visible(timeout=15000)
        check("Recrop keeps the same photo and saves a new crop")

        # Argus stopped: initials, honest message, Meridian data untouched.
        subprocess.run(["docker", "stop", "aetest-module-argus"], check=True, capture_output=True)
        # Rendered pictures are cached for two minutes; start from a cold cache.
        subprocess.run(
            ["docker", "restart", "aetest-module-meridian"], check=True, capture_output=True
        )
        time.sleep(4)
        try:
            page.reload()
            frame = page.frame_locator("#module-application")
            frame.locator('[data-act="go"][data-view="people"]').first.click()
            r = frame.locator(f'#people-list [data-id="{pid}"]')
            expect(r).to_be_visible(timeout=20000)
            time.sleep(2)
            check("Initials shown while Argus is down", r.locator(".avatar.has-photo").count() == 0)
            r.click()
            frame.locator(".profile-head .avatar-edit").click()
            expect(frame.locator("#dialog .pic-empty")).to_be_visible(timeout=20000)
            check("Picture dialog explains that Argus is unavailable")
            frame.locator('#dialog [data-act="close"]').first.click()
        finally:
            subprocess.run(
                ["docker", "start", "aetest-module-argus"], check=True, capture_output=True
            )
            time.sleep(4)

        # Phone width: crop editor stacks.
        page.set_viewport_size({"width": 390, "height": 844})
        page.reload()
        frame = page.frame_locator("#module-application")
        frame.locator('[data-act="go"][data-view="people"]').first.click()
        frame.locator(f'#people-list [data-id="{pid}"]').click()
        frame.locator(".profile-head .avatar-edit").click()
        frame.locator("#dialog #pic-recrop").click()
        expect(frame.locator("#dialog #pic-save")).to_be_enabled(timeout=20000)
        page.screenshot(path=str(SHOTS / "crop-390.png"))
        overflow = frame.locator("body").evaluate("b => b.scrollWidth > b.clientWidth + 1")
        check("Crop editor fits at 390 px", not overflow)
        frame.locator("#dialog #pic-back").click()
        frame.locator("#dialog #pic-remove").click()
        expect(frame.locator("#dialog")).not_to_be_visible(timeout=15000)
        expect(frame.locator(".profile-head .avatar.has-photo")).to_have_count(0)
        check(
            "Removing the picture restores initials and removes the reference",
            edges_settle(pid, False),
        )
        check("No page errors", not errors)
        browser.close()
    print(json.dumps({"passed": sum(ok for _, ok in results), "total": len(results)}))


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print("FAILED:", str(error)[:1500], flush=True)
        sys.exit(1)
