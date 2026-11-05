// Regression tests for the Celestial Graph engine, run in Chromium against the real
// frontend/graph.js and the synthetic fixtures. Usage:
//   PLAYWRIGHT_PATH=<path to playwright> node tests/perf/graph-tests.cjs
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { SETS } = require("./fixtures.cjs");

// The engine's input from the /api/graph projection (as the Graph view builds it).
function toData(raw) {
  return {
    nodes: raw.nodes.map(([id, kind, label, self]) => ({ id, kind, label, self: !!self })),
    edges: raw.edges.map(([a, b, kind, ti, state, conf]) => {
      const t = raw.types[ti];
      return { source: raw.nodes[a][0], target: raw.nodes[b][0], record: kind, type: t.key, category: t.category, label: t.label, inverse: t.inverse, symmetric: t.symmetric, state, conf };
    }),
  };
}

const TESTS = {
  async "settles, then stops drawing when idle"(data) {
    const e = await engineWith(data);
    await sleep(1200);
    const before = e.frames;
    await sleep(600);
    return check(!e.settling && e.frames === before, `frames kept running: ${before} → ${e.frames}`);
  },
  async "hover and selection never restart the layout"(data) {
    const e = await engineWith(data);
    const alpha = e.sim.alpha();
    const n = e.visibleNodes[0];
    const p = e.toScreen(n.x, n.y);
    e.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: e.canvas.getBoundingClientRect().left + p.x, clientY: e.canvas.getBoundingClientRect().top + p.y, bubbles: true }));
    e.select({ type: "node", id: n.id });
    await sleep(300);
    return check(!e.settling && e.sim.alpha() === alpha && e.hover?.id === n.id, "the simulation was reheated or hover was missed");
  },
  async "separate networks do not overlap"(data) {
    const e = await engineWith(data);
    const comp = new Map();
    for (const n of e.nodes) (comp.get(n.home.index) || comp.set(n.home.index, []).get(n.home.index)).push(n);
    const boxes = [...comp.values()].filter((g) => g.length > 1 && !g[0].home.lone).map((g) => e.bounds(g));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) return check(false, `clusters ${i} and ${j} overlap`);
      }
    return check(boxes.length >= 4, `expected at least 4 clusters, got ${boxes.length}`);
  },
  async "hit targets stay usable however small a node is drawn"(data) {
    const e = await engineWith(data);
    e.animateTo({ k: 0.15 }, 0);
    e.quad = null;
    const n = e.visibleNodes[3];
    const p = e.toScreen(n.x, n.y);
    const hit = e.nodeAt(p.x + 8, p.y);
    return check(hit?.id === n.id || Math.hypot(e.toScreen(hit.x, hit.y).x - p.x - 8, e.toScreen(hit.x, hit.y).y - p.y) < 8, "a click 8 px from a tiny node missed it");
  },
  async "fitting keeps the graph clear of the panel"(data) {
    const e = await engineWith(data);
    e.setInsets({ right: 400, top: 70 });
    e.fit(0);
    const xs = e.visibleNodes.map((n) => e.toScreen(n.x, n.y));
    return check(xs.every((p) => p.x < e.w - 400 && p.y > 70), "a node sits under the panel or the bar");
  },
  async "several records between one pair stay separate and selectable"(data) {
    const e = await engineWith(data);
    const pairs = new Map();
    for (const l of e.visibleLinks) (pairs.get(l.pair) || pairs.set(l.pair, []).get(l.pair)).push(l);
    const multi = [...pairs.values()].find((g) => g.length >= 3);
    const mids = multi.map((l) => e.pointOn(l, 0.5));
    const distinct = mids.every((m, i) => mids.every((o, j) => i === j || Math.hypot(m.x - o.x, m.y - o.y) > 3));
    const p = e.toScreen(mids[0].x, mids[0].y);
    const hit = e.edgeAt(p.x, p.y);
    return check(distinct && hit?.pair === multi[0].pair, "parallel records collapsed or were not selectable");
  },
  async "filtering never moves the layout"(data) {
    const e = await engineWith(data);
    const before = JSON.stringify([...e.positions()]);
    e.applyFilter({ node: (n) => n.kind === "p", link: (l) => l.state !== 1, isolated: false });
    await sleep(200);
    return check(JSON.stringify([...e.positions()]) === before && !e.settling, "positions changed after filtering");
  },
  async "labels never overlap"(data) {
    const e = await engineWith(data);
    await sleep(900);
    const b = e.stats.labelBoxes;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i][0] < b[j][2] && b[i][2] > b[j][0] && b[i][1] < b[j][3] && b[i][3] > b[j][1]) return check(false, `labels ${i} and ${j} overlap`);
    return check(b.length > 10, `too few labels: ${b.length}`);
  },
  async "relationships arc, memberships and work are straight spokes"(data) {
    const e = await engineWith(data);
    const spoke = e.links.find((l) => l.spoke && !l.lane);
    const rel = e.links.find((l) => !l.spoke && !l.lane);
    const mid = (l) => ({ x: (l.source.x + l.target.x) / 2, y: (l.source.y + l.target.y) / 2 });
    const c1 = e.control(spoke);
    const c2 = e.control(rel);
    return check(Math.hypot(c1.x - mid(spoke).x, c1.y - mid(spoke).y) < 0.01 && Math.hypot(c2.x - mid(rel).x, c2.y - mid(rel).y) > 1, "edge geometry does not tell the record kinds apart");
  },
  async "reduced motion moves the camera at once"(data) {
    const e = await engineWith(data, { reducedMotion: () => true });
    e.animateTo({ k: 2, x: 10, y: 10 }, 500);
    return check(e.cam.k === 2 && e.cam.x === 10 && !e.anim, "the camera animated under reduced motion");
  },
  async "size follows visible connections, gently"(data) {
    const e = await engineWith(data);
    const rs = e.visibleNodes.map((n) => n.r);
    return check(Math.max(...rs) <= 9.3 && Math.min(...rs) >= 3.2, `radius range ${Math.min(...rs)}–${Math.max(...rs)}`);
  },
  async "a selected connection always names both of its ends"(data) {
    const e = await engineWith(data);
    const misses = [];
    for (const l of e.visibleLinks.slice(0, 40)) {
      e.select({ type: "edge", key: l.pair }, { silent: true });
      await sleep(260);
      for (const n of [l.source, l.target]) if (!(e.labelAlpha.get(n.id) > 0.95)) misses.push(n.label);
    }
    return check(!misses.length, `unnamed ends: ${misses.slice(0, 5).join(", ")}`);
  },
  async "framing an entity shows everything it is connected to"(data) {
    const e = await engineWith(data);
    e.setInsets({ right: 400, top: 70 });
    const hub = [...e.visibleNodes].sort((a, b) => b.shown - a.shown)[0];
    e.frameAround(hub.id, { ms: 0 });
    const s = e.safeRect();
    const near = e.visibleLinks.filter((l) => l.source === hub || l.target === hub).map((l) => (l.source === hub ? l.target : l.source));
    const out = [hub, ...near].filter((n) => {
      const p = e.toScreen(n.x, n.y);
      return p.x < s.x0 || p.x > s.x1 || p.y < s.y0 || p.y > s.y1;
    });
    return check(!out.length && e.cam.k <= 1.6, `${out.length} neighbours outside the free area at zoom ${e.cam.k.toFixed(2)}`);
  },
  async "coming back to the same graph restores it exactly"(data) {
    const first = await engineWith(data);
    first.select({ type: "node", id: first.visibleNodes[2].id });
    const saved = first.positions();
    const before = JSON.stringify([...saved]);
    first.destroy();
    let done;
    const settled = new Promise((r) => (done = r));
    const e = new MeridianGraph.Engine(document.getElementById("c"), { onSettled: () => done() });
    window.__e = e;
    e.setData(data, saved);
    await settled;
    const same = JSON.stringify([...e.positions()]) === before;
    // Changed data (one connection fewer) may adjust, so the layout is allowed to run.
    const changed = { nodes: data.nodes, edges: data.edges.slice(1) };
    const f = new MeridianGraph.Engine(document.getElementById("c"), {});
    f.setData(changed, saved);
    const reheats = f.settling && f.sim.alpha() > 0;
    f.destroy();
    return check(same && reheats, same ? "changed data did not re-run the layout" : "positions moved on return");
  },
};
TESTS["arrows point the way the shown wording reads, from either side"] = async function () {
  const node = (id, kind, label) => ({ id, kind, label, self: false });
  const rel = (source, target, record, type, category, label, inverse, symmetric = false) => ({ source, target, record, type, category, label, inverse, symmetric, state: 0, conf: 0 });
  const data = {
    nodes: [node("renata", "p", "Renáta"), node("viktor", "p", "Viktor"), node("maria", "p", "Mária"), node("oto", "p", "Oto"), node("choir", "g", "Choir"), node("acme", "o", "Acme")],
    edges: [
      rel("renata", "viktor", "r", "parent", "family", "parent of", "child of"),
      rel("maria", "oto", "r", "manager", "professional", "manager of", "reports to"),
      rel("viktor", "choir", "m", "membership", "membership", "member of", "has member"),
      rel("oto", "acme", "e", "employment", "employment", "works at", "employs"),
      rel("renata", "maria", "r", "friend", "social", "friend of", "friend of", true),
    ],
  };
  const e = await engineWith(data);
  e.animateTo({ k: 1.4 }, 0);
  const problems = [];
  const expect = {
    renata: [["renata", "viktor", "parent of"]],
    viktor: [["viktor", "renata", "child of"], ["viktor", "choir", "member of"]],
    choir: [["choir", "viktor", "has member"]],
    maria: [["maria", "oto", "manager of"]],
    oto: [["oto", "maria", "reports to"], ["oto", "acme", "works at"]],
    acme: [["acme", "oto", "employs"]],
  };
  const key = (rows) => rows.map((r) => r.join(">")).sort().join(" | ");
  for (const [focus, want] of Object.entries(expect)) {
    e.select({ type: "node", id: focus }, { silent: true });
    e.hover = null;
    await sleep(320);
    if (key(e.stats.arrows) !== key(want)) problems.push(`${focus}: arrows ${key(e.stats.arrows)}`);
    // The wording drawn on each connection names the same direction as its arrow.
    const worded = e.stats.words.filter((w) => w[2] !== "friend of");
    if (key(worded) !== key(want)) problems.push(`${focus}: words ${key(worded)}`);
    // The tip is drawn nearer the entity the wording points to.
    for (const l of e.visibleLinks.filter((x) => x.source.id === focus || x.target.id === focus)) {
      const r = e.reads(l, focus);
      if (!r.directed) continue;
      const tip = e.pointOn(l, r.reversed ? 0.39 : 0.61);
      const d = (n) => Math.hypot(tip.x - n.x, tip.y - n.y);
      if (!(d(r.to) < d(r.from))) problems.push(`${focus}: ${r.text} tip is not nearer ${r.to.label}`);
    }
  }
  // Symmetric relationships carry no arrow from either side.
  e.select({ type: "node", id: "maria" }, { silent: true });
  await sleep(320);
  if (e.stats.arrows.some((a) => a[2] === "friend of")) problems.push("friend of has an arrow");
  // A selected connection (no entity in focus) reads from its subject.
  const parent = e.visibleLinks.find((l) => l.type === "parent");
  e.select({ type: "edge", key: parent.pair }, { silent: true });
  await sleep(320);
  if (key(e.stats.arrows) !== "renata>viktor>parent of") problems.push(`edge: ${key(e.stats.arrows)}`);
  return check(!problems.length, problems.join("; "));
};
const FIXTURE = { "separate networks do not overlap": "clusters", "several records between one pair stay separate and selectable": "dense", "labels never overlap": "social", "relationships arc, memberships and work are straight spokes": "social", "a selected connection always names both of its ends": "social", "framing an entity shows everything it is connected to": "social", "coming back to the same graph restores it exactly": "social" };

