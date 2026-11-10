// Organization suggestions in Work and Education (MER-QA-AUTOCOMPLETE): the list is an anchored
// overlay, so opening, changing or closing it never moves a field. Synthetic data in the local
// harness: python tests/e2e/harness.py 17402 (PYTHONPATH=backend), then
// PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/autocomplete_layout_e2e.cjs
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "../../../mnemosyne/node_modules/playwright");
const BASE = process.env.HARNESS || "http://127.0.0.1:17402";
const SIZES = [
  ["390", { width: 390, height: 844 }, 1],
  ["820", { width: 820, height: 1180 }, 1],
  ["1440", { width: 1440, height: 900 }, 1],
  // 200% browser zoom of a 1440 × 900 window: half the CSS pixels at twice the density.
  ["1440 at 200%", { width: 720, height: 450 }, 2],
];
let passed = 0;
const check = (ok, what) => {
  assert.ok(ok, what);
  passed++;
  console.log(`ok   ${what}`);
};
async function api(path, method = "GET", body) {
  const r = await fetch(BASE + "/api" + path, {
    method,
    headers: { "x-nexus-gateway-key": "h".repeat(40), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(r.ok, await r.clone().text());
  return r.json();
}

(async () => {
  const run = Date.now().toString(36);
  const person = await api("/people", "POST", { names: [{ kind: "full", given: "Layout", family: `Person ${run}` }] });
  for (let i = 1; i <= 14; i++)
    await api("/entities", "POST", {
      kind: "organization",
      names: [{ kind: "full", value: `Example Org ${run} ${String(i).padStart(2, "0")}` }],
    });
  const browser = await chromium.launch();
  try {
    for (const [label, viewport, deviceScaleFactor] of SIZES) {
      const page = await browser.newPage({ viewport, deviceScaleFactor, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE + "/__harness");
      const f = page.frames().find((fr) => fr !== page.mainFrame());
      await f.waitForFunction(() => typeof go === "function" && typeof openPanel === "function");
      await f.evaluate((id) => go("person", id), person.id);
      await f.locator(".person-name").waitFor();
      await f.evaluate(() => openPanel("employments"));

      for (const section of ["employments", "education"]) {
        const where = `${label}, ${section === "employments" ? "Work" : "Education"}`;
        if (section === "education") await f.locator('[data-act="panel-section"][data-section="education"]').click();
        await f.locator('#panel-body [data-combo-input="org"]').first().waitFor();
        // Two rows, so there is a field below the one being typed in.
        if ((await f.locator('#panel-body [data-combo-input="org"]').count()) < 2)
          await f.locator('#panel [data-act="add-row"]').click();
        const input = f.locator('#panel-body [data-combo-input="org"]').first();
        const list = f.locator("#panel-body .combo-list").first();
        const fields = () => f.evaluate(() => [...document.querySelectorAll("#panel-body [data-k], #panel-body .ae-label")].filter((el) => el.offsetParent).map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(","); })); // prettier-ignore
        const geometry = () =>
          input.evaluate((el) => {
            const l = el.closest(".combo").querySelector(".combo-list");
            const i = el.getBoundingClientRect();
            const r = l.getBoundingClientRect();
            const at = (y) => document.elementFromPoint(r.left + r.width / 2, y);
            return {
              position: getComputedStyle(l).position,
              gapBelow: r.top - i.bottom,
              gapAbove: i.top - r.bottom,
              inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5,
              noSideScroll: document.documentElement.scrollWidth <= innerWidth,
              onTop: [r.top + 6, r.top + r.height / 2, r.bottom - 6].every((y) => l.contains(at(y))),
              scrolls: l.scrollHeight > l.clientHeight,
              scrollTop: l.scrollTop,
            };
          });
        const anchored = (g) => (g.gapBelow >= 0 && g.gapBelow <= 8) || (g.gapAbove >= 0 && g.gapAbove <= 8);
        const shown = (text) => f.waitForFunction((t) => { const l = document.querySelector("#panel-body .combo-list:not([hidden])"); return l && (!t || l.textContent.includes(t)); }, text); // prettier-ignore

        await input.click(); // may scroll the editor to the field: measure after that
        const before = await fields();
        await input.pressSequentially(`example org ${run}`);
        await shown(`Example Org ${run} 01`);
        let g = await geometry();
        check(g.position === "absolute", `${where}: suggestions are an overlay, not part of the form`);
        check(
          JSON.stringify(await fields()) === JSON.stringify(before),
          `${where}: no field moves or resizes when suggestions open`,
        );
        check(anchored(g), `${where}: the list is anchored to the field (${Math.round(g.gapBelow)} px below)`);
        check(g.inViewport && g.noSideScroll, `${where}: the list fits the viewport, no horizontal scrolling`);
        check(g.onTop, `${where}: the list is drawn above the fields under it`);
        check(g.scrolls, `${where}: a long list scrolls on its own`);
        check((await input.getAttribute("aria-expanded")) === "true", `${where}: aria-expanded is true while open`);

        // Keyboard: arrows move through options and the long list follows; Escape closes only the list.
        await input.press("ArrowDown");
        const first = await f.locator("#panel-body .combo-option").first().getAttribute("id");
        check(
          (await input.getAttribute("aria-activedescendant")) === first,
          `${where}: ArrowDown highlights the first option`,
        );
        for (let i = 0; i < 12; i++) await input.press("ArrowDown");
        g = await geometry();
        check(g.scrollTop > 0, `${where}: the list scrolls to the highlighted option`);
        check(
          JSON.stringify(await fields()) === JSON.stringify(before),
          `${where}: moving through options moves no field`,
        );
        await input.press("Escape");
        check(
          (await list.isHidden()) && (await input.getAttribute("aria-expanded")) === "false",
          `${where}: Escape closes the list`,
        );
        check(await f.locator("#panel").isVisible(), `${where}: Escape leaves the editor open`);
        check(JSON.stringify(await fields()) === JSON.stringify(before), `${where}: closing moves no field`);

        // Changing the text changes the list (one "Create" option), still without moving anything.
        await input.fill("");
        await input.pressSequentially(`zz nothing ${run}`);
        await shown("Create");
        check(JSON.stringify(await fields()) === JSON.stringify(before), `${where}: the empty result moves no field`);
        await input.press("Tab");
        check(await list.isHidden(), `${where}: Tab leaves the field and closes the list`);

        // A search error is shown in the same overlay.
        await page.route("**/api/search**", (route) => route.abort());
        await input.fill("");
        await input.pressSequentially(`example org ${run}`);
        await shown("could not be searched");
        g = await geometry();
        check(
          anchored(g) && g.inViewport && JSON.stringify(await fields()) === JSON.stringify(before),
          `${where}: the error message is an anchored overlay too`,
        );
        await page.unroute("**/api/search**");
        await input.press("Escape");

        // Near the bottom of the visible editor: the list still fits, and stays with the field
        // while the editor scrolls.
        const low = f.locator('#panel-body [data-combo-input="org"]').last();
        await low.evaluate((el) => el.scrollIntoView({ block: "end" }));
        await low.click();
        await low.fill("");
        await low.pressSequentially(`example org ${run}`);
        await shown(`Example Org ${run} 01`);
        const lowGeometry = () =>
          low.evaluate((el) => {
            const l = el.closest(".combo").querySelector(".combo-list");
            const i = el.getBoundingClientRect();
            const r = l.getBoundingClientRect();
            return {
              below: r.top - i.bottom,
              above: i.top - r.bottom,
              inViewport: r.top >= 0 && r.bottom <= innerHeight + 0.5,
            };
          });
        const g1 = await lowGeometry();
        check(
          g1.inViewport && ((g1.below >= 0 && g1.below <= 8) || (g1.above >= 0 && g1.above <= 8)),
          `${where}: near the bottom the list fits the viewport (${g1.above >= 0 ? "opens upwards" : "opens downwards"})`,
        );
        await low.evaluate((el) => { const s = el.closest(".panel-body") || document.scrollingElement; s.scrollTop -= 40; }); // prettier-ignore
        const g2 = await lowGeometry();
        check(
          Math.abs(g2.below - g1.below) < 1 && Math.abs(g2.above - g1.above) < 1,
          `${where}: the list stays anchored while the editor scrolls`,
        );
        await low.press("Escape");
      }
      check(errors.length === 0, `${label}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
      await page.close();
    }
    console.log(`${passed} checks passed`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
