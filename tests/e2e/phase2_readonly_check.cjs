// Read-only re-check of roadmap Phase 2 inside the real aetest Nexus (never production), for
// releases after phase2_e2e.cjs already ran there: the people pickers in Chronos and Mnemosyne
// answer through Meridian, and a profile that phase2_e2e.cjs linked still lists its items. It
// creates, edits and deletes nothing.
//
//   PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/phase2_readonly_check.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const NEXUS = "http://localhost:12334";
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
  await sleep(500);
  return frame;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const meridian = await open(page, "meridian");
  const state = await meridian.evaluate(() => api("/state"));
  check(Number(state.version.split(".")[1]) >= 6, `Meridian ${state.version} answers inside Nexus`);
  const daniela = (await meridian.evaluate(() => api("/people?q=Dátumová"))).items[0];
  check(daniela, "the person linked by the Phase 2 journey is still there");
  const linked = await meridian.evaluate((id) => api(`/entities/${id}/linked-from`), daniela.id);
  check(linked.items.length === 2 && linked.items.every((x) => x.availability === "available"), `linked-from lists ${linked.items.map((x) => x.label).join(", ")}`);
  await meridian.evaluate((id) => go("person", id), daniela.id);
  const box = page.frameLocator("#module-application").locator("#linked-from");
  await box.waitFor({ state: "visible", timeout: 15000 });
  check((await box.innerText()).includes("Phase 2 lunch"), "the profile shows the section");
  const chronos = await open(page, "chronos");
  const picked = await chronos.evaluate(() => api("/people?q=Dátumová"));
  check(picked.availability === "available" && picked.items.length === 1, "Chronos picker answers through Meridian");
  const src = (await chronos.evaluate(() => api("/state"))).sources.find((s) => s.provider === "meridian");
  check(src && src.enabled === false, "Chronos Meridian source is still off");
  const mnemosyne = await open(page, "mnemosyne");
  const mn = await mnemosyne.evaluate(() => api(`/api/w/${state.wid}/people?q=Dátumová`));
  check(mn.availability === "available" && mn.items.length === 1, "Mnemosyne picker answers through Meridian");
  check(errors.length === 0, `no page errors (${errors.join(" / ")})`);
  await browser.close();
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
