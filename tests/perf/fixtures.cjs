// Deterministic synthetic graphs in the exact /api/graph format, for visual QA and
// benchmarks. Every name is invented. Usage: node tests/perf/fixtures.cjs <outdir>
const fs = require("fs");
const path = require("path");

const TYPES = [
  ["parent", "family", "parent of", "child of", false],
  ["sibling", "family", "sibling of", "sibling of", true],
  ["spouse", "partner", "married to", "married to", true],
  ["partner", "partner", "partner of", "partner of", true],
  ["cousin", "family", "cousin of", "cousin of", true],
  ["friend", "social", "friend of", "friend of", true],
  ["acquaintance", "social", "knows", "knows", true],
  ["classmate", "social", "classmate of", "classmate of", true],
  ["colleague", "professional", "colleague of", "colleague of", true],
  ["manager", "professional", "manager of", "reports to", false],
  ["mentor", "professional", "mentor of", "mentored by", false],
  ["subsidiary", "structure", "subsidiary of", "parent company of", false],
  ["founder", "affiliation", "founder of", "founded by", false],
  ["membership", "membership", "member of", "has member", false],
  ["employment", "employment", "works at", "employs", false],
].map(([key, category, label, inverse, symmetric]) => ({ key, category, label, inverse, symmetric }));
const T = Object.fromEntries(TYPES.map((t, i) => [t.key, i]));
const GIVEN = ["Anna", "Boris", "Cecília", "Dávid", "Eva", "Filip", "Gabriela", "Hugo", "Ivana", "Ján", "Klára", "Lukáš", "Mária", "Norbert", "Oľga", "Pavol", "Renáta", "Samuel", "Tereza", "Urban", "Veronika", "Viktor", "Zora", "Adam", "Bianka", "Daniel", "Ema", "Fedor", "Helena", "Igor"];
const FAMILY = ["Bartoš", "Čierny", "Dolný", "Fábry", "Gál", "Horák", "Ihnát", "Jurík", "Kováč", "Lipták", "Mráz", "Novotný", "Oravec", "Petrík", "Rybár", "Sloboda", "Tóth", "Urban", "Vlk", "Zelený"];
const ORGS = ["Meridian Atelier", "Northfield Labs", "Danube Logistics", "Tatra Software", "Harbor Clinic", "Linden School", "Copperline Studio", "Vista Partners", "Orion Foundation", "Brook & Vale", "Summit Robotics", "Elm Street Café"];
const GROUPS = ["Climbing group", "Book club", "Choir", "Old classmates", "Running crew", "Chess evenings", "Neighbours", "Board game night"];

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function builder(seed) {
  const rand = rng(seed);
  const nodes = [];
  const edges = [];
  const id = (i) => `0190fa00-0000-7000-8000-${String(i).padStart(12, "0")}`;
  const add = (kind, label, self = 0) => (nodes.push([id(nodes.length), kind, label, self]), nodes.length - 1);
  const person = (i) => add("p", `${GIVEN[i % GIVEN.length]} ${FAMILY[Math.floor(i / GIVEN.length + i * 7) % FAMILY.length]}`);
  const link = (a, b, type, state = 0, conf = 0) => a !== b && edges.push([a, b, type === "membership" ? "m" : type === "employment" ? "e" : "r", T[type], state, conf]);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  return { nodes, edges, add, person, link, pick, rand };
}
const out = (b) => ({ nodes: b.nodes, edges: b.edges, types: TYPES, truncated: false });

