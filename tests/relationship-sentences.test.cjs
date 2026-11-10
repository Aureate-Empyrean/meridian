// Relationship sentences (MER-QA-RELATIONSHIP-GRAMMAR): the “Reads as” preview, the graph panel
// and the “Still going on?” dialog say “{a} is parent of {b}” but “{a} studies at {b}”, never
// “{a} is has student {b}”. Run from the meridian folder: node tests/relationship-sentences.test.cjs
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const UX = require("../frontend/ux.js");

// ── Every built-in phrase, both directions, is classified on purpose ──
const verbs = ["knows", "studies at", "has student", "teaches at", "has teacher", "has board member", "has member", "has volunteer",
  "has customer", "has branch", "contracts", "includes", "partners with", "acquired", "reports to", "provides services to",
  "works at", "worked at", "employs", "employed", "studied at"]; // prettier-ignore
const linked = ["parent of", "child of", "sibling of", "grandparent of", "grandchild of", "aunt or uncle of", "niece or nephew of",
  "cousin of", "guardian of", "in the care of", "relative of", "partner of", "married to", "engaged to", "dating", "friend of",
  "classmate of", "roommate of", "neighbor of", "colleague of", "manager of", "mentor of", "mentored by", "teacher of",
  "student of", "client of", "business partner of", "founder of", "founded by", "owner of", "owned by", "board member of",
  "member of", "volunteer at", "contractor for", "customer of", "affiliated with", "subsidiary of", "parent company of",
  "part of", "branch of", "successor of", "predecessor of", "acquired by"]; // prettier-ignore
for (const p of verbs) assert.ok(UX.relationIsVerbPhrase(p), `“${p}” has its own verb`);
for (const p of linked) assert.ok(!UX.relationIsVerbPhrase(p), `“${p}” needs “is”`);

