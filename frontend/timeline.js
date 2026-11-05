/* ───────────────────────── Timeline ─────────────────────────
   A projection of Meridian's records onto time (docs/TIMELINE.md). Relationship, membership
   and work entries come from those records and link back to them; only native events are
   edited here. Loaded after app.js and sharing its helpers. */

const TL = {
  data: null,
  entity: null, // { id, kind, name } when focused on one entity
  filter: { kinds: new Set(["p", "o", "g"]), categories: null, status: "all", from: "", to: "" },
  mode: null, // "overview" | "detail"; chosen by size until the reader picks
  open: new Set(), // years expanded in Overview
  more: new Set(), // month groups shown in full
  undated: false,
  selected: null,
  scroll: 0,
  pending: null, // an entry to select once the view has loaded
};
const TL_KIND = { p: "person", o: "organization", g: "group" };
const TL_CATEGORY = {
  relationship: { label: "Relationship changes", noun: "Relationship" },
  membership: { label: "Memberships", noun: "Membership" },
  employment: { label: "Work", noun: "Work" },
  life: { label: "Life dates", noun: "Life date" },
  event: { label: "Events", noun: "Event" },
};
const TL_COUNT = {
  relationship: ["{count} relationship change", "{count} relationship changes"],
  membership: ["{count} membership change", "{count} membership changes"],
  employment: ["{count} work change", "{count} work changes"],
  life: ["{count} life date", "{count} life dates"],
  event: ["{count} event", "{count} events"],
};
const TL_HUE = { membership: "#b3c39e", employment: "#9aaec6", life: "#ecdccd", event: "#c48663" };
const TL_REL_HUE = { family: "#c98d69", partner: "#d39f8a", social: "#cdbca7", professional: "#a3b5cc", affiliation: "#a3b5cc", structure: "#93a7c1", other: "#b9aea3" };
const TL_CONFIDENCE = { high: "Sure", medium: "Fairly sure", low: "Uncertain", unknown: "Don't know" };
const TL_DETAIL_LIMIT = 6; // entries shown per month group before "Show N more"
const TL_OVERVIEW_AT = 160; // larger timelines open in Overview

/** A relationship entry's type: its wording and category, sent once per type. */
const tlType = (e) => TL.data?.types?.[e.type] || { category: e.group || "other", label: e.phrase || e.type, inverse: e.inverse || e.phrase || e.type, symmetric: e.symmetric ?? true };
const tlHue = (e) => (e.category === "relationship" ? TL_REL_HUE[e.type ? tlType(e).category : e.group] || TL_REL_HUE.other : TL_HUE[e.category]);
/** [began, ended] of the record behind a period entry, whichever side the entry is. */
const tlPeriod = (e) => (e.period ? e.period : e.moment === "start" ? [e.date, e.until] : e.moment === "end" ? [e.since, e.date] : [null, null]);
const tlYear = (v) => (v && !v.startsWith("--") ? +v.slice(0, 4) : null);