function family() {
  const b = builder(3);
  const [g1, g2, g3, g4] = ["Helena Horák", "Ján Horák", "Oľga Tóth", "Pavol Tóth"].map((n) => b.add("p", n));
  b.link(g1, g2, "spouse");
  b.link(g3, g4, "spouse");
  const kids = ["Mária Horák", "Lukáš Horák", "Eva Tóth", "Igor Tóth"].map((n) => b.add("p", n));
  kids.slice(0, 2).forEach((k) => (b.link(g1, k, "parent"), b.link(g2, k, "parent")));
  kids.slice(2).forEach((k) => (b.link(g3, k, "parent"), b.link(g4, k, "parent")));
  b.link(kids[0], kids[1], "sibling");
  b.link(kids[2], kids[3], "sibling");
  b.link(kids[1], kids[2], "spouse");
  const exPartner = b.add("p", "Viktor Mráz");
  b.link(kids[0], exPartner, "partner", 1);
  const grand = ["Ema Horák", "Samuel Horák", "Zora Horák"].map((n) => b.add("p", n));
  grand.forEach((g) => (b.link(kids[1], g, "parent"), b.link(kids[2], g, "parent")));
  b.link(grand[0], grand[1], "sibling");
  b.link(grand[1], grand[2], "sibling");
  b.link(grand[0], grand[2], "sibling");
  const me = b.add("p", "Klára Horák", 1);
  b.link(kids[0], me, "parent");
  b.link(me, grand[0], "cousin");
  b.link(me, b.add("p", "Adam Lipták"), "cousin", 0, 2);
  return out(b);
}
function social(people = 120, orgCount = 10, groupCount = 6, seed = 11) {
  const b = builder(seed);
  const ppl = Array.from({ length: people }, (_, i) => b.person(i));
  b.nodes[ppl[0]][3] = 1;
  const orgs = ORGS.slice(0, orgCount).map((n) => b.add("o", n));
  const groups = GROUPS.slice(0, groupCount).map((n) => b.add("g", n));
  const communities = Math.max(3, Math.round(people / 18));
  const of = (p) => p % communities;
  for (const p of ppl) {
    const c = of(p);
    if (b.rand() < 0.75) b.link(p, orgs[(c + (b.rand() < 0.2 ? 1 : 0)) % orgs.length], "employment", b.rand() < 0.2 ? 1 : 0);
    const friends = 1 + Math.floor(b.rand() * 3);
    for (let f = 0; f < friends; f++) {
      const q = ppl[(Math.floor(b.rand() * (people / communities)) * communities + c) % people];
      b.link(p, q, b.pick(["friend", "friend", "acquaintance", "colleague", "classmate"]), b.rand() < 0.12 ? 1 : 0, b.rand() < 0.06 ? 2 : 0);
    }
    if (b.rand() < 0.04) b.link(p, ppl[Math.floor(b.rand() * people)], "acquaintance", 0, 2);
  }
  groups.forEach((g, i) => {
    const size = 5 + Math.floor(b.rand() * 10);
    for (let k = 0; k < size; k++) b.link(ppl[(i * 13 + k * communities + Math.floor(b.rand() * 3)) % people], g, "membership", b.rand() < 0.15 ? 1 : 0);
  });
  for (let i = 1; i < orgs.length; i += 3) b.link(orgs[i], orgs[i - 1], "subsidiary");
  for (let i = 0; i < people / 10; i++) b.link(ppl[i * 3], ppl[i * 3 + 1], b.pick(["sibling", "parent", "spouse"]));
  return out(b);
}
function clusters() {
  const b = builder(19);
  const ring = (n, label) => {
    const ids = Array.from({ length: n }, (_, i) => b.add("p", `${GIVEN[(i + label.length) % GIVEN.length]} ${label}`));
    ids.forEach((x, i) => b.link(x, ids[(i + 1) % n], "friend"));
    for (let i = 0; i < n / 3; i++) b.link(ids[i], ids[(i * 5 + 3) % n], "colleague");
    return ids;
  };
  const a = ring(18, "Novotný");
  const org = b.add("o", "Summit Robotics");
  a.slice(0, 6).forEach((x) => b.link(x, org, "employment"));
  const c = ring(12, "Oravec");
  const g = b.add("g", "Running crew");
  c.slice(0, 7).forEach((x) => b.link(x, g, "membership"));
  ring(8, "Rybár");
  ring(6, "Zelený");
  for (let i = 0; i < 7; i++) b.add(i % 3 ? "p" : "o", i % 3 ? `${GIVEN[i + 9]} Vlk` : ORGS[(i + 4) % ORGS.length]);
  return out(b);
}
function dense() {
  const b = builder(23);
  const p = ["Anna Kováč", "Boris Kováč", "Cecília Gál", "Dávid Gál", "Eva Sloboda", "Filip Sloboda"].map((n) => b.add("p", n));
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      b.link(p[i], p[j], b.pick(["friend", "colleague", "acquaintance"]));
      if ((i + j) % 2 === 0) b.link(p[i], p[j], "classmate", 1);
      if ((i + j) % 3 === 0) b.link(p[i], p[j], "mentor", 0, 2);
    }
  b.link(p[0], p[1], "sibling");
  b.link(p[2], p[3], "spouse");
  const g = b.add("g", "Chess evenings");
  p.forEach((x) => b.link(x, g, "membership"));
  return out(b);
}
function history() {
  const b = builder(29);
  const ppl = Array.from({ length: 34 }, (_, i) => b.person(i + 40));
  const orgs = ORGS.slice(3, 7).map((n) => b.add("o", n));
  const g = b.add("g", "Old classmates");
  ppl.forEach((p, i) => {
    b.link(p, ppl[(i + 1) % ppl.length], b.pick(["friend", "partner", "colleague"]), b.rand() < 0.5 ? 1 : 0, b.rand() < 0.25 ? 2 : 0);
    if (i % 2) b.link(p, orgs[i % orgs.length], "employment", b.rand() < 0.6 ? 1 : 0);
    if (i % 3 === 0) b.link(p, g, "membership", 1);
  });
  return out(b);
}
const SETS = { family, social: () => social(), clusters, dense, history, large: () => social(1400, 12, 8, 31), huge: () => social(4800, 12, 8, 37) };
if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, "out");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, make] of Object.entries(SETS)) {
    const g = make();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(g));
    console.log(name, g.nodes.length, "nodes", g.edges.length, "edges");
  }
}
module.exports = { SETS };
