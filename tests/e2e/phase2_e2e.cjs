// Roadmap Phase 2 across modules, inside the real Nexus on aetest (never production):
// Meridian birthdays in Chronos (opt-in), Meridian People on Chronos events and in Mnemosyne
// notes through the people-directory picker, current names through resolution, and the
// "Linked from other modules" list on the Meridian profile. 1440 and 390 px.
//
// Synthetic data, kept for review: Meridian people "Daniela Dátumová" and "Fero Fiktívny", a
// Chronos event "Phase 2 lunch" and a Mnemosyne note "Phase 2 coffee notes". The Chronos
// Meridian source is put back to its original state (off) at the end. Run once per installation.
//
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/phase2_e2e.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const NEXUS = "http://localhost:12334";
const SHOTS = path.join(__dirname, "../../docs/screenshots/0.6.0-aetest");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(page, module) {
  await page.goto(`${NEXUS}/app/modules/${module}`);
  // Wait for either the sign-in form or the module frame; isVisible() does not wait.
  await page.locator("#username, #module-application").first().waitFor({ timeout: 30000 });
  if (await page.locator("#username").isVisible()) {
    const owner = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../empyrean-nexus/.data/aetest-owner.json"), "utf8"));
    await page.locator("#username").fill(owner.username);
    await page.locator("#password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  let frame;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes(`/modules/${module}`));
    if (!frame) await sleep(250);
  }
  await frame.waitForFunction(() => typeof api === "function", null, { timeout: 30000 });
  await sleep(600);
  return frame;
}
const call = (frame, p, method = "GET", body) => frame.evaluate(([p, m, b]) => (b === null ? api(p, m) : api(p, m, b)), [p, method, body === undefined ? null : body]);
async function until(fn, what, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(500);
  }
  check(false, `${what} (timed out)`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ── Setup in Meridian ──
  let meridian = await open(page, "meridian");
  check((await call(meridian, "/state")).version === "0.6.0", "aetest runs Meridian 0.6.0");
  const daniela = await call(meridian, "/people", "POST", { names: [{ kind: "full", given: "Daniela", family: "Dátumová" }], dates: [{ kind: "birth", date: "1990-11-20" }] });
  const fero = await call(meridian, "/people", "POST", { names: [{ kind: "full", given: "Fero", family: "Fiktívny" }] });
  const danielaRef = `nexus:v1:meridian:person:${daniela.id}`;

  // ── Chronos: Meridian birthdays, off by default, then opted in ──
  let chronos = await open(page, "chronos");
  const sources = (await call(chronos, "/state")).sources;
  const original = sources.find((s) => s.provider === "meridian");
  check(original && original.enabled === false, "Chronos lists Meridian as a source, off by default");
  await chronos.evaluate(() => settingsDialog());
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "desktop-chronos-settings.png") });
  await page.frameLocator("#module-application").locator('[data-source="meridian"]').check();
  await sleep(800);
  await call(chronos, "/sources/meridian/refresh", "POST");
  const nov = "/occurrences?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z";
  const findBirthday = async (day) => (await call(chronos, nov)).occurrences.find((o) => o.provider === "meridian" && o.title.includes("Dátumová") && o.start === day);
  const bday = await until(() => findBirthday("2026-11-20"), "Daniela's birthday appears in Chronos");
  check(bday.all_day && bday.summary === "Turns 36" && bday.title === "Birthday · Daniela Dátumová", "the birthday is an all-day, read-only shared date");
  await chronos.evaluate(async (key) => {
    await refresh();
    await openDetails(key);
  }, bday.key);
  await sleep(500);
  const details = await page.frameLocator("#module-application").locator(".ae-drawer").innerText();
  check(/From Meridian/.test(details) && /Turns 36/.test(details), "details say Meridian owns the date");
  await page.screenshot({ path: path.join(SHOTS, "desktop-chronos-birthday.png") });
  await chronos.evaluate(() => closeLayer());

  // A change in Meridian reaches Chronos through the change announcement.
  meridian = await open(page, "meridian");
  const doc = await call(meridian, `/people/${daniela.id}`);
  await call(meridian, `/people/${daniela.id}`, "PUT", { names: [{ kind: "full", given: "Daniela", family: "Dátumová" }], dates: [{ kind: "birth", date: "1990-11-22" }], expected_revision: doc.edit_revision });
  chronos = await open(page, "chronos");
  await until(() => findBirthday("2026-11-22"), "an edited birthday moves in Chronos soon after the change", 45);
  check(!(await findBirthday("2026-11-20")), "the old date is gone, not duplicated");

  // ── Chronos: a Meridian person on an event, through the picker ──
  const people = await call(chronos, "/people?q=Dátum");
  check(people.availability === "available" && people.items.length === 1 && people.items[0].resource === danielaRef, "the people picker searches Meridian by name");
  check(Object.keys(people.items[0]).sort().join() === "label,resource,self", "the picker receives names only");
  const me = await call(chronos, "/people?q=%40me");
  check(me.items.length === 1 && me.items[0].self === true, `@me finds the self person (${me.items[0]?.label})`);
  const cal = (await call(chronos, "/state")).calendars.find((c) => c.kind === "native");
  const event = await call(chronos, "/events", "POST", { calendar_id: cal.id, title: "Phase 2 lunch", start: "2026-11-21T12:00", end: "2026-11-21T13:00", time_zone: "Europe/Bratislava" });
  const eventKey = await chronos.evaluate(async (id) => {
    await refresh();
    return state.occurrences.find((o) => o.event_id === id)?.key;
  }, event.id);
  await chronos.evaluate((key) => openDetails(key), eventKey);
  const cf = page.frameLocator("#module-application");
  await cf.locator('[data-act="add-person"]').click();
  await cf.locator(".person-search input").fill("Daniela");
  await cf.locator(".person-option").first().waitFor({ timeout: 15000 });
  await cf.locator(".person-option").first().click();
  await until(async () => (await cf.locator("#people-rows").innerText()).includes("Daniela Dátumová"), "the linked person shows with her current name");
  await page.screenshot({ path: path.join(SHOTS, "desktop-chronos-people.png") });
  const links = (await call(chronos, `/events/${event.id}/links`)).links;
  check(links.length === 1 && links[0].relation === "chronos.involves" && links[0].availability === "available", "the event links the person by reference and resolves her");

  // ── Mnemosyne: link the person from a note ──
  const mnemosyne = await open(page, "mnemosyne");
  const wid = await mnemosyne.evaluate(() => state.wid);
  const note = await mnemosyne.evaluate(async (w) => api(`/api/w/${w}/resources`, "POST", { kind: "note", title: "Phase 2 coffee notes", status: "open" }), wid);
  await mnemosyne.evaluate((id) => openDetails(id), note.id);
  const mf = page.frameLocator("#module-application");
  await mf.locator(".person-form summary").waitFor({ timeout: 15000 });
  await mf.locator(".person-form summary").click();
  await mf.locator("#person-q").fill("Daniela");
  await mf.locator(".person-option").first().waitFor({ timeout: 15000 });
  await mf.locator(".person-option").first().click();
  await until(async () => (await mf.locator("[data-person-link] .d-row-title").first().innerText()) === "Daniela Dátumová", "the note shows the linked person by her current name");
  await page.screenshot({ path: path.join(SHOTS, "desktop-mnemosyne-person.png") });

  // ── Meridian: the profile lists both, with their owners' titles ──
  meridian = await open(page, "meridian");
  const linked = await until(async () => {
    // Leave and re-open the profile: the list is read when the profile opens.
    await meridian.evaluate(async (id) => {
      await go("people");
      await go("person", id);
    }, daniela.id);
    const box = page.frameLocator("#module-application").locator("#linked-from");
    await box.waitFor({ state: "visible", timeout: 6000 });
    const text = await box.innerText();
    return text.includes("Phase 2 lunch") && text.includes("Phase 2 coffee notes") ? text : null;
  }, "Daniela's profile lists the Chronos event and the Mnemosyne note", 45);
  check(/Event in Chronos/.test(linked) && /Note in Mnemosyne/.test(linked), "each item says which module owns it");
  await page.screenshot({ path: path.join(SHOTS, "desktop-meridian-linked-from.png") });
  const backlinks = await call(meridian, `/entities/${daniela.id}/linked-from`);
  check(backlinks.items.every((x) => x.availability === "available") && backlinks.items.length === 2, "both resolve through their owners");
  check(errors.length === 0, `desktop: no page errors (${errors.join(" / ")})`);

  // ── Phone: the same workflows at 390 px ──
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  const phoneErrors = [];
  phone.on("pageerror", (e) => phoneErrors.push(String(e)));
  const pc = await open(phone, "chronos");
  await pc.evaluate(async (id) => {
    await refresh();
    const key = state.occurrences.find((o) => o.event_id === id)?.key;
    if (key) await openDetails(key);
  }, event.id);
  const pcf = phone.frameLocator("#module-application");
  await pcf.locator('[data-act="add-person"]').click();
  await pcf.locator(".person-search input").fill("Fero");
  await pcf.locator(".person-option").first().waitFor({ timeout: 15000 });
  check(!(await pcf.locator(".person-results").innerText()).includes("Daniela"), "phone: people already on the event are not offered again");
  await pcf.locator(".person-option").first().click();
  await until(async () => (await pcf.locator("#people-rows").innerText()).includes("Fero Fiktívny"), "phone: a second person is added in Chronos");
  const overflow = await pc.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(!overflow, "phone: Chronos details fit the width");
  await phone.screenshot({ path: path.join(SHOTS, "phone-chronos-people.png") });
  const pm = await open(phone, "mnemosyne");
  await pm.evaluate((id) => openDetails(id), note.id);
  const pmf = phone.frameLocator("#module-application");
  await pmf.locator(".person-form summary").click();
  await pmf.locator("#person-q").fill("Fero");
  await pmf.locator(".person-option").first().waitFor({ timeout: 15000 });
  await pmf.locator(".person-option").first().click();
  await until(async () => (await pmf.locator("[data-person-link] .d-row-title").allInnerTexts()).includes("Fero Fiktívny"), "phone: a second person is linked in Mnemosyne");
  await phone.screenshot({ path: path.join(SHOTS, "phone-mnemosyne-person.png") });
  const pmer = await open(phone, "meridian");
  await until(async () => {
    // Leave and re-open the profile: the list is read when the profile opens.
    await pmer.evaluate(async (id) => {
      await go("people");
      await go("person", id);
    }, fero.id);
    const box = phone.frameLocator("#module-application").locator("#linked-from");
    await box.waitFor({ state: "visible", timeout: 6000 });
    const text = await box.innerText();
    return text.includes("Phase 2 lunch") && text.includes("Phase 2 coffee notes");
  }, "phone: Fero's profile lists both items", 45);
  check(!(await pmer.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "phone: the Meridian profile fits the width");
  await phone.screenshot({ path: path.join(SHOTS, "phone-meridian-linked-from.png") });
  check(phoneErrors.length === 0, `phone: no page errors (${phoneErrors.join(" / ")})`);

  // ── Put the Chronos source back as it was (off): its copies go with it ──
  chronos = await open(page, "chronos");
  await call(chronos, "/sources/meridian", "PUT", { enabled: false });
  check(!(await call(chronos, nov)).occurrences.some((o) => o.provider === "meridian"), "turning the source off removes Chronos's copies");
  check((await call(chronos, "/state")).sources.find((s) => s.provider === "meridian").enabled === false, "the Chronos Meridian source is off again, as before");

  await browser.close();
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
