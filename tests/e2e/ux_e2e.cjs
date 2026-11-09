// Browser journey for the 0.5.0 UX improvements, against the local harness (tests/e2e/harness.py):
// Meridian in a sandboxed iframe with a Nexus-like bridge and a fresh, synthetic database.
//
//   docker run -d --name meridian-ux-harness -p 127.0.0.1:17399:8000 -v <meridian>:/src -w /src \
//     -e PYTHONPATH=/src/backend aureate-pytest:local python tests/e2e/harness.py 8000
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/ux_e2e.cjs
//
// Screenshots go to docs/screenshots/0.5.0/. Exit code 1 on the first failed check.
//
// Inside the real Nexus (aetest only, never production): NEXUS_URL=http://localhost:12334 signs
// in with empyrean-nexus/.data/aetest-owner.json, seeds through Meridian's own bridge calls,
// restores the original @me and People settings at the end, and keeps the synthetic people for
// review. Screenshots then go to docs/screenshots/0.5.0-aetest/. Run it once per installation.
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const BASE = process.env.HARNESS || "http://127.0.0.1:17399";
const NEXUS = process.env.NEXUS_URL || "";
if (NEXUS && !/^http:\/\/(localhost|127\.0\.0\.1):12334$/.test(NEXUS)) throw Error("NEXUS_URL must be the local aetest Nexus");
const KEY = "h".repeat(40);
const SHOTS = path.join(__dirname, NEXUS ? "../../docs/screenshots/0.5.0-aetest" : "../../docs/screenshots/0.5.0");
let setupFrame = null; // in Nexus mode, API calls go through Meridian's own bridge in this frame
fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0;
const check = (ok, what) => {
  if (!ok) {
    console.error(`FAIL ${what}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${what}`);
};

async function api(p, method = "GET", body) {
  if (NEXUS) return setupFrame.evaluate(([q, m, b]) => (b === null ? api(q, m) : api(q, m, b)), [p, method, body === undefined ? null : body]);
  const r = await fetch(BASE + "/api" + p, { method, headers: { "x-nexus-gateway-key": KEY, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw Error(`${method} ${p}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const person = (given, family, born) => api("/people", "POST", { names: [{ kind: "full", given, family }], ...(born ? { dates: [{ kind: "birth", date: born }] } : {}) }).then((x) => x.id);
const relate = (a, type, b, extra = {}) => api("/relationships", "POST", { subject_id: a, object_id: b, type, ...extra });

// Contrast ratio of two CSS rgb() colours (WCAG relative luminance).
function contrast(fg, bg) {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
      v = +v / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const meridianFrame = (page) => (NEXUS ? page.frames().find((fr) => fr !== page.mainFrame() && /\/modules\/meridian/.test(fr.url())) : page.frame({ url: /\/$/ }) || page.frames()[1]);
async function openApp(page) {
  if (NEXUS) {
    await page.goto(NEXUS + "/app/modules/meridian");
    const user = page.locator("#username");
    if (await user.isVisible({ timeout: 5000 }).catch(() => false)) {
      const owner = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../empyrean-nexus/.data/aetest-owner.json"), "utf8"));
      await user.fill(owner.username);
      await page.locator("#password").fill(owner.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
  } else await page.goto(BASE + "/__harness");
  await page.frameLocator("#module-application").locator(".app .nav-item").first().waitFor({ timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
  let original = null;
  if (NEXUS) {
    const setup = await context.newPage();
    await openApp(setup);
    setupFrame = meridianFrame(setup);
    original = await api("/state");
    console.log(`aetest Meridian ${original.version}; people ${original.counts.people}; @me ${original.self ? "set" : "not set"}; settings ${JSON.stringify(original.settings)}`);
    check(original.version === "0.5.0", "aetest runs Meridian 0.5.0 inside Nexus");
  }
  // ── Synthetic data ──
  const ukazka = await person("Ukážka", "Kvázimenná");
  const pokusko = await person("Pokusko", "Kvázimenný");
  const vzorko = await person("Vzorko", "Kvázimenný", "1987-08-23");
  const nahradka = await person("Náhradka", "Kvázimenná", "1990-04-26");
  const adrian = await person("Adrián", "Čech");
  const jana = await person("Jana", "Nová");
  const tomas = await person("Tomáš", "Starý");
  await person("Zuzana", "Cibuľová");
  await person("Chris", "Hraško");
  await relate(ukazka, "parent", nahradka, { kinship: "biological" });
  await relate(pokusko, "parent", nahradka, { kinship: "biological" });
  await relate(tomas, "dating", jana, { valid_from: "2022" });
  await relate(jana, "friend", tomas, { valid_from: "2015" });
  await api("/self", "PUT", { person_id: adrian });
  // A second family and couple for the phone pass: two shared biological parents this time.
  const eva = await person("Eva", "Pekná");
  const ivan = await person("Ivan", "Pekný");
  const juraj = await person("Juraj", "Pekný", "1995-04-12");
  const lenka = await person("Lenka", "Pekná", "1998-09-01");
  await relate(eva, "parent", lenka, { kinship: "biological" });
  await relate(ivan, "parent", lenka, { kinship: "biological" });
  await relate(ivan, "parent", juraj, { kinship: "biological" });
  const ema = await person("Ema", "Rybárová");
  const oto = await person("Oto", "Sokol");
  await relate(oto, "dating", ema, { valid_from: "2019" });
  await relate(ema, "friend", oto, { valid_from: "2015" });
  const SCENARIO = {
    desktop: { parent: "Ukážka Kvázimenná", child: "Vzorko Kvázimenný", childFull: "Vzorko Kvázimenný", sibFull: "Náhradka Kvázimenná", year: "1987", born: "23/08/1987", reason: /Whether they share their other parent is not recorded/, pre: "biological", choose: "biological_half", childId: vzorko, from: "Jana Nová", to: "Tomáš Starý", a: jana, b: tomas, since: "2022" },
    phone: { parent: "Eva Pekná", child: "Juraj Pekný", childFull: "Juraj Pekný", sibFull: "Lenka Pekná", year: "1995", born: "12/04/1995", reason: /Both have .+ as biological parents/, pre: "biological_full", choose: "biological_full", childId: juraj, from: "Ema Rybárová", to: "Oto Sokol", a: ema, b: oto, since: "2019" },
  };

  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openApp(page);
    const f = page.frameLocator("#module-application");
    const frame = () => meridianFrame(page);
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`) });
    const go = async (view) => {
      if (label === "phone") {
        const nav = f.locator(`[data-act="go"][data-view="${view}"]`);
        if (!(await nav.first().isVisible())) await f.locator('[data-act="menu"], [data-act="nav-more"]').first().click().catch(() => {});
      }
      await f.locator(`[data-act="go"][data-view="${view}"]`).first().click();
    };
    const openPerson = async (name) => {
      await go("people");
      await f.locator("#people-q").fill(name);
      await page.waitForTimeout(400);
      await f.locator('#people-list [data-act="open-person"]').first().click();
      await f.locator(".person-name").waitFor();
    };

    const S = SCENARIO[label];
    {
      // ── 1 + 3 + 4: the relationship form ──
      await openPerson(S.parent);
      await f.locator('[data-act="add-relation"]:visible').first().click();
      await f.locator("#rel-type").waitFor();
      // 3. The selector's group headings and options are readable (computed colours).
      const colours = await frame().evaluate(() => {
        const sel = document.querySelector("#rel-type");
        const g = getComputedStyle(sel.querySelector("optgroup"));
        const o = getComputedStyle(sel.querySelector("optgroup option"));
        return { gfg: g.color, gbg: g.backgroundColor, ofg: o.color, obg: o.backgroundColor, groups: [...sel.querySelectorAll("optgroup")].map((x) => x.label) };
      });
      check(contrast(colours.gfg, colours.gbg) >= 4.5, `optgroup heading contrast ${contrast(colours.gfg, colours.gbg).toFixed(1)}:1 (${colours.gfg} on ${colours.gbg})`);
      check(contrast(colours.ofg, colours.obg) >= 4.5, `option contrast ${contrast(colours.ofg, colours.obg).toFixed(1)}:1`);
      check(!/255, 255, 255/.test(colours.gbg) && !/rgba\(0, 0, 0, 0\)/.test(colours.gbg), "optgroup background is the theme surface, not white or transparent");
      check(["Family", "Partners", "Friends and social"].every((x) => colours.groups.includes(x)), "categories preserved");
      // Keyboard still drives the native select.
      await f.locator("#rel-type").focus();
      await page.keyboard.press("ArrowDown");
      check((await f.locator("#rel-type").inputValue()) !== "", "keyboard selects an option");

      // 4. @me in the Of whom picker.
      await f.locator("#rel-target input[type=search]").fill("@me");
      await f.locator("#rel-target .search-results .row").first().waitFor();
      const meRow = await f.locator("#rel-target .search-results .row").first().innerText();
      check(/Adrián Čech|Čech, Adrián/.test(meRow) && /Me/.test(meRow), `@me resolves the self person: ${meRow.replace(/\s+/g, " ")}`);
      await shot("at-me-picker");
      // 1. Parent of Vzorko: the birth date is suggested as Since.
      await f.locator("#rel-target input[type=search]").fill(S.child);
      await f.locator("#rel-target .search-results .row").first().waitFor();
      await page.waitForTimeout(250);
      await f.locator("#rel-target .search-results .row").first().click();
      await f.locator("#rel-type").selectOption("parent|out");
      await page.waitForTimeout(500);
      const since = async () => frame().evaluate(() => ["d", "m", "y"].map((k) => document.querySelector(`[data-date="rel-from"] [data-part=${k}]`).value).join("/"));
      const until = async () => frame().evaluate(() => ["d", "m", "y"].map((k) => document.querySelector(`[data-date="rel-until"] [data-part=${k}]`).value).join("/"));
      check((await since()) === S.born, `Since suggested from the birth date (${await since()})`);
      check((await until()) === "//", "Until stays empty");
      check(await f.locator("#rel-suggest").isVisible(), "the suggestion is explained");
      check((await f.locator("#rel-kinship").inputValue()) === "biological", "new parent relationships start as biological");
      if (label === "phone") check(/Eva Pekná is parent of Juraj Pekný/.test(await f.locator("#rel-reads").innerText()), "“Reads as” uses natural names");
      await shot("parent-suggestion");
      await f.locator("#rel-kinship").selectOption("adoptive");
      await page.waitForTimeout(400);
      check((await since()) === "//", "adoption does not start at birth: the untouched suggestion is withdrawn");
      await f.locator("#rel-kinship").selectOption("biological");
      await page.waitForTimeout(400);
      check((await since()) === S.born, "suggested again for biological parenthood");
      await f.locator('[data-date="rel-from"] [data-part=y]').fill(String(+S.year + 1));
      await f.locator("#rel-kinship").selectOption("");
      await page.waitForTimeout(400);
      check((await since()) === S.born.replace(S.year, String(+S.year + 1)), "a date the user changed is never overwritten");
      await f.locator('[data-date="rel-from"] [data-part=y]').fill(S.year);
      await f.locator("#rel-kinship").selectOption("biological");
      await page.waitForTimeout(300);
      // ── 2: save, then the sibling dialog ──
      await f.locator('#panel [data-act="panel-save"]').click();
      await f.locator("#sib-title").waitFor({ timeout: 8000 });
      const sib = await f.locator("#dialog").innerText();
      check(sib.includes(S.childFull) && sib.includes(S.sibFull), "sibling dialog lists the pair");
      check(S.reason.test(sib), label === "desktop" ? "one known shared parent is uncertainty, not half-siblings" : "two shared biological parents: full siblings");
      check((await f.locator('[data-sib="0"]').inputValue()) === S.pre, `preselected: ${S.pre}`);
      const before = await api(`/people/${S.childId}`);
      check(!before.relationships.some((r) => r.type === "sibling"), "no sibling record before confirmation");
      await page.waitForTimeout(500);
      await shot("sibling-dialog");
      await f.locator('[data-sib="0"]').selectOption(S.choose);
      await f.locator('[data-act="sib-save"]').click();
      await page.waitForTimeout(800);
      const after = await api(`/people/${S.childId}`);
      const sibRec = after.relationships.find((r) => r.type === "sibling");
      check(sibRec && sibRec.kinship === S.choose && sibRec.phrase === "sibling of", "confirmed answer is stored once as “sibling of” with its kinship");
      const parentRec = after.relationships.find((r) => r.type === "parent" && r.other.display_name.startsWith(S.parent));
      check(parentRec.valid_from === (label === "desktop" ? "1987-08-23" : "1995-04-12") && parentRec.valid_until === null, "parent record saved with the suggested Since and no Until");

      // ── 6: an ongoing relationship when another begins ──
      await openPerson(S.from);
      await f.locator('[data-act="add-relation"]:visible').first().click();
      await f.locator("#rel-target input[type=search]").fill(S.to);
      await f.locator("#rel-target .search-results .row").first().waitFor();
      await page.waitForTimeout(250);
      await f.locator("#rel-target .search-results .row").first().click();
      await f.locator("#rel-type").selectOption("engaged|mutual");
      await f.locator('[data-date="rel-from"] [data-part=y]').fill("2024");
      await f.locator('[data-date="rel-from"] [data-part=m]').selectOption("05");
      check((await frame().evaluate(() => document.querySelector("#rel-target [data-picked]").value)) === S.b && (await frame().evaluate(() => state.person.id)) === S.a, "the intended two people are chosen");
      await f.locator('#panel [data-act="panel-save"]').click();
      await f.locator("#tr-title").waitFor({ timeout: 8000 });
      const rows = await frame().evaluate(() => [...document.querySelectorAll("[data-end]")].map((x) => ({ text: x.closest("label").innerText.replace(/\s+/g, " "), on: x.checked })));
      check(rows.length === 2, "both ongoing relationships are listed");
      check(rows.find((r) => /dating/.test(r.text))?.on === true, "dating is proposed for ending");
      check(rows.find((r) => /friend/.test(r.text))?.on === false, "the friendship is not");
      const trDate = await frame().evaluate(() => ["m", "y"].map((k) => document.querySelector(`[data-date="tr-until"] [data-part=${k}]`).value).join("/"));
      check(trDate === "05/2024", "the transition date starts at the new Since and is editable");
      await page.waitForTimeout(500); // let the dialog finish fading in
      if (label === "phone") check(!(await f.locator("#dialog").innerText()).includes("Sokol, Oto"), "sentences use the natural name, not the list form");
      await shot("transition-dialog");
      // Cancel first: nothing changes, the form stays.
      await f.locator('[data-act="tr-cancel"]').click();
      await page.waitForTimeout(400);
      let pair = await api(`/connections?a=${S.a}&b=${S.b}`);
      check(pair.relationships.length === 2 && pair.relationships.every((r) => r.state === "current"), "cancel changes nothing");
      check(await f.locator("#panel").isVisible(), "the form is still open after cancelling");
      await f.locator('#panel [data-act="panel-save"]').click();
      await f.locator("#tr-title").waitFor({ timeout: 8000 });
      await f.locator('[data-act="tr-end"]').click();
      await page.waitForTimeout(1000);
      pair = await api(`/connections?a=${S.a}&b=${S.b}`);
      const dating = pair.relationships.find((r) => r.type === "dating");
      check(dating.state === "former" && dating.valid_until === "2024-05" && dating.valid_from === S.since, "dating ended at the transition date, its history kept");
      check(pair.relationships.find((r) => r.type === "friend").state === "current", "the friendship continues");
      check(pair.relationships.some((r) => r.type === "engaged" && r.state === "current"), "engaged saved as a separate record");
      // The graph shows the current state by default; the ended dating edge stays reachable.
      await go("graph");
      await page.waitForTimeout(1500);
      const hidden = await frame().evaluate(([a, b]) => (GRAPH.engine ? GRAPH.engine.links.filter((l) => l.superseded && [l.source.id, l.target.id].sort().join() === [a, b].sort().join()).map((l) => l.type) : null), [S.a, S.b]);
      check(Array.isArray(hidden) && hidden.length === 1 && hidden[0] === "dating", `superseded history under “All”: ${JSON.stringify(hidden)}`);
      const shown = await frame().evaluate(([a, b]) => GRAPH.engine.visibleLinks.filter((l) => [l.source.id, l.target.id].sort().join() === [a, b].sort().join()).map((l) => l.type), [S.a, S.b]);
      check(shown.includes("engaged") && shown.includes("friend") && !shown.includes("dating"), "current and concurrent edges shown");
    }

    // ── 5: Settings → People ──
    await go("settings");
    await f.locator('[data-act="pref-sort"]').first().waitFor();
    if (label === "desktop") {
      await f.locator('[data-act="pref-sort"][data-value="family"]').click();
      await page.waitForTimeout(400);
      await f.locator('[data-act="pref-display"][data-value="family"]').click();
      await page.waitForTimeout(400);
      check((await api("/settings")).people_sort === "family", "sorting preference saved");
    }
    await f.locator('[data-section="people"], #set-people').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot("settings-people");
    await go("people");
    await f.locator("#people-q").fill("");
    await page.waitForTimeout(600);
    const listed = await f.locator("#people-list .nm").allInnerTexts();
    const at = (n) => listed.indexOf(n);
    check(["Cibuľová, Zuzana", "Čech, Adrián", "Hraško, Chris", "Kvázimenná, Náhradka"].every((n, i, all) => at(n) >= 0 && (i === 0 || at(all[i - 1]) < at(n))), `People sorted by last name in Slovak order, shown last-first: ${listed.slice(0, 6).join(" | ")}`);
    check(listed.indexOf("Kvázimenná, Náhradka") < listed.indexOf("Kvázimenná, Ukážka") && listed.indexOf("Kvázimenná, Ukážka") < listed.indexOf("Kvázimenný, Pokusko"), "Kvázimenná before Kvázimenný");
    await shot("people-list");

    // ── 7: Timeline, same-day group ──
    await openPerson("Vzorko Kvázimenný");
    await f.locator('[data-act="tab"][data-tab="timeline"]').click();
    await f.locator("#ptl-body .tl-entry").first().waitFor();
    const ptl = await frame().evaluate(() => [...document.querySelectorAll("#ptl-body .tl-entry")].map((li) => ({ cls: li.className, when: li.querySelector(".tl-when").textContent, label: li.querySelector(".tl-item").getAttribute("aria-label") })));
    const day = ptl.filter((x) => /23 August 1987|August 23, 1987/.test(x.label));
    check(day.length === 2, `two entries on 23 August 1987 (${day.length})`);
    check(day[0].when !== "" && day[1].when === "" && /is-day-cont/.test(day[1].cls), "one visible date label for the day; the second entry continues it");
    check(day.every((x) => /1987/.test(x.label)), "each entry still announces its full date");
    await shot("profile-timeline");
    await f.locator('[data-act="tl-focus"]').first().click();
    await f.locator("#tl-stream .tl-entry").first().waitFor();
    await page.waitForTimeout(500);
    const tl = await frame().evaluate(() => {
      const items = [...document.querySelectorAll("#tl-stream .tl-entry")];
      const y = document.querySelector('#tl-stream .tl-year[data-year="1987"] .tl-year-sum')?.innerText || "";
      return { n: items.length, conts: items.filter((li) => li.classList.contains("is-day-cont")).length, whens: items.map((li) => li.querySelector(".tl-when").textContent), y };
    });
    check(tl.conts === 1, `Timeline view groups the same day too (${tl.conts} continued)`);
    check(tl.whens.filter((w) => /Aug/.test(w)).length === 1, "“Aug 23” appears once");
    await shot("timeline");
    check(errors.length === 0, `no page errors (${errors.join(" / ")})`);
    await page.close();
  }
  if (NEXUS) {
    // Put the owner's own settings back; the synthetic people stay for review.
    await api("/self", "PUT", { person_id: original.self?.id || null });
    await api("/settings", "PUT", original.settings);
    const now = await api("/state");
    check(now.self?.id === original.self?.id && JSON.stringify(now.settings) === JSON.stringify(original.settings), "original @me and People settings restored");
  }
  await browser.close();
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
