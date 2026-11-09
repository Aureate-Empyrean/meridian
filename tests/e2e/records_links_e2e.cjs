// Meridian 0.7.0 inside the real aetest Nexus (never production): an Interaction linked to a real
// Chronos event. The event is offered because it involves the participant; the link is registered
// with Nexus, private to Meridian, survives reconcile, stays readable after the event is deleted,
// and its edge is removed with the Interaction. Synthetic data, removed or trashed at the end.
//
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/records_links_e2e.cjs
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const NEXUS = "http://localhost:12334";
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const check = (cond, what) => {
  if (!cond) {
    console.error(`FAIL ${what}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${what}`);
};
async function until(fn, what, seconds = 90) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(500);
  }
  check(false, `${what} (timed out)`);
}
async function open(page, module) {
  await page.goto(`${NEXUS}/app/modules/${module}`);
  await page.locator("#username, #module-application").first().waitFor({ timeout: 30000 });
  if (await page.locator("#username").isVisible()) {
    const owner = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../empyrean-nexus/.data/aetest-owner.json"), "utf8"));
    await page.locator("#username").fill(owner.username);
    await page.locator("#password").fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  let frame;
  for (let i = 0; i < 80 && !frame; i++) {
    frame = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes(`/modules/${module}`));
    if (!frame) await sleep(250);
  }
  await frame.waitForFunction(() => typeof api === "function", null, { timeout: 30000 });
  await sleep(500);
  return frame;
}
const call = (frame, p, method = "GET", body) => frame.evaluate(([x, m, b]) => (b === null ? api(x, m) : api(x, m, b)), [p, method, body === undefined ? null : body]);
/** Read-only look at the Nexus reference index of the aetest installation. */
function edges(source) {
  const code = `import sqlite3,json,sys
c=sqlite3.connect('file:/data/nexus.sqlite3?mode=ro',uri=True)
print(json.dumps(c.execute("select target,relation,readers,creator from resource_references where source=?",(sys.argv[1],)).fetchall()))`;
  return JSON.parse(execFileSync("docker", ["exec", "aetest-nexus-1", "python", "-c", code, source], { encoding: "utf8" }));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let m = await open(page, "meridian");
  const person = await call(m, "/people", "POST", { names: [{ kind: "full", value: `Linka Odkazová ${RUN}` }] });

  const c = await open(page, "chronos");
  const cal = (await call(c, "/state")).calendars.find((x) => x.kind === "native");
  const event = await call(c, "/events", "POST", { calendar_id: cal.id, title: `Obed ${RUN}`, start: "2026-12-01T12:00", end: "2026-12-01T13:00", time_zone: "Europe/Bratislava" });
  await call(c, `/events/${event.id}/people`, "POST", { resource: `nexus:v1:meridian:person:${person.id}`, label: `Linka Odkazová ${RUN}` });
  const target = `nexus:v1:chronos:event:${event.id}`;

  m = await open(page, "meridian");
  await until(async () => (await call(m, `/interaction-link-candidates?entity=${person.id}`)).items.some((x) => x.resource === target), "the Chronos event becomes a candidate");
  check(true, "a Chronos event involving the person is offered as a candidate");

  await m.evaluate((id) => go("person", id), person.id);
  await m.locator('.add-chip[data-section="interactions"]').click();
  await m.locator("#ix-summary").fill(`Obed spolu ${RUN}`);
  await m.locator('[data-act="ix-link-load"]').click();
  const choice = m.locator(".ix-choice", { hasText: `Obed ${RUN}` });
  await choice.waitFor({ timeout: 20000 });
  await choice.click();
  await m.locator(".ix-link", { hasText: `Obed ${RUN}` }).waitFor();
  await m.locator('#panel [data-act="panel-save"]').click();
  await m.locator("#panel").waitFor({ state: "detached" });
  await m.locator("#interactions-box .ix-row").first().waitFor({ timeout: 15000 });
  check(true, "the event is linked from the interaction editor");

  const { items } = await call(m, `/interactions?entity=${person.id}`);
  const iid = items[0].id;
  const source = `nexus:v1:meridian:interaction:${iid}`;
  const registered = await until(async () => { const e = edges(source); return e.length ? e : null; }, "the Nexus edge is registered");
  check(registered[0][0] === target && registered[0][1] === "meridian.interaction-about", "the link is registered with Nexus");
  check(registered[0][2] === '["chronos"]', "the edge is shared with the event's module only");
  let full = await call(m, `/interactions/${iid}`);
  check(full.links[0].availability === "available" && full.links[0].label === `Obed ${RUN}`, "the link resolves to the event's current title");

  const reconcile = (() => {
    const out = execFileSync("docker", ["exec", "aetest-nexus-1", "python", "-m", "nexus.manage", "--reconcile", "meridian"], { encoding: "utf8" }).trim().split("\n").pop();
    return JSON.parse(out);
  })();
  check(reconcile.added === 0 && reconcile.removed === 0 && reconcile.unchanged >= 1, `reconcile keeps the index (${JSON.stringify(reconcile)})`);

  const chronos = await open(page, "chronos");
  await call(chronos, `/events/${event.id}`, "DELETE");
  m = await open(page, "meridian");
  full = await until(async () => { const x = await call(m, `/interactions/${iid}`); return x.links[0].availability !== "available" ? x : null; }, "the deleted event is reported");
  check(full.links[0].label === `Obed ${RUN}`, `after the event is deleted the link stays readable (${full.links[0].availability})`);
  await m.evaluate(async (id) => openInteraction(await api(`/interactions/${id}`)), iid);
  await m.locator(".ix-link.is-gone").waitFor({ timeout: 10000 });
  check((await m.locator(".ix-link.is-gone").innerText()).includes(`Obed ${RUN}`), "the editor shows it as unresolved, not as an error");
  await m.locator('#panel [aria-label="Close"]').click();
  await m.locator("#panel").waitFor({ state: "detached" });

  await call(m, `/interactions/${iid}`, "DELETE");
  await until(async () => edges(source).length === 0, "the Nexus edge is removed");
  check(true, "deleting the interaction removes its Nexus edge");
  await call(m, `/people/${person.id}`, "DELETE");
  check(errors.length === 0, `no page errors (${errors.join(" / ")})`);
  await browser.close();
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
