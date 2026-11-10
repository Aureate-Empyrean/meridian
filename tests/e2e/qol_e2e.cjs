// Meridian 0.12.0 and Atlas 0.5.0 inside the real aetest Nexus (never production): real-world
// address search, Meridian addresses in Atlas Library, reuse of Organizations and groups.
// Synthetic records named "QoL ...", removed at the end; earlier settings are restored.
//
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright BROWSER=chromium node tests/e2e/qol_e2e.cjs
const fs = require("fs");
const path = require("path");
const playwright = require(process.env.PLAYWRIGHT_PATH || "playwright");

const NEXUS = "http://localhost:12334";
const ENGINE = process.env.BROWSER || "chromium";
const RUN = Date.now().toString(36);
const ROOT = path.join(__dirname, "../../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const check = (ok, what) => {
  if (!ok) {
    failures.push(what);
    console.log(`FAIL ${what}`);
    throw new Error(`failed: ${what}`);
  }
  passed++;
  console.log(`ok   ${what}`);
};
async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await Promise.resolve().then(fn).catch(() => null);
    if (value) return value;
    await sleep(120);
  }
  check(false, `${what} (timed out)`);
}
const owner = JSON.parse(fs.readFileSync(path.join(ROOT, "empyrean-nexus/.data/aetest-owner.json"), "utf8"));
const route = (page) => new URL(page.url()).searchParams.get("route");
const pathParam = (page) => new URL(page.url()).searchParams.get("path");
const frameOf = async (page) => (await page.locator("#module-application").elementHandle({ timeout: 20000 })).contentFrame();
const ADAPTER = { meridian: "meridianNavigation", atlas: "atlasNavigation" };
async function ready(page, module) {
  return until(async () => {
    const f = await frameOf(page);
    return (await f.evaluate((a) => globalThis.eval(`typeof ${a} !== "undefined" && ${a}.enabled`), ADAPTER[module])) ? f : null;
  }, `${module} negotiated`);
}
async function open(page, module, reference) {
  await page.goto(`${NEXUS}/app/modules/${module}${reference ? `?nav=1&route=${encodeURIComponent(reference)}` : ""}`);
  await page.locator("#username, #module-application").first().waitFor({ timeout: 30000 });
  if (await page.locator("#username").isVisible()) {
    await page.locator("#username").fill(owner.username);
    await page.locator("#password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  return ready(page, module);
}
const call = (frame, p, method = "GET", body) => frame.evaluate(([x, m, b]) => (b === null ? api(x, m) : api(x, m, b)), [p, method, body === undefined ? null : body]);
async function act(frame, fn, arg) {
  await frame.evaluate(([source, value]) => {
    const run = (0, eval)(`(${source})`);
    const b = Object.assign(document.createElement("button"), { id: "__act" });
    b.style = "position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647";
    b.onclick = () => { b.remove(); run(value); };
    document.body.append(b);
  }, [fn.toString(), arg === undefined ? null : arg]);
  await frame.locator("#__act").click();
}
const closeEditor = async (frame) => { await frame.evaluate(() => closePanel()); await sleep(350); };
const saveEditor = (frame) => frame.locator('#panel [data-act="panel-save"]').click();
const ADDRESS = (frame) => frame.locator(".address-search-input").first();
async function typeSearch(input, text) {
  await input.fill("");
  await input.pressSequentially(text, { delay: 30 });
}

(async () => {
  const browser = await playwright[ENGINE].launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const atlasTab = await ctx.newPage();
  const errors = [];
  for (const p of [page, atlasTab]) p.on("pageerror", (e) => errors.push(e.message));
  let m = await open(page, "meridian");
  let a = await open(atlasTab, "atlas");
  const before = { consent: (await call(m, "/address-search/status")).consent, map: await call(a, "/map-settings") };
  const person = (await call(m, "/people", "POST", { names: [{ kind: "full", given: "QoL", family: `Osoba ${RUN}` }] })).id;
  const second = (await call(m, "/people", "POST", { names: [{ kind: "full", given: "QoL", family: `Druhá ${RUN}` }] })).id;
  const org = await call(m, "/entities", "POST", { kind: "organization", names: [{ kind: "full", value: `QoL Škola ${RUN}` }] });
  const group = await call(m, "/entities", "POST", { kind: "group", names: [{ kind: "full", value: `QoL Klub ${RUN}` }] });
  const made = { orgs: [org.id], groups: [group.id] };
  try {
    /* ── Consent and manual entry ── */
    await call(m, "/address-search/consent", "PUT", { enabled: false });
    m = await open(page, "meridian", `/people/${person}`);
    await until(() => m.locator(".profile-head").isVisible(), "person open");
    await m.evaluate(() => openPanel("addresses"));
    await m.locator(".address-consent").waitFor();
    check(!(await ADDRESS(m).isVisible()), "before consent there is no search box, only the explanation");
    check(/never sent/.test(await m.locator(".address-consent").innerText()), "the consent text says what is and is not sent");
    check(await m.locator(".addr-details").first().evaluate((d) => d.open), "manual fields are open when search is unavailable");
    check((await call(m, "/address-search", "POST", { q: "Hlavná 1" })).availability === "consent_required", "the server refuses to search before consent");
    await m.locator('[data-act="address-search-consent"]').click();
    await ADDRESS(m).waitFor();
    check(true, "turning it on shows the search box");

    /* ── Real provider ── */
    await typeSearch(ADDRESS(m), "Hlavná 1 Košice");
    await until(async () => (await m.locator(".combo-option").count()) > 0, "the provider answered as you type");
    check(/OpenStreetMap/.test(await m.locator(".combo-foot").innerText()), "the results carry attribution");
    await ADDRESS(m).press("ArrowDown");
    check((await m.locator(".combo-option.is-active").count()) === 1, "arrow keys move through suggestions");
    await ADDRESS(m).press("Enter");
    const field = (k) => m.locator(`#panel [data-k="${k}"]`).first();
    await until(async () => (await field("latitude").inputValue()) !== "", "choosing fills the coordinates");
    check((await field("street").inputValue()).length > 0 && (await field("locality").inputValue()).length > 0, "choosing fills the structured fields");
    check(await m.locator(".addr-details").first().evaluate((d) => d.open), "the details open for review");
    await saveEditor(m);
    const saved = await until(async () => { const p = await call(m, `/people/${person}`); return p.addresses[0]?.latitude != null ? p : null; }, "the address and position are saved");
    check(saved.addresses[0].geo_precision !== "", "the precision is stored");
    await until(() => m.evaluate(() => !panel.isDirty()), "saved");
    await typeSearch(ADDRESS(m), "abc");
    check(await m.evaluate(() => !panel.isDirty()), "text typed only into the search box is not an unsaved change");
    await until(async () => (await m.locator(".combo-list:not([hidden])").count()) === 1, "the list is showing");
    await ADDRESS(m).press("Escape");
    await sleep(350);
    check(await m.evaluate(() => !panel.closing && !!panel.el()), "Escape closes the suggestions, not the panel");
    check((await m.locator(".combo-list:not([hidden])").count()) === 0, "and the list is gone");
    await typeSearch(ADDRESS(m), "def");
    await ADDRESS(m).press("Escape");
    await sleep(700);
    check(await m.evaluate(() => !panel.closing && !!panel.el()), "Escape while a search is still waiting keeps the panel");
    check((await m.locator(".combo-list:not([hidden])").count()) === 0, "and the late answer does not reopen the list");
    await ADDRESS(m).fill("");

    /* ── Corrections drop the position ── */
    await field("street").fill(`${await field("street").inputValue()} A`);
    check((await field("latitude").inputValue()) === "", "editing the street clears the position at once");
    check(/removed/.test(await m.locator("[data-address-note]").first().innerText()), "and says so");
    await saveEditor(m);
    await until(async () => (await call(m, `/people/${person}`)).addresses[0].latitude === null, "the stale position is not stored");

    /* ── No results and provider failure ── */
    await typeSearch(ADDRESS(m), "zzqxjkvwq xqzjkv");
    await until(async () => /No address matches/.test(await m.locator(".combo-note").first().innerText({ timeout: 500 })), "an empty result says so");
    await call(a, "/map-settings", "PUT", { online: true, tile_url: before.map.tile_url, geocoder_url: before.map.geocoder_url, suggest_url: "http://127.0.0.1:9" });
    await typeSearch(ADDRESS(m), "Provider failure test");
    await until(async () => /did not answer/.test(await m.locator(".combo-note").first().innerText({ timeout: 500 })), "a provider failure says so and offers manual entry");
    await call(a, "/map-settings", "PUT", { online: true, tile_url: before.map.tile_url, geocoder_url: before.map.geocoder_url, suggest_url: before.map.suggest_url });
    await ADDRESS(m).fill("");
    await closeEditor(m);

    /* ── Unsaved edits with the new layout ── */
    m = await open(page, "meridian", "/people");
    await act(m, (id) => go("person", id), person);
    await until(() => route(page) === `/people/${person}`, "person has an address");
    await until(() => m.locator(".profile-head").isVisible(), "person shown");
    await m.evaluate(() => openPanel("addresses"));
    await ADDRESS(m).waitFor();
    await m.locator(".addr-details summary").first().click();
    await field("postal_code").fill("049 99");
    await page.goBack();
    await until(() => route(page) === "/people", "Back moved the address");
    await m.locator("#panel-hold").waitFor({ timeout: 5000 });
    check((await field("postal_code").inputValue()) === "049 99", "Back keeps the address edit");
    await page.goForward();
    await until(() => route(page) === `/people/${person}`, "Forward returned");
    await page.evaluate(() => document.querySelector('a[data-nav="overview"]').click());
    await until(async () => new URL(page.url()).pathname === "/app/overview" && (await page.locator("#module-application").count()) === 0, "left Meridian");
    await page.goBack();
    m = await ready(page, "meridian");
    await m.locator("#draft-tray").waitFor({ timeout: 10000 });
    await m.locator('#draft-tray [data-draft="resume"]').click();
    await until(async () => (await m.locator('#panel [data-k="postal_code"]').first().inputValue({ timeout: 500 })) === "049 99", "the address draft is restored after leaving");
    check(true, "a draft in the new address layout is recovered");
    await closeEditor(m);

    /* ── Organizations ── */
    await m.evaluate(() => openPanel("employments"));
    const orgInput = () => m.locator('#panel [data-combo-input="org"]').last();
    await typeSearch(orgInput(), `qol skola ${RUN}`);
    await until(async () => (await m.locator(".combo-option").count()) > 0, "an existing Organization is suggested");
    check((await m.locator(".combo-option").first().innerText()).includes(`QoL Škola ${RUN}`), "matching ignores case and accents");
    check((await m.locator(".combo-option", { hasText: "Create" }).count()) === 0, "no new one is offered when the name already exists");
    await orgInput().press("Enter");
    check((await orgInput().inputValue()) === `QoL Škola ${RUN}`, "choosing fills the canonical name");
    await m.locator('#panel [data-k="title"]').last().fill("Synthetic Engineer");
    await saveEditor(m);
    await until(async () => (await call(m, `/people/${person}`)).employments[0]?.organization_id === org.id, "the job links the existing Organization");
    await until(() => m.evaluate(() => !panel.isDirty()), "job saved");
    await m.locator('[data-act="add-row"]').click();
    await typeSearch(orgInput(), `QoL Nová ${RUN}`);
    await until(async () => (await m.locator(".combo-option", { hasText: "Create" }).count()) === 1, "a new Organization is offered explicitly");
    await orgInput().press("Enter");
    await saveEditor(m);
    const withNew = await until(async () => { const p = await call(m, `/people/${person}`); return p.employments.length === 2 ? p : null; }, "the new Organization is created");
    made.orgs.push(withNew.employments.find((e) => e.organization_id !== org.id).organization_id);
    await closeEditor(m);
    await m.evaluate(() => openPanel("education"));
    await typeSearch(orgInput(), `qol skola ${RUN}`);
    await until(async () => (await m.locator(".combo-option").count()) > 0, "education suggests it too");
    await orgInput().press("Enter");
    await saveEditor(m);
    await until(async () => (await call(m, `/people/${person}`)).education[0]?.organization_id === org.id, "school links the same Organization");
    await closeEditor(m);
    const found = await call(m, `/search?q=${encodeURIComponent(`Škola ${RUN}`)}&kinds=organization`);
    check(found.entities.length === 1, "no duplicate Organization was created");

    /* ── Groups ── */
    m = await open(page, "meridian", `/people/${person}`);
    await until(() => m.locator(".profile-head").isVisible(), "person shown");
    await m.evaluate(() => openMembership(null, null));
    const groupInput = () => m.locator("#mem-target .picker-search input");
    await groupInput().pressSequentially(`qol klub ${RUN}`, { delay: 25 });
    await until(async () => (await m.locator("#mem-target .row").count()) > 0, "an existing group is suggested");
    check((await m.locator("#mem-target .row", { hasText: "Create group" }).count()) === 0, "no new group is offered when the name exists");
    await groupInput().press("Enter");
    await until(async () => (await m.locator("#mem-target [data-picked]").inputValue()) === group.id, "the existing group is chosen");
    await saveEditor(m);
    await until(async () => (await call(m, `/people/${person}`)).memberships.some((x) => x.group.id === group.id), "the contact joined the group");
    await until(async () => (await m.locator("#panel").count()) === 0, "panel closed");
    await m.evaluate(() => openMembership(null, null));
    await groupInput().pressSequentially(`QoL Nový ${RUN}`, { delay: 25 });
    await until(async () => (await m.locator("#mem-target .row", { hasText: "Create group" }).count()) === 1, "a new group is offered");
    await groupInput().press("Enter");
    const chosen = await until(async () => (await m.locator("#mem-target [data-picked]").inputValue()) || null, "the new group is created and chosen");
    made.groups.push(chosen);
    await saveEditor(m);
    const joined = await until(async () => { const p = await call(m, `/people/${person}`); return p.memberships.length === 2 ? p : null; }, "a contact can be in several groups");
    await until(async () => (await m.locator("#panel").count()) === 0, "panel closed");
    await call(m, `/memberships/${joined.memberships.find((x) => x.group.id === chosen).id}`, "DELETE");
    check((await call(m, `/entities/${chosen}`)).display_name.includes("Nový"), "removing a membership keeps the group");

    /* ── Atlas Library ── */
    const current = await call(m, `/people/${person}`);
    const doc = await m.evaluate((p) => ({ ...editable(p), expected_revision: p.edit_revision }), current);
    const home = { label: "home", street: "Syntetická 7", postal_code: "040 01", locality: "Testovo", region: "", country: "Slovakia", is_primary: true };
    const geo = await m.evaluate((x) => geoKey(x), home);
    doc.addresses = [{ ...home, latitude: 48.7, longitude: 21.2, geo_precision: "house", geo_key: geo }, { label: "old", street: "Staršia 3", locality: "Testovo", country: "Slovakia", is_primary: false, valid_until: "2001" }, { label: "box", po_box: "P.O. Box 9", is_primary: false }];
    const stored = await call(m, `/people/${person}`, "PUT", doc);
    const homeId = stored.addresses.find((x) => x.street === "Syntetická 7").id;
    a = await open(atlasTab, "atlas", "/library");
    await until(() => a.evaluate(() => state.contacts.availability === "available" && renderedSection === "library"), "Library open");
    await a.evaluate(() => loadLibrary());
    const entry = () => a.locator(`[data-contact-entry="${homeId}"]`);
    await entry().waitFor({ timeout: 15000 });
    check((await entry().innerText()).includes("Meridian"), "a Meridian address is listed and marked as Meridian's");
    await a.locator("#lib-q").fill(`qol osoba ${RUN}`);
    await until(async () => (await a.locator("[data-contact-entry]").count()) === 3, "search finds all three addresses, ignoring case");
    const text = await a.locator("#place-list").innerText();
    check(/Former address/.test(text), "a former address is labelled");
    check(/Nothing to place on a map/.test(text), "an address with no geography is still listed");
    await a.locator('[data-source="places"]').click();
    await until(async () => (await a.locator("[data-contact-entry]").count()) === 0, "the Places filter hides Meridian addresses");
    await a.locator('[data-source="contacts"]').click();
    await until(async () => (await a.locator("[data-contact-entry]").count()) === 3, "the Meridian filter shows them");
    await entry().locator('[data-act="contact-to-place"]').click();
    await until(() => a.locator("#pl-name").isVisible(), "the place editor opens");
    check((await a.locator("#pl-name").inputValue()).includes(`Osoba ${RUN}`), "making a place starts from the address");
    await a.evaluate(() => document.querySelector("#dialog").close());
    check(!(await a.evaluate(() => state.places.some((p) => p.name.includes("QoL")))), "nothing is created until saved");
    await entry().locator('button[data-module="meridian"]').click();
    await until(() => pathParam(atlasTab) === `/people/${person}/addresses/${homeId}`, "Open goes to the exact contact and address");
    const there = await ready(atlasTab, "meridian");
    await there.locator(`[data-address-row="${homeId}"].is-target`).waitFor({ timeout: 15000 });
    check(true, "the exact address is highlighted");
    await atlasTab.goBack();
    a = await ready(atlasTab, "atlas");
    await until(async () => new URL(atlasTab.url()).pathname === "/app/modules/atlas", "Back returns to Atlas");
    check(route(atlasTab) === "/library", "Back returns to the Library");
    await until(async () => (await a.locator("#lib-q").inputValue()) === `qol osoba ${RUN}`, "the private search is restored");
    check(!atlasTab.url().includes("qol"), "the search is not in the URL");
    await until(async () => (await a.locator(`[data-contact-entry="${homeId}"]`).count()) === 1, "the entry is listed again");
    await a.locator(`[data-contact-entry="${homeId}"] [data-contact-pin]`).click();
    await until(() => route(atlasTab) === "/map/contact", "Show on map opens the contact on the map");
    check(!atlasTab.url().includes(person) && !atlasTab.url().includes("Testovo"), "the URL names no one and no place");
    await until(() => a.evaluate(() => state.selectedGroup !== null && document.querySelector("#detail").innerText.includes("QoL")), "the map shows that contact");
    await atlasTab.goBack();
    await until(() => route(atlasTab) === "/library", "Back returns from the map");

    /* ── Changes in Meridian ── */
    const contactsOf = () => a.evaluate(async () => { await loadContacts(); return state.contacts.items; });
    const mine = (items) => items.filter((x) => x.resource.endsWith(person));
    const latest = await call(m, `/people/${person}`);
    const edit = await m.evaluate((p) => ({ ...editable(p), expected_revision: p.edit_revision }), latest);
    edit.addresses = edit.addresses.filter((x) => x.label !== "box").map((x) => (x.label === "home" ? { ...x, street: "Zmenená 8" } : x));
    await call(m, `/people/${person}`, "PUT", edit);
    await until(async () => mine(await contactsOf()).some((x) => x.id === homeId && x.text.includes("Zmenená 8") && x.latitude === null), "an update reaches Atlas and the old position goes");
    check(mine(await contactsOf()).length === 2, "a deleted address leaves Atlas");
    check(!(await a.locator("#place-list").innerText()).includes("Syntetická 7"), "the Library does not keep the old address");
    await call(m, `/people/${person}`, "DELETE");
    await until(async () => mine(await contactsOf()).length === 0, "a trashed contact leaves Atlas");
    await call(m, `/people/${person}/restore`, "POST");
    await until(async () => mine(await contactsOf()).length === 2, "a restored contact returns");

    /* ── Outage and access ── */
    await atlasTab.route("**/modules/atlas/api/contacts", (r) => r.abort());
    await a.evaluate(() => loadContacts());
    await until(async () => /not shown right now/.test(await a.locator("#place-list").innerText()), "an outage is stated");
    check((await a.locator("[data-contact-entry]").count()) === 0, "nothing stale is shown during an outage");
    await atlasTab.unroute("**/modules/atlas/api/contacts");
    await until(async () => { await a.evaluate(() => loadContacts()); return (await a.locator("[data-contact-entry]").count()) === 2; }, "the entries return after the outage");
    const stranger = await browser.newContext();
    const anon = await stranger.request.get(`${NEXUS}/modules/atlas/api/contacts`);
    check([401, 403].includes(anon.status()), "signed out, Atlas's contact layer refuses");
    const anonSearch = await stranger.request.post(`${NEXUS}/modules/meridian/api/address-search`, { data: { q: "abc" } });
    check([401, 403].includes(anonSearch.status()), "signed out, address search refuses");
    await stranger.close();

    /* ── Manual mode and small screens ── */
    await call(m, "/address-search/consent", "PUT", { enabled: false });
    m = await open(page, "meridian", `/people/${person}`);
    await until(() => m.locator(".profile-head").isVisible(), "person shown");
    await m.evaluate(() => openPanel("addresses"));
    await m.locator(".address-consent").waitFor();
    check(await m.locator('#panel [data-k="street"]').first().isVisible(), "with address search off, the address can be typed by hand");
    await closeEditor(m);
    if (ENGINE !== "firefox") {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await ctx.storageState() });
      const small = await phone.newPage();
      const pm = await open(small, "meridian", `/people/${person}`);
      await until(() => pm.locator(".profile-head").isVisible(), "person shown at 390");
      await pm.evaluate(() => openPanel("addresses"));
      await pm.locator('#panel [data-k="street"]').first().waitFor();
      check(await pm.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the address editor fits a 390 px viewport (emulated)");
      const pa = await open(small, "atlas", "/library");
      await pa.locator("[data-contact-entry]").first().waitFor({ timeout: 15000 });
      check(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the Library fits a 390 px viewport (emulated)");
      await phone.close();
    }
    check(errors.filter((e) => !/access control checks/.test(e)).length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);
  } catch (error) {
    if (process.env.DEBUG_JOURNEY) {
      const f = await frameOf(page).catch(() => null);
      console.log("debug", await f?.evaluate(() => ({ error: document.querySelector("#form-error")?.textContent, hidden: document.querySelector("#form-error")?.hidden, dirty: panel.isDirty(), saving: panel.saving, save: document.querySelector('[data-act="panel-save"]')?.disabled, street: document.querySelector('#panel [data-k="street"]')?.value })).catch((e) => e.message));
    }
    if (!error.message.startsWith("failed:")) {
      failures.push(error.message.slice(0, 500));
      console.log(`FAIL ${error.message.slice(0, 500)}`);
    }
  } finally {
    const f = await open(page, "meridian");
    await call(f, "/address-search/consent", "PUT", { enabled: !!before.consent }).catch(() => {});
    for (const id of [person, second]) {
      await call(f, `/people/${id}`, "DELETE").catch(() => {});
      await call(f, `/trash/${id}?confirm=true`, "DELETE").catch(() => {});
    }
    for (const id of [...made.orgs, ...made.groups]) {
      await call(f, `/entities/${id}`, "DELETE").catch(() => {});
      await call(f, `/trash/${id}?confirm=true`, "DELETE").catch(() => {});
    }
    const g = await open(atlasTab, "atlas");
    await call(g, "/map-settings", "PUT", { online: before.map.online, tile_url: before.map.tile_url, geocoder_url: before.map.geocoder_url, suggest_url: before.map.suggest_url }).catch(() => {});
    await browser.close();
  }
  console.log(JSON.stringify({ engine: ENGINE, passed, failed: failures.length, failures }));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