/** The marker beside an entry: its kind as a shape (never colour alone), its moment as fill. */
function tlMark(e, size = 16) {
  const c = tlHue(e);
  const hollow = e.moment === "end" || e.moment === "record";
  const fill = hollow ? "none" : c;
  const doubt = e.confidence === "low" || e.confidence === "unknown" || e.state === "unknown" ? 'stroke-dasharray="1.4 1.6"' : "";
  const s = `stroke="${c}" stroke-width="1.4" ${doubt}`;
  const body = {
    relationship: `<path d="M2.5 11.5Q8 1.5 13.5 11.5" fill="none" ${s}/><circle cx="2.5" cy="11.5" r="1.9" fill="${fill}" ${s}/><circle cx="13.5" cy="11.5" r="1.9" fill="${fill}" ${s}/>`,
    membership: `<path d="M13.6 8 10.8 12.8H5.2L2.4 8l2.8-4.8h5.6z" fill="${hollow ? "none" : "rgba(179,195,158,.35)"}" ${s}/>`,
    employment: `<path d="M8 2.2 13.8 8 8 13.8 2.2 8z" fill="${fill}" ${s}/>`,
    life: `<circle cx="8" cy="8" r="4.6" fill="${fill}" ${s}/>`,
    event: `<path d="M8 1.8 9.6 6.4 14.2 8 9.6 9.6 8 14.2 6.4 9.6 1.8 8 6.4 6.4z" fill="${fill}" ${s}/>`,
  }[e.category];
  return `<svg class="tl-glyph" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

/* ── Words ── */

function tlWho(i) {
  const x = TL.data.entities[i];
  return x ? { id: x[0], kind: TL_KIND[x[1]], name: x[2], self: !!x[3] } : null;
}
/** The parts of an entry's sentence, read from the focused entity's side where it matters. */
function tlParts(e, who = (i) => tlWho(i)) {
  const people = (e.entities || []).map(who).filter(Boolean);
  if (e.category === "event") return { title: e.title, people };
  if (e.category === "life") return { a: people[0], phrase: cap(t(e.phrase)), people };
  let [a, b] = people;
  const type = e.category === "relationship" ? tlType(e) : null;
  let phrase = type ? type.label : "member of";
  const focus = TL.entity?.id;
  if (type && !type.symmetric && focus && b?.id === focus) {
    [a, b] = [b, a];
    phrase = type.inverse;
  }
  if (e.category === "membership" && focus && b?.id === focus) {
    [a, b] = [b, a];
    phrase = "has member";
  }
  if (e.category === "employment") {
    const past = e.moment === "end"; // a beginning reads in the present ("works at … until 2016")
    if (!b) return { a, phrase: past ? t("worked as") : t("works as"), text: e.detail || t("role not recorded"), people };
    if (focus && b.id === focus) [a, b, phrase] = [b, a, past ? "employed" : "employs"];
    else phrase = past ? "worked at" : "works at";
  }
  return { a, b, phrase: t(phrase), people };
}
function tlTitleHtml(e, parts = tlParts(e)) {
  if (parts.title !== undefined) return `<span class="tl-name">${esc(parts.title)}</span>`;
  const name = (x) => (x ? `<span class="tl-name${x.id === TL.entity?.id ? " is-focus" : ""}">${esc(x.name)}</span>` : "");
  if (e.category === "life") return name(parts.a);
  return `${name(parts.a)} <span class="tl-phrase">${esc(parts.phrase)}</span> ${parts.text ? `<span class="tl-name">${esc(parts.text)}</span>` : name(parts.b)}`;
}
function tlTitleText(e, parts = tlParts(e)) {
  if (parts.title !== undefined) return parts.title;
  if (e.category === "life") return parts.a?.name || "";
  return [parts.a?.name, parts.phrase, parts.text || parts.b?.name].filter(Boolean).join(" ");
}
function tlTag(e) {
  if (e.category === "event") return t(TL.data.categories[e.type] || cap(e.type));
  if (e.category === "life") return cap(t(e.phrase));
  return { start: t("Began"), end: t("Ended"), record: t("Undated") }[e.moment];
}
/** "17 May 1990", "May 1990", "1990" (with "about"), or how it is unknown. */
function tlDate(value, approximate = false) {
  if (!value) return t("Date unknown");
  if (value.startsWith("--")) return t("{date}, year unknown", { date: formatPartial(value) });
  const text = formatPartial(value);
  return approximate ? t("About {date}", { date: text }) : text;
}
function tlPrecision(value) {
  if (!value) return t("Date unknown");
  if (value.startsWith("--")) return t("Day and month known");
  return { 4: t("Year only"), 7: t("Month and year"), 10: t("Exact date") }[value.length];
}
/** The short date beside an entry, within its year heading. */
function tlWhen(e) {
  const v = e.date;
  if (!v || v.startsWith("--")) return "";
  const [y, m, d] = v.split("-").map(Number);
  const text = d ? fmt({ day: "numeric", month: "short" }, y, m, d) : m ? fmt({ month: "short" }, y, m, 1) : "";
  return e.approximate ? `${t("c.")} ${text || y}` : text;
}
function tlSpan(from, until) {
  const a = tlYear(from);
  const b = until ? tlYear(until) : new Date().getFullYear();
  if (!a || !b || b < a) return "";
  const n = b - a;
  return n < 1 ? "" : until ? plural(n, "{count} year", "{count} years") : plural(n, "{count} year so far", "{count} years so far");
}
/** The quiet second line: kind, period context, certainty, sources. */
function tlSub(e) {
  const bits = [];
  if (e.category === "relationship") bits.push(t(REL_CATEGORIES()[tlType(e).category] || "Relationship"));
  else if (e.category === "event") {
    const parts = tlParts(e);
    if (parts.people.length) bits.push(parts.people.map((p) => p.name).join(", "));
  } else bits.push(t(TL_CATEGORY[e.category].noun));
  if (e.detail && !(e.category === "employment" && !tlParts(e).b)) bits.push(e.category === "relationship" ? `“${e.detail}”` : e.detail);
  const [from, until] = tlPeriod(e);
  if (e.moment === "start") {
    if (until) bits.push(t("until {date}", { date: formatPartial(until) }));
    else if (e.state === "former") bits.push(t("ended, date unknown"));
    else if (e.state === "unknown") bits.push(t("whether it continues is not recorded"));
    else bits.push(t("ongoing"));
    const span = tlSpan(from, until);
    if (span && (until || e.ongoing)) bits.push(span);
  }
  if (e.moment === "end") bits.push(from ? t("since {date}", { date: formatPartial(from) }) : t("start not recorded"));
  if (e.moment === "span") bits.push(e.end ? t("until {date}", { date: formatPartial(e.end) }) : t("ongoing"));
  if (e.confidence === "low") bits.push(t("uncertain"));
  if (e.confidence === "unknown") bits.push(t("certainty unknown"));
  if (e.sources) bits.push(plural(e.sources, "{count} source", "{count} sources"));
  return bits.filter(Boolean);
}

/* ── Filtering and grouping ── */

function tlVisible(e) {
  const f = TL.filter;
  const kinds = (e.entities || []).map((i) => TL.data.entities[i]?.[1]);
  if (kinds.length && !kinds.some((k) => f.kinds.has(k))) return false;
  if (f.categories && !f.categories.has(e.category)) return false;
  const period = ["relationship", "membership", "employment"].includes(e.category);
  if (period && f.status === "current" && !(e.state === "current" && e.moment !== "end")) return false;
  if (period && f.status === "ended" && e.state !== "former") return false;
  return true;
}
function tlInRange(e) {
  const f = TL.filter;
  if (!f.from && !f.to) return true;
  const y = tlYear(e.date);
  return y !== null && (!f.from || y >= +f.from) && (!f.to || y <= +f.to);
}
function tlFiltered() {
  const d = TL.data;
  const dated = d.entries.filter((e) => tlVisible(e) && tlInRange(e));
  const undated = TL.filter.from || TL.filter.to ? [] : d.undated.filter(tlVisible);
  return { dated, undated };
}
const tlActive = () => {
  const f = TL.filter;
  return 3 - f.kinds.size + (f.categories ? 1 : 0) + (f.status !== "all" ? 1 : 0) + (f.from || f.to ? 1 : 0);
};
/** Years, each with its year-only group first ("During 1990") and then its months. */
function tlYears(dated) {
  const years = new Map();
  for (const e of dated) {
    const y = e.date.slice(0, 4);
    const m = e.date.length >= 7 ? e.date.slice(5, 7) : "00";
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(e);
  }
  return years;
}
function tlCounts(list) {
  const counts = {};
  for (const e of list) counts[e.category] = (counts[e.category] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/* ── View ── */

async function viewTimeline(sheet, token) {
  const entity = TL.entity;
  const data = await api("/timeline" + query({ entity: entity?.id || "" }));
  if (stale(token)) return;
  TL.data = data;
  if (entity) {
    const me = data.entities.find((x) => x[0] === entity.id);
    if (me) entity.name = me[2];
  }
  const total = data.entries.length + data.undated.length;
  if (!TL.mode) TL.mode = data.entries.length > TL_OVERVIEW_AT ? "overview" : "detail";
  setTitle(entity ? [{ label: t("Timeline"), view: "timeline" }, { label: entity.name }] : [{ label: t("Timeline") }]);
  const span = data.entries.length ? `${data.entries[0].date.slice(0, 4)}–${data.entries[data.entries.length - 1].date.slice(0, 4)}` : "";
  sheet.innerHTML = `<div class="page tl-page" id="tl-page">
    <header class="tl-head">
      <div class="tl-heading"><p class="eyebrow">${esc(entity ? t("Timeline · {kind}", { kind: t(KIND_NOUN[entity.kind]) }) : t("Everyone in Meridian"))}</p>
        <h2 class="display" data-heading tabindex="-1">${esc(entity ? t("{name} over time", { name: entity.name }) : t("History"))}</h2>
        <p class="meta-line" id="tl-meta">${[plural(total, "{count} entry", "{count} entries"), span, data.undated.length ? plural(data.undated.length, "{count} without a date", "{count} without a date") : ""].filter(Boolean).map(esc).join(DOT)}</p></div>
      <div class="tl-tools" role="toolbar" aria-label="${esc(t("Timeline tools"))}">
        <div class="tl-focus">${entity ? `<span class="tl-chip">${avatar(entity.name, entity.id, `sm is-${entity.kind}`)}<span>${esc(entity.name)}</span><button class="tl-chip-x" data-act="tl-unfocus" aria-label="${esc(t("Show everyone"))}" title="${esc(t("Show everyone"))}">${icon("x")}</button></span>` : `<div class="search-box tl-search">${icon("search")}<input class="ae-input" id="tl-q" type="search" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="tl-results" placeholder="${esc(t("Focus on someone"))}" aria-label="${esc(t("Focus the timeline on a person, organization or group"))}" maxlength="200" autocomplete="off"><kbd class="ae-kbd" aria-hidden="true">/</kbd><div class="search-results" id="tl-results" role="listbox" hidden></div></div>`}</div>
        <div class="tl-filter-wrap"><button class="ae-btn" data-act="tl-filters" aria-expanded="false" aria-controls="tl-filters">${icon("names")}<span>${esc(t("Filters"))}</span><span class="badge" id="tl-filter-count" hidden></span></button>
          <div class="tl-filters" id="tl-filters" hidden role="group" aria-label="${esc(t("Timeline filters"))}">${tlFilterBody()}</div></div>
        ${segmented("tl-mode", t("Detail"), [["overview", t("Overview")], ["detail", t("Detail")]], TL.mode)}
        <button class="ae-btn ae-btn--primary" data-act="tl-new-event" aria-label="${esc(t("New event"))}" title="${esc(t("New event"))}">${icon("plus")}<span>${esc(t("New event"))}</span></button>
      </div>
    </header>
    <div class="tl-body">
      <nav class="tl-rail" id="tl-rail" aria-label="${esc(t("Years"))}"></nav>
      <div class="tl-stream" id="tl-stream"></div>
      <aside class="tl-detail" id="tl-detail" aria-label="${esc(t("Entry details"))}" hidden></aside>
    </div>
    <p class="sr-only" id="tl-live" aria-live="polite"></p>
  </div>`;
  if (!entity) tlBindSearch();
  tlBindFilters();
  tlRender();
  const pending = TL.pending;
  TL.pending = null;
  if (pending) tlSelect(pending, { scroll: true });
  else if (TL.selected) tlSelect(TL.selected, { scroll: false });
  else tlShowKey();
  if (TL.scroll && !pending) for (const el of [$("#sheet"), document.scrollingElement]) if (el) el.scrollTop = TL.scroll;
}
function saveTimelineState() {
  TL.scroll = Math.max($("#sheet")?.scrollTop || 0, document.scrollingElement?.scrollTop || 0);
}

function tlFilterBody() {
  const d = TL.data;
  const all = [...d.entries, ...d.undated];
  const kindsIn = new Set(all.flatMap((e) => (e.entities || []).map((i) => d.entities[i]?.[1])));
  const cats = tlCounts(all);
  const hasPeriods = all.some((e) => ["relationship", "membership", "employment"].includes(e.category));
  const f = TL.filter;
  const kindRow = (k, label) => (kindsIn.has(k) ? `<label class="check"><input type="checkbox" data-tl-kind="${k}" ${f.kinds.has(k) ? "checked" : ""}>${glyph(k)}<span>${esc(t(label))}</span></label>` : "");
  return `<fieldset><legend>${esc(t("Involving"))}</legend>${kindRow("p", "People")}${kindRow("o", "Organizations")}${kindRow("g", "Groups")}</fieldset>
    ${cats.length > 1 ? `<fieldset><legend>${esc(t("What"))}</legend>${cats.map(([c, n]) => `<label class="check"><input type="checkbox" data-tl-cat="${c}" ${!f.categories || f.categories.has(c) ? "checked" : ""}>${tlMark({ category: c, moment: "start", group: "social" }, 14)}<span>${esc(t(TL_CATEGORY[c].label))}</span><span class="n">${n}</span></label>`).join("")}</fieldset>` : ""}
    ${hasPeriods ? `<fieldset><legend>${esc(t("Connections"))}</legend>${segmented("tl-status", t("Connections"), [["all", t("All")], ["current", t("Still in effect")], ["ended", t("Ended")]], f.status)}<p class="ae-hint">${esc(t("Applies to relationships, memberships and work."))}</p></fieldset>` : ""}
    <fieldset><legend>${esc(t("Years"))}</legend><div class="tl-years-in"><input class="ae-input" id="tl-from" inputmode="numeric" maxlength="4" placeholder="${esc(t("From"))}" aria-label="${esc(t("From year"))}" value="${esc(f.from)}"><span aria-hidden="true">–</span><input class="ae-input" id="tl-to" inputmode="numeric" maxlength="4" placeholder="${esc(t("To"))}" aria-label="${esc(t("To year"))}" value="${esc(f.to)}"></div><p class="ae-hint">${esc(t("Entries without a date are hidden while a range is set."))}</p></fieldset>
    <button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="tl-reset">${esc(t("Reset filters"))}</button>`;
}
function tlBindFilters() {
  const box = $("#tl-filters");
  box.addEventListener("change", (event) => {
    const f = TL.filter;
    const kind = event.target.dataset.tlKind;
    const cat = event.target.dataset.tlCat;
    if (kind) event.target.checked ? f.kinds.add(kind) : f.kinds.delete(kind);
    if (cat) {
      const all = $$("[data-tl-cat]", box).map((el) => el.dataset.tlCat);
      f.categories = new Set($$("[data-tl-cat]:checked", box).map((el) => el.dataset.tlCat));
      if (f.categories.size === all.length) f.categories = null;
    }
    tlRender({ announce: true });
  });
  const years = debounce(() => {
    const read = (el) => (/^\d{4}$/.test(el.value.trim()) ? el.value.trim() : "");
    TL.filter.from = read($("#tl-from"));
    TL.filter.to = read($("#tl-to"));
    tlRender({ announce: true });
  }, 250);
  $("#tl-from").addEventListener("input", years);
  $("#tl-to").addEventListener("input", years);
}
function tlBindSearch() {
  const input = $("#tl-q");
  const box = $("#tl-results");
  let items = [];
  let active = -1;
  const show = (open) => {
    box.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };
  input.addEventListener("input", () => {
    const q = foldText(input.value);
    if (!q) return show(false);
    const count = new Map();
    for (const e of TL.data.entries.concat(TL.data.undated)) for (const i of e.entities || []) count.set(i, (count.get(i) || 0) + 1);
    items = TL.data.entities
      .map((x, i) => ({ id: x[0], kind: TL_KIND[x[1]], name: x[2], n: count.get(i) || 0 }))
      .filter((x) => foldText(x.name).includes(q))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
    box.innerHTML = items.length
      ? `<div class="rows">${items.map((x, i) => `<button class="row" type="button" role="option" id="tlq-${i}" aria-selected="false" data-i="${i}" tabindex="-1">${glyph(x.kind[0])}<span class="grow"><span class="primary">${highlight(x.name, input.value)}</span><span class="secondary">${esc(t(KIND_NOUN[x.kind]))} · ${esc(plural(x.n, "{count} entry", "{count} entries"))}</span></span></button>`).join("")}</div>`
      : `<p class="empty">${esc(t("No one on the timeline matches “{q}”.", { q: input.value }))}</p>`;
    active = -1;
    show(true);
  });
  input.addEventListener("keydown", (event) => {
    const mark = (i) => {
      active = i;
      $$(".row", box).forEach((r, n) => r.classList.toggle("is-active", n === i) || r.setAttribute("aria-selected", String(n === i)));
      input.setAttribute("aria-activedescendant", `tlq-${i}`);
    };
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      mark((active + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      mark((active - 1 + items.length) % items.length);
    } else if (event.key === "Enter" && items.length) {
      event.preventDefault();
      tlFocusEntity(items[Math.max(0, active)]);
    } else if (event.key === "Escape" && !box.hidden) {
      event.stopPropagation();
      show(false);
    }
  });
  box.addEventListener("mousedown", (event) => event.preventDefault());
  box.addEventListener("click", (event) => {
    const row = event.target.closest("[data-i]");
    if (row) tlFocusEntity(items[+row.dataset.i]);
  });
  input.addEventListener("blur", () => setTimeout(() => show(false), 120));
}
function tlFocusEntity(x, entryId = null) {
  TL.entity = x ? { id: x.id, kind: x.kind, name: x.name || x.display_name } : null;
  TL.selected = null;
  TL.pending = entryId;
  TL.scroll = 0;
  TL.open.clear();
  TL.more.clear();
  TL.mode = null;
  return state.route.view === "timeline" ? render() : go("timeline");
}

/** One entry row: date, marker, tag, sentence, and a quiet line of context. */
function tlRow(e, { compact = false } = {}) {
  const parts = tlParts(e);
  const sub = tlSub(e);
  const label = [tlDate(e.date, e.approximate), tlTag(e), tlTitleText(e, parts), ...sub].join(", ");
  return `<li class="tl-entry m-${e.moment} c-${e.category}${e.ongoing ? " is-ongoing" : ""}${e.state === "former" ? " is-past" : ""}" style="--hue:${tlHue(e)}">
    <button class="tl-item${TL.selected === e.id ? " is-selected" : ""}" data-act="tl-select" data-entry="${esc(e.id)}" tabindex="-1" aria-label="${esc(label)}" aria-pressed="${TL.selected === e.id}">
      <span class="tl-when">${esc(tlWhen(e))}</span>
      <span class="tl-mark">${tlMark(e)}</span>
      <span class="tl-text"><span class="tl-line"><span class="tl-tag">${esc(tlTag(e))}</span>${tlTitleHtml(e, parts)}</span>${!compact && sub.length ? `<span class="tl-sub">${sub.map(esc).join(" · ")}</span>` : ""}</span>
    </button></li>`;
}
/** The overview of a year: what kinds of things happened, and its most telling entries. */
function tlYearSummary(list) {
  return tlCounts(list)
    .map(([c, n]) => `<span class="tl-count" style="--hue:${tlHue({ category: c, group: "social" })}">${tlMark({ category: c, moment: "start", group: "social" }, 12)}${esc(plural(n, ...TL_COUNT[c]))}</span>`)
    .join("");
}
const TL_WEIGHT = { event: 0, life: 1, relationship: 2, membership: 3, employment: 3 };
const TL_LAZY_AT = 600; // above this many entries, Detail builds years as they come near

/** A year's entries: in Overview its most telling few, in Detail every month group. */
function tlYearBody(y, months, list = [...months.values()].flat()) {
  let html = "";
  if (TL.mode === "overview" && !TL.open.has(y)) {
    const telling = [...list].sort((a, b) => TL_WEIGHT[a.category] - TL_WEIGHT[b.category]).slice(0, 3);
    const keep = new Set(telling.map((e) => e.id));
    return `<ol class="tl-entries">${list.filter((e) => keep.has(e.id)).map((e) => tlRow(e, { compact: true })).join("")}</ol>${list.length > 3 ? `<button class="ae-btn ae-btn--sm ae-btn--quiet tl-more" data-act="tl-open-year" data-year="${y}" aria-expanded="false">${esc(t("Show all {n} in {year}", { n: list.length, year: y }))}</button>` : ""}`;
  }
  // Month labels help in a busy year; in a quiet one the dates beside entries suffice.
  const labelled = list.length >= 3 && (months.size > 1 || !months.has("00"));
  for (const [m, entries] of months) {
    const key = `${y}-${m}`;
    const full = TL.more.has(key) || entries.length <= TL_DETAIL_LIMIT + 1;
    const shown = full ? entries : entries.slice(0, TL_DETAIL_LIMIT);
    const label = m === "00" ? t("During {year}", { year: y }) : fmt({ month: "long" }, +y, +m, 1);
    html += `<div class="tl-group${m === "00" ? " is-year" : ""}">${labelled ? `<p class="tl-month">${esc(label)}${m === "00" ? `<span class="tl-month-note">${esc(t("day and month not recorded"))}</span>` : ""}</p>` : ""}<ol class="tl-entries">${shown.map((e) => tlRow(e)).join("")}</ol>${full ? "" : `<button class="ae-btn ae-btn--sm ae-btn--quiet tl-more" data-act="tl-more" data-key="${key}">${esc(t("Show {n} more from {when}", { n: entries.length - shown.length, when: m === "00" ? y : `${label} ${y}` }))}</button>`}</div>`;
  }
  if (TL.mode === "overview") html += `<button class="ae-btn ae-btn--sm ae-btn--quiet tl-more" data-act="tl-open-year" data-year="${y}" aria-expanded="true">${esc(t("Show less of {year}", { year: y }))}</button>`;
  return html;
}
/** The height a year will take once built, so the scrollbar and jumps stay honest. */
function tlEstimate(y, months) {
  let rows = 0;
  for (const [m, entries] of months) rows += (TL.more.has(`${y}-${m}`) || entries.length <= TL_DETAIL_LIMIT + 1 ? entries.length : TL_DETAIL_LIMIT + 0.6) + 0.5;
  return Math.round(rows * 58);
}
/** Build a waiting year now (it came near, or something needs its entries). */
function tlFill(y) {
  const slot = $(`.tl-pending[data-year="${CSS.escape(String(y))}"]`);
  if (!slot || !TL.view?.has(y)) return false;
  slot.outerHTML = tlYearBody(y, TL.view.get(y));
  return true;
}
let tlFiller = null;
function tlWatchPending() {
  tlFiller?.disconnect();
  const slots = $$("#tl-stream .tl-pending");
  if (!slots.length || !("IntersectionObserver" in window)) return slots.forEach((s) => tlFill(s.dataset.year));
  tlFiller = new IntersectionObserver(
    (seen) => {
      for (const x of seen) if (x.isIntersecting) tlFill(x.target.dataset.year);
    },
    { root: innerWidth <= 640 ? null : $("#sheet"), rootMargin: "1600px 0px" },
  );
  slots.forEach((s) => tlFiller.observe(s));
}

function tlRender({ announce = false } = {}) {
  const stream = $("#tl-stream");
  if (!stream || !TL.data) return;
  const { dated, undated } = tlFiltered();
  const years = tlYears(dated);
  const badge = $("#tl-filter-count");
  const active = tlActive();
  if (badge) {
    badge.hidden = !active;
    badge.textContent = active;
  }
  if (!dated.length && !undated.length) {
    const nothing = !TL.data.entries.length && !TL.data.undated.length;
    stream.innerHTML = nothing
      ? emptyState("calendar", TL.entity ? t("Nothing dated about {name} yet", { name: TL.entity.name }) : t("No history yet"), t("The timeline shows when relationships, memberships and work began and ended, life dates such as birthdays, and events you record."), `<button class="ae-btn ae-btn--primary" data-act="tl-new-event">${icon("plus")}<span>${esc(t("New event"))}</span></button>`)
      : emptyState("calendar", t("Nothing matches these filters"), t("{n} entries are hidden by the current filters.", { n: TL.data.entries.length + TL.data.undated.length }), `<button class="ae-btn" data-act="tl-reset">${esc(t("Reset filters"))}</button>`);
    $("#tl-rail").innerHTML = "";
    if (announce) $("#tl-live").textContent = t("Nothing matches these filters");
    return;
  }
  // Year rail: every year with entries, its density as a quiet bar.
  const max = Math.max(1, ...[...years.values()].map((m) => [...m.values()].reduce((s, l) => s + l.length, 0)));
  const yearList = [...years.keys()];
  $("#tl-rail").innerHTML = `<ol>${yearList
    .map((y, i) => {
      const n = [...years.get(y).values()].reduce((s, l) => s + l.length, 0);
      const gap = i > 0 && +y - +yearList[i - 1] > 1;
      return `${gap ? '<li class="tl-rail-gap" aria-hidden="true"></li>' : ""}<li><button class="tl-rail-year" data-act="tl-year" data-year="${y}" aria-label="${esc(t("{year}, {n}", { year: y, n: plural(n, "{count} entry", "{count} entries") }))}"><span class="y">${y}</span><span class="bar" style="--w:${Math.max(8, Math.round((n / max) * 100))}%"></span></button></li>`;
    })
    .join("")}${undated.length ? `<li><button class="tl-rail-year is-undated" data-act="tl-year" data-year="undated"><span class="y">${esc(t("Undated"))}</span></button></li>` : ""}</ol>`;
  // The stream, oldest first. Quiet stretches between years are shown, not hidden.
  TL.view = years;
  const lazy = TL.mode === "detail" && dated.length > TL_LAZY_AT;
  let html = "";
  let previous = null;
  for (const [y, months] of years) {
    const list = [...months.values()].flat();
    if (previous && +y - previous > 1) {
      const quiet = +y - previous - 1;
      html += `<div class="tl-gap" aria-hidden="true"><span>${esc(plural(quiet, "{count} quiet year", "{count} quiet years"))}</span></div>`;
    }
    previous = +y;
    const overview = TL.mode === "overview" && !TL.open.has(y);
    // A large timeline in Detail builds a year's entries only as it comes near (tlFill).
    const deferred = lazy && !overview;
    html += `<section class="tl-year${overview ? " is-overview" : ""}" data-year="${y}" aria-labelledby="tl-y-${y}">
      <h3 class="tl-year-head" id="tl-y-${y}"><span class="tl-year-num">${y}</span>${list.length > 1 || overview ? `<span class="tl-year-sum">${tlYearSummary(list)}</span>` : ""}</h3>
      ${deferred ? `<div class="tl-pending" data-year="${y}" style="height:${tlEstimate(y, months)}px" aria-hidden="true"></div>` : tlYearBody(y, months, list)}</section>`;
  }
  if (undated.length) {
    html += `<section class="tl-year tl-undated" data-year="undated" aria-labelledby="tl-y-undated"><h3 class="tl-year-head" id="tl-y-undated"><span class="tl-year-num">${esc(t("Date unknown"))}</span><span class="tl-year-sum"><span class="tl-count">${esc(t("Recorded without a date, or with a day and month only. Nothing is guessed."))}</span></span></h3>
      ${TL.undated || undated.length <= 4 ? `<ol class="tl-entries">${undated.map((e) => tlRow(e)).join("")}</ol>` : `<button class="ae-btn ae-btn--sm ae-btn--quiet tl-more" data-act="tl-undated" aria-expanded="false">${esc(plural(undated.length, "Show {count} undated entry", "Show {count} undated entries"))}</button>`}</section>`;
  }
  stream.innerHTML = html;
  stream.classList.toggle("is-large", dated.length + undated.length > 400);
  tlWatchYears();
  tlWatchPending();
  // One entry is reachable with Tab; arrow keys move between entries (roving focus).
  const items = $$(".tl-item", stream);
  const current = items.find((b) => b.dataset.entry === TL.selected) || items[0];
  if (current) current.tabIndex = 0;
  if (announce) $("#tl-live").textContent = plural(dated.length + undated.length, "{count} entry shown", "{count} entries shown");
}

/* ── Selection and details ── */

function tlAll() {
  const { dated, undated } = tlFiltered();
  return [...dated, ...undated];
}
function tlEntry(id) {
  return TL.data && [...TL.data.entries, ...TL.data.undated].find((e) => e.id === id);
}
/** Make sure an entry is rendered (its year open, its month group full), then select it. */
async function tlSelect(id, { scroll = true, focus = false } = {}) {
  const e = tlEntry(id);
  if (!e) return;
  TL.selected = id;
  // Keep keyboard focus on the entry: re-rendering would otherwise drop it to the page.
  const hadFocus = !!document.activeElement?.classList?.contains("tl-item");
  if (!$(`.tl-item[data-entry="${CSS.escape(id)}"]`)) {
    // Not on screen yet: open its year (Overview) or its month group, or the undated list.
    const y = e.date && !e.date.startsWith("--") ? e.date.slice(0, 4) : null;
    if (y) {
      if (TL.mode === "overview") TL.open.add(y);
      TL.more.add(`${y}-${e.date.length >= 7 ? e.date.slice(5, 7) : "00"}`);
    } else TL.undated = true;
    if (!(y && tlFill(y))) {
      tlRender();
      if (y) tlFill(y);
    }
  }
  $$(".tl-item.is-selected").forEach((b) => b.classList.remove("is-selected") || b.setAttribute("aria-pressed", "false"));
  const button = $(`.tl-item[data-entry="${CSS.escape(id)}"]`);
  if (button) {
    $$(".tl-item").forEach((b) => (b.tabIndex = -1));
    button.tabIndex = 0;
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    if (scroll) tlReveal(button);
    if (focus || hadFocus) button.focus({ preventScroll: true });
  }
  await tlDetails(e);
}
let tlToken = 0;
async function tlDetails(e) {
  const box = $("#tl-detail");
  if (!box) return;
  const mine = ++tlToken;
  const narrow = innerWidth < 1100;
  box.hidden = false;
  box.classList.toggle("is-sheet", narrow);
  const parts = tlParts(e);
  box.innerHTML = tlDetailHead(e, parts) + `<div class="tl-detail-body"><p class="gp-hint">${esc(t("Loading…"))}</p></div>`;
  if (narrow) {
    document.body.classList.add("tl-sheet-open");
    animate(box, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], MOTION.panel);
  }
  $("#tl-live").textContent = `${tlTag(e)}: ${tlTitleText(e, parts)}, ${tlDate(e.date, e.approximate)}`;
  let full;
  try {
    full = await api("/timeline/entry" + query({ id: e.id }));
  } catch (error) {
    if (mine === tlToken) $(".tl-detail-body", box).innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    return;
  }
  if (mine !== tlToken) return;
  $(".tl-detail-body", box).innerHTML = tlDetailBody(e, full);
}
function tlDetailHead(e, parts) {
  const list = tlAll();
  const i = list.findIndex((x) => x.id === e.id);
  return `<div class="tl-detail-head" style="--hue:${tlHue(e)}">
    <span class="tl-detail-mark">${tlMark(e, 22)}</span>
    <p class="tl-detail-eyebrow">${esc(tlTag(e))}${e.category !== "event" && e.category !== "life" ? ` · ${esc(t(TL_CATEGORY[e.category].noun))}` : ""}</p>
    <div class="tl-detail-nav"><button class="graph-tool is-icon" data-act="tl-step" data-step="-1" ${i <= 0 ? "disabled" : ""} aria-label="${esc(t("Earlier entry"))}" title="${esc(t("Earlier entry"))}">‹</button><button class="graph-tool is-icon" data-act="tl-step" data-step="1" ${i < 0 || i >= list.length - 1 ? "disabled" : ""} aria-label="${esc(t("Later entry"))}" title="${esc(t("Later entry"))}">›</button><button class="graph-tool is-icon" data-act="tl-close" aria-label="${esc(t("Close details"))}" title="${esc(t("Close details"))}">${icon("x")}</button></div>
  </div><h3 class="tl-detail-title" tabindex="-1">${tlTitleHtml(e, parts)}</h3>`;
}
function tlWhenBlock(e) {
  const rows = [];
  const line = (label, value, note = "") => `<div class="tl-fact"><span class="k">${esc(label)}</span><span class="v">${esc(value)}${note ? `<span class="note">${esc(note)}</span>` : ""}</span></div>`;
  if (["relationship", "membership", "employment"].includes(e.category)) {
    const [from, until] = tlPeriod(e);
    rows.push(line(t("Began"), tlDate(from), from ? tlPrecision(from) : t("not recorded")));
    if (until) rows.push(line(t("Ended"), tlDate(until), tlPrecision(until)));
    else rows.push(line(t("Now"), e.state === "former" ? t("Ended, date unknown") : e.state === "unknown" ? t("Not known whether it continues") : t("Ongoing")));
    const span = tlSpan(from, until);
    if (span) rows.push(line(t("Length"), span, t("from the years recorded")));
  } else if (e.moment === "span") {
    rows.push(line(t("From"), tlDate(e.date, e.approximate), tlPrecision(e.date)));
    rows.push(line(t("Until"), e.end ? tlDate(e.end, e.approximate) : t("Ongoing"), e.end ? tlPrecision(e.end) : ""));
  } else {
    rows.push(line(t("When"), tlDate(e.date, e.approximate), e.date && !e.date.startsWith("--") ? tlPrecision(e.date) + (e.approximate ? ` · ${t("approximate")}` : "") : ""));
  }
  return rows.join("");
}
function tlDetailBody(e, full) {
  const ids = (full.entities || []).map((x) => x.id);
  const people = (full.entities || [])
    .map((x) => `<li class="tl-person"><button class="tl-person-open" data-act="open-entity" data-id="${esc(x.id)}" data-kind="${x.kind}">${avatar(x.display_name, x.id, `sm is-${x.kind}`)}<span class="grow"><span class="primary">${esc(x.display_name)}</span><span class="secondary">${esc(t(KIND_NOUN[x.kind]))}${full.roles?.[x.id] ? ` · ${esc(full.roles[x.id])}` : ""}</span></span></button>
      <span class="acts">${TL.entity?.id === x.id ? "" : `<button class="graph-tool is-icon" data-act="tl-focus" data-id="${esc(x.id)}" data-kind="${x.kind}" data-name="${esc(x.display_name)}" aria-label="${esc(t("{name} over time", { name: x.display_name }))}" title="${esc(t("{name} over time", { name: x.display_name }))}">${icon("calendar")}</button>`}<button class="graph-tool is-icon" data-act="tl-graph" data-id="${esc(x.id)}" aria-label="${esc(t("Show {name} in the graph", { name: x.display_name }))}" title="${esc(t("Show in the graph"))}">${icon("graph")}</button></span></li>`)
    .join("");
  const notes = [full.description, full.note].filter(Boolean);
  const context = e.detail ? (e.category === "relationship" ? `“${e.detail}”` : e.detail) : "";
  const sources = (full.sources || []).map((s) => `<li>${esc(t(SOURCE_KINDS[s.kind] || cap(s.kind)))}${s.entity_name || s.label ? ` · ${esc(s.entity_name && !s.label ? s.entity_name : s.label)}` : ""}${s.learned ? ` · ${esc(t("learned {date}", { date: formatPartial(s.learned) }))}` : ""}</li>`);
  const authority = {
    relationship: [t("This is a relationship record. Edit it on the profile, where its period, certainty and sources live."), t("Edit relationship")],
    membership: [t("This is a group membership. Edit it on the profile."), t("Edit membership")],
    employment: [t("This comes from a work record on the profile."), t("Edit work")],
    date: [t("This comes from a date on the profile."), t("Edit dates")],
  }[full.record];
  return `<div class="tl-facts">${tlWhenBlock(e)}${context ? `<div class="tl-fact"><span class="k">${esc(e.category === "membership" ? t("Role") : e.category === "employment" ? t("Role") : t("In their words"))}</span><span class="v">${esc(context)}</span></div>` : ""}
      <div class="tl-fact"><span class="k">${esc(t("Certainty"))}</span><span class="v">${esc(t(TL_CONFIDENCE[full.confidence] || "Not stated"))}</span></div></div>
    ${people ? `<p class="gp-label">${esc(t("Involved"))}</p><ul class="tl-people">${people}</ul>` : ""}
    ${notes.length ? `<p class="gp-label">${esc(full.record === "event" ? t("Description") : t("Note"))}</p>${notes.map((n) => `<p class="tl-note">${esc(n)}</p>`).join("")}` : ""}
    <p class="gp-label">${esc(t("Where this comes from"))}</p>${sources.length ? `<ul class="tl-sources">${sources.join("")}</ul>` : `<p class="gp-hint">${esc(t("No source recorded."))}</p>`}
    ${full.editable
      ? `<div class="gp-actions"><button class="ae-btn ae-btn--sm" data-act="tl-edit-event" data-id="${esc(full.record_id)}">${icon("edit")}<span>${esc(t("Edit event"))}</span></button><button class="ae-btn ae-btn--sm ae-btn--quiet is-danger" data-act="tl-delete-event" data-id="${esc(full.record_id)}">${icon("trash")}<span>${esc(t("Delete"))}</span></button></div>${full.updated_at ? `<p class="gp-hint">${esc(t("Recorded {when}", { when: relativeTime(full.created_at) }))}${full.updated_at !== full.created_at ? ` · ${esc(t("changed {when}", { when: relativeTime(full.updated_at) }))}` : ""}</p>` : ""}`
      : `<div class="tl-authority"><p>${esc(authority[0])}</p><button class="ae-btn ae-btn--sm" data-act="tl-edit-record" data-entry="${esc(e.id)}" data-ids="${esc(ids.join(","))}">${icon("edit")}<span>${esc(authority[1])}</span></button></div>`}`;
}
/** With nothing selected, the details column is a key to the marks (shapes, fill, lines). */
function tlLegend() {
  const row = (e, label, note) => `<li>${tlMark(e, 18)}<span><span class="primary">${esc(label)}</span>${note ? `<span class="secondary">${esc(note)}</span>` : ""}</span></li>`;
  return `<div class="tl-key"><p class="gp-label">${esc(t("Reading the timeline"))}</p>
    <ul class="tl-key-list">
      ${row({ category: "relationship", moment: "start", group: "partner" }, t("Relationship"), t("an arc between two"))}
      ${row({ category: "membership", moment: "start" }, t("Membership"), t("a hexagon, like a group"))}
      ${row({ category: "employment", moment: "start" }, t("Work"), t("a diamond, like an organization"))}
      ${row({ category: "life", moment: "at" }, t("Life date"), t("born, died, founded, anniversaries"))}
      ${row({ category: "event", moment: "at" }, t("Event"), t("something you recorded as it happened"))}
    </ul>
    <ul class="tl-key-list">
      ${row({ category: "relationship", moment: "start", group: "social" }, t("Filled: began or happened"), "")}
      ${row({ category: "relationship", moment: "end", group: "social" }, t("Hollow: ended"), "")}
      ${row({ category: "relationship", moment: "start", group: "social", confidence: "low" }, t("Dotted: uncertain"), "")}
    </ul>
    <p class="gp-hint">${esc(t("Partial dates stay partial: a year alone is listed before that year's months, never as 1 January. Entries without a date are kept at the end."))}</p>
    <p class="gp-hint">${esc(t("Select an entry to see who was involved, how certain it is, where it comes from, and the record it belongs to. Arrow keys move between entries; Page Up and Page Down between years."))}</p></div>`;
}
function tlShowKey() {
  const box = $("#tl-detail");
  if (!box || innerWidth < 1100) return;
  box.hidden = false;
  box.classList.remove("is-sheet");
  box.innerHTML = tlLegend();
}
function tlCloseDetails() {
  const box = $("#tl-detail");
  if (!box || box.hidden) return false;
  const back = TL.selected && $(`.tl-item[data-entry="${CSS.escape(TL.selected)}"]`);
  TL.selected = null;
  $$(".tl-item.is-selected").forEach((b) => b.classList.remove("is-selected") || b.setAttribute("aria-pressed", "false"));
  box.hidden = true;
  box.innerHTML = "";
  document.body.classList.remove("tl-sheet-open");
  tlShowKey();
  back?.focus({ preventScroll: true });
  return true;
}

/* ── Going to the authoritative record ── */

/** Open the profile that owns a projected entry, with its editor. */
async function tlEditRecord(entryId, ids) {
  const full = await api("/timeline/entry" + query({ id: entryId }));
  saveTimelineState();
  const owner = { relationship: TL.entity && ids.includes(TL.entity.id) ? TL.entity.id : full.subject_id, membership: full.member_id, employment: full.person_id, date: full.entity_id }[full.record];
  const kind = (full.entities || []).find((x) => x.id === owner)?.kind || "person";
  state.pendingEdit = { record: full.record, id: full.record_id };
  return go(kind === "person" ? "person" : "entity", owner, kind);
}
/** Called by the profile once it is shown: open the editor a Timeline entry asked for. */
function runPendingEdit() {
  const pending = state.pendingEdit;
  state.pendingEdit = null;
  if (!pending || !state.person) return;
  requestAnimationFrame(() => {
    if (pending.record === "relationship") {
      const record = state.person.relationships.find((r) => r.id === pending.id);
      if (record) openRelation(record, null);
    } else if (pending.record === "membership") {
      const record = state.person.memberships.find((m) => m.id === pending.id);
      if (record) openMembership(record, null);
    } else if (pending.record === "employment") openPanel("employments");
    else if (pending.record === "date") openPanel("dates");
  });
}

/* ── Native events: create, edit, delete ── */

const evEditor = { record: null, participants: [], allowSimilar: false, after: null };
async function openEvent(record = null, { with: preset = [], invoker = null, after = null } = {}) {
  if (panel.isDirty() && !(await confirmDiscard())) return;
  const cats = TL.data?.categories || (await api("/event-categories")).categories;
  evEditor.record = record;
  evEditor.allowSimilar = false;
  evEditor.after = after;
  evEditor.participants = record ? record.participants.map((p) => ({ ...p.entity, role: p.role })) : preset.map((x) => ({ ...x, role: "" }));
  panel.invoker = invoker && invoker.isConnected ? invoker : panel.invoker;
  openShell("event", {
    eyebrow: t("Timeline"),
    title: record ? t("Event") : t("New event"),
    body: `<p class="ae-hint">${esc(t("For things no relationship, membership or work record already says: a first meeting, a graduation, a move, a founding."))}</p>
      <div class="ae-field"><label class="ae-label" for="ev-title">${esc(t("What happened"))}</label><input class="ae-input" id="ev-title" maxlength="200" value="${esc(record?.title || "")}" placeholder="${esc(t("e.g. “Graduated from university”, “Moved to Vienna”"))}"></div>
      <div class="ae-field"><label class="ae-label" for="ev-cat">${esc(t("Kind"))}</label><select class="ae-select" id="ev-cat">${Object.entries(cats).map(([k, l]) => `<option value="${k}" ${(record?.category || "milestone") === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}${record && !cats[record.category] ? `<option value="${esc(record.category)}" selected>${esc(cap(record.category))}</option>` : ""}</select></div>
      <fieldset class="rel-period"><legend class="ae-label">${esc(t("When"))}</legend>
        <div class="rel-period-grid">
          <div class="ae-field"><span class="ae-label">${esc(t("Date"))}</span>${dateInput("ev-starts", record?.starts)}</div>
          <div class="ae-field"><span class="ae-label">${esc(t("Until (optional)"))}</span>${dateInput("ev-ends", record?.ends)}</div>
        </div>
        <label class="check"><input type="checkbox" id="ev-ongoing" ${record?.ongoing ? "checked" : ""}><span>${esc(t("Still going on"))}</span></label>
        <label class="check"><input type="checkbox" id="ev-approx" ${record?.approximate ? "checked" : ""}><span>${esc(t("The date is approximate"))}</span></label>
        <p class="ae-hint">${esc(t("Leave unknown parts empty: a year alone, or a month and year, is fine. Leave it all empty if the date is not known."))}</p></fieldset>
      <div class="ae-field"><span class="ae-label">${esc(t("Who or what was involved"))}</span><ul class="ev-people" id="ev-people"></ul>${entityPicker("ev-add", { kinds: ["person", "organization", "group"], label: t("Add a person, organization or group") })}</div>
      <div class="ae-field"><label class="ae-label" for="ev-desc">${esc(t("Description (optional)"))}</label><textarea class="ae-textarea" id="ev-desc" rows="4" maxlength="4000">${esc(record?.description || "")}</textarea></div>
      <div class="ae-field"><label class="ae-label" for="rel-confidence">${esc(t("How sure are you?"))}</label><select class="ae-select" id="rel-confidence">${[["", "Not stated"], ["high", "Sure"], ["medium", "Fairly sure"], ["low", "Uncertain"], ["unknown", "Don't know"]].map(([v, l]) => `<option value="${v}" ${(record?.confidence || "") === v ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
      <div class="rel-sources"><span class="ae-label">${esc(t("Where this comes from"))}</span><div id="src-rows">${(record?.sources || []).map(sourceRow).join("")}</div>
        <button class="ae-btn ae-btn--sm" data-act="src-add">${icon("plus")}<span>${esc(t("Add a source"))}</span></button></div>
      <div id="ev-similar" hidden></div>`,
    foot: record ? `<button class="ae-btn ae-btn--quiet is-danger" data-act="tl-delete-event" data-id="${esc(record.id)}">${icon("trash")}<span>${esc(t("Delete"))}</span></button>` : "",
  });
  evPeople();
  bindPicker($("#ev-add"), {
    onPick: (x) => {
      if (!x) return;
      if (!evEditor.participants.some((p) => p.id === x.id)) evEditor.participants.push({ ...x, role: "" });
      evPeople();
      $("#ev-add")._unpick();
    },
  });
  panel.snapshot = formState() + JSON.stringify(evEditor.participants);
  $("#ev-title").focus({ preventScroll: true });
}
function evPeople() {
  const list = $("#ev-people");
  list.innerHTML = evEditor.participants.length
    ? evEditor.participants.map((p, i) => `<li class="ev-person" data-i="${i}">${avatar(p.display_name, p.id, `sm is-${p.kind}`)}<span class="grow"><span class="primary">${esc(p.display_name)}</span><input class="ae-input ae-input--sm" data-role="${i}" maxlength="80" value="${esc(p.role || "")}" placeholder="${esc(t("Role (optional)"))}" aria-label="${esc(t("Role of {name}", { name: p.display_name }))}"></span><button class="ae-btn ae-btn--quiet ae-btn--icon ae-btn--sm" data-act="ev-remove" data-i="${i}" aria-label="${esc(t("Remove {name}", { name: p.display_name }))}">${icon("x")}</button></li>`).join("")
    : `<li class="ev-empty">${esc(t("Add at least one person, organization or group."))}</li>`;
  $$("[data-role]", list).forEach((input) => input.addEventListener("input", () => (evEditor.participants[+input.dataset.role].role = input.value)));
}
const evDirty = () => !!panel.el() && formState() + JSON.stringify(evEditor.participants) !== panel.snapshot;
async function saveEvent(button, allowSimilar = false) {
  const box = $("#form-error");
  box.hidden = true;
  if (!evDirty() && !allowSimilar) return closePanel();
  try {
    const title = $("#ev-title").value.trim();
    if (!title) throw Error(t("Say what happened."));
    const starts = readDate($('[data-date="ev-starts"]'));
    const ends = readDate($('[data-date="ev-ends"]'));
    if (starts.error || ends.error) throw Error(t("When: {e}", { e: starts.error || ends.error }));
    if (!evEditor.participants.length) throw Error(t("Add at least one person, organization or group."));
    const body = {
      title,
      category: $("#ev-cat").value,
      starts: starts.value,
      ends: ends.value,
      ongoing: $("#ev-ongoing").checked,
      approximate: $("#ev-approx").checked,
      description: $("#ev-desc").value.trim(),
      confidence: $("#rel-confidence").value || null,
      participants: evEditor.participants.map((p) => ({ entity_id: p.id, role: (p.role || "").trim() })),
      sources: readSources(),
      allow_similar: allowSimilar,
    };
    button.classList.add("is-busy");
    const record = evEditor.record;
    const unchanged = record && record.starts === body.starts && record.participants.map((p) => p.entity.id).sort().join() === body.participants.map((p) => p.entity_id).sort().join();
    if (!allowSimilar && !unchanged && body.starts) {
      const check = await api("/similar-events" + query({ starts: body.starts, entities: body.participants.map((p) => p.entity_id).join(","), exclude: record?.id || "" }));
      if (check.similar.length) {
        button.classList.remove("is-busy");
        return evShowSimilar(check.similar);
      }
    }
    const saved = await api(record ? `/events/${record.id}` : "/events", record ? "PUT" : "POST", { ...body, allow_similar: true });
    button.classList.remove("is-busy");
    panel.snapshot = formState() + JSON.stringify(evEditor.participants);
    await closePanel();
    toast(record ? t("Event saved") : t("Event added to the timeline"), "good");
    const after = evEditor.after;
    if (after) return after(saved);
    if (state.route.view === "timeline") {
      TL.pending = `event:${saved.id}`;
      return render({ focus: false });
    }
  } catch (error) {
    button.classList.remove("is-busy");
    box.textContent = error.message;
    box.hidden = false;
  }
}
function evShowSimilar(similar) {
  const box = $("#ev-similar");
  const who = (x) => x.display_name;
  box.innerHTML = `<div class="notice warn">${icon("alert")}<div><p><b>${esc(t("This may already be on the timeline"))}</b></p>
    <ul class="similar-list">${similar.map((e) => `<li>${esc(e.category === "event" ? e.title : `${tlTagFor(e)} · ${(e.entities || []).map(who).join(" · ")}`)} · ${esc(tlDate(e.date, e.approximate))}</li>`).join("")}</ul>
    <p>${esc(t("A relationship, membership or work record already appears on the timeline by itself; there is no need to repeat it as an event. Save anyway if this is something else."))}</p>
    <div class="actions"><button class="ae-btn ae-btn--sm" data-act="ev-save-anyway">${esc(t("Save anyway"))}</button></div></div></div>`;
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  $('[data-act="ev-save-anyway"]', box).focus();
}
function tlTagFor(e) {
  if (e.category === "life") return cap(t(e.phrase));
  return `${{ start: t("Began"), end: t("Ended"), record: t("Undated") }[e.moment] || ""} ${t(e.phrase || "")}`.trim();
}
function deleteEvent(id) {
  return confirmAction(t("Delete this event?"), t("It is removed from the timeline and from everyone it involves. Relationships and other records are not affected."), t("Delete"), async () => {
    await api(`/events/${id}`, "DELETE");
    if (panel.el()) {
      panel.snapshot = formState() + JSON.stringify(evEditor.participants);
      await closePanel();
    }
    toast(t("Event deleted"));
    if (state.route.view === "timeline") {
      TL.selected = null;
      return render({ focus: false });
    }
    if (state.route.view === "person" || state.route.view === "entity") return tabTimelineLoad(state.person);
  });
}

/* ── On a profile: the entity's own timeline ── */

function tabTimeline(p) {
  setTimeout(() => tabTimelineLoad(p), 0);
  return `<section class="psection ptl" data-section="timeline"><div class="section-head"><h3>${icon("calendar")}${esc(t("Over time"))}</h3>
    <div class="ptl-acts"><button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="tl-profile-event">${icon("plus")}<span>${esc(t("Add event"))}</span></button><button class="ae-btn ae-btn--sm" data-act="tl-focus" data-id="${esc(p.id)}" data-kind="${p.kind}" data-name="${esc(p.display_name)}">${icon("calendar")}<span>${esc(t("Open in Timeline"))}</span></button></div></div>
    <div id="ptl-body"><p class="gp-hint">${esc(t("Loading…"))}</p></div></section>`;
}
async function tabTimelineLoad(p) {
  const body = $("#ptl-body");
  if (!body) return;
  let data;
  try {
    data = await api("/timeline" + query({ entity: p.id }));
  } catch (error) {
    body.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    return;
  }
  if (!$("#ptl-body") || state.person?.id !== p.id || state.tab !== "timeline") return;
  const saved = { data: TL.data, entity: TL.entity };
  TL.data = data;
  TL.entity = { id: p.id, kind: p.kind, name: p.display_name };
  const years = tlYears(data.entries);
  let html = "";
  for (const [y, months] of years)
    html += `<div class="ptl-year"><p class="ptl-year-num">${y}</p><ol class="tl-entries">${[...months.values()]
      .flat()
      .map((e) => tlRow(e).replace('data-act="tl-select"', 'data-act="tl-goto"').replace('tabindex="-1"', ""))
      .join("")}</ol></div>`;
  if (data.undated.length) html += `<div class="ptl-year"><p class="ptl-year-num">${esc(t("Date unknown"))}</p><ol class="tl-entries">${data.undated.map((e) => tlRow(e).replace('data-act="tl-select"', 'data-act="tl-goto"').replace('tabindex="-1"', "")).join("")}</ol></div>`;
  Object.assign(TL, saved);
  body.innerHTML = html || emptyState("calendar", t("Nothing dated yet"), t("Dates on relationships, memberships and work, life dates, and events involving {name} appear here.", { name: p.display_name }), "");
}

/** Bring an entry into view. Off-screen years of a large timeline are only estimated until
    shown, so the position is corrected once they have been laid out. */
function tlReveal(el) {
  const large = $("#tl-stream")?.classList.contains("is-large");
  // Below 1,100 px the details open as a sheet over the lower part: keep the entry above it.
  const block = innerWidth < 1100 ? "start" : "center";
  el.scrollIntoView({ block, behavior: large || reducedMotion() ? "auto" : "smooth" });
  if (large) requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ block })));
}
let tlObserver = null;
/** The rail marks the year being read. */
function tlWatchYears() {
  tlObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  const narrow = innerWidth <= 640;
  tlObserver = new IntersectionObserver(
    (seen) => {
      const top = seen.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!top) return;
      const y = top.target.dataset.year;
      $$("#tl-rail .tl-rail-year").forEach((b) => (b.dataset.year === y ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
      // Scroll only the rail itself: scrollIntoView would also move the page under the reader.
      const button = $(`#tl-rail .tl-rail-year[data-year="${CSS.escape(y)}"]`);
      const rail = $("#tl-rail");
      if (button && rail) {
        const b = button.getBoundingClientRect();
        const r = rail.getBoundingClientRect();
        if (b.top < r.top || b.bottom > r.bottom) rail.scrollTop += b.top - r.top - r.height / 3;
        if (b.left < r.left || b.right > r.right) rail.scrollLeft += b.left - r.left - r.width / 3;
      }
    },
    { root: narrow ? null : $("#sheet"), rootMargin: "0px 0px -65% 0px" },
  );
  $$("#tl-stream .tl-year").forEach((x) => tlObserver.observe(x));
}

/* ── Interaction ── */

function tlScrollToYear(y) {
  tlFill(y);
  const target = $(`.tl-year[data-year="${CSS.escape(y)}"]`);
  if (!target) return;
  const large = $("#tl-stream")?.classList.contains("is-large");
  target.scrollIntoView({ block: "start", behavior: large || reducedMotion() ? "auto" : "smooth" });
  if (large) requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: "start" })));
  const first = $(".tl-item", target);
  $$(".tl-item").forEach((b) => (b.tabIndex = -1));
  if (first) {
    first.tabIndex = 0;
    first.focus({ preventScroll: true });
  }
}
function closeTimelineFilters(returnFocus = false) {
  const box = $("#tl-filters");
  if (!box || box.hidden) return false;
  box.hidden = true;
  const toggle = $('[data-act="tl-filters"]');
  toggle?.setAttribute("aria-expanded", "false");
  if (returnFocus) toggle?.focus();
  return true;
}

