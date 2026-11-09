// 0.5.0 UX helpers (frontend/ux.js): same-day Timeline grouping, date suggestions that never
// overwrite the user's own date, name display, sibling answers and transition defaults.
// Run from the meridian folder: node tests/ux.test.cjs
const assert = require("assert");
const UX = require("../frontend/ux.js");

// ── 7. Timeline: one date label per exact day ──
const e = (date, extra = {}) => ({ date, ...extra });
assert.ok(UX.sameDay(e("1987-08-23"), e("1987-08-23")));
assert.ok(!UX.sameDay(e("1987-08-23"), e("1987-08")), "a month is not a day in it");
assert.ok(UX.sameDay(e("1987-08"), e("1987-08")), "two month-only dates share the month label");
assert.ok(!UX.sameDay(e("1987"), e("1987")), "year-only dates have no day label to share");
assert.ok(!UX.sameDay(e("--08-23"), e("--08-23")), "no year: not the same exact date");
assert.ok(!UX.sameDay(e("1987-08-23"), e("1988-08-23")), "same day and month, another year");
assert.ok(!UX.sameDay(e("1987-08-23", { approximate: true }), e("1987-08-23")), "about a date is not that date");
assert.ok(UX.sameDay(e("1987-08-23", { approximate: true }), e("1987-08-23", { approximate: true })));
assert.ok(!UX.sameDay(e(null), e(null)));

const list = [e("1987-06-30"), e("1987-08"), e("1987-08-23"), e("1987-08-23"), e("1987-08-23"), e("1987-08-24")];
const runs = UX.dayRuns(list);
assert.strictEqual(runs.length, list.length, "every entry keeps its own row");
assert.deepStrictEqual(runs[0], { continued: false, opens: false, closes: false });
assert.deepStrictEqual(runs[1], { continued: false, opens: false, closes: false }, "August 1987 stays apart from 23 August");
assert.deepStrictEqual(runs[2], { continued: false, opens: true, closes: false });
assert.deepStrictEqual(runs[3], { continued: true, opens: false, closes: false });
assert.deepStrictEqual(runs[4], { continued: true, opens: false, closes: true });
assert.deepStrictEqual(runs[5], { continued: false, opens: false, closes: false });
assert.deepStrictEqual(UX.dayRuns([]), []);
// The grouping follows the order given (chronological from the server); it never reorders.
const order = [e("1987-08-23", { id: "a" }), e("1987-08-24", { id: "b" }), e("1987-08-23", { id: "c" })];
assert.ok(UX.dayRuns(order).every((r) => !r.continued));

// ── 1. A suggested Since never replaces what the user entered ──
assert.strictEqual(UX.takeSuggestion(null, null, "1987-08-23"), "1987-08-23", "empty field takes the suggestion");
assert.strictEqual(UX.takeSuggestion("1987-08-23", "1987-08-23", "1990-01-01"), "1990-01-01", "an untouched suggestion follows the new child");
assert.strictEqual(UX.takeSuggestion("1987-08-23", "1987-08-23", null), null, "an untouched suggestion goes when no longer valid (adoptive)");
assert.strictEqual(UX.takeSuggestion("2001", "1987-08-23", "1990-01-01"), "2001", "a typed date is kept");
assert.strictEqual(UX.takeSuggestion("2001", null, "1987-08-23"), "2001", "a date entered before any suggestion is kept");
assert.strictEqual(UX.takeSuggestion("?", "1987", "1990"), "?", "a half-typed date is not overwritten");

// ── 5. Name display ──
const vzorko = { display_name: "Vzorko Kvázimenný", display_family_first: "Kvázimenný, Vzorko" };
assert.strictEqual(UX.listName(vzorko, "given"), "Vzorko Kvázimenný");
assert.strictEqual(UX.listName(vzorko, "family"), "Kvázimenný, Vzorko");
assert.strictEqual(UX.listName({ display_name: "Madonna", display_family_first: "Madonna" }, "family"), "Madonna");
assert.strictEqual(UX.listName({ display_name: "Old summary" }, "family"), "Old summary", "falls back without the field");

// ── 2. Sibling answers ──
const create = { action: "create", kinship: "biological", a: { id: "A" }, b: { id: "B" } };
const choices = UX.siblingChoices(create);
assert.strictEqual(choices.preselected, "biological", "uncertain stays uncertain by default");
const labels = choices.options.map((o) => o.label);
for (const l of ["Yes, they are siblings", "Yes, they are half-siblings", "No, do not create a sibling relationship", "Yes, siblings through adoption"])
  assert.ok(labels.includes(l), l);
assert.strictEqual(UX.siblingChoices({ ...create, kinship: null }).preselected, "", "no evidence: siblings without details");
const update = { action: "update", kinship: "biological_full", current_kinship: "biological_half", record_id: "R", a: { id: "A" }, b: { id: "C" } };
assert.ok(UX.siblingChoices(update).options.some((o) => o.value === "keep"));
assert.ok(!UX.siblingChoices(update).options.some((o) => o.value === "skip"));
const items = UX.siblingItems([create, update, { ...create, b: { id: "D" } }], ["biological_half", "biological_full", "skip"]);
assert.deepStrictEqual(items, [
  { a: "A", b: "B", kinship: "biological_half" },
  { a: "A", b: "C", kinship: "biological_full", record_id: "R" },
]);
assert.deepStrictEqual(UX.siblingItems([create], [""]), [{ a: "A", b: "B", kinship: null }]);
assert.deepStrictEqual(UX.siblingItems([update], ["keep"]), [], "keeping sends nothing");
assert.deepStrictEqual(UX.siblingItems([update], ["biological_half"]), [], "choosing what is recorded changes nothing");
assert.deepStrictEqual(UX.siblingItems([create, create], ["skip", "skip"]), [], "declining everything sends nothing");

// ── 6. Ending ongoing relationships ──
const active = [{ id: "dating", suggest_end: true }, { id: "friend", suggest_end: false }];
assert.deepStrictEqual(UX.preselectedEnds(active), ["dating"], "only the partner relationship starts selected");
assert.ok(UX.endFits("2022", "2024-05"));
assert.ok(UX.endFits("2024-05-10", "2024-05"), "same month at the shared precision");
assert.ok(!UX.endFits("2022-06", "2022-05"));
assert.ok(UX.endFits(null, "2020") && UX.endFits("2020", null));

console.log("ux helper tests passed");
