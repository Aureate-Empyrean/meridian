/* Meridian UX helpers (0.5.0): small pure functions shared by app.js and timeline.js and tested
   on their own in Node (tests/ux.test.cjs). No DOM, no network, no wording: callers translate. */

// Words that open a relationship phrase which already has its verb. Built-in verb phrases
// (backend/meridian/relations.py and the Work/Education edges) plus common custom ones.
const AUXILIARIES = new Set(["is", "are", "was", "were", "has", "have", "had", "does", "did"]);
const VERBS = new Set(
  (
    "knows knew studies studied teaches taught works worked employs employed contracts contracted " +
    "includes included partners partnered acquired reports reported provides provided owns owned " +
    "founded leads led manages managed runs ran attends attended lives lived supports supported " +
    "mentors mentored coaches coached advises advised represents represented sponsors sponsored " +
    "funds funded volunteers volunteered serves served belongs belonged joined left met loves likes"
  ).split(" "),
);
const NOUNS_IN_S = new Set(["sports", "arts", "news", "friends", "parents", "siblings", "games"]);

const MeridianUX = {
  /** The day label an entry shows beside it: a month or an exact day, never a bare year. */
  dayKey(e) {
    const v = e?.date;
    if (!v || v.startsWith("--") || v.length < 7) return null;
    return `${v}|${e.approximate ? "~" : ""}`;
  },
  /** Same exact date at the same precision: "1987-08-23" never matches "1987-08", and an
      approximate date never matches an exact one, whatever their labels look like. */
  sameDay(a, b) {
    const k = MeridianUX.dayKey(a);
    return k !== null && k === MeridianUX.dayKey(b);
  },
  /** For each entry of a chronological list: does it open a run of same-day entries, continue
      one, or close one? Every entry stays its own row; only the repeated label is dropped. */
  dayRuns(list) {
    return list.map((e, i) => {
      const prev = i > 0 && MeridianUX.sameDay(list[i - 1], e);
      const next = i < list.length - 1 && MeridianUX.sameDay(e, list[i + 1]);
      return { continued: prev, opens: !prev && next, closes: prev && !next };
    });
  },

  /** A suggested start date replaces the field only while the field is empty or still shows
      the previous suggestion; anything the user entered is kept. */
  takeSuggestion(current, previous, next) {
    if (current && current !== previous) return current;
    return next || null;
  },

  /** The name a list shows under the owner's display preference. */
  listName(x, display) {
    return (display === "family" && x?.display_family_first) || x?.display_name || "";
  },

  /** Kinship values per relationship type, in the order the form offers them. */
  KINSHIP: {
    parent: ["biological", "adoptive", "step"],
    sibling: ["biological_full", "biological_half", "biological", "adoptive", "step"],
  },

  /** The choices for one sibling suggestion and which is preselected. `value` is the kinship to
      store ("" = siblings without detail), "skip" creates nothing, "keep" leaves a record as is. */
  siblingChoices(s) {
    const options = [
      { value: "biological_full", label: "Yes, they are siblings" },
      { value: "biological_half", label: "Yes, they are half-siblings" },
      { value: "biological", label: "Yes, siblings — full or half not known" },
      { value: "adoptive", label: "Yes, siblings through adoption" },
      { value: "", label: "Yes, siblings — no details" },
    ];
    if (s.action === "update") options.push({ value: "keep", label: "Keep it as recorded" });
    else options.push({ value: "skip", label: "No, do not create a sibling relationship" });
    const preselected = s.kinship ?? "";
    return { options, preselected };
  },
  /** The request items for the answers given; "skip"/"keep" (and unanswered) send nothing. */
  siblingItems(suggestions, answers) {
    const items = [];
    suggestions.forEach((s, i) => {
      const answer = answers[i];
      if (answer === undefined || answer === "skip" || answer === "keep") return;
      const kinship = answer === "" ? null : answer;
      if (s.action === "update" && kinship === s.current_kinship) return;
      items.push({ a: s.a.id, b: s.b.id, kinship, ...(s.action === "update" ? { record_id: s.record_id } : {}) });
    });
    return items;
  },

  /** Which ongoing relationships start out selected for ending: only those the server marks as
      usually followed by the new one (partners). Friends, colleagues and the like stay. */
  preselectedEnds(active) {
    return active.filter((r) => r.suggest_end).map((r) => r.id);
  },
  /** Whether an English relationship phrase already carries its verb ("studies at", "has
      student", "knows", "is godparent of") or needs a linking verb before it ("parent of",
      "married to", "acquired by", "dating"). Callers pick the sentence template; the phrase is
      never rewritten. A label that reads wrongly can say its own verb: "is godparent of". */
  relationIsVerbPhrase(phrase) {
    const words = String(phrase || "")
      .trim()
      .toLowerCase()
      .split(/\s+/);
    const [first, second] = words;
    if (!first) return false;
    if (AUXILIARIES.has(first)) return true;
    if (second === "by") return false; // passive: "acquired by", "employed by", "founded by"
    if (VERBS.has(first)) return true;
    // A custom third-person verb ("trains", "babysits"), but not "boss", "alumnus", "basis",
    // "physics teacher of" or "sports coach of".
    return /[^siu]s$/.test(first) && !/ics$/.test(first) && !NOUNS_IN_S.has(first);
  },
  /** Whether an end date can close a relationship that began on `from` (partial dates). */
  endFits(from, until) {
    if (!from || !until) return true;
    const n = Math.min(from.length, until.length);
    return until.slice(0, n) >= from.slice(0, n);
  },
};
if (typeof module !== "undefined") module.exports = MeridianUX;