document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (!act.startsWith("tl-") && !act.startsWith("ev-")) return;
  try {
    if (act === "tl-select") return tlSelect(el.dataset.entry, { scroll: false });
    if (act === "tl-close") return tlCloseDetails();
    if (act === "tl-step") {
      const list = tlAll();
      const i = list.findIndex((x) => x.id === TL.selected);
      const next = list[i + +el.dataset.step];
      if (next) return tlSelect(next.id, { focus: false });
      return;
    }
    if (act === "tl-year") return tlScrollToYear(el.dataset.year === "undated" ? (TL.undated = true, tlRender(), "undated") : el.dataset.year);
    if (act === "tl-open-year") {
      const y = el.dataset.year;
      TL.open.has(y) ? TL.open.delete(y) : TL.open.add(y);
      tlRender();
      return $(`.tl-year[data-year="${y}"] .tl-item`)?.focus({ preventScroll: true });
    }
    if (act === "tl-more") {
      TL.more.add(el.dataset.key);
      const group = el.closest(".tl-group");
      const count = $$(".tl-item", group).length;
      const year = el.dataset.key.slice(0, 4);
      tlRender();
      tlFill(year);
      return $$(`.tl-year[data-year="${year}"] .tl-item`)[count]?.focus({ preventScroll: true });
    }
    if (act === "tl-undated") {
      TL.undated = true;
      tlRender();
      return $('.tl-year[data-year="undated"] .tl-item')?.focus({ preventScroll: true });
    }
    if (act === "tl-mode") {
      TL.mode = el.dataset.value;
      TL.open.clear();
      pressOnly(el.parentElement, el);
      return tlRender({ announce: true });
    }
    if (act === "tl-filters") {
      const box = $("#tl-filters");
      const open = box.hidden;
      box.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) {
        animate(box, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
        $("input", box)?.focus();
      }
      return;
    }
    if (act === "tl-status") {
      TL.filter.status = el.dataset.value;
      pressOnly(el.parentElement, el);
      return tlRender({ announce: true });
    }
    if (act === "tl-reset") {
      TL.filter = { kinds: new Set(["p", "o", "g"]), categories: null, status: "all", from: "", to: "" };
      const box = $("#tl-filters");
      if (box) box.innerHTML = tlFilterBody();
      tlRender({ announce: true });
      return;
    }
    if (act === "tl-unfocus") return tlFocusEntity(null);
    if (act === "tl-focus") return tlFocusEntity({ id: el.dataset.id, kind: el.dataset.kind, name: el.dataset.name });
    if (act === "tl-goto") {
      const p = state.person;
      return tlFocusEntity({ id: p.id, kind: p.kind, name: p.display_name }, el.dataset.entry);
    }
    if (act === "tl-graph") {
      saveTimelineState();
      GRAPH.local = null;
      GRAPH.camera = null;
      GRAPH.selected = { type: "node", id: el.dataset.id };
      GRAPH.focusAfter = el.dataset.id;
      return go("graph");
    }
    if (act === "tl-edit-record") return tlEditRecord(el.dataset.entry, el.dataset.ids.split(","));
    if (act === "tl-new-event") {
      const preset = TL.entity ? [{ id: TL.entity.id, kind: TL.entity.kind, display_name: TL.entity.name }] : [];
      return openEvent(null, { with: preset, invoker: el });
    }
    if (act === "tl-profile-event") {
      const p = state.person;
      return openEvent(null, { with: [{ id: p.id, kind: p.kind, display_name: p.display_name }], invoker: el, after: () => tabTimelineLoad(p) });
    }
    if (act === "tl-edit-event") {
      const record = await api(`/events/${el.dataset.id}`);
      return openEvent(record, { invoker: el });
    }
    if (act === "tl-delete-event") return deleteEvent(el.dataset.id);
    if (act === "ev-remove") {
      evEditor.participants.splice(+el.dataset.i, 1);
      evPeople();
      return $(".picker-search input", $("#ev-add"))?.focus();
    }
    if (act === "ev-save-anyway") return saveEvent($('#panel [data-act="panel-save"]'), true);
  } catch (error) {
    toast(error.message, "danger");
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#tl-filters") && !event.target.closest('[data-act="tl-filters"]')) closeTimelineFilters();
});
document.addEventListener("keydown", (event) => {
  if (state.route.view !== "timeline" || panel.el() || dialog().open) return;
  if (event.key === "Escape") {
    if (closeTimelineFilters(true) || tlCloseDetails()) event.stopPropagation();
    return;
  }
  if (event.key === "/" && !typing(document.activeElement) && $("#tl-q")) {
    event.preventDefault();
    return $("#tl-q").focus();
  }
  // Within the stream: arrows move between entries, Page keys between years.
  const item = event.target.closest?.(".tl-item");
  if (!item) return;
  // Neighbouring years of a large timeline may still be waiting to be built.
  if (TL.view && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
    const ys = [...TL.view.keys()];
    const at = ys.indexOf(item.closest(".tl-year")?.dataset.year);
    if (event.key === "Home") tlFill(ys[0]);
    else if (event.key === "End") tlFill(ys[ys.length - 1]);
    else [ys[at - 1], ys[at + 1]].forEach((y) => y && tlFill(y));
  }
  const all = $$("#tl-stream .tl-item");
  const i = all.indexOf(item);
  let next = null;
  if (event.key === "ArrowDown") next = all[i + 1];
  else if (event.key === "ArrowUp") next = all[i - 1];
  else if (event.key === "Home") next = all[0];
  else if (event.key === "End") next = all[all.length - 1];
  else if (event.key === "PageDown" || event.key === "PageUp") {
    const years = $$("#tl-stream .tl-year");
    const at = years.indexOf(item.closest(".tl-year"));
    const target = years[at + (event.key === "PageDown" ? 1 : -1)];
    next = target && $(".tl-item", target);
  }
  if (next) {
    event.preventDefault();
    item.tabIndex = -1;
    next.tabIndex = 0;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  }
});
window.addEventListener(
  "resize",
  debounce(() => {
    const box = $("#tl-detail");
    if (box && !TL.selected) {
      box.hidden = true;
      tlShowKey();
    } else if (box && !box.hidden) {
      box.classList.toggle("is-sheet", innerWidth < 1100);
      document.body.classList.toggle("tl-sheet-open", innerWidth < 1100);
    }
  }, 120),
);