// A new built-in type must be added above, so its sentence is a decision rather than a guess.
const relations = fs.readFileSync("backend/meridian/relations.py", "utf8");
const found = [...relations.matchAll(/_t\("\w+", "\w+", "([^"]+)"(?:, "([^"]+)")?/g)];
assert.strictEqual(
  found.length,
  (relations.match(/^\s+_t\(/gm) || []).length,
  "every built-in type was read from relations.py",
);
assert.ok(found.length >= 38);
const builtins = found.flatMap((m) => m.slice(1).filter(Boolean));
for (const p of builtins)
  assert.ok(verbs.includes(p) || linked.includes(p), `built-in phrase “${p}” is classified in this test`);

// Custom labels: used as typed, never rewritten. A label may carry its own verb; doubled “is” never appears.
assert.ok(UX.relationIsVerbPhrase("is godparent of"));
assert.ok(UX.relationIsVerbPhrase("Was  engaged to"), "case and spacing do not matter");
assert.ok(UX.relationIsVerbPhrase("trains"));
assert.ok(UX.relationIsVerbPhrase("babysits for"));
assert.ok(UX.relationIsVerbPhrase("coaches"));
for (const p of [
  "godparent of",
  "boss of",
  "alumnus of",
  "physics teacher of",
  "sports coach of",
  "employed by",
  "taught by",
  "",
  null,
])
  assert.ok(!UX.relationIsVerbPhrase(p), `“${p}” needs “is”`);

// ── The sentences, built by app.js's own relationSentence and t() ──
const app = fs.readFileSync("frontend/app.js", "utf8").replace(/\r\n/g, "\n");
const slice = (from, to) => {
  const a = app.indexOf(from);
  const b = app.indexOf(to, a);
  assert(a >= 0 && b > a, `${from} not found in app.js`);
  return app.slice(a, b);
};
const context = { MeridianUX: UX, catalogs: {}, activeLocale: "en" };
vm.createContext(context);
vm.runInContext(
  `${slice("function t(key, vars)", "function plural(")}${slice("function relationSentence(", "\n}\n")}\n}\nglobalThis.S = relationSentence;`,
  context,
);
const S = context.S;

// The reported pattern, both directions (person ↔ organization).
assert.strictEqual(S("Example University", "has student", "Test Person"), "Example University has student Test Person");
assert.strictEqual(S("Test Person", "studies at", "Example University"), "Test Person studies at Example University");
// Person ↔ person, asymmetric and symmetric.
assert.strictEqual(S("Eva Pekná", "parent of", "Juraj Pekný"), "Eva Pekná is parent of Juraj Pekný");
assert.strictEqual(S("Juraj Pekný", "child of", "Eva Pekná"), "Juraj Pekný is child of Eva Pekná");
assert.strictEqual(S("Eva Pekná", "friend of", "Test Person"), "Eva Pekná is friend of Test Person");
assert.strictEqual(S("Test Person", "friend of", "Eva Pekná"), "Test Person is friend of Eva Pekná");
assert.strictEqual(S("Eva Pekná", "knows", "Test Person"), "Eva Pekná knows Test Person");
assert.strictEqual(S("Test Person", "reports to", "Eva Pekná"), "Test Person reports to Eva Pekná");
assert.strictEqual(S("Eva Pekná", "dating", "Test Person"), "Eva Pekná is dating Test Person");
assert.strictEqual(S("Eva Pekná", "married to", "Test Person", true), "Eva Pekná was married to Test Person");
// Organization ↔ organization.
assert.strictEqual(S("Example Labs", "acquired by", "Example Corp"), "Example Labs is acquired by Example Corp");
assert.strictEqual(S("Example Corp", "acquired", "Example Labs"), "Example Corp acquired Example Labs");
assert.strictEqual(S("Example Corp", "partners with", "Example Labs"), "Example Corp partners with Example Labs");
// Group membership and employment, current and ended.
assert.strictEqual(S("Test Person", "member of", "Example Choir"), "Test Person is member of Example Choir");
assert.strictEqual(S("Test Person", "member of", "Example Choir", true), "Test Person was member of Example Choir");
assert.strictEqual(S("Example Choir", "has member", "Test Person"), "Example Choir has member Test Person");
assert.strictEqual(S("Test Person", "works at", "Example Corp"), "Test Person works at Example Corp");
assert.strictEqual(
  S("Test Person", "worked at", "Example Corp", true),
  "Test Person worked at Example Corp",
  "no “was worked at”",
);
assert.strictEqual(S("Example Corp", "employs", "Test Person"), "Example Corp employs Test Person");
// Custom types: the label as typed, no doubled verb.
assert.strictEqual(S("Eva Pekná", "is godparent of", "Juraj Pekný"), "Eva Pekná is godparent of Juraj Pekný");
assert.strictEqual(S("Eva Pekná", "godparent of", "Juraj Pekný"), "Eva Pekná is godparent of Juraj Pekný");
assert.strictEqual(S("Eva Pekná", "trains", "Juraj Pekný"), "Eva Pekná trains Juraj Pekný");

// Localization: the templates and the phrase are catalog keys, interpolated with the names.
context.catalogs.sk = {
  "{a} is {p} {b}": "{a} je {p} {b}",
  "{a} {p} {b}": "{a} {p} {b}",
  "parent of": "rodičom osoby",
  "studies at": "študuje na",
};
context.activeLocale = "sk";
assert.strictEqual(S("Eva", "parent of", "Juraj"), "Eva je rodičom osoby Juraj");
assert.strictEqual(S("Test Person", "studies at", "Example University"), "Test Person študuje na Example University");
assert.strictEqual(S("Eva", "trains", "Juraj"), "Eva trains Juraj", "a phrase without a translation stays as typed");
context.activeLocale = "en";

// No sentence surface keeps the unconditional “is”.
assert.ok(
  !/\{a\} is \{p\} \{b\};|\{b\} is \{q\} \{a\}/.test(app),
  "the “Reads as” template no longer inserts “is” itself",
);
assert.ok(!app.includes("${t(r.label)} ${r.object.display_name}`"), "the transition dialog uses relationSentence");
assert.ok(
  !app.includes('${t("member of")} ${m.group.display_name}'),
  "the graph panel uses relationSentence for memberships",
);
// The editor's “Test Person is [relationship]” header hides its “is” for verb phrases.
assert.ok(
  app.includes('id="rel-is"') && app.includes("relSelfVerb(value);"),
  "the editor header's “is” follows the phrase",
);

console.log("relationship sentence tests passed");
