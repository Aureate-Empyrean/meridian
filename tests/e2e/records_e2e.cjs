// Meridian 0.7.0 (roadmap Phase 3): Education, Interests and Interactions in a browser, with
// synthetic data only. Against the local harness (default), or inside the real aetest Nexus with
// NEXUS_URL set (never production). PHONE=1 runs at 390 px.
//
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/records_e2e.cjs
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "../../../mnemosyne/node_modules/playwright");

const BASE = process.env.HARNESS || "http://127.0.0.1:17401";
const NEXUS = process.env.NEXUS_URL;
const PHONE = !!process.env.PHONE;
const LABEL = PHONE ? "390" : "1440";
const SHOTS = path.join(__dirname, "../../docs/screenshots/0.7.0-records");
const RUN = process.env.RUN_TAG || `${LABEL}-${Date.now().toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (what) => {
  passed++;
  console.log(`ok   ${what}`);
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let f;
  if (NEXUS) {
    await page.goto(`${NEXUS}/app/modules/meridian`);
    await page.locator("#username, #module-application").first().waitFor({ timeout: 30000 });
    if (await page.locator("#username").isVisible()) {
      const owner = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../empyrean-nexus/.data/aetest-owner.json"), "utf8"));
      await page.locator("#username").fill(owner.username);
      await page.locator("#password").fill(owner.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    for (let i = 0; i < 80 && !f; i++) {
      f = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes("/modules/meridian"));
      if (!f) await sleep(250);
    }
  } else {
    await page.goto(BASE + "/__harness");
    f = page.frames().find((fr) => fr !== page.mainFrame());
  }
  await f.waitForFunction(() => typeof go === "function" && typeof openInteraction === "function");
  const api = (p, method = "GET", body) => f.evaluate(([a, b, c]) => api(a, b, c), [p, method, body]);

  const A = `Daniela Záznamová ${RUN}`;
  const B = `Fero Fiktívny ${RUN}`;
  const SCHOOL = `Skúšobná univerzita ${RUN}`;
  const CLUB = `Skúšobný klub ${RUN}`;
  const a = await api("/people", "POST", { names: [{ kind: "full", value: A }] });
  const lyra = "nexus:v1:lyra:title:0190f0e4-0000-7000-8000-00000000000a";
  const b = await api("/people", "POST", { names: [{ kind: "full", value: B }], interests: [{ category: "films_tv", subject: "Arrival", sentiment: "favorite", target_kind: "film", target_ref: lyra }] });
  const club = await api("/entities", "POST", { kind: "group", names: [{ kind: "full", value: CLUB }] });

  const openProfile = async (id, kind = "person") => {
    await f.evaluate(() => go("people"));
    await sleep(150);
    await f.evaluate(([x, k]) => (k === "person" ? go("person", x) : go("entity", x, k)), [id, kind]);
    await f.locator(`.person-name`).first().waitFor();
  };
  const save = f.locator('#panel [data-act="panel-save"]');
  const field = (key) => f.locator(`#panel-body [data-k="${key}"]`).first();
  const closePanel = async () => {
    await f.locator('#panel [data-act="panel-cancel"]').click();
    await f.locator("#panel").waitFor({ state: "detached" });
  };
  const noOverflow = async (what) => {
    const n = await f.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(n <= 0, `${what}: overflow ${n}`);
    ok(`${what} fits the width`);
  };

  // Education and Interests go through the unified editor, in one atomic save.
  await openProfile(a.id);
  for (const chip of ["Education", "Interest or preference", "Interaction"])
    assert.ok(await f.locator(".add-chip", { hasText: chip }).first().isVisible(), chip);
  ok("an empty profile offers Education, Interests and Interactions");
  await f.locator('.add-chip[data-section="education"]').click();
  await field("organization").fill(SCHOOL);
  await field("kind").selectOption("university");
  await field("program").fill("Informatika");
  await field("degree").fill("Mgr.");
  await field("status").selectOption("graduated");
  await field("valid_from").fill("2005-09");
  await field("valid_until").fill("2010-06");
  await f.locator('[data-act="panel-section"][data-section="interests"]').click();
  await field("subject").fill("Horolezectvo");
  await field("sentiment").selectOption("favorite");
  await field("category").selectOption("sports");
  await field("context").fill("v lete");
  await field("subject").waitFor();
  await noOverflow("the editor");
  await save.click();
  await f.waitForFunction(() => !panel.saving && !panel.isDirty());
  await closePanel();
  let cur = await api(`/people/${a.id}`);
  assert.equal(cur.education[0].organization, SCHOOL);
  assert.equal(cur.education[0].status, "graduated");
  assert.equal(cur.interests[0].sentiment, "favorite");
  assert.equal(cur.interests[0].context, "v lete");
  ok("both sections saved together");
  const edu = f.locator('.psection[data-section="education"]');
  await edu.waitFor();
  assert.match(await edu.innerText(), /Informatika/);
  assert.match(await f.locator('.psection[data-section="interests"]').innerText(), /Horolezectvo/);
  ok("the profile shows Education and Interests");
  await noOverflow("the profile");
  await page.screenshot({ path: path.join(SHOTS, `profile-${LABEL}.png`), fullPage: true });

  // The school is one Organization, and lists who studied there.
  await openProfile(cur.education[0].organization_id, "organization");
  const studied = f.locator('.psection[data-section="studied_here"]');
  await studied.waitFor();
  assert.match(await studied.innerText(), new RegExp(A));
  ok("the Organization lists who studied there");

  // Editing must not drop a reserved cross-module target.
  await openProfile(b.id);
  await f.evaluate(() => openPanel("interests"));
  await field("context").fill("po večeroch");
  await save.click();
  await f.waitForFunction(() => !panel.saving && !panel.isDirty());
  await closePanel();
  cur = await api(`/people/${b.id}`);
  assert.equal(cur.interests[0].target_ref, lyra);
  assert.equal(cur.interests[0].context, "po večeroch");
  ok("a reserved target survives editing");

  // An Interaction: stored once, shown for each participant.
  await openProfile(a.id);
  await f.locator('.add-chip[data-section="interactions"]').click();
  await f.locator("#ix-summary").fill(`Káva ${RUN}`);
  await f.locator("#ix-type").selectOption("visit");
  await f.locator('[data-date="ix-date"] [data-part="y"]').fill("2024");
  await f.locator('[data-date="ix-date"] [data-part="m"]').selectOption("06");
  await f.locator("#ix-approx").check();
  await f.locator("#ev-add .picker-search input").fill(RUN.slice(0, 12) && `Fero Fiktívny ${RUN}`);
  await f.locator("#ev-add .search-results .row").first().click();
  await f.locator('[data-role="1"]').fill("hosť");
  await f.locator("#ix-group .picker-search input").fill(CLUB);
  await f.locator("#ix-group .search-results .row").first().click();
  await f.locator("#ix-notes").fill("Rozhovor o škole.");
  await f.locator('[data-act="ix-link-load"]').click();
  await f.waitForFunction(() => { const x = document.querySelector("#ix-candidates"); return x && x.textContent.trim() && !x.textContent.includes("Loading"); });
  ok("linking offers items, or says why there are none");
  await noOverflow("the interaction editor");
  await page.screenshot({ path: path.join(SHOTS, `interaction-editor-${LABEL}.png`) });
  await save.click();
  await f.locator("#panel").waitFor({ state: "detached" });
  const box = f.locator("#interactions-box");
  await box.locator(".ix-row").first().waitFor();
  assert.match(await box.innerText(), new RegExp(`Káva ${RUN}`));
  ok("the interaction appears on the first participant");
  const { items } = await api(`/interactions?entity=${b.id}`);
  assert.equal(items.length, 1);
  assert.equal(items[0].participants[1].role, "hosť");
  assert.equal(items[0].group.id, club.id);
  assert.equal(items[0].occurred, "2024-06");
  assert.equal(items[0].approximate, true);
  ok("it is the same record for the other participant, with role, group and partial date");
  await openProfile(b.id);
  await f.locator("#interactions-box .ix-row").first().waitFor();
  ok("the other participant's profile shows it");

  // Someone else's edit is detected, not overwritten.
  await f.locator('#interactions-box [data-act="ix-edit"]').first().click();
  await f.locator("#ix-summary").waitFor();
  const before = await api(`/interactions/${items[0].id}`);
  await api(`/interactions/${items[0].id}`, "PUT", {
    summary: `Zmenené ${RUN}`, type: before.type, occurred: before.occurred, approximate: before.approximate, group_id: club.id,
    participants: before.participants.map((p) => ({ entity_id: p.entity.id, role: p.role })),
  });
  await f.locator("#ix-summary").fill(`Prepísané ${RUN}`);
  await save.click();
  await f.locator("#panel #form-error").waitFor({ state: "visible" });
  assert.match(await f.locator("#panel #form-error").innerText(), /changed in another session/);
  assert.equal((await api(`/interactions/${items[0].id}`)).summary, `Zmenené ${RUN}`);
  ok("a concurrent edit is reported and nothing is overwritten");
  await f.evaluate(() => { panel.snapshot = ixState(); });
  await f.locator('#panel [aria-label="Close"]').click();
  await f.locator("#panel").waitFor({ state: "detached" });

  // The Timeline is a projection of the records.
  await openProfile(a.id);
  await f.locator('.tab[data-tab="timeline"]').click();
  await f.locator("#ptl-body .tl-item").first().waitFor();
  const stream = await f.locator("#ptl-body").innerText();
  assert.match(stream, /studied at/);
  assert.match(stream, new RegExp(`Zmenené ${RUN}`));
  ok("the profile Timeline shows Education and the Interaction");
  await noOverflow("the profile Timeline");
  await page.screenshot({ path: path.join(SHOTS, `timeline-${LABEL}.png`), fullPage: true });
  await f.evaluate((id) => { TL.pending = id; go("timeline"); }, `interaction:${items[0].id}`);
  await f.locator("#tl-detail .tl-detail-body [data-act='ix-edit']").waitFor({ timeout: 20000 });
  assert.match(await f.locator("#tl-detail").innerText(), /hosť/);
  ok("the Timeline details show roles and offer Edit interaction");

  // Deleting removes it for everyone and leaves the people.
  await f.locator("#tl-detail [data-act='ix-delete']").click();
  await f.locator("#confirm").click();
  await f.waitForFunction(() => !document.querySelector("dialog[open]"));
  await sleep(300);
  assert.equal((await api(`/interactions?entity=${a.id}`)).items.length, 0);
  assert.equal((await api(`/interactions?entity=${b.id}`)).items.length, 0);
  assert.equal((await api(`/people/${b.id}`)).interaction_count, 0);
  ok("deleting removes it for everyone and leaves the people");

  assert.deepEqual(errors, []);
  ok("no page errors");
  if (NEXUS) {
    // Tidy this run's synthetic records into Trash.
    for (const [p, id] of [["people", a.id], ["people", b.id], ["entities", club.id], ["entities", (await api(`/people/${a.id}`)).education[0].organization_id]])
      await api(`/${p}/${id}`, "DELETE");
    ok("this run's synthetic records moved to Trash");
  }
  await browser.close();
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