// Tests that need the real mouse (pointer capture, real event timing) run from Node.
const MOUSE_TESTS = {
  async "a released node lets the network settle naturally, without snapping back"(page) {
    const data = toData(SETS.social());
    await page.evaluate(async (d) => {
      const e = await engineWith(d);
      await sleep(300);
      const n = e.visibleNodes.find((x) => x.shown >= 2 && x.shown <= 5 && !x.home.lone);
      const near = e.visibleLinks.filter((l) => l.source === n || l.target === n).map((l) => (l.source === n ? l.target : l.source));
      window.__drag = { e, n, near, snap: () => near.map((m) => [m.x, m.y]) };
    }, data);
    const moved = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
    const sample = () => page.evaluate(() => ({ near: __drag.snap(), node: [__drag.n.x, __drag.n.y], settling: __drag.e.settling, frames: __drag.e.frames, t: performance.now() }));
    const problems = [];
    const took = [];
    for (const [round, [dx, dy]] of [[1, [170, 90]], [2, [-120, 140]], [3, [28, -18]]]) {
      const start = await sample();
      const from = await page.evaluate(() => {
        const p = __drag.e.toScreen(__drag.n.x, __drag.n.y);
        const r = __drag.e.canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 14; i++) {
        await page.mouse.move(from.x + (dx * i) / 14, from.y + (dy * i) / 14);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(120);
      const held = await sample();
      await page.mouse.up();
      const r0 = await sample();
      await page.waitForTimeout(80);
      const r1 = await sample();
      await page.waitForTimeout(320);
      const r2 = await sample();
      let end = r2;
      while (end.settling && end.t - r0.t < 5000) {
        await page.waitForTimeout(100);
        end = await sample();
      }
      const settleMs = end.t - r0.t;
      await page.waitForTimeout(500);
      const idle = await sample();
      const tag = `drag ${round}:`;
      if (moved(start.near, held.near) < 2) problems.push(`${tag} neighbours did not follow the drag`);
      if (!r2.settling) problems.push(`${tag} the layout stopped at once on release`);
      if (moved(r1.near, r2.near) < 0.5) problems.push(`${tag} nothing moved after release`);
      took.push(settleMs);
      if (end.settling || settleMs > 3400) problems.push(`${tag} still moving ${Math.round(settleMs)} ms after release`);
      else if (settleMs < 700) problems.push(`${tag} settled in only ${Math.round(settleMs)} ms`);
      const drift = Math.hypot(end.node[0] - r0.node[0], end.node[1] - r0.node[1]);
      if (drift > 6) problems.push(`${tag} the released node drifted ${drift.toFixed(1)} units back`);
      if (idle.frames !== end.frames) problems.push(`${tag} kept drawing after settling`);
      console.log(`      ${tag} neighbours moved ${moved(start.near, held.near).toFixed(0)} while held, ${moved(r1.near, r2.near).toFixed(1)} in the 0.1–0.4 s after release; settled ${Math.round(settleMs)} ms after release; released node drifted ${drift.toFixed(2)}`);
    }
    if (!(took[2] < took[0] - 300)) problems.push(`a small nudge took as long to settle as a big drag (${Math.round(took[2])} vs ${Math.round(took[0])} ms)`);
    return problems.length ? problems.join("; ") : "ok";
  },
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.resolve(__dirname, "graph-bench.html").replace(/\\/g, "/"));
  await page.evaluate(() => {
    window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.check = (ok, why) => (ok ? "ok" : why);
    window.engineWith = async (data, opts = {}) => {
      window.__e?.destroy();
      let done;
      const settled = new Promise((r) => (done = r));
      const e = new MeridianGraph.Engine(document.getElementById("c"), { ...opts, onSettled: () => done() });
      window.__e = e;
      e.setData(data);
      await settled;
      e.fit(0);
      return e;
    };
  });
  let failed = 0;
  for (const [name, fn] of Object.entries(TESTS)) {
    const data = toData(SETS[FIXTURE[name] || "family"]());
    const result = await page.evaluate(`(${fn.toString().replace(/^async [^(]*/, "async function")})(${JSON.stringify(data)})`);
    console.log(`${result === "ok" ? "PASS" : "FAIL"}  ${name}${result === "ok" ? "" : ` — ${result}`}`);
    if (result !== "ok") failed++;
  }
  for (const [name, fn] of Object.entries(MOUSE_TESTS)) {
    const result = await fn(page);
    console.log(`${result === "ok" ? "PASS" : "FAIL"}  ${name}${result === "ok" ? "" : ` — ${result}`}`);
    if (result !== "ok") failed++;
  }
  await browser.close();
  const total = Object.keys(TESTS).length + Object.keys(MOUSE_TESTS).length;
  console.log(`${total - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
