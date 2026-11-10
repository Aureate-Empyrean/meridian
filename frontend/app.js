const catalogs = /*CATALOGS*/ {};

/* ───────────────────────── Localization ───────────────────────── */

let activeLocale = "en";
function t(key, vars) {
  let text =
    catalogs[activeLocale]?.[key] ??
    catalogs[activeLocale.split("-")[0]]?.[key] ??
    catalogs.en?.[key] ??
    key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
  return text;
}
function plural(count, one, other, vars = {}) {
  let rule = "other";
  try {
    rule = new Intl.PluralRules(activeLocale).select(count);
  } catch {
    rule = count === 1 ? "one" : "other";
  }
  return t(rule === "one" ? one : other, { count, ...vars });
}
function safeLocale(value) {
  try {
    return Intl.getCanonicalLocales(value || "en")[0] || "en";
  } catch {
    return "en";
  }
}

/* ───────────────────────── Utilities ───────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w))
    .slice(0, 2)
    .map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, "")][0] || "")
    .join("")
    .toUpperCase() || "?";
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const ICONS = {
  mark: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5c-3.2 2.4-4.6 5.2-4.6 8.5s1.4 6.1 4.6 8.5"/><path d="M9.6 8.4 15.6 10.6M9.8 15.4l5.8-4.8"/><circle cx="8.7" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="16.4" cy="10.9" r="1.6" fill="currentColor" stroke="none"/><circle cx="9" cy="16" r="1.6" fill="currentColor" stroke="none"/>',
  dashboard: '<rect x="3.5" y="3.5" width="5.5" height="6" rx="1.5"/><rect x="11" y="3.5" width="5.5" height="4" rx="1.5"/><rect x="11" y="9.5" width="5.5" height="7" rx="1.5"/><rect x="3.5" y="11.5" width="5.5" height="5" rx="1.5"/>',
  people: '<circle cx="7.5" cy="7" r="2.8"/><path d="M2.8 16c.6-2.7 2.4-4.2 4.7-4.2s4.1 1.5 4.7 4.2"/><circle cx="13.8" cy="7.6" r="2.2"/><path d="M13 11.9c2.1-.1 3.6 1.2 4.2 3.6"/>',
  organizations: '<path d="M4 16.5V5.5l6-2 6 2v11"/><path d="M2.5 16.5h15M7.5 8h1M11.5 8h1M7.5 11h1M11.5 11h1M9 16.5v-2.5h2v2.5"/>',
  groups: '<circle cx="10" cy="6.3" r="2.3"/><circle cx="5" cy="12.3" r="2"/><circle cx="15" cy="12.3" r="2"/><path d="M8 8.2 6.3 10.5M12 8.2l1.7 2.3M7 12.3h6"/>',
  timeline: '<path d="M6 3v14"/><circle cx="6" cy="6" r="1.7"/><circle cx="6" cy="13.5" r="1.7"/><path d="M9.5 6h7M9.5 13.5h5"/>',
  graph: '<circle cx="5" cy="5.5" r="1.8"/><circle cx="15" cy="7" r="1.8"/><circle cx="7.5" cy="14.5" r="1.8"/><circle cx="14" cy="14.5" r="1.4"/><path d="m6.7 6 6.5.8M5.6 7.2l1.4 5.5M8.8 13.4l4.8-5M9.3 14.5h3.3"/>',
  upload: '<path d="M10 13V4M6.5 7.3 10 3.8l3.5 3.5"/><path d="M4 12.5v2.2c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5v-2.2"/>',
  trash: '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>',
  settings: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v1.8M10 15.4v1.8M17.2 10h-1.8M4.6 10H2.8M15.1 4.9l-1.3 1.3M6.2 13.8l-1.3 1.3M15.1 15.1l-1.3-1.3M6.2 6.2 4.9 4.9"/>',
  search: '<circle cx="8.7" cy="8.7" r="5.2"/><path d="m12.6 12.6 4 4"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  userplus: '<circle cx="8" cy="7" r="3"/><path d="M2.8 16.5c.6-3 2.6-4.6 5.2-4.6 1.4 0 2.6.4 3.6 1.3M15 10v5M12.5 12.5h5"/>',
  phone: '<path d="M6.2 3.5 8 7.4 6.6 8.7a9 9 0 0 0 4.7 4.7l1.3-1.4 3.9 1.8-.6 2.7c-6.3.4-12.3-5.6-11.9-11.9z"/>',
  mail: '<rect x="3" y="5" width="14" height="10.5" rx="2"/><path d="m3.6 6 6.4 5 6.4-5"/>',
  globe: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c-2.2 2-3.2 4.3-3.2 7s1 5 3.2 7c2.2-2 3.2-4.3 3.2-7s-1-5-3.2-7z"/>',
  pin: '<path d="M10 17s5.5-5 5.5-9a5.5 5.5 0 0 0-11 0c0 4 5.5 9 5.5 9z"/><circle cx="10" cy="8" r="2"/>',
  cake: '<path d="M4 16.5h12v-5.5c0-.8-.7-1.5-1.5-1.5h-9c-.8 0-1.5.7-1.5 1.5z"/><path d="M4 13c1.3 0 1.3-1 2.7-1s1.3 1 2.6 1 1.4-1 2.7-1 1.3 1 2.7 1 1.3-1 1.3-1M10 9.5V7"/><path d="M10 4.2c.6.7.9 1.3.9 1.8a.9.9 0 0 1-1.8 0c0-.5.3-1.1.9-1.8z"/>',
  calendar: '<rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/>',
  school: '<path d="M10 4 2.5 7.8 10 11.6l7.5-3.8z"/><path d="M5.5 9.6v3.6c1.3 1.3 2.9 2 4.5 2s3.2-.7 4.5-2V9.6M17.5 7.8v4.4"/>',
  heart: '<path d="M10 16.2S3 12.3 3 7.6C3 5.5 4.6 4 6.5 4c1.4 0 2.7.8 3.5 2.1C10.800 4.800 12.100 4 13.500 4 15.400 4 17 5.500 17 7.600c0 4.700-7 8.600-7 8.600z"/>',
  chat: '<path d="M3.500 5.500c0-.8.7-1.500 1.500-1.500h10c.8 0 1.500.7 1.500 1.500v6.500c0 .8-.7 1.500-1.500 1.500H9l-3.500 2.800v-2.800H5c-.8 0-1.500-.7-1.500-1.500z"/>',
  briefcase: '<rect x="3" y="6.5" width="14" height="9.5" rx="2"/><path d="M7.5 6.5V5c0-.8.7-1.5 1.5-1.5h2c.8 0 1.5.7 1.5 1.5v1.5M3 10.5h14"/>',
  at: '<circle cx="10" cy="10" r="3"/><path d="M13 10v1.3a2.2 2.2 0 0 0 4.4 0V10a7.4 7.4 0 1 0-2.9 5.9"/>',
  note: '<path d="M5 3.5h7l3 3v10H5z"/><path d="M12 3.5v3h3M7.5 10h5M7.5 13h5"/>',
  edit: '<path d="m12.5 4.5 3 3L7 16H4v-3z"/><path d="m11 6 3 3"/>',
  x: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  more: '<circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="6.5" y="6.5" width="9" height="9.5" rx="1.8"/><path d="M4.5 12.5v-7c0-1 .8-1.8 1.8-1.8h6.2"/>',
  external: '<path d="M11 4h5v5M16 4l-7.5 7.5M14 11.5v3c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-7c0-.8.7-1.5 1.5-1.5h3"/>',
  restore: '<path d="M4.5 9.5a5.5 5.5 0 1 1 1.6 4"/><path d="M4 5.5v4h4"/>',
  alert: '<path d="M10 3.5 17 16H3z"/><path d="M10 8.5v3.5M10 14.2h.01"/>',
  star: '<path d="m10 3.5 2 4.3 4.6.5-3.4 3.1 1 4.6L10 13.7 5.8 16l1-4.6-3.4-3.1 4.6-.5z"/>',
  check: '<path d="m4.8 10.4 3.3 3.3 7.1-7.4"/>',
  names: '<path d="M4 6h12M4 10h8M4 14h10"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5h.01"/>',
  list: '<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9"/><circle cx="4" cy="5.5" r=".9" fill="currentColor" stroke="none"/><circle cx="4" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="4" cy="14.5" r=".9" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.4"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.4"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.4"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.4"/>',
  minus: '<path d="M4 10h12"/>',
  fit: '<path d="M4 8V5.5C4 4.7 4.7 4 5.5 4H8M12 4h2.5c.8 0 1.5.7 1.5 1.5V8M16 12v2.5c0 .8-.7 1.5-1.5 1.5H12M8 16H5.5c-.8 0-1.5-.7-1.5-1.5V12"/>',
  link: '<path d="M8.5 11.5a3.2 3.2 0 0 0 4.5 0l2.6-2.6a3.2 3.2 0 0 0-4.5-4.5l-1 1"/><path d="M11.5 8.5a3.2 3.2 0 0 0-4.5 0l-2.6 2.6a3.2 3.2 0 0 0 4.5 4.5l1-1"/>',
  merge: '<path d="M5 3.5v3.2c0 2.4 1.9 4.3 4.3 4.3h.7M5 16.5v-3M15 11l-3-3M15 11l-3 3"/><path d="M10 11h5"/>',
};
function icon(name, className = "") {
  const box = name === "mark" ? "0 0 24 24" : "0 0 20 20";
  return `<svg class="i ${className}" viewBox="${box}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}

/* ───────────────────────── Motion ───────────────────────── */

// One motion vocabulary (docs/DESIGN.md): durations and one easing family, mirrored in CSS.
const MOTION = { fast: 120, page: 220, panel: 260, exit: 160, ease: "cubic-bezier(.22,1,.36,1)", exitEase: "cubic-bezier(.4,0,1,1)" };
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** Web Animations with the shared easing. Reduced motion: no movement, the change is immediate. */
function animate(el, frames, duration = MOTION.page, easing = MOTION.ease) {
  if (!el?.animate || reducedMotion()) return Promise.resolve();
  try {
    el.getAnimations?.().forEach((a) => a.cancel());
    return el.animate(frames, { duration, easing, fill: "both" }).finished.then(
      (a) => a.cancel(),
      () => {},
    );
  } catch {
    return Promise.resolve();
  }
}
const enter = (el, distance = 6) =>
  animate(el, [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "none" }]);

/* ───────────────────────── Nexus bridge ───────────────────────── */

let serial = 0;
const pending = new Map();
window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== "empyrean-v1") return;
  const request = pending.get(event.data.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(event.data.id);
  event.data.error ? request.reject(Error(event.data.error)) : request.resolve(event.data.result);
});
function bridge(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++serial);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(t("Nexus did not respond. Try again in a moment.")));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ channel: "empyrean-v1", id, action, ...data }, "*");
  });
}
const api = (path, method = "GET", body) =>
  bridge("request", { path: "/api" + path, method, ...(body === undefined ? {} : { body }) });
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) q.set(k, v);
  const s = q.toString();
  return s ? "?" + s : "";
};

/* ───────────────────────── Dates ───────────────────────── */

const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function fmt(options, y, m, d) {
  return new Intl.DateTimeFormat(activeLocale, { timeZone: "UTC", ...options }).format(new Date(Date.UTC(y, m - 1, d)));
}
/** A partial date in words: "17 May 1990", "May 1990", "1990", "17 May". */
function formatPartial(value) {
  if (!value) return "";
  if (value.startsWith("--")) return fmt({ month: "long", day: "numeric" }, 2000, +value.slice(2, 4), +value.slice(5, 7));
  const [y, m, d] = value.split("-").map(Number);
  if (d) return fmt({ year: "numeric", month: "long", day: "numeric" }, y, m, d);
  if (m) return fmt({ year: "numeric", month: "long" }, y, m, 1);
  return String(y);
}
function formatDateRecord(r) {
  const text = r.date ? formatPartial(r.date) : "";
  const main = text && r.approximate ? t("About {date}", { date: text }) : text;
  return [main, r.description].filter(Boolean).join(" · ") || t("Unknown");
}
function period(r) {
  const from = r.valid_from ? formatPartial(r.valid_from) : "";
  const until = r.valid_until ? formatPartial(r.valid_until) : "";
  if (from && until) return `${from} – ${until}`;
  if (from) return t("Since {date}", { date: from });
  if (until) return t("Until {date}", { date: until });
  return "";
}
/** Next anniversary of a date whose day and month are known, from today (local). */
function nextOccurrence(value) {
  let m, d;
  if (value?.startsWith("--")) [m, d] = [+value.slice(2, 4), +value.slice(5, 7)];
  else if (value?.length === 10) [m, d] = [+value.slice(5, 7), +value.slice(8, 10)];
  else return null;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const when = Date.UTC(y, m - 1, Math.min(d, last));
    if (when >= today) return { year: y, month: m, day: Math.min(d, last), days: Math.round((when - today) / 86400000) };
  }
  return null;
}
const inDays = (n) => (n === 0 ? t("Today") : n === 1 ? t("Tomorrow") : plural(n, "In {count} day", "In {count} days"));
const MONTHS = () => Array.from({ length: 12 }, (_, i) => fmt({ month: "long" }, 2000, i + 1, 1));
function dateInput(name, value) {
  let y = "", m = "", d = "";
  if (value?.startsWith("--")) [m, d] = [value.slice(2, 4), value.slice(5, 7)];
  else if (value) [y, m, d] = value.split("-");
  return `<div class="date-input" data-date="${esc(name)}">
    <input class="ae-input" inputmode="numeric" maxlength="2" placeholder="${esc(t("Day"))}" aria-label="${esc(t("Day"))}" data-part="d" value="${esc(d ? +d : "")}">
    <select class="ae-select" aria-label="${esc(t("Month"))}" data-part="m"><option value="">${esc(t("Month"))}</option>${MONTHS().map((label, i) => `<option value="${pad(i + 1)}" ${m && +m === i + 1 ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
    <input class="ae-input" inputmode="numeric" maxlength="4" placeholder="${esc(t("Year"))}" aria-label="${esc(t("Year"))}" data-part="y" value="${esc(y)}">
  </div>`;
}
/** Read a day/month/year widget into a partial date, or explain what is missing. */
function readDate(root) {
  const d = $("[data-part=d]", root).value.trim();
  const m = $("[data-part=m]", root).value;
  const y = $("[data-part=y]", root).value.trim();
  if (!d && !m && !y) return { value: null };
  if (y && !/^\d{4}$/.test(y)) return { error: t("Enter the year with four digits") };
  if (d && !/^\d{1,2}$/.test(d)) return { error: t("Enter the day as a number") };
  if (d && !m) return { error: t("Choose a month for this day") };
  if (m && !d && !y) return { error: t("Add a day or a year to the month") };
  if (d && m && y) return { value: `${y}-${m}-${pad(+d)}` };
  if (d && m) return { value: `--${m}-${pad(+d)}` };
  if (m && y) return { value: `${y}-${m}` };
  return { value: y };
}
function relativeTime(iso) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat(activeLocale, { numeric: "auto" });
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]])
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  return t("just now");
}

/* ───────────────────────── State ───────────────────────── */

const state = {
  context: { applications: [], locale: "en" },
  route: { view: "dashboard", id: null },
  counts: { people: 0, trash: 0, imports: 0 },
  self: null,
  version: "",
  // People sorting and name display (Settings → People), stored by Meridian.
  prefs: { people_sort: "given", people_display: "given" },
  people: { q: "", has: new Set(), sort: "name", items: [], total: 0, limit: 100 },
  person: null,
  tab: "overview",
  importing: null,
};
let viewToken = 0;

/* ───────────────────────── Feedback ───────────────────────── */

/** One toast per message: a repeated message refreshes the existing one. At most three. */
function toast(message, tone = "", action = null) {
  const box = $("#toasts");
  const existing = $$(".ae-toast", box).find((el) => el.dataset.text === message && !el.classList.contains("is-leaving"));
  const dismiss = (el) => {
    clearTimeout(el._timer);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), reducedMotion() ? 0 : MOTION.exit);
  };
  const life = tone === "danger" ? 9000 : 3500;
  if (existing) {
    clearTimeout(existing._timer);
    existing._timer = setTimeout(() => dismiss(existing), life);
    return;
  }
  const el = document.createElement("div");
  el.className = `ae-toast ae-glass ${tone === "danger" ? "ae-toast--danger" : ""}`;
  el.dataset.text = message;
  el.setAttribute("role", tone === "danger" ? "alert" : "status");
  el.innerHTML = `${tone === "good" ? icon("check", "good") : ""}<span>${esc(message)}</span>${action ? `<button class="ae-btn ae-btn--sm toast-action">${esc(action.label)}</button>` : ""}<button class="ae-btn ae-btn--quiet ae-btn--icon ae-btn--sm toast-close" aria-label="${esc(t("Dismiss"))}">${icon("x")}</button>`;
  el.querySelector(".toast-close").onclick = () => dismiss(el);
  if (action)
    el.querySelector(".toast-action").onclick = () => {
      dismiss(el);
      action.run();
    };
  box.append(el);
  $$(".ae-toast:not(.is-leaving)", box).slice(0, -3).forEach(dismiss);
  el._timer = setTimeout(() => dismiss(el), life);
}
const dialog = () => $("#dialog");
let dialogClosing = null;
function openDialog(html, { wide = false } = {}) {
  const d = dialog();
  dialogClosing = null;
  d.getAnimations?.().forEach((a) => a.cancel());
  d.className = `ae-dialog ae-glass ${wide ? "ae-dialog--wide" : ""}`;
  d.innerHTML = html;
  if (!d.open) d.showModal();
  animate(d, [{ opacity: 0, transform: "translateY(8px) scale(.985)" }, { opacity: 1, transform: "none" }], MOTION.page);
  ($("[data-focus]", d) || $("input,select,textarea,button", d))?.focus();
  return d;
}
function closeDialog() {
  const d = dialog();
  if (!d.open || dialogClosing) return dialogClosing || Promise.resolve();
  dialogClosing = animate(d, [{ opacity: 1 }, { opacity: 0, transform: "translateY(4px) scale(.99)" }], MOTION.exit, MOTION.exitEase).then(() => {
    if (dialogClosing) d.close();
    dialogClosing = null;
  });
  return dialogClosing;
}
dialog().addEventListener?.("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
function confirmAction(title, text, label, run, { danger = true } = {}) {
  openDialog(`<div class="ae-dialog-head"><h2>${esc(title)}</h2></div>
    <div class="ae-dialog-body"><p style="margin:0;color:var(--m-text-2)">${esc(text)}</p><p class="form-error" id="form-error" hidden></p></div>
    <div class="ae-dialog-foot"><button class="ae-btn" data-act="close" data-focus>${esc(t("Cancel"))}</button><button class="ae-btn ${danger ? "ae-btn--danger" : "ae-btn--primary"}" id="confirm">${esc(label)}</button></div>`);
  $("#confirm").onclick = async (event) => {
    const button = event.currentTarget;
    button.classList.add("is-busy");
    try {
      await run();
      await closeDialog();
    } catch (error) {
      showError(error);
    } finally {
      button.classList.remove("is-busy");
    }
  };
}
/** Resolves true when the user agrees to drop unsaved edits. */
function confirmDiscard() {
  if (panel.session) return confirmContactClose();
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      closeDialog().then(() => resolve(value));
    };
    confirmAction(t("Discard your changes?"), t("You have edits in the side panel that are not saved yet."), t("Discard changes"), async () => answer(true));
    const d = dialog();
    const onClose = () => {
      d.removeEventListener("close", onClose);
      answer(false);
    };
    d.addEventListener("close", onClose);
  });
}
function showError(error) {
  const box = $("#form-error");
  if (box) {
    box.textContent = error.message;
    box.hidden = false;
  } else toast(error.message, "danger");
}

/* ───────────────────────── Shell and navigation ───────────────────────── */

const NAV = [
  { view: "dashboard", icon: "dashboard", label: "Dashboard" },
  { view: "people", icon: "people", label: "People", count: () => state.counts.people },
  { view: "organizations", icon: "organizations", label: "Organizations", count: () => state.counts.organizations || "" },
  { view: "groups", icon: "groups", label: "Groups", count: () => state.counts.groups || "" },
  { view: "graph", icon: "graph", label: "Graph" },
  { view: "timeline", icon: "timeline", label: "Timeline" },
  { view: "import", icon: "upload", label: "Import contacts" },
];
const FOOT = [
  { view: "trash", icon: "trash", label: "Trash", count: () => state.counts.trash || "" },
  { view: "settings", icon: "settings", label: "Settings" },
];
function renderShell() {
  $("#app").innerHTML = `
    <aside class="rail" aria-label="Meridian">
      <div class="brand"><span class="brand-mark">${icon("mark")}</span><span class="brand-name">Meridian</span></div>
      <nav class="nav" id="nav" aria-label="${esc(t("Sections"))}"></nav>
    </aside>
    <div class="main">
      <header class="toolbar">
        <h1 id="toolbar-title"></h1><span class="spacer"></span>
        <div class="quick-search" id="quick-search-box">${icon("search")}<input class="ae-input" id="quick-search" type="search" placeholder="${esc(t("Find a person"))}" aria-label="${esc(t("Find a person"))}" maxlength="200" autocomplete="off"></div>
        <button class="ae-btn ae-btn--primary" data-act="new-person" title="${esc(t("New person"))}" aria-label="${esc(t("New person"))}">${icon("plus")}<span class="label-wide">${esc(t("New person"))}</span></button>
      </header>
      <section class="sheet" id="sheet"></section>
    </div>`;
  $("#quick-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      state.people.q = event.currentTarget.value.trim();
      event.currentTarget.value = "";
      go("people");
    }
  });
}
function navButton(n) {
  const r = state.route;
  const current = r.view === n.view || (n.view === "people" && r.view === "person") || (r.view === "entity" && KIND_VIEW[r.kind] === n.view);
  const count = n.count?.();
  return `<button class="nav-item" data-act="go" data-view="${n.view}" ${current ? 'aria-current="page"' : ""} title="${esc(t(n.label))}">${icon(n.icon)}<span>${esc(t(n.label))}</span>${count !== undefined && count !== "" ? `<span class="count">${esc(count)}</span>` : ""}</button>`;
}
function renderNav() {
  const nav = $("#nav");
  if (!nav) return;
  const indicator = $(".nav-indicator", nav)?.outerHTML || '<span class="nav-indicator" aria-hidden="true"></span>';
  nav.innerHTML = `${indicator}${NAV.map(navButton).join("")}
    <span class="nav-spacer"></span>
    <div class="nav-foot">${FOOT.map(navButton).join("")}</div>`;
  placeIndicator();
}
/** The active-navigation light slides to the current item. */
function placeIndicator(instant = false) {
  const nav = $("#nav");
  const indicator = $(".nav-indicator", nav);
  const current = $('.nav-item[aria-current="page"]', nav);
  if (!indicator) return;
  if (!current) {
    indicator.style.opacity = "0";
    return;
  }
  const navBox = nav.getBoundingClientRect();
  const box = current.getBoundingClientRect();
  if (instant || !indicator.dataset.placed) indicator.style.transition = "none";
  indicator.style.width = `${box.width}px`;
  indicator.style.height = `${box.height}px`;
  indicator.style.transform = `translate(${box.left - navBox.left + nav.scrollLeft}px, ${box.top - navBox.top + nav.scrollTop}px)`;
  indicator.style.opacity = "1";
  if (indicator.style.transition === "none") {
    indicator.dataset.placed = "1";
    requestAnimationFrame(() => requestAnimationFrame(() => (indicator.style.transition = "")));
  }
}
window.addEventListener("resize", debounce(() => {
  placeIndicator(true);
  placeTabInk(true);
}, 80));
function setTitle(parts) {
  $("#toolbar-title").innerHTML = parts
    .map((p, i) => (p.view ? `<button class="crumb" data-act="go" data-view="${p.view}">${esc(p.label)}</button><span class="crumb-sep" aria-hidden="true">/</span>` : `<span>${esc(p.label)}</span>`))
    .join("");
  // Screens with their own search field do not repeat it in the toolbar.
  $("#quick-search-box").hidden = ["dashboard", "people", "organizations", "groups", "graph", "timeline"].includes(state.route.view);
}
async function refreshCounts() {
  try {
    const data = await api("/state");
    state.counts = data.counts;
    state.self = data.self;
    renderNav();
  } catch {
    /* counts are a convenience */
  }
}
/**
 * Open a profile. Where the browser supports view transitions, the avatar that was clicked
 * travels to the profile header, so the person you chose is visibly the one that opens.
 * The profile is fetched first (a local request), so the transition never waits on the
 * network with the page frozen; anything slower falls back to an ordinary navigation.
 */
async function openPerson(id, from, kind = "person") {
  const view = kind === "person" ? "person" : "entity";
  const source = from?.querySelector?.(".avatar");
  if (!document.startViewTransition || reducedMotion() || !source || panel.el()) return go(view, id, kind);
  const promise = api(kind === "person" ? `/people/${id}` : `/entities/${id}`);
  state.prefetch = { id, promise };
  const ready = await Promise.race([promise.then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 250))]);
  if (!ready || state.prefetch?.id !== id) return go(view, id, kind);
  source.style.viewTransitionName = "m-avatar";
  state.transitioning = true;
  const transition = document.startViewTransition(async () => {
    source.style.viewTransitionName = "";
    await go(view, id, kind);
    const target = $("#person-page .profile-head .avatar");
    if (target) target.style.viewTransitionName = "m-avatar";
  });
  const done = () => {
    state.transitioning = false;
    const target = $("#person-page .profile-head .avatar");
    if (target) target.style.viewTransitionName = "";
  };
  transition.finished.then(done, done);
  transition.ready.catch(done);
}
/** Navigate. Unsaved edits in the side panel are never dropped silently. Inside Nexus with
 * the navigation contract, the move becomes a browser history entry and is shown when Nexus
 * confirms it (frontend/navigation.js); otherwise it is shown directly, as before. */
async function go(view, id = null, kind = null) {
  if (panel.isDirty() && !(await confirmDiscard())) return;
  const next = { view, id, kind };
  if (meridianNavigation.enabled) {
    try {
      await queueNavigation(MeridianRoutes.serialize(next), "push");
    } catch (error) {
      if (!/superseded/i.test(error.message)) toast(error.message, "danger");
    }
    return;
  }
  leaveView();
  return showRoute(next);
}
/** Tidy up the screen being left: the side panel, and state worth keeping per view. */
function leaveView() {
  closePanel();
  if (state.route.view === "graph") saveGraphState();
  if (state.route.view === "timeline") saveTimelineState();
  document.body.classList.remove("tl-sheet-open");
  if (state.route.view === "people") state.people.scroll = scrollPos();
}
async function showRoute(next, options = {}) {
  const route = next.view === "interaction" ? await resolveInteractionRoute(next) : next;
  if (options.isCurrent && !options.isCurrent()) return;
  const { view, id } = route;
  // A profile opened from elsewhere starts on Profile; re-rendering the same one keeps its tab.
  if ((view === "person" || view === "entity") && (id !== state.person?.id || state.route.view !== view)) state.tab = "overview";
  if (options.tab && !route.interaction && !route.address) state.tab = options.tab;
  if (route.address) state.tab = "overview";
  state.route = { view, id, kind: route.kind || null, interaction: route.interaction || null, address: route.address || null, path: route.path || null };
  return render(options);
}
/** An Interaction is shown on the profile of its first participant still in the directory. */
async function resolveInteractionRoute(route) {
  const missing = { view: "not-found", id: null, path: `/interactions/${route.interaction}` };
  let record;
  try {
    record = await api(`/interactions/${route.interaction}`);
  } catch (error) {
    if (/not found/i.test(error.message)) return missing;
    throw error;
  }
  const who = record.participants.find((p) => !p.entity.deleted)?.entity;
  if (!who) return missing;
  return who.kind === "person" ? { view: "person", id: who.id, interaction: route.interaction } : { view: "entity", id: who.id, kind: who.kind, interaction: route.interaction };
}
function routeFromLocation() {
  return routeFromPath(location.pathname.replace(/^\/modules\/[^/]+/, "") || "/");
}
function routeFromPath(path) {
  const clean = String(path || "/").replace(/\/+$/, "") || "/";
  if (clean === "/") return { view: "dashboard", id: null };
  const person = clean.match(/^\/people\/([0-9a-f-]{36})(?:\/addresses\/([0-9a-f-]{36}))?$/);
  if (person) return { view: "person", id: person[1], ...(person[2] ? { address: person[2] } : {}) };
  const entity = clean.match(/^\/(organizations|groups)\/([0-9a-f-]{36})(?:\/addresses\/([0-9a-f-]{36}))?$/);
  if (entity) return { view: "entity", id: entity[2], kind: entity[1] === "groups" ? "group" : "organization", ...(entity[3] ? { address: entity[3] } : {}) };
  const interaction = clean.match(/^\/interactions\/([0-9a-f-]{36})$/);
  if (interaction) return { view: "interaction", id: null, interaction: interaction[1] };
  const view = clean.slice(1);
  if (["people", "organizations", "groups", "graph", "timeline", "import", "trash", "settings"].includes(view)) return { view, id: null };
  return { view: "not-found", id: null, path: clean };
}
const SKELETONS = {
  person: `<div class="page banded"><div class="band"><div class="wrap"><div class="profile-head"><span class="avatar xl skeleton"></span><div><div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:220px"></div></div></div><div class="sk-tabs"></div></div></div><div class="wrap body"><div class="skeleton sk-block"></div></div></div>`,
  dashboard: `<div class="page banded"><div class="band"><div class="wrap"><div class="skeleton sk-line" style="width:160px"></div><div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-search"></div></div></div><div class="wrap body"><div class="skeleton sk-block"></div></div></div>`,
  default: `<div class="page"><div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:45%"></div><div class="skeleton sk-block" style="margin-top:32px"></div></div>`,
};
// How deep a screen is: going deeper slides in from the right, going back from the left.
const DEPTH = { dashboard: 0, people: 1, organizations: 1, groups: 1, graph: 1, timeline: 1, import: 1, trash: 1, settings: 1, person: 2, entity: 2 };
let lastView = null;
/**
 * Render the current route. A navigation token guards every write: when the user moves on
 * while a view is still loading, the late result is discarded rather than painted over the
 * newer screen. A skeleton appears only when loading takes long enough to notice.
 */
async function render({ focus = true, scroll = null } = {}) {
  const token = ++viewToken;
  let outcome;
  renderNav();
  const sheet = $("#sheet");
  $(".page", sheet)?.classList.add("is-leaving");
  const skeleton = setTimeout(() => {
    if (token === viewToken) sheet.innerHTML = SKELETONS[state.route.view === "entity" ? "person" : state.route.view] || SKELETONS.default;
  }, 160);
  const views = {
    dashboard: viewDashboard, people: viewPeople, person: viewPerson, entity: viewEntity,
    organizations: (sheet, token) => viewEntities(sheet, token, "organization"),
    groups: (sheet, token) => viewEntities(sheet, token, "group"),
    import: viewImport, trash: viewTrash, settings: viewSettings, "not-found": viewNotFound,
    ...(typeof viewGraph === "function" ? { graph: viewGraph } : {}),
    ...(typeof viewTimeline === "function" ? { timeline: viewTimeline } : {}),
  };
  try {
    outcome = await (views[state.route.view] || viewDashboard)(sheet, token);
  } catch (error) {
    if (token === viewToken && /not found/i.test(error.message)) outcome = viewNotFound(sheet);
    else if (token === viewToken)
      sheet.innerHTML = `<div class="page"><h2 class="sr-only" data-heading tabindex="-1">${esc(t("This could not be loaded"))}</h2>${emptyState("alert", t("This could not be loaded"), error.message, `<button class="ae-btn" data-act="retry">${esc(t("Try again"))}</button><button class="ae-btn" data-act="go" data-view="dashboard">${esc(t("Back to Dashboard"))}</button>`)}</div>`;
  } finally {
    clearTimeout(skeleton);
  }
  if (token !== viewToken) return;
  // A new screen starts at its top. On phones the document scrolls, not the sheet.
  sheet.scrollTop = 0;
  for (const el of [document.scrollingElement, document.body]) if (el) el.scrollTop = 0;
  const from = lastView;
  const backToDirectory = state.route.view === "people" && from === "person";
  if (backToDirectory && state.people.scroll) for (const el of [sheet, document.scrollingElement, document.body]) if (el) el.scrollTop = state.people.scroll;
  if (scroll) for (const el of [sheet, document.scrollingElement, document.body]) if (el) el.scrollTop = scroll;
  lastView = state.route.view;
  // Inside a view transition the browser animates the change; otherwise the page enters
  // in the direction of travel: deeper from the right, back from the left, sideways up.
  if (!state.transitioning) {
    const step = from === null ? 0 : (DEPTH[state.route.view] ?? 1) - (DEPTH[from] ?? 1);
    const page = $(".page", sheet);
    if (step) animate(page, [{ opacity: 0, transform: `translateX(${step > 0 ? 14 : -14}px)` }, { opacity: 1, transform: "none" }]);
    else enter(page);
  }
  const cameFrom = backToDirectory && state.person && $(`#people-list [data-id="${CSS.escape(state.person.id)}"]`);
  if (cameFrom) cameFrom.focus({ preventScroll: true });
  else if (focus) $("[data-heading]", sheet)?.focus({ preventScroll: true });
  if (state.route.address) focusAddress(state.route.address);
  return outcome === "not-found" ? outcome : undefined;
}
/** Opened from a link to one address (Atlas): show that one, or say it is gone. */
function focusAddress(id) {
  const row = $(`[data-address-row="${CSS.escape(id)}"]`);
  if (!row) return toast(t("That address is no longer on this contact."));
  row.classList.add("is-target");
  row.tabIndex = -1;
  row.scrollIntoView({ block: "center", behavior: "auto" });
  row.focus({ preventScroll: true });
}
/** A deliberate outcome: the address stays as it is, and nothing unrelated is shown instead. */
function viewNotFound(sheet) {
  setTitle([{ label: t("Not found") }]);
  sheet.innerHTML = `<div class="page"><h2 class="sr-only" data-heading tabindex="-1">${esc(t("This page could not be found"))}</h2>${emptyState("alert", t("This page could not be found"), t("The address may be wrong, or the record may have been removed."), `<button class="ae-btn" data-act="go" data-view="dashboard">${esc(t("Back to Dashboard"))}</button>`)}</div>`;
  return "not-found";
}
const stale = (token) => token !== undefined && token !== viewToken;

/* ───────────────────────── Shared pieces ───────────────────────── */

/** Initials on one of a few muted tones, chosen from the person's id so it never changes. */
const TONES = 7;
function tone(key = "") {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % TONES;
}
const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const avatar = (name, key, cls = "") => {
  const photo = ENTITY_ID.test(key || "") ? PICTURES.known(key) : null;
  return `<span class="avatar tone-${tone(key || name)} ${cls}${photo ? " has-photo" : ""}" aria-hidden="true"${ENTITY_ID.test(key || "") ? ` data-avatar="${esc(key)}"` : ""}${photo ? ` style="background-image:url(${photo})"` : ""}>${esc(initials(name))}</span>`;
};

/* ───────────────────────── Pictures (Argus) ───────────────────────── */
/* An entity's picture is an Argus photo plus the owner's crop; Meridian's backend asks Argus
   for rendered images and the page only ever sees data: URLs. Avatars render initials first
   and are upgraded in place when a picture arrives; anything other than an available picture
   (no picture, Argus off, photo trashed or deleted) simply stays initials. */
const PICTURES = {
  cache: new Map(), // entity id → { src | null, size, at }
  inflight: false,
  queued: false,
  TTL: 10 * 60 * 1000,
  known(id) {
    const hit = this.cache.get(id);
    return hit && hit.src && Date.now() - hit.at < this.TTL ? hit.src : null;
  },
  forget(id) {
    this.cache.delete(id);
    $$(`.avatar[data-avatar="${CSS.escape(id)}"]`).forEach((el) => {
      el.classList.remove("has-photo");
      el.style.backgroundImage = "";
      delete el.dataset.size;
    });
  },
  sizeFor(el) {
    return el.classList.contains("xl") ? 256 : el.classList.contains("lg") || el.classList.contains("md") ? 128 : 64;
  },
  apply(el, src) {
    if (src) {
      el.classList.add("has-photo");
      el.style.backgroundImage = `url(${src})`;
    } else {
      el.classList.remove("has-photo");
      el.style.backgroundImage = "";
    }
  },
  schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.hydrate();
    });
  },
  async hydrate() {
    if (this.inflight) return void (this.again = true);
    const wanted = new Map(); // size → Set(ids)
    for (const el of $$(".avatar[data-avatar]")) {
      const id = el.dataset.avatar;
      const size = this.sizeFor(el);
      const hit = this.cache.get(id);
      if (hit && Date.now() - hit.at < this.TTL && hit.size >= size) {
        if (el.dataset.size !== String(hit.size)) {
          this.apply(el, hit.src);
          el.dataset.size = String(hit.size);
        }
        continue;
      }
      if (!wanted.has(size)) wanted.set(size, new Set());
      wanted.get(size).add(id);
    }
    if (!wanted.size) return;
    this.inflight = true;
    try {
      for (const [size, set] of wanted) {
        const ids = [...set];
        for (let i = 0; i < ids.length; i += 120) {
          const chunk = ids.slice(i, i + 120);
          const res = await api("/avatars", "POST", { ids: chunk, size });
          for (const id of chunk) {
            const item = res.items[id];
            // Remember "no picture" too, but never longer than a picture: it may be set soon.
            this.cache.set(id, { src: item?.status === "available" ? item.src : null, size, at: Date.now() - (item ? 0 : this.TTL / 2) });
          }
        }
      }
      for (const el of $$(".avatar[data-avatar]")) {
        const hit = this.cache.get(el.dataset.avatar);
        if (hit) {
          this.apply(el, hit.src);
          el.dataset.size = String(hit.size);
        }
      }
    } catch {
      // Pictures are optional; initials stay.
    } finally {
      this.inflight = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  },
};
new MutationObserver(() => PICTURES.schedule()).observe(document.documentElement, { childList: true, subtree: true });

const PICTURE_SHAPE = { person: "is-person", organization: "is-organization", group: "is-group" };
const UNAVAILABLE_LIBRARY = {
  module_uninstalled: "Argus is not installed in this Nexus, so there are no photos to choose from.",
  module_disabled: "Argus is switched off in Nexus. Turn it on to choose a photo.",
  not_granted: "Meridian may not read the Argus photo library yet. Review Meridian's access in Nexus.",
  forbidden: "Argus did not allow Meridian to read its photo library.",
};
/** Choose an Argus photo and crop it for a Person, Organization or Group. */
async function openPicture(entity, existing = entity.image) {
  const shape = PICTURE_SHAPE[entity.kind] || "is-person";
  const head = (title) => `<div class="ae-dialog-head"><h2>${esc(title)}</h2><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>`;
  const library = { items: [], cursor: null, availability: null };
  async function loadMore() {
    const res = await api(`/photo-library${query({ cursor: library.cursor || "" })}`);
    library.availability = res.availability;
    library.items.push(...res.items);
    library.cursor = res.next_cursor;
  }
  function chooseStep() {
    const d = openDialog(`${head(t("Picture for {name}", { name: entity.display_name }))}
      <div class="ae-dialog-body pic-body"><div id="pic-grid" class="pic-grid" aria-busy="true"><p class="muted">${esc(t("Loading photos from Argus…"))}</p></div></div>
      <div class="ae-dialog-foot pic-foot">${existing ? `<button class="ae-btn ae-btn--quiet" id="pic-remove">${icon("trash")}${esc(t("Remove picture"))}</button>` : ""}<span class="spacer"></span>${state.context.applications.some((a) => a.id === "argus") ? `<button class="ae-btn" id="pic-argus">${icon("upload")}${esc(t("Upload in Argus"))}</button>` : ""}${existing ? `<button class="ae-btn ae-btn--primary" id="pic-recrop">${esc(t("Adjust crop"))}</button>` : ""}</div>`, { wide: true });
    const render = () => {
      const grid = $("#pic-grid", d);
      if (!grid) return;
      grid.removeAttribute("aria-busy");
      if (library.availability !== "available") {
        grid.innerHTML = `<div class="pic-empty">${icon("info")}<p>${esc(t(UNAVAILABLE_LIBRARY[library.availability] || "Argus is not reachable right now. Try again in a moment; the current picture is kept."))}</p></div>`;
        return;
      }
      if (!library.items.length) {
        grid.innerHTML = `<div class="pic-empty">${icon("upload")}<p>${esc(t("No photos in Argus yet. Upload one there, then come back to choose it."))}</p></div>`;
        return;
      }
      grid.innerHTML = library.items.map((it, i) => `<button class="pic-tile${existing?.photo_id === it.id ? " is-current" : ""}" data-i="${i}" title="${esc(it.title || t("Photo"))}" aria-label="${esc(it.title || t("Photo {n}", { n: i + 1 }))}">${it.thumbnail ? `<img src="${it.thumbnail}" alt="">` : `<span class="muted">${esc(t("No preview"))}</span>`}</button>`).join("") +
        (library.cursor ? `<button class="ae-btn pic-more" id="pic-more">${esc(t("Show more"))}</button>` : "");
      $$(".pic-tile", grid).forEach((b) => (b.onclick = () => cropStep(library.items[+b.dataset.i], null)));
      const more = $("#pic-more", grid);
      if (more) more.onclick = async () => {
        more.classList.add("is-busy");
        await loadMore().catch(() => {});
        render();
      };
    };
    loadMore().then(render, () => {
      library.availability = "unreachable";
      render();
    });
    const remove = $("#pic-remove", d);
    if (remove) remove.onclick = async () => {
      remove.classList.add("is-busy");
      try {
        await api(`/entities/${entity.id}/image`, "DELETE");
        entity.image = null;
        PICTURES.forget(entity.id);
        await closeDialog();
        toast(t("Picture removed. The photo stays in Argus."), "good");
      } catch (error) {
        remove.classList.remove("is-busy");
        toast(error.message, "danger");
      }
    };
    const toArgus = $("#pic-argus", d);
    if (toArgus) toArgus.onclick = () => bridge("navigate", { module: "argus" }).catch((e) => toast(e.message, "danger"));
    const recrop = $("#pic-recrop", d);
    if (recrop) recrop.onclick = () => cropStep({ id: existing.photo_id }, existing.crop);
  }
  async function cropStep(photo, crop) {
    const d = openDialog(`${head(t("Crop the picture"))}
      <div class="ae-dialog-body pic-body"><div class="pic-crop">
        <div class="pic-stage ${shape}" id="pic-stage" tabindex="0" role="application" aria-label="${esc(t("Crop area. Drag or use the arrow keys to move, plus and minus to zoom, 0 to reset."))}"><p class="muted">${esc(t("Loading the photo…"))}</p></div>
        <div class="pic-side">
          <label class="ae-label" for="pic-zoom">${esc(t("Zoom"))}</label>
          <div class="pic-zoom">${icon("minus")}<input type="range" id="pic-zoom" min="1" max="6" step="0.01" value="1" disabled>${icon("plus")}</div>
          <div class="ae-label">${esc(t("Preview"))}</div>
          <div class="pic-previews"><canvas width="176" height="176" class="pic-prev xl ${shape}" aria-hidden="true"></canvas><canvas width="88" height="88" class="pic-prev md ${shape}" aria-hidden="true"></canvas><canvas width="68" height="68" class="pic-prev sm ${shape}" aria-hidden="true"></canvas></div>
          <p class="ae-hint">${esc(t("Only the crop is saved in Meridian. The original photo stays untouched in Argus."))}</p>
        </div></div><p class="form-error" id="form-error" hidden></p></div>
      <div class="ae-dialog-foot"><button class="ae-btn ae-btn--quiet" id="pic-back">${esc(t("Choose another"))}</button><span class="spacer"></span><button class="ae-btn" id="pic-reset" disabled>${esc(t("Reset"))}</button><button class="ae-btn ae-btn--primary" id="pic-save" disabled>${esc(t("Save picture"))}</button></div>`, { wide: true });
    $("#pic-back", d).onclick = chooseStep;
    let preview;
    try {
      preview = await api(`/photo-preview/${photo.id}`);
    } catch (error) {
      preview = { status: "unavailable" };
    }
    const stage = $("#pic-stage", d);
    if (!stage) return;
    if (preview.status !== "available") {
      stage.innerHTML = `<div class="pic-empty">${icon("alert")}<p>${esc(preview.status === "trashed" ? t("This photo is in Argus's Trash. Restore it there or choose another.") : preview.status === "deleted" || preview.status === "not_found" ? t("This photo no longer exists in Argus. Choose another.") : t("Argus could not render this photo right now."))}</p></div>`;
      return;
    }
    const img = new Image();
    img.alt = "";
    img.draggable = false;
    img.src = preview.src;
    await img.decode().catch(() => {});
    const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
    stage.innerHTML = "";
    stage.append(img);
    stage.insertAdjacentHTML("beforeend", `<span class="pic-mask" aria-hidden="true"></span>`);
    const zoom = $("#pic-zoom", d);
    const V = () => stage.clientWidth || 320;
    // View state: zoom z ≥ 1 (1 = the shorter side fills the square), and the crop's
    // top-left in normalised picture coordinates.
    const view = { z: 1, x: 0, y: 0 };
    const side = () => ({ w: Math.min(1, H / W) / view.z, h: Math.min(1, W / H) / view.z });
    function clamp() {
      const { w, h } = side();
      view.x = Math.min(Math.max(view.x, 0), 1 - w);
      view.y = Math.min(Math.max(view.y, 0), 1 - h);
    }
    function reset() {
      view.z = 1;
      const { w, h } = side();
      view.x = (1 - w) / 2;
      view.y = (1 - h) * (H > W ? 0.3 : 0.5); // portraits: faces sit high
      draw();
    }
    function draw() {
      clamp();
      const { w, h } = side();
      const v = V();
      const dw = v / w, dh = v / h;
      img.style.width = `${dw}px`;
      img.style.height = `${dh}px`;
      img.style.transform = `translate(${-view.x * dw}px, ${-view.y * dh}px)`;
      zoom.value = String(view.z);
      for (const c of $$(".pic-prev", d)) {
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, view.x * W, view.y * H, w * W, h * H, 0, 0, c.width, c.height);
      }
    }
    if (crop && crop.w > 0) {
      view.z = Math.max(1, Math.min(6, Math.min(1, H / W) / crop.w));
      view.x = crop.x;
      view.y = crop.y;
      draw();
    } else reset();
    zoom.disabled = false;
    $("#pic-reset", d).disabled = false;
    $("#pic-save", d).disabled = false;
    function zoomTo(z, cx = 0.5, cy = 0.5) {
      const before = side();
      const fx = view.x + before.w * cx, fy = view.y + before.h * cy;
      view.z = Math.min(6, Math.max(1, z));
      const after = side();
      view.x = fx - after.w * cx;
      view.y = fy - after.h * cy;
      draw();
    }
    zoom.oninput = () => zoomTo(+zoom.value);
    stage.onwheel = (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomTo(view.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    const pointers = new Map();
    let pinch = null;
    stage.onpointerdown = (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
      }
    };
    stage.onpointermove = (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        return zoomTo(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.dist)));
      }
      const { w, h } = side();
      const v = V();
      view.x -= ((now.x - last.x) / v) * w;
      view.y -= ((now.y - last.y) / v) * h;
      draw();
    };
    stage.onpointerup = stage.onpointercancel = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    stage.onkeydown = (e) => {
      const { w, h } = side();
      const step = e.shiftKey ? 0.1 : 0.02;
      const keys = { ArrowLeft: () => (view.x -= w * step), ArrowRight: () => (view.x += w * step), ArrowUp: () => (view.y -= h * step), ArrowDown: () => (view.y += h * step) };
      if (keys[e.key]) {
        keys[e.key]();
        draw();
      } else if (e.key === "+" || e.key === "=") zoomTo(view.z * 1.1);
      else if (e.key === "-" || e.key === "_") zoomTo(view.z / 1.1);
      else if (e.key === "0") reset();
      else return;
      e.preventDefault();
    };
    new ResizeObserver(() => draw()).observe(stage);
    $("#pic-reset", d).onclick = reset;
    $("#pic-save", d).onclick = async (e) => {
      const button = e.currentTarget;
      button.classList.add("is-busy");
      const { w, h } = side();
      const r6 = (n) => Math.round(n * 1e6) / 1e6;
      try {
        const image = await api(`/entities/${entity.id}/image`, "PUT", { photo_id: photo.id, crop: { x: r6(view.x), y: r6(view.y), w: r6(w), h: r6(h) } });
        entity.image = image;
        PICTURES.forget(entity.id);
        await closeDialog();
        toast(t("Picture saved"), "good");
        PICTURES.schedule();
      } catch (error) {
        button.classList.remove("is-busy");
        showError(error);
      }
    };
    stage.focus();
  }
  chooseStep();
}
/** A person's name as lists and pickers show it: "First Last" or "Last, First" (Settings → People). */
const shownName = (x) => MeridianUX.listName(x, state.prefs.people_display);
function personRow(p, end = "", attrs = "") {
  const second = [p.work, p.email || p.phone].filter(Boolean).join(" · ");
  return `<button class="row" data-act="open-person" data-id="${esc(p.id)}" ${attrs}>
    ${avatar(p.display_name, p.id, p.is_self ? "self" : "")}
    <span class="grow"><span class="primary">${esc(shownName(p))}${p.is_self ? ' <span class="self-badge">@me</span>' : ""}</span>${second ? `<span class="secondary">${esc(second)}</span>` : ""}</span>
    ${end}</button>`;
}
const KIND_LABEL = { birth: "Birthday", name_day: "Name day", anniversary: "Anniversary", death: "Death", custom: "Date" };
const dateKind = (r) => r.label || t(KIND_LABEL[r.kind] || r.kind.replace(/_/g, " "));
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? t("Good evening") : h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
}

/* ───────────────────────── Dashboard ───────────────────────── */

async function viewDashboard(sheet, token) {
  setTitle([{ label: t("Dashboard") }]);
  const data = await api("/dashboard" + query({ today: todayIso() }));
  if (stale(token)) return;
  state.counts = data.counts;
  state.self = data.self;
  renderNav();
  const self = data.self;
  const first = self?.display_name?.split(" ")[0];
  const heading = first ? `${greeting()}, ${first}` : t("Welcome to Meridian");
  const empty = data.counts.people === 0;
  const days = data.upcoming_days;
  const [next, ...later] = data.upcoming;
  const date = fmt({ weekday: "long", day: "numeric", month: "long" }, ...todayIso().split("-").map(Number));
  const last = data.last_import;
  const meta = empty
    ? [`<span>${esc(t("A private place for the people in your life and what you know about them."))}</span>`]
    : [
        `<span>${esc(plural(data.counts.people, "{count} person", "{count} people"))}</span>`,
        `<span>${esc(data.upcoming.length ? plural(data.upcoming.length, "{count} date in the next {days} days", "{count} dates in the next {days} days", { days }) : t("No dates in the next {days} days", { days }))}</span>`,
        last ? `<span>${esc(t("Last import {when}", { when: relativeTime(last.created_at) }))}</span>` : "",
        self ? "" : `<button class="link" data-act="choose-self">${esc(t("Which of these people is you?"))}</button>`,
      ].filter(Boolean);
  const identity = self
    ? `<button class="dash-self" data-act="open-person" data-id="${esc(self.id)}" aria-label="${esc(t("Open your profile"))}" title="${esc(t("Your profile"))}">${avatar(self.display_name, self.id, "lg self")}</button>`
    : "";

  // The next occasion is the one thing worth seeing first; the timeline continues after it.
  const spotlight = next
    ? `<button class="spotlight ${next.in_days <= 7 ? "is-soon" : ""}" data-act="open-person" data-id="${esc(next.person_id)}">
        <span class="spot-label">${esc(t("Next occasion"))}</span>
        <span class="spot-person">${avatar(next.display_name, next.person_id, "md")}<span class="grow"><span class="primary">${esc(next.display_name)}</span><span class="secondary">${esc(occasion(next))}</span></span></span>
        <span class="spot-when"><span class="spot-count">${countdown(next.in_days)}</span><span class="spot-day">${esc(longDay(next.on))}</span></span>
      </button>`
    : "";
  let month = "";
  const timeline = later.map((u) => {
    const [, mm, dd] = u.on.split("-");
    const label = fmt({ month: "long" }, 2000, +mm, 1);
    const head = label !== month ? `<p class="list-label">${esc(label)}</p>` : "";
    month = label;
    return `${head}<button class="row tl-row" data-act="open-person" data-id="${esc(u.person_id)}">
      <span class="tl-date"><b>${+dd}</b><small>${esc(fmt({ month: "short" }, 2000, +mm, 1))}</small></span>
      ${avatar(u.display_name, u.person_id, "sm")}
      <span class="grow"><span class="primary">${esc(u.display_name)}</span><span class="secondary">${esc(occasion(u))}</span></span>
      <span class="end ${u.in_days <= 7 ? "is-soon" : ""}">${esc(inDays(u.in_days))}</span></button>`;
  });
  const tiles = data.recent.map(
    (p) => `<button class="person-tile" data-act="open-person" data-id="${esc(p.id)}">
      ${avatar(p.display_name, p.id, `md ${p.is_self ? "self" : ""}`)}
      <span class="grow"><span class="primary">${esc(p.display_name)}${p.is_self ? ' <span class="self-badge">@me</span>' : ""}</span><span class="secondary">${esc(p.work || p.email || p.phone || t("No details yet"))}</span><span class="when">${esc(t("Updated {when}", { when: relativeTime(p.updated_at) }))}</span></span></button>`,
  );
  const dot = '<span class="dot" aria-hidden="true">·</span>';
  sheet.innerHTML = `<div class="page banded dash">
    <header class="band"><div class="wrap dash-top">
      <div class="dash-intro">
        ${identity}
        <div class="grow"><p class="eyebrow">${esc(date)}</p><h2 class="display" data-heading tabindex="-1">${esc(heading)}</h2><p class="meta-line">${meta.join(dot)}</p></div>
      </div>
      ${spotlight}
      ${empty ? "" : `<div class="search-box" id="dash-search-box">${icon("search")}
        <input class="ae-input" id="dash-search" type="search" role="combobox" aria-expanded="false" aria-controls="dash-results" aria-autocomplete="list" placeholder="${esc(searchPlaceholder())}" aria-label="${esc(t("Search people"))}" maxlength="200" autocomplete="off">
        <kbd class="ae-kbd" aria-hidden="true">/</kbd>
        <div class="search-results" id="dash-results" role="listbox" hidden></div></div>`}
    </div></header>
    <div class="wrap body">
    ${empty
      ? `<section class="welcome"><p>${esc(t("Start by importing the contacts you already have — a .vcf file from your phone, mail or address book. Meridian shows you every contact first and changes nothing until you choose. Or add someone by hand with New person."))}</p><div class="actions"><button class="ae-btn ae-btn--primary" data-act="go" data-view="import">${icon("upload")}<span>${esc(t("Import contacts"))}</span></button></div><p class="muted">${esc(t("Everything stays in your own Aureate Empyrean installation."))}</p></section>`
      : `<div class="dash-grid">
        <section class="dsection" aria-labelledby="h-upcoming"><div class="section-head"><h3 id="h-upcoming">${icon("calendar")}${esc(t("Coming up"))}</h3><span class="muted">${esc(plural(days, "next {count} day", "next {count} days"))}</span></div>
          ${timeline.length ? `<div class="list">${timeline.join("")}</div>` : `<p class="list list-empty">${esc(next ? t("Nothing else in the next {count} days.", { count: days }) : t("No birthdays, name days or anniversaries in the next {count} days. Dates appear here once their day and month are known.", { count: days }))}</p>`}</section>
        <section class="dsection" aria-labelledby="h-recent"><div class="section-head"><h3 id="h-recent">${icon("people")}${esc(t("Recently updated"))}</h3><button class="link" data-act="go" data-view="people">${esc(t("All people"))}</button></div>
          <div class="people-grid">${tiles.join("")}</div></section>
      </div>`}
    </div>
  </div>`;
  if (!empty) bindSearch($("#dash-search"), $("#dash-results"));
}
const occasion = (u) =>
  [dateKind(u), u.years !== null && u.years !== undefined ? (u.kind === "birth" ? t("turns {n}", { n: u.years }) : plural(u.years, "{count} year", "{count} years")) : ""].filter(Boolean).join(" · ");
const longDay = (iso) => fmt({ weekday: "long", day: "numeric", month: "long" }, ...iso.split("-").map(Number));
/** A countdown as a number and a unit, so the number can carry the weight. */
function countdown(n) {
  if (n === 0) return `<b>${esc(t("Today"))}</b>`;
  if (n === 1) return `<b>${esc(t("Tomorrow"))}</b>`;
  return `<b>${n}</b><small>${esc(plural(n, "day", "days"))}</small>`;
}

/** Search with a results list: arrow keys move, Enter opens, Escape closes. */
const PHONE = matchMedia("(max-width: 640px)");
const searchPlaceholder = () => (PHONE.matches ? t("Search people") : t("Name, phone, email or organization"));
PHONE.addEventListener("change", () => {
  const input = $("#dash-search");
  if (input) input.placeholder = searchPlaceholder();
});
function bindSearch(input, box) {
  let active = -1;
  let items = [];
  const show = (open) => {
    box.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };
  const highlight = (index) => {
    active = index;
    $$(".row", box).forEach((row, i) => {
      row.classList.toggle("is-active", i === index);
      row.setAttribute("aria-selected", String(i === index));
    });
    const row = $$(".row", box)[index];
    if (row) {
      input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) return show(false);
    const result = await api("/search" + query({ q })).catch(() => ({ people: [] }));
    if (input.value.trim() !== q) return;
    items = result.people;
    const wasHidden = box.hidden;
    box.innerHTML = items.length
      ? `<div class="rows">${items.map((p, i) => personRow(p, "", `role="option" id="result-${i}" tabindex="-1" aria-selected="false"`)).join("")}</div>`
      : `<p class="empty">${esc(result.self_missing ? t("No one is marked as you yet. Choose who you are in Settings → You.") : t("No one matches “{q}”.", { q }))}</p>`;
    show(true);
    active = -1;
    if (wasHidden) animate(box, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
  }, 150);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (event) => {
    const count = $$(".row", box).length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      highlight((active + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      highlight((active - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && items[active]) openPerson(items[active].id, $$(".row", box)[active]);
      else if (items.length === 1 && !box.hidden) openPerson(items[0].id, $(".row", box));
      else if (input.value.trim()) {
        state.people.q = input.value.trim();
        go("people");
      }
    } else if (event.key === "Escape" && !box.hidden) {
      event.stopPropagation();
      show(false);
    }
  });
  input.addEventListener("blur", () => setTimeout(() => !box.contains(document.activeElement) && show(false), 120));
}

/* ───────────────────────── Shared screen pieces ───────────────────────── */

/** The identity band of a list screen: heading, a factual meta line, actions, tools below. */
function screenBand({ eyebrow = "", title, meta = [], actions = "", below = "" }) {
  return `<header class="band"><div class="wrap screen-top">
    <div class="screen-title">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h2 class="display" data-heading tabindex="-1">${esc(title)}</h2>${meta.length ? `<p class="meta-line" id="screen-meta">${meta.join(DOT)}</p>` : ""}</div>
    ${actions ? `<div class="screen-actions">${actions}</div>` : ""}
    ${below ? `<div class="screen-tools">${below}</div>` : ""}
  </div></header>`;
}
/** One empty state for every screen: what is missing, why, and the way forward. */
function emptyState(iconName, title, text = "", actions = "") {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
}
/** A segmented control of toggle buttons; exactly one is pressed. */
function segmented(act, label, options, current) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${options
    .map(([value, text, iconName]) => `<button class="seg-btn" data-act="${act}" data-value="${esc(value)}" aria-pressed="${value === current}" ${iconName ? `title="${esc(text)}"` : ""}>${iconName ? icon(iconName) : ""}<span class="${iconName ? "seg-label" : ""}">${esc(text)}</span></button>`)
    .join("")}</div>`;
}
function pressOnly(group, button) {
  $$(".seg-btn", group).forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
}
/** Case- and accent-insensitive form, as the server compares ("Ján" ~ "jan"). */
const foldText = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** Mark the parts of a text that the search words match, ignoring case and accents. */
function highlight(text, q) {
  const words = foldText(q).split(" ").filter(Boolean);
  const value = String(text || "");
  if (!words.length || !value) return esc(value);
  const chars = [...value];
  let folded = "";
  const map = [];
  chars.forEach((c, i) => {
    const f = /\s/.test(c) ? " " : foldText(c);
    for (const ch of f) {
      folded += ch;
      map.push(i);
    }
  });
  const marked = new Array(chars.length).fill(false);
  for (const w of words)
    for (let at = folded.indexOf(w); at !== -1; at = folded.indexOf(w, at + w.length))
      for (let k = at; k < at + w.length; k++) marked[map[k]] = true;
  let out = "";
  let open = false;
  chars.forEach((c, i) => {
    if (marked[i] !== open) {
      out += open ? "</mark>" : "<mark>";
      open = marked[i];
    }
    out += esc(c);
  });
  return out + (open ? "</mark>" : "");
}
const scrollPos = () => $("#sheet")?.scrollTop || document.body.scrollTop || document.scrollingElement?.scrollTop || 0;

/* ───────────────────────── People directory ───────────────────────── */

const FILTER_LABELS = { phone: "Phone", email: "Email", birthday: "Birthday", work: "Work", imported: "Imported" };
const SORT_OPTIONS = [["name", "Name"], ["updated", "Last updated"], ["created", "Date added"]];
const VIEW_KEY = "meridian.people.view";
function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}
let peopleToken = 0;
/** Load the directory. Returns false when a newer request has started meanwhile. */
async function loadPeople(more = false) {
  const p = state.people;
  if (!more) {
    p.limit = p.restoreLimit || 100;
    delete p.restoreLimit;
  }
  const token = ++peopleToken;
  const data = await api("/people" + query({ q: p.q, has: [...p.has].join(","), sort: p.sort, limit: p.limit }));
  if (token !== peopleToken) return false;
  p.items = data.items;
  p.total = data.total;
  return true;
}
function peopleCount() {
  const p = state.people;
  const all = Math.max(state.counts.people || 0, p.total);
  return p.q || p.has.size ? t("{n} of {total} people", { n: p.total, total: all }) : plural(p.total, "{count} person", "{count} people");
}
async function viewPeople(sheet, token) {
  setTitle([{ label: t("People") }]);
  const p = state.people;
  p.view ??= savedView();
  await loadPeople();
  if (stale(token)) return;
  const chips = Object.entries(FILTER_LABELS)
    .map(([k, l]) => `<button class="filter-chip" data-act="filter" data-filter="${k}" aria-pressed="${p.has.has(k)}">${icon("check")}<span>${esc(t(l))}</span></button>`)
    .join("");
  const tools = `<div class="dir-tools">
      <div class="search-box dir-search">${icon("search")}<input class="ae-input" id="people-q" type="search" placeholder="${esc(t("Name, phone, email or organization"))}" aria-label="${esc(t("Search people"))}" aria-controls="people-list" maxlength="200" value="${esc(p.q)}" autocomplete="off"><kbd class="ae-kbd" aria-hidden="true">/</kbd></div>
      ${segmented("sort", t("Sort by"), SORT_OPTIONS.map(([v, l]) => [v, t(l)]), p.sort)}
      ${segmented("view", t("View"), [["list", t("List"), "list"], ["grid", t("Cards"), "grid"]], p.view)}
    </div>
    <div class="filter-chips" role="group" aria-label="${esc(t("Only people with"))}"><span class="filter-label">${esc(t("Only with"))}</span>${chips}</div>`;
  sheet.innerHTML = `<div class="page banded dir">
    ${screenBand({ title: t("People"), meta: [`<span id="people-count" aria-live="polite">${esc(peopleCount())}</span>`], actions: `<button class="ae-btn" data-act="go" data-view="import">${icon("upload")}<span>${esc(t("Import contacts"))}</span></button>`, below: tools })}
    <div class="wrap body"><div id="people-list"></div></div></div>`;
  renderPeopleList();
  const input = $("#people-q");
  const run = debounce(() => {
    state.people.q = input.value.trim();
    refreshPeople();
  }, 160);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      $("#people-list [data-act='open-person']")?.focus();
    } else if (event.key === "Escape" && input.value) {
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
      run();
    }
  });
}
function dirRow(x, q) {
  const line = [x.preferred ? esc(t("Goes by {name}", { name: x.preferred })) : "", x.work ? highlight(x.work, q) : ""].filter(Boolean).join(DOT);
  const when = state.people.sort === "created" ? t("Added {when}", { when: relativeTime(x.created_at) }) : t("Updated {when}", { when: relativeTime(x.updated_at) });
  return `<button class="row dir-row" data-act="open-person" data-id="${esc(x.id)}">
    ${avatar(x.display_name, x.id, x.is_self ? "self" : "")}
    <span class="who"><span class="primary"><span class="nm">${highlight(shownName(x), q)}</span>${x.is_self ? ' <span class="self-badge">@me</span>' : ""}</span>${line ? `<span class="secondary">${line}</span>` : ""}</span>
    <span class="reach">${x.email ? `<span class="reach-item">${icon("mail")}<span>${highlight(x.email, q)}</span></span>` : ""}${x.phone ? `<span class="reach-item">${icon("phone")}<span>${highlight(x.phone, q)}</span></span>` : ""}${!x.email && !x.phone ? `<span class="reach-item muted">${esc(t("No phone or email"))}</span>` : ""}</span>
    <span class="end">${esc(when)}</span></button>`;
}
function dirCard(x, q) {
  return `<button class="person-tile dir-card" data-act="open-person" data-id="${esc(x.id)}">
    ${avatar(x.display_name, x.id, `md ${x.is_self ? "self" : ""}`)}
    <span class="grow"><span class="primary"><span class="nm">${highlight(shownName(x), q)}</span>${x.is_self ? ' <span class="self-badge">@me</span>' : ""}</span>
      ${x.work ? `<span class="secondary">${highlight(x.work, q)}</span>` : x.preferred ? `<span class="secondary">${esc(t("Goes by {name}", { name: x.preferred }))}</span>` : ""}
      ${x.email ? `<span class="card-line">${icon("mail")}<span>${highlight(x.email, q)}</span></span>` : ""}
      ${x.phone ? `<span class="card-line">${icon("phone")}<span>${highlight(x.phone, q)}</span></span>` : ""}</span></button>`;
}
function renderPeopleList({ fade = false } = {}) {
  const p = state.people;
  const box = $("#people-list");
  if (!box) return;
  const count = $("#people-count");
  if (count) count.textContent = peopleCount();
  box.classList.remove("is-busy");
  box.setAttribute("aria-busy", "false");
  if (!p.items.length) {
    const searched = p.q || p.has.size;
    box.innerHTML = searched
      ? emptyState(
          "search",
          p.q ? t("No one matches “{q}”", { q: p.q }) : t("No one has all of these"),
          p.q ? t("Search looks at names, phone numbers, email addresses, organizations and notes. Try part of a name or the last digits of a number.") : t("Each filter narrows the list further. Remove one to see more people."),
          [p.q ? `<button class="ae-btn" data-act="clear-search">${esc(t("Clear search"))}</button>` : "", p.has.size ? `<button class="ae-btn" data-act="clear-filters">${esc(t("Clear filters"))}</button>` : ""].join(""),
        )
      : emptyState("people", t("No people yet"), t("Add someone you know, or bring in the contacts you already have from a .vcf file."), `<button class="ae-btn ae-btn--primary" data-act="new-person">${icon("plus")}<span>${esc(t("New person"))}</span></button><button class="ae-btn" data-act="go" data-view="import">${icon("upload")}<span>${esc(t("Import contacts"))}</span></button>`);
  } else {
    const items = p.view === "grid" ? `<div class="people-grid dir-grid">${p.items.map((x) => dirCard(x, p.q)).join("")}</div>` : `<div class="list dir-list">${p.items.map((x) => dirRow(x, p.q)).join("")}</div>`;
    box.innerHTML = items + (p.items.length < p.total ? `<div class="more-row"><button class="ae-btn" data-act="more-people">${esc(t("Show {n} more", { n: Math.min(100, p.total - p.items.length) }))}</button><span class="muted">${esc(t("{shown} of {total} shown", { shown: p.items.length, total: p.total }))}</span></div>` : "");
  }
  if (fade) animate(box, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], MOTION.page);
}
/** Re-query after a search, sort or filter change; an older answer never paints over a newer one. */
async function refreshPeople({ fade = false } = {}) {
  const box = $("#people-list");
  const slow = setTimeout(() => {
    box?.classList.add("is-busy");
    box?.setAttribute("aria-busy", "true");
  }, 120);
  try {
    if (await loadPeople()) renderPeopleList({ fade });
  } catch (error) {
    if (box?.isConnected) box.innerHTML = emptyState("alert", t("People could not be loaded"), error.message, `<button class="ae-btn" data-act="people-retry">${esc(t("Try again"))}</button>`);
  } finally {
    clearTimeout(slow);
  }
}

/* ───────────────────────── Person profile ───────────────────────── */

const SECTION_KEYS = {
  names: ["id", "kind", "value", "given", "middle", "family", "prefix", "suffix"],
  contacts: ["id", "channel", "value", "label", "is_primary"],
  addresses: ["id", "label", "street", "extended", "po_box", "locality", "region", "postal_code", "country", "formatted", "is_primary", "latitude", "longitude", "geo_precision", "geo_key"],
  dates: ["id", "kind", "label", "date", "description", "approximate"],
  employments: ["id", "organization", "organization_id", "title", "department", "role"],
  accounts: ["id", "service", "handle", "display_name", "url", "state"],
  facts: ["id", "key", "value"],
  education: ["id", "organization", "organization_id", "kind", "department", "program", "field", "degree", "status", "achievements"],
  interests: ["id", "category", "subject", "sentiment", "context", "target_kind", "target_ref"],
};
const COMMON = ["valid_from", "valid_until", "confidence", "note"];
const NULLABLE = new Set(["valid_from", "valid_until", "confidence", "date", "target_ref", "organization_id", "latitude", "longitude"]);
/* 0.7.0 (roadmap Phase 3): open vocabularies offered by the interface; any other word is kept. */
const EDUCATION_KINDS = { primary_school: "Primary school", secondary_school: "Secondary school", university: "University", course: "Course", certification: "Certification", training: "Training", other: "Other" };
const EDUCATION_STATUS = { studying: "Studying", graduated: "Graduated", dropped_out: "Dropped out", interrupted: "Interrupted", unknown: "Unknown" };
const INTEREST_CATEGORIES = { hobbies: "Hobbies", sports: "Sports", music: "Music", films_tv: "Films and TV", books: "Books", games: "Games", art: "Art", technology: "Technology", science: "Science", history: "History", travel: "Travel", fashion: "Fashion", food: "Food and drink", vehicles: "Vehicles", collecting: "Collecting", communities: "Communities", topics: "Topics", other: "Other" };
const SENTIMENTS = { favorite: "Favorite", loves: "Loves", likes: "Likes", preferred: "Prefers", neutral: "Neutral", dislikes: "Dislikes", avoids: "Avoids", hates: "Hates" };
const vocab = (map, key) => (key ? t(map[key] || cap(String(key).replace(/_/g, " "))) : "");
/** The editable document of a loaded person, in the shape the API accepts. */
function editable(person) {
  const doc = { notes: person.notes || "", ...(person.kind && person.kind !== "person" ? { kind: person.kind } : {}) };
  for (const [section, keys] of Object.entries(SECTION_KEYS))
    doc[section] = (person[section] || []).map((r) => {
      const out = {};
      for (const k of [...keys, ...COMMON]) {
        let v = r[k];
        if (NULLABLE.has(k) && (v === "" || v === undefined)) v = null;
        if (v === undefined) v = "";
        out[k] = v;
      }
      return out;
    });
  return doc;
}
async function viewPerson(sheet, token) {
  const pre = state.prefetch?.id === state.route.id ? state.prefetch.promise : null;
  state.prefetch = null;
  const person = await (pre || api(`/people/${state.route.id}`));
  if (stale(token)) return;
  state.person = person;
  setTitle([{ label: t("People"), view: "people" }, { label: person.display_name }]);
  if (person.deleted_at) {
    sheet.innerHTML = `<div class="page banded">${screenBand({ title: person.display_name, meta: [`<span>${esc(t("In Trash since {when}", { when: relativeTime(person.deleted_at) }))}</span>`] })}<div class="wrap body">${emptyState("trash", t("{name} is in Trash", { name: person.display_name }), t("Restore this person to see and edit their profile again."), `<button class="ae-btn ae-btn--primary" data-act="restore" data-id="${esc(person.id)}">${icon("restore")}<span>${esc(t("Restore"))}</span></button><button class="ae-btn" data-act="go" data-view="trash">${esc(t("Open Trash"))}</button>`)}</div></div>`;
    return;
  }
  if (!TABS(person).some(([k]) => k === state.tab)) state.tab = "overview";
  sheet.innerHTML = `<div class="page banded" id="person-page">${personPage(person)}</div>`;
  requestAnimationFrame(() => placeTabInk(true));
  runPendingEdit();
}
/** Re-render after an edit without a page transition. */
function refreshPerson() {
  const page = $("#person-page");
  if (!page) return;
  const p = state.person;
  setTitle([{ label: t(KIND_PLURAL[p.kind]), view: KIND_VIEW[p.kind] }, { label: p.display_name }]);
  if (!TABS(p).some(([k]) => k === state.tab)) state.tab = "overview";
  page.innerHTML = personPage(p);
  placeTabInk(true);
}
function primary(p, channel) {
  const current = p.contacts.filter((c) => c.channel === channel && !c.valid_until);
  return current.find((c) => c.is_primary) || current[0];
}
const DOT = '<span class="dot" aria-hidden="true">·</span>';
function firstName(p) {
  const full = p.names.find((n) => n.kind === "full" && n.given);
  return full?.given || p.display_name.split(" ")[0];
}
/** Where someone lives, in a few words, from their primary (or first current) address. */
function place(p) {
  const current = p.addresses.filter((a) => !a.valid_until);
  const a = current.find((x) => x.is_primary) || current[0];
  if (!a) return "";
  return [a.locality, a.country].filter(Boolean).join(", ") || a.region || "";
}
/** The whole profile page: an identity band (header and tabs), then the open tab. */
function personPage(p) {
  return `<div class="band"><div class="wrap">${personHeader(p)}${personTabs(p)}</div></div>
    <div class="wrap body"><div id="tab-body" role="tabpanel" aria-labelledby="tab-${state.tab}">${tabContent(p)}</div></div>`;
}
function personHeader(p) {
  const isPerson = p.kind === "person";
  const preferred = p.names.find((n) => n.kind === "preferred" && !n.valid_until);
  const aliases = p.names.filter((n) => ["nickname", "alias", "abbreviation"].includes(n.kind) && !n.valid_until).map((n) => n.value);
  const work = isPerson && p.employments.find((e) => !e.valid_until);
  const sub = work ? [work.title || work.role, work.organization].filter(Boolean).join(" · ") : "";
  const where = place(p);
  const counted = !isPerson
    ? p.kind === "organization"
      ? plural(p.work_here.filter((w) => !w.valid_until && !w.deleted).length, "{count} person at work here", "{count} people at work here")
      : plural(p.memberships.filter((m) => m.state !== "former").length, "{count} current member", "{count} current members")
    : "";
  const meta = [
    !isPerson && `<span class="meta-item">${icon(p.kind === "organization" ? "organizations" : "groups")}${esc(t(KIND_NOUN[p.kind]))}</span>`,
    counted && `<span class="meta-item">${esc(counted)}</span>`,
    where && `<span class="meta-item">${icon("pin")}${esc(where)}</span>`,
    preferred && `<span class="meta-item">${icon("names")}${esc(t("Goes by {name}", { name: preferred.value }))}</span>`,
    aliases.length && `<span class="meta-item">${icon("names")}${esc(t("Also {names}", { names: aliases.join(", ") }))}</span>`,
  ].filter(Boolean);
  const email = primary(p, "email");
  const phone = primary(p, "phone");
  return `<header class="profile-head">
    ${p.deleted_at ? avatar(p.display_name, p.id, `xl is-${p.kind} ${p.is_self ? "self" : ""}`) : `<button class="avatar-edit" data-act="pick-image" aria-label="${esc(p.image ? t("Change picture") : t("Add a picture"))}" title="${esc(p.image ? t("Change picture") : t("Add a picture"))}">${avatar(p.display_name, p.id, `xl is-${p.kind} ${p.is_self ? "self" : ""}`)}<span class="avatar-edit-badge" aria-hidden="true">${icon(p.image ? "edit" : "plus")}</span></button>`}
    <div class="identity"><h2 class="person-name" data-heading tabindex="-1">${esc(p.display_name)}${p.is_self ? '<span class="self-badge" title="' + esc(t("This is you")) + '">@me</span>' : ""}</h2>
      ${sub ? `<p class="profile-sub">${esc(sub)}</p>` : ""}
      ${meta.length ? `<p class="meta-line">${meta.join(DOT)}</p>` : ""}</div>
    <div class="profile-actions">
      ${email ? `<button class="ae-btn" data-act="external" data-url="mailto:${esc(email.value)}" title="${esc(email.value)}">${icon("mail")}<span>${esc(t("Email"))}</span></button>` : ""}
      ${phone ? `<button class="ae-btn" data-act="copy" data-value="${esc(phone.value)}" title="${esc(phone.value)}">${icon("phone")}<span>${esc(t("Copy number"))}</span></button>` : ""}
      <button class="ae-btn" data-act="edit" data-section="${isPerson ? "contacts" : "names"}">${icon("edit")}<span>${esc(t("Edit"))}</span></button>
      <button class="ae-btn ae-btn--icon" data-act="person-menu" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("More actions"))}">${icon("more")}</button>
    </div>
  </header>`;
}
const TABS = (p) => [
  ["overview", t("Profile")],
  ["timeline", t("Timeline")],
  ["names", t("Names"), p.names.length > 1 ? p.names.length : 0],
  ...(p.imported.length ? [["imported", t("Imported data"), p.imported.length]] : []),
  ["record", t("Record")],
];
function personTabs(p) {
  return `<div class="tabs" role="tablist" aria-label="${esc(t("Profile sections"))}">${TABS(p)
    .map(([k, l, n]) => `<button class="tab" role="tab" id="tab-${k}" data-act="tab" data-tab="${k}" aria-selected="${state.tab === k}" aria-controls="tab-body" tabindex="${state.tab === k ? 0 : -1}">${esc(l)}${n ? `<span class="badge">${n}</span>` : ""}</button>`)
    .join("")}<span class="tab-ink" aria-hidden="true"></span></div>`;
}
function placeTabInk(instant = false) {
  const tabs = $(".tabs");
  const ink = $(".tab-ink", tabs || document);
  const current = $('.tab[aria-selected="true"]', tabs || document);
  if (!tabs || !ink || !current) return;
  if (instant) ink.style.transition = "none";
  ink.style.width = `${current.offsetWidth - 20}px`;
  ink.style.transform = `translateX(${current.offsetLeft + 10}px)`;
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => (ink.style.transition = "")));
}
let tabToken = 0;
/** Tab change: the underline slides, the old panel fades out quickly, the new one fades in. */
async function switchTab(name, focus = false) {
  if (state.tab === name) return;
  const token = ++tabToken;
  state.tab = name;
  $$(".tab").forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  });
  placeTabInk();
  const body = $("#tab-body");
  await animate(body, [{ opacity: 1 }, { opacity: 0 }], 70, MOTION.exitEase);
  if (token !== tabToken) return;
  body.setAttribute("aria-labelledby", `tab-${name}`);
  body.innerHTML = tabContent(state.person);
  animate(body, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], 170);
}
function tabContent(p) {
  return ({ overview: tabOverview, timeline: tabTimeline, names: tabNames, imported: tabImported, record: tabRecord }[state.tab] || tabOverview)(p);
}

/** A profile section: a heading, its records in one list, and one way in to editing. */
function psection(key, title, iconName, rows, emptyText, addLabel) {
  const head = `<div class="section-head"><h3>${icon(iconName)}${esc(title)}${rows.length ? ` <span class="count">${rows.length}</span>` : ""}</h3>${rows.length ? `<button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="edit" data-section="${key}" aria-label="${esc(t("Edit {section}", { section: title }))}">${icon("edit")}<span>${esc(t("Edit"))}</span></button>` : ""}</div>`;
  const body = rows.length
    ? `<div class="list vrows">${rows.join("")}</div>`
    : `<div class="list list-empty"><span>${esc(emptyText)}</span><button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="edit" data-section="${key}">${icon("plus")}<span>${esc(addLabel)}</span></button></div>`;
  return `<section class="psection" data-section="${key}">${head}${body}</section>`;
}
const recordSub = (r) => [period(r), r.confidence ? t("confidence: {c}", { c: t(r.confidence) }) : "", r.note].filter(Boolean).join(" · ");
const act = (name, label, attrs) => `<button class="ae-btn ae-btn--quiet ae-btn--icon ae-btn--sm act" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`;
function vrow(label, value, { sub = "", former = false, acts = "", strong = false, primary: isPrimary = false, attr = "" } = {}) {
  return `<div class="vrow ${former ? "former" : ""}" ${attr}><span class="label">${esc(label)}${isPrimary ? ` <span class="primary-mark">${esc(t("primary"))}</span>` : ""}</span><span class="value ${strong ? "strong" : ""}">${value}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</span><span class="acts">${acts}</span></div>`;
}
function addressText(a) {
  if (a.formatted) return a.formatted;
  return [a.po_box, a.extended, a.street, [a.postal_code, a.locality].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).join("\n");
}
/** What the Profile tab can hold, in reading order, per kind. Empty ones become "add" chips. */
const PROFILE_SECTIONS = {
  person: [
    ["contacts", "Contact", "phone", "Phone or email"],
    ["employments", "Work", "briefcase", "Work"],
    ["education", "Education", "school", "Education"],
    ["relationships", "Relationships", "link", "Relationship"],
    ["interests", "Interests and preferences", "heart", "Interest or preference"],
    ["interactions", "Interactions", "chat", "Interaction"],
    ["addresses", "Addresses", "pin", "Address"],
    ["accounts", "Online accounts", "at", "Online account"],
    ["notes", "Notes", "note", "Note"],
    ["facts", "Other details", "info", "Detail"],
  ],
  organization: [
    ["work_here", "People at work here", "briefcase", ""],
    ["studied_here", "People who studied here", "school", ""],
    ["relationships", "Relationships", "link", "Relationship"],
    ["interactions", "Interactions", "chat", "Interaction"],
    ["contacts", "Contact", "phone", "Phone, email or website"],
    ["addresses", "Addresses", "pin", "Address"],
    ["accounts", "Online accounts", "at", "Online account"],
    ["notes", "About", "note", "Description"],
    ["facts", "Other details", "info", "Detail"],
  ],
  group: [
    ["members", "Members", "people", "Member"],
    ["relationships", "Relationships", "link", "Relationship"],
    ["interactions", "Interactions", "chat", "Interaction"],
    ["notes", "About", "note", "Description"],
    ["facts", "Other details", "info", "Detail"],
  ],
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const CONFIDENCE_TAG = { low: "Uncertain", unknown: "Confidence unknown" };
/** One line of how something is known: period, confidence (only when doubtful) and sources. */
function knownBy(r) {
  const bits = [];
  const span = period(r);
  if (span) bits.push(esc(span));
  if (CONFIDENCE_TAG[r.confidence]) bits.push(`<span class="conf-tag">${icon("alert")}${esc(t(CONFIDENCE_TAG[r.confidence]))}</span>`);
  if (r.sources?.length) bits.push(esc(sourceText(r.sources)));
  if (r.note) bits.push(esc(r.note.length > 90 ? r.note.slice(0, 90) + "…" : r.note));
  return bits.join(" · ");
}
const SOURCE_KINDS = { observed: "Observed it myself", told: "Told by someone", document: "Document or record", imported: "Imported", other: "Other" };
function sourceText(sources) {
  const first = sources[0];
  const who = first.entity_name || first.label;
  const what = { observed: t("observed"), document: t("document"), imported: t("imported"), other: t("source") }[first.kind] || first.kind;
  const text = first.kind === "told" ? (who ? t("told by {who}", { who }) : t("told by someone")) : who ? `${what}: ${who}` : what;
  return sources.length > 1 ? t("{first} · +{n} sources", { first: text, n: sources.length - 1 }) : text;
}
/** A connection row: what the other side is to this one, who, and how it is known. */
function connectionRow(r, { label, other, extra = "", act }) {
  const gone = other.deleted;
  return `<div class="vrow conn-row ${r.state === "former" ? "former" : ""}" data-record="${r.record}" data-id="${esc(r.id)}">
    <span class="label">${esc(label)}</span>
    <span class="value"><button class="conn-other" data-act="open-entity" data-id="${esc(other.id)}" data-kind="${other.kind}" ${gone ? "disabled" : ""}>${avatar(other.display_name, other.id, `sm is-${other.kind}`)}<span class="nm">${esc(other.display_name)}</span>${gone ? `<span class="muted">${esc(t("(in Trash)"))}</span>` : ""}</button>
      ${extra || knownBy(r) ? `<span class="sub">${[extra, knownBy(r)].filter(Boolean).join(" · ")}</span>` : ""}</span>
    <span class="acts">${act}</span></div>`;
}
function relationRows(p) {
  const rows = p.relationships.map((r) => ({
    r,
    html: connectionRow(r, {
      label: cap(t(r.phrase)),
      other: r.other,
      // The ordinary wording stays ("Sibling of"); how the kinship came about is the detail.
      extra: [r.type === "parent" && r.kinship === "biological" ? "" : kinshipText(r.type, r.kinship), r.context ? `“${r.context}”` : ""].filter(Boolean).map(esc).join(" · "),
      act: act("edit", t("Edit relationship"), `data-act="edit-relation" data-id="${esc(r.id)}"`),
    }),
  }));
  const groups = p.memberships
    .filter((m) => m.member?.id === p.id)
    .map((m) => ({
      r: m,
      html: connectionRow(m, {
        label: t("Member of"),
        other: m.group,
        extra: m.role ? esc(m.role) : "",
        act: act("edit", t("Edit membership"), `data-act="edit-membership" data-id="${esc(m.id)}"`),
      }),
    }));
  return historyOrdered([...rows, ...groups]);
}
/** Current first, then history under its own label: an ended relationship stays visible. */
function historyOrdered(items) {
  const now = items.filter((x) => x.r.state !== "former").map((x) => x.html);
  const past = items.filter((x) => x.r.state === "former").map((x) => x.html);
  if (!past.length) return now;
  return [...now, `<p class="list-label conn-history">${esc(t("History"))}</p>`, ...past];
}
function memberRows(p) {
  return historyOrdered(
    p.memberships
      .filter((m) => m.group?.id === p.id)
      .map((m) => ({
        r: m,
        html: connectionRow(m, {
          label: m.role ? cap(m.role) : t("Member"),
          other: m.member,
          act: act("edit", t("Edit membership"), `data-act="edit-membership" data-id="${esc(m.id)}"`),
        }),
      })),
  );
}
function workHereRows(p) {
  return historyOrdered(
    p.work_here.map((w) => ({
      r: { ...w, state: w.valid_until ? "former" : "current" },
      html: connectionRow(
        { ...w, record: "employment", state: w.valid_until ? "former" : "current" },
        { label: cap(w.title || w.role || t("Works here")), other: { id: w.person_id, kind: "person", display_name: w.person_name, deleted: w.deleted }, extra: esc(w.department || ""), act: "" },
      ),
    })),
  );
}
function studiedHereRows(p) {
  return historyOrdered(
    (p.studied_here || []).map((s) => {
      const state = s.valid_until || !["studying", ""].includes(s.status || "") ? "former" : "current";
      return {
        r: { ...s, state },
        html: connectionRow(
          { ...s, record: "education", state },
          { label: cap(vocab(EDUCATION_KINDS, s.kind) || t("Studied here")), other: { id: s.person_id, kind: "person", display_name: s.person_name, deleted: s.deleted }, extra: esc([s.program, s.field, s.degree, vocab(EDUCATION_STATUS, s.status)].filter(Boolean).join(" · ")), act: "" },
        ),
      };
    }),
  );
}
/** Education rows: school (or the kind when no school is known), what and how far. */
function educationRows(p) {
  return p.education.map((e) => {
    const what = [e.program, e.field].filter(Boolean).join(", ") || e.degree || vocab(EDUCATION_KINDS, e.kind) || t("Education");
    const sub = [what === e.degree ? "" : e.degree, vocab(EDUCATION_STATUS, e.status), e.department, e.achievements, recordSub(e)].filter(Boolean).join(" · ");
    const open = e.organization_id ? act("external", t("Open {name}", { name: e.organization }), `data-act="open-entity" data-kind="organization" data-id="${esc(e.organization_id)}"`) : "";
    const ended = !!e.valid_until || !["studying", ""].includes(e.status || "");
    return vrow(e.organization || vocab(EDUCATION_KINDS, e.kind) || t("Education"), esc(what), { sub, former: ended, strong: true, acts: open });
  });
}
/** Interests: current first, ordered by feeling; those with an end go under History. */
function interestRows(p) {
  const order = Object.keys(SENTIMENTS);
  const rank = (i) => (order.includes(i.sentiment) ? order.indexOf(i.sentiment) : order.length);
  const items = [...p.interests].sort((a, b) => !!a.valid_until - !!b.valid_until || rank(a) - rank(b));
  return historyOrdered(
    items.map((i) => ({
      r: { state: i.valid_until ? "former" : "current" },
      html: vrow(vocab(SENTIMENTS, i.sentiment) || t("Interested in"), esc(i.subject), {
        sub: [vocab(INTEREST_CATEGORIES, i.category), i.context, recordSub(i)].filter(Boolean).join(" · "),
        former: !!i.valid_until,
        strong: i.sentiment === "favorite",
      }),
    })),
  );
}
function overviewRows(p, key) {
  if (key === "relationships") return relationRows(p);
  if (key === "members") return memberRows(p);
  if (key === "work_here") return workHereRows(p);
  if (key === "studied_here") return studiedHereRows(p);
  if (key === "education") return educationRows(p);
  if (key === "interests") return interestRows(p);
  if (key === "contacts")
    return ["phone", "email", "website"].flatMap((channel) =>
      p.contacts
        .filter((c) => c.channel === channel)
        .map((c) => {
          const label = c.label || { phone: t("Phone"), email: t("Email"), website: t("Website") }[channel];
          const acts =
            (channel === "email" ? act("mail", t("Write an email"), `data-act="external" data-url="mailto:${esc(c.value)}"`) : "") +
            (channel === "website" ? act("external", t("Open website"), `data-act="external" data-url="${esc(c.value)}"`) : "") +
            act("copy", t("Copy"), `data-act="copy" data-value="${esc(c.value)}"`);
          return vrow(label, esc(c.value), { sub: recordSub(c), former: !!c.valid_until, acts, strong: channel !== "website", primary: c.is_primary });
        }),
    );
  if (key === "employments")
    return p.employments.map((e) =>
      vrow(e.organization || t("Work"), esc(e.title || e.role || t("Role not recorded")), { sub: [e.department, e.title && e.role ? e.role : "", recordSub(e)].filter(Boolean).join(" · "), former: !!e.valid_until, strong: true, acts: e.organization_id ? act("external", t("Open {name}", { name: e.organization }), `data-act="open-entity" data-kind="organization" data-id="${esc(e.organization_id)}"`) : "" }),
    );
  if (key === "addresses") return p.addresses.map((a) => vrow(a.label || t("Address"), esc(addressText(a)), { attr: `data-address-row="${esc(a.id)}"`, sub: recordSub(a), former: !!a.valid_until, primary: a.is_primary }));
  if (key === "accounts")
    return p.accounts.map((a) =>
      vrow(a.service, esc(a.handle || a.display_name || a.url), { sub: [a.display_name && a.handle ? a.display_name : "", a.state !== "unknown" ? t(a.state) : "", recordSub(a)].filter(Boolean).join(" · "), former: !!a.valid_until, strong: true, acts: a.url ? act("external", t("Open profile"), `data-act="external" data-url="${esc(a.url)}"`) : "" }),
    );
  if (key === "facts") return p.facts.map((f) => vrow(f.key, esc(f.value), { sub: recordSub(f), former: !!f.valid_until }));
  return [];
}
function notesSection(p, title) {
  return `<section class="psection" data-section="notes"><div class="section-head"><h3>${icon("note")}${esc(title)}</h3><button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="edit" data-section="notes" aria-label="${esc(t("Edit {section}", { section: title }))}">${icon("edit")}<span>${esc(t("Edit"))}</span></button></div><div class="list notes-body">${esc(p.notes)}</div></section>`;
}
/** Sections whose rows are records of their own, with their own add action. */
const RECORD_SECTIONS = { relationships: "add-relation", members: "add-member", interactions: "add-interaction" };
function connectionSection(key, title, iconName, rows, addLabel) {
  const count = rows.filter((r) => r.startsWith("<div")).length;
  return `<section class="psection" data-section="${key}"><div class="section-head"><h3>${icon(iconName)}${esc(title)} <span class="count">${count}</span></h3><button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="${RECORD_SECTIONS[key]}">${icon("plus")}<span>${esc(t("Add {what}", { what: addLabel.toLowerCase() }))}</span></button></div><div class="list vrows">${rows.join("")}</div></section>`;
}
function tabOverview(p) {
  const filled = [];
  const missing = [];
  for (const [key, title, iconName, addLabel] of PROFILE_SECTIONS[p.kind]) {
    if (key === "notes") {
      if (p.notes) filled.push(notesSection(p, t(title)));
      else missing.push([key, addLabel]);
      continue;
    }
    if (key === "interactions") {
      if (p.interaction_count) filled.push(`<div id="interactions-box" data-entity="${esc(p.id)}">${interactionsSection([], p.interaction_count)}</div>`);
      else missing.push([key, addLabel]);
      continue;
    }
    const rows = overviewRows(p, key);
    if (rows.length)
      filled.push(
        key === "work_here" || key === "studied_here"
          ? `<section class="psection" data-section="${key}"><div class="section-head"><h3>${icon(iconName)}${esc(t(title))} <span class="count">${rows.filter((r) => r.startsWith("<div")).length}</span></h3><span class="muted section-note">${esc(t(key === "work_here" ? "From each person’s Work" : "From each person’s Education"))}</span></div><div class="list vrows">${rows.join("")}</div></section>`
          : RECORD_SECTIONS[key]
            ? connectionSection(key, t(title), iconName, rows, t(addLabel))
            : psection(key, t(title), iconName, rows),
      );
    else if (addLabel) missing.push([key, addLabel]);
  }
  // Nothing recorded is not shown as a row of empty boxes: what is missing is offered once, together.
  const name = p.kind === "person" ? firstName(p) : p.display_name;
  const add = missing.length
    ? `<section class="profile-add" aria-label="${esc(t("Add to this profile"))}">
        <p>${esc(filled.length ? t("Add to {name}’s profile", { name }) : t("Nothing is recorded about {name} yet. Start with what you know.", { name }))}</p>
        <div class="add-chips">${missing.map(([key, label]) => `<button class="add-chip" data-act="${RECORD_SECTIONS[key] || "edit"}" data-section="${key}">${icon("plus")}<span>${esc(t(label))}</span></button>`).join("")}</div>
      </section>`
    : "";
  setTimeout(() => loadLinkedFrom(p), 0);
  if (p.interaction_count) setTimeout(() => loadInteractions(p), 0);
  return `<div class="profile-grid">
    <div class="profile-main ${filled.length > 2 ? "is-rich" : ""}">${filled.join("")}<div id="linked-from" data-entity="${esc(p.id)}" hidden></div>${add}</div>
    ${glance(p)}
  </div>`;
}
/* Linked from other modules (0.6.0): Chronos events and Mnemosyne notes, tasks and projects
   that link to this entity and share the link with Meridian. Their owners provide the titles;
   Meridian stores none of them. Shown only when something links here. */
const LINKED_KIND = { "chronos:event": "Event in Chronos", "mnemosyne:note": "Note in Mnemosyne", "mnemosyne:task": "Task in Mnemosyne", "mnemosyne:project": "Project in Mnemosyne", "mnemosyne:collection": "Collection in Mnemosyne", "atlas:place": "Place in Atlas", "argus:photo": "Photo in Argus" };
const LINKED_ICON = { chronos: "calendar", mnemosyne: "note", atlas: "pin", argus: "people" };
async function loadLinkedFrom(p) {
  const box = $("#linked-from");
  if (!box || box.dataset.entity !== p.id) return;
  const result = await api(`/entities/${p.id}/linked-from`).catch(() => null);
  if (!box.isConnected || state.person?.id !== p.id || !result || result.availability !== "available" || !result.items.length) return;
  const rows = result.items.map((x) => {
    const gone = x.availability !== "available";
    const kind = t(LINKED_KIND[`${x.module}:${x.type}`] || "Linked in {module}", { module: cap(x.module) });
    const note = x.availability === "deleted" ? t("deleted there") : ["forbidden", "not_found", "not_resolvable"].includes(x.availability) ? t("not available") : gone ? t("not available right now") : "";
    const open = !gone && (state.context.applications || []).some((a) => a.id === x.module)
      ? `<span class="acts">${act("external", t("Open {module}", { module: cap(x.module) }), `data-act="open-module" data-module="${esc(x.module)}" data-path="${esc(x.open_path || "")}"`)}</span>`
      : "";
    return `<div class="vrow linked-row${gone ? " former" : ""}"><span class="label">${icon(LINKED_ICON[x.module] || "link")}<span>${esc(kind)}</span></span><span class="value">${esc(gone ? t("Something linked here") : x.label)}${note ? `<span class="sub">${esc(note)}</span>` : ""}</span>${open}</div>`;
  });
  box.innerHTML = `<section class="psection" data-section="linked"><div class="section-head"><h3>${icon("link")}${esc(t("Linked from other modules"))} <span class="count">${rows.length}</span></h3></div><div class="list vrows">${rows.join("")}</div><p class="ae-hint linked-hint">${esc(t("These items belong to their modules."))}</p></section>`;
  box.hidden = false;
}
/** Where a person's records came from, in words. */
function provenance(p) {
  const sources = new Map();
  let byYou = !!p.notes;
  for (const key of Object.keys(SECTION_KEYS))
    for (const r of p[key]) {
      if (r.source) sources.set(r.source.kind + r.source.label, r.source);
      else byYou = true;
    }
  return [...[...sources.values()].map((s) => (s.kind === "vcard-import" ? t("Imported from {file}", { file: s.label }) : s.label)), byYou ? (sources.size ? t("edited in Meridian") : t("Entered in Meridian")) : ""].filter(Boolean).join(" · ");
}
/** Everyone this entity is connected to now, each once, for the context column. */
function connectedEntities(p) {
  const seen = new Map();
  const put = (e) => e && !e.deleted && e.id !== p.id && !seen.has(e.id) && seen.set(e.id, e);
  p.relationships.filter((r) => r.state !== "former").forEach((r) => put(r.other));
  p.memberships.filter((m) => m.state !== "former").forEach((m) => put(m.other));
  (p.work_here || []).filter((w) => !w.valid_until).forEach((w) => put({ id: w.person_id, kind: "person", display_name: w.person_name, deleted: w.deleted }));
  if (p.kind === "person") p.employments.filter((e) => !e.valid_until && e.organization_id).forEach((e) => put({ id: e.organization_id, kind: "organization", display_name: e.organization }));
  return [...seen.values()];
}
function connectionsGlance(p) {
  const all = connectedEntities(p);
  const shown = all.slice(0, 8);
  return `<section class="g-sec" data-section="connections"><div class="g-head"><h3>${esc(t("Connections"))}</h3>${all.length && typeof viewGraph === "function" ? `<button class="link" data-act="local-graph" data-id="${esc(p.id)}">${esc(t("Explore in graph"))}</button>` : ""}</div>
    ${all.length
      ? `<p class="hint">${esc(plural(all.length, "{count} current connection", "{count} current connections"))}</p>
        <div class="conn-stack">${shown.map((e) => `<button class="conn-chip" data-act="open-entity" data-id="${esc(e.id)}" data-kind="${e.kind}" title="${esc(e.display_name)}">${avatar(e.display_name, e.id, `sm is-${e.kind}`)}<span class="nm">${esc(e.display_name)}</span></button>`).join("")}${all.length > shown.length ? `<span class="conn-more">${esc(t("+{n} more", { n: all.length - shown.length }))}</span>` : ""}</div>`
      : `<p class="hint">${esc(t("No relationships recorded yet."))}</p>`}
    <button class="ae-btn ae-btn--sm g-action" data-act="add-relation">${icon("plus")}<span>${esc(t("Add relationship"))}</span></button>
  </section>`;
}
/** The context column: dates that matter, connections, where the record came from. Nothing here repeats the main column. */
function glance(p) {
  const isPerson = p.kind === "person";
  const current = p.dates.filter((d) => !d.valid_until);
  const dated = current.map((d) => ({ d, next: d.date ? nextOccurrence(d.date) : null }));
  const soonest = dated.filter((x) => x.next).sort((a, b) => a.next.days - b.next.days)[0];
  const turns = (x) => {
    const year = x.d.date && !x.d.date.startsWith("--") ? +x.d.date.slice(0, 4) : null;
    if (!x.next || !year || x.d.date.length !== 10 || x.d.approximate) return "";
    const n = x.next.year - year;
    return x.d.kind === "birth" ? t("turns {n}", { n }) : plural(n, "{count} year", "{count} years");
  };
  const hero = soonest
    ? `<div class="occasion ${soonest.next.days <= 7 ? "is-soon" : ""}"><span class="spot-count">${countdown(soonest.next.days)}</span>
        <span class="grow"><span class="primary">${esc([dateKind(soonest.d), turns(soonest)].filter(Boolean).join(" · "))}</span><span class="secondary">${esc(fmt({ weekday: "long" }, soonest.next.year, soonest.next.month, soonest.next.day))} · ${esc(formatDateRecord(soonest.d))}</span></span></div>`
    : "";
  const rest = dated.filter((x) => x !== soonest);
  const list = rest.length
    ? `<ul class="g-list">${rest.map((x) => `<li><span class="k">${esc(dateKind(x.d))}</span><span class="v">${esc(formatDateRecord(x.d))}</span>${x.next ? `<span class="when">${esc(inDays(x.next.days))}</span>` : ""}</li>`).join("")}</ul>`
    : dated.length
      ? ""
      : `<p class="hint">${esc(isPerson ? t("No birthday, name day or anniversary yet.") : t("No dates recorded."))}</p>`;
  const dates = isPerson || current.length
    ? `<section class="g-sec psection" data-section="dates"><div class="g-head"><h3>${esc(isPerson ? t("Personal dates") : t("Dates"))}</h3><button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="edit" data-section="dates" aria-label="${esc(current.length ? t("Edit dates") : t("Add a date"))}">${icon(current.length ? "edit" : "plus")}<span>${esc(current.length ? t("Edit") : t("Add"))}</span></button></div>${hero}${list}</section>`
    : "";
  return `<aside class="glance" aria-label="${esc(t("At a glance"))}">
    ${dates}
    ${connectionsGlance(p)}
    <section class="g-sec"><div class="g-head"><h3>${esc(t("Record"))}</h3><button class="link" data-act="tab" data-tab="record">${esc(t("Details"))}</button></div>
      <ul class="g-list">
        <li><span class="k">${esc(t("Added"))}</span><span class="v">${esc(relativeTime(p.created_at))}</span></li>
        <li><span class="k">${esc(t("Last changed"))}</span><span class="v">${esc(relativeTime(p.updated_at))}</span></li>
      </ul><p class="hint">${esc(provenance(p))}</p></section>
  </aside>`;
}
const NAME_KINDS = { full: "Full name", preferred: "Preferred name", nickname: "Nickname", alias: "Alias", birth: "Birth name", former: "Former name", phonetic: "Phonetic name" };
function tabNames(p) {
  const rows = p.names.map((n) => {
    const parts = [["prefix", "Prefix"], ["given", "Given"], ["middle", "Middle"], ["family", "Family"], ["suffix", "Suffix"]].filter(([k]) => n[k]).map(([k, l]) => `${t(l)}: ${n[k]}`).join(" · ");
    return vrow(t(NAME_KINDS[n.kind] || n.kind), esc(n.value || [n.prefix, n.given, n.middle, n.family, n.suffix].filter(Boolean).join(" ")), { sub: [parts, recordSub(n)].filter(Boolean).join(" · "), former: !!n.valid_until, strong: n.kind === "full" });
  });
  return `<div class="profile-main measure">${psection("names", t("Names"), "names", rows, "", t("Add name"))}</div>`;
}
function tabImported(p) {
  const rows = p.imported.map((r) => {
    const params = Object.entries(r.params || {}).map(([k, v]) => `${k}=${v}`).join("; ");
    return vrow(r.name, `<span class="raw-value">${esc(r.value) || `<span class="muted">${esc(t("(empty)"))}</span>`}</span>`, { sub: [params, r.source?.label].filter(Boolean).join(" · "), acts: act("x", t("Remove"), `data-act="drop-imported" data-id="${esc(r.id)}"`) });
  });
  return `<div class="profile-main measure"><p class="lede" style="margin:0">${esc(t("These values came with an import and could not be placed in Meridian's structure. They are kept so nothing is lost; copy what you need into the profile, then remove them."))}</p>
    <section class="psection"><div class="section-head"><h3>${icon("upload")}${esc(t("Imported, not mapped"))} <span class="count">${rows.length}</span></h3></div><div class="list vrows">${rows.join("")}</div></section></div>`;
}
function tabRecord(p) {
  const rows = [
    vrow(t("Created"), esc(new Date(p.created_at).toLocaleString(activeLocale))),
    vrow(t("Last changed"), esc(new Date(p.updated_at).toLocaleString(activeLocale))),
    vrow(t("Sources"), esc(provenance(p).split(" · ").join("\n"))),
    vrow(t("Meridian ID"), `<span class="raw-value">${esc(p.id)}</span>`, { acts: act("copy", t("Copy"), `data-act="copy" data-value="${esc(p.id)}"`) }),
    ...p.identifiers.map((i) => vrow(i.system === "vcard-uid" ? t("Contact ID (vCard)") : i.system, `<span class="raw-value">${esc(i.value)}</span>`)),
  ];
  return `<div class="profile-main measure"><section class="psection"><div class="section-head"><h3>${icon("info")}${esc(t("This record"))}</h3></div><div class="list vrows">${rows.join("")}</div></section></div>`;
}

/* ───────────────────────── Graph ───────────────────────── */

/*
 * The Celestial Graph: a view over Meridian's records (/api/graph). Every edge is a stored
 * relationship, Group membership or Work record, nothing inferred. Layout positions and the
 * camera are kept for the session. A local graph shows one entity's neighbourhood with the
 * same engine. The details panel is also the text alternative to the canvas.
 */
const GRAPH = {
  raw: null,
  engine: null,
  positions: new Map(),
  camera: null,
  selected: null,
  local: null, // { id, depth }
  collapsed: null, // null: automatic (the overview starts folded on phones)
  browseAll: false,
  legend: true,
  filter: { kinds: new Set(["p", "o", "g"]), categories: null, time: "all", isolated: true },
};
try {
  GRAPH.legend = localStorage.getItem("meridian.graph.legend") !== "0";
} catch {
  /* a convenience */
}
const KIND_OF = { p: "person", o: "organization", g: "group" };
const FORMER_PHRASE = { "works at": "worked at", employs: "employed" };
/** A relationship as one sentence: "{a} is parent of {b}", but "{a} studies at {b}" when the
    phrase has its own verb. `phrase` is the English phrase and is translated here; `former`
    reads a linking verb in the past ("was married to"). */
function relationSentence(a, phrase, b, former = false) {
  const template = MeridianUX.relationIsVerbPhrase(phrase) ? "{a} {p} {b}" : former ? "{a} was {p} {b}" : "{a} is {p} {b}";
  return t(template, { a, p: t(phrase), b });
}

/** The canvas silhouettes as inline SVG, so the interface and the graph speak alike. */
function glyph(kind, size = 14) {
  const c = MeridianGraph.KIND[kind].color;
  const body = kind === "p" ? `<circle cx="7" cy="7" r="4.6" fill="${c}"/>` : kind === "o" ? `<path d="M7 1.6 12.4 7 7 12.4 1.6 7z" fill="${c}"/>` : `<path d="M12.2 7 9.6 11.5H4.4L1.8 7l2.6-4.5h5.2z" fill="rgba(179,195,158,.2)" stroke="${c}" stroke-width="1.3"/>`;
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true">${body}</svg>`;
}
/** A line sample: solid, dashed (ended) or dotted (uncertain); arc or straight spoke. */
function lineSample(color, pattern = "solid", spoke = false) {
  const dash = pattern === "ended" ? 'stroke-dasharray="4 3"' : pattern === "doubt" ? 'stroke-dasharray="0.1 3" stroke-linecap="round"' : "";
  const d = spoke ? "M2 7h20" : "M2 10Q12 2 22 10";
  return `<svg class="line-sample" width="24" height="14" viewBox="0 0 24 14" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" ${dash}/></svg>`;
}
const edgeHue = (l) => (l.record === "m" ? MeridianGraph.CATEGORY.membership : l.record === "e" ? MeridianGraph.CATEGORY.employment : MeridianGraph.CATEGORY[l.category] || MeridianGraph.CATEGORY.other);
const edgePattern = (l) => (l.state === 1 ? "ended" : l.conf === 1 || l.conf === 2 || l.state === 2 ? "doubt" : "solid");

/** The compact projection as engine nodes and edges. */
function graphData(raw) {
  const nodes = raw.nodes.map(([id, kind, label, self]) => ({ id, kind, label, self: !!self }));
  const edges = raw.edges.map(([a, b, kind, typeIndex, state, conf]) => {
    const type = raw.types[typeIndex];
    return { source: raw.nodes[a][0], target: raw.nodes[b][0], record: kind, type: type.key, category: type.category, label: type.label, inverse: type.inverse, symmetric: type.symmetric, state, conf };
  });
  // An ended relationship that a current one of the same kind followed (dating, then engaged)
  // is history: hidden under "All" so the current state reads clearly, still shown under
  // "Ended" and in the pair's details. Concurrent relationships all stay.
  const pair = (e) => [e.source, e.target].sort().join("|");
  const live = new Set(edges.filter((e) => e.record === "r" && e.state !== 1).map((e) => `${pair(e)}|${e.category}`));
  for (const e of edges) if (e.record === "r" && e.state === 1 && live.has(`${pair(e)}|${e.category}`)) e.superseded = true;
  return { nodes, edges };
}
/** One entity's neighbourhood, a few steps out, from the same data. */
function neighbourhood(data, id, depth) {
  const next = new Map(data.nodes.map((n) => [n.id, []]));
  for (const e of data.edges) {
    next.get(e.source)?.push(e.target);
    next.get(e.target)?.push(e.source);
  }
  const keep = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const out = [];
    for (const n of frontier) for (const m of next.get(n) || []) if (!keep.has(m)) keep.add(m) && out.push(m);
    frontier = out;
  }
  return { nodes: data.nodes.filter((n) => keep.has(n.id)), edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}
function linkPhrase(l, fromId) {
  const out = (l.source.id || l.source) === fromId;
  let phrase = l.symmetric || out ? l.label : l.inverse;
  if (l.state === 1 && FORMER_PHRASE[phrase]) phrase = FORMER_PHRASE[phrase];
  return phrase;
}
const statusWords = (l) => [l.state === 1 ? t("ended") : l.state === 2 ? t("state unknown") : "", l.conf === 2 ? t("uncertain") : l.conf === 1 ? t("confidence unknown") : ""].filter(Boolean);
function saveGraphState() {
  const engine = GRAPH.engine;
  if (!engine) return;
  if (!GRAPH.local) GRAPH.positions = engine.positions();
  else {
    GRAPH.localPositions = engine.positions();
    for (const [id, p] of GRAPH.localPositions) if (!GRAPH.positions.has(id)) GRAPH.positions.set(id, p);
  }
  GRAPH.camera = { ...engine.cam, local: GRAPH.local?.id || null };
  GRAPH.selected = engine.selected;
  engine.destroy();
  GRAPH.engine = null;
}
async function viewGraph(sheet, token) {
  saveGraphState();
  const raw = await api("/graph");
  if (stale(token)) return;
  GRAPH.raw = raw;
  const all = graphData(raw);
  const local = GRAPH.local && all.nodes.some((n) => n.id === GRAPH.local.id) ? GRAPH.local : null;
  GRAPH.local = local;
  const centre = local && all.nodes.find((n) => n.id === local.id);
  setTitle(local ? [{ label: t("Graph"), view: "graph" }, { label: t("Around {name}", { name: centre.label }) }] : [{ label: t("Graph") }]);
  const data = local ? neighbourhood(all, local.id, local.depth) : all;
  GRAPH.data = data;
  const counts = { p: 0, o: 0, g: 0 };
  data.nodes.forEach((n) => counts[n.kind]++);
  const categories = [...new Set(data.edges.map((e) => (e.record === "m" ? "membership" : e.record === "e" ? "employment" : e.category)))];
  const cats = REL_CATEGORIES();
  const C = MeridianGraph.CATEGORY;
  sheet.innerHTML = `<div class="page graph-page">
    <h2 class="sr-only" data-heading tabindex="-1">${esc(local ? t("Graph around {name}", { name: centre.label }) : t("Graph"))}</h2>
    <div class="graph-stage" id="graph-stage">
      <canvas id="graph-canvas" tabindex="0" role="application" aria-roledescription="${esc(t("relationship graph"))}" aria-label="${esc(t("{n} entities and {m} connections. The panel lists them as text.", { n: data.nodes.length, m: data.edges.length }))}" aria-describedby="graph-help"></canvas>
      <p class="sr-only" id="graph-help">${esc(t("Arrow keys pan, plus and minus zoom, 0 fits everything, Enter opens the selected entity, Escape clears the selection. Search, or browse the list in the panel."))}</p>
      <p class="sr-only" id="graph-live" aria-live="polite"></p>
      <div class="graph-tip" id="graph-tip" aria-hidden="true" hidden></div>
      <div class="graph-bar" role="toolbar" aria-label="${esc(t("Graph tools"))}">
        <div class="search-box graph-search">${icon("search")}<input class="ae-input" id="graph-q" type="search" role="combobox" aria-expanded="false" aria-controls="graph-results" aria-autocomplete="list" aria-label="${esc(t("Find in the graph"))}" placeholder="${esc(t("Find in the graph"))}" maxlength="200" autocomplete="off"><kbd class="ae-kbd" aria-hidden="true">/</kbd><div class="search-results" id="graph-results" role="listbox" hidden></div></div>
        <span class="graph-bar-sep" aria-hidden="true"></span>
        <button class="graph-tool" data-act="graph-filters" aria-expanded="false" aria-controls="graph-filters">${icon("names")}<span>${esc(t("Filters"))}</span><span class="badge" id="graph-filter-count" hidden></span></button>
        ${local ? `<span class="graph-bar-sep" aria-hidden="true"></span><div class="graph-local">${glyph(centre.kind)}<span class="graph-local-name">${esc(t("Around {name}", { name: centre.label }))}</span>${segmented("graph-depth", t("How far"), [["1", "1"], ["2", "2"], ["3", "3"]], String(local.depth))}<span class="muted graph-local-unit">${esc(t("steps"))}</span><button class="graph-tool" data-act="graph-whole">${esc(t("Whole graph"))}</button></div>` : ""}
      </div>
      <div class="graph-filters" id="graph-filters" role="dialog" aria-label="${esc(t("Graph filters"))}" hidden>
        <fieldset><legend>${esc(t("Show"))}</legend>
          ${[["p", "People"], ["o", "Organizations"], ["g", "Groups"]].map(([k, l]) => `<label class="check"><input type="checkbox" data-graph-kind="${k}" ${GRAPH.filter.kinds.has(k) ? "checked" : ""}>${glyph(k)}<span>${esc(t(l))}</span><span class="muted">${counts[k]}</span></label>`).join("")}
        </fieldset>
        <fieldset><legend>${esc(t("Connections"))}</legend>
          ${categories.length ? categories.map((c) => `<label class="check"><input type="checkbox" data-graph-cat="${esc(c)}" ${!GRAPH.filter.categories || GRAPH.filter.categories.has(c) ? "checked" : ""}>${lineSample(C[c] || C.other, "solid", c === "membership" || c === "employment")}<span>${esc(t(cats[c] || cap(c)))}</span></label>`).join("") : `<p class="muted">${esc(t("No connections recorded yet."))}</p>`}
        </fieldset>
        <fieldset><legend>${esc(t("Time"))}</legend>${segmented("graph-time", t("Time"), [["all", t("All")], ["current", t("Current")], ["former", t("Ended")]], GRAPH.filter.time)}</fieldset>
        <label class="check"><input type="checkbox" id="graph-isolated" ${GRAPH.filter.isolated ? "checked" : ""}><span>${esc(t("Show entities without connections"))}</span></label>
        <button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="graph-reset-filters">${esc(t("Reset filters"))}</button>
      </div>
      <div class="graph-zoom" role="group" aria-label="${esc(t("View"))}">
        <button class="graph-tool is-icon" data-act="graph-zoom" data-z="in" aria-label="${esc(t("Zoom in"))}" title="${esc(t("Zoom in"))}">${icon("plus")}</button>
        <button class="graph-tool is-icon" data-act="graph-zoom" data-z="out" aria-label="${esc(t("Zoom out"))}" title="${esc(t("Zoom out"))}">${icon("minus")}</button>
        <span class="graph-zoom-sep" aria-hidden="true"></span>
        <button class="graph-tool is-icon" data-act="graph-fit" aria-label="${esc(t("Zoom to fit"))}" title="${esc(t("Zoom to fit"))}">${icon("fit")}</button>
        <button class="graph-tool is-icon" data-act="graph-reset" aria-label="${esc(t("Reset view"))}" title="${esc(t("Reset view"))}">${icon("restore")}</button>
      </div>
      <div class="graph-legend ${GRAPH.legend ? "" : "is-closed"}" id="graph-legend">
        <button class="graph-tool graph-legend-toggle" data-act="graph-legend" aria-expanded="${GRAPH.legend}" aria-controls="graph-legend-body">${esc(t("Legend"))}</button>
        <div class="graph-legend-body" id="graph-legend-body" ${GRAPH.legend ? "" : "hidden"}>
          <span>${glyph("p")}${esc(t("Person"))}</span><span>${glyph("o")}${esc(t("Organization"))}</span><span>${glyph("g")}${esc(t("Group"))}</span>
          <span>${lineSample(C.social)}${esc(t("Relationship"))}</span><span>${lineSample(C.membership, "solid", true)}${esc(t("Membership or work"))}</span>
          <span>${lineSample("#b9aea3", "ended")}${esc(t("Ended"))}</span><span>${lineSample("#b9aea3", "doubt")}${esc(t("Uncertain"))}</span>
        </div>
      </div>
      <aside class="graph-panel" id="graph-panel" aria-label="${esc(t("Graph details"))}"></aside>
      ${!data.nodes.length ? `<div class="graph-empty">${emptyState("graph", t("Nothing to show yet"), t("The graph shows people, organizations and groups, and the relationships you record between them."), `<button class="ae-btn" data-act="go" data-view="people">${esc(t("Go to People"))}</button>`)}</div>` : ""}
    </div></div>`;
  if (!data.nodes.length) {
    $("#graph-panel").hidden = true;
    return;
  }
  const canvas = $("#graph-canvas");
  const engine = new MeridianGraph.Engine(canvas, {
    reducedMotion,
    arrangingText: t("Arranging the graph…"),
    onSelect: (sel, info) => {
      graphTip(null);
      if (!sel && $("#graph-live")) $("#graph-live").textContent = t("Selection cleared");
      showGraphDetails(sel, info);
      if (sel?.type === "node") engine.ensureVisible(sel.id);
    },
    onHover: (sel, info, at) => graphTip(sel, info, at),
    onOpen: (node) => {
      saveGraphState();
      go(node.kind === "p" ? "person" : "entity", node.id, KIND_OF[node.kind]);
    },
    onSettled: () => {
      if (GRAPH.focusAfter && engine.byId.has(GRAPH.focusAfter)) {
        const id = GRAPH.focusAfter;
        GRAPH.focusAfter = null;
        GRAPH.fitPending = false;
        return graphFocus(id);
      }
      if (!GRAPH.fitPending) return;
      GRAPH.fitPending = false;
      engine.fit(reducedMotion() ? 0 : 640);
    },
  });
  GRAPH.engine = engine;
  const sameView = GRAPH.camera && GRAPH.camera.local === (local?.id || null);
  // Coming back to the same local graph restores its own arrangement; entering it anew
  // re-arranges the neighbourhood.
  const back = sameView && local && GRAPH.localPositions;
  engine.setData(data, back ? GRAPH.localPositions : GRAPH.positions, { warm: local && !back ? 0.6 : null });
  applyGraphFilter({ silent: true });
  const sel = sameView ? GRAPH.selected : local ? { type: "node", id: local.id } : GRAPH.selected;
  if (sel && (sel.type !== "node" || engine.byId.has(sel.id))) engine.select(sel, { silent: true });
  showGraphDetails(engine.selected, engine.selectionInfo(engine.selected));
  if (sameView) Object.assign(engine.cam, { x: GRAPH.camera.x, y: GRAPH.camera.y, k: GRAPH.camera.k });
  else {
    const first = engine.fitTarget();
    if (first) Object.assign(engine.cam, first);
    GRAPH.fitPending = true;
  }
  bindGraphSearch();
  bindGraphFilters();
  if (!GRAPH.resizeBound) {
    window.addEventListener("resize", debounce(graphInsets, 120));
    GRAPH.resizeBound = true;
  }
}
/** Whether the details panel is folded: the reader's choice, else folded for the overview on phones. */
function panelShut(sel) {
  return GRAPH.collapsed ?? (innerWidth <= 640 && !sel);
}
/** Tell the engine which parts of the canvas the bar and the panel cover. */
function graphInsets() {
  const engine = GRAPH.engine;
  const stage = $("#graph-stage")?.getBoundingClientRect();
  if (!engine || !stage) return;
  const bar = $(".graph-bar")?.getBoundingClientRect();
  const box = $("#graph-panel");
  const side = innerWidth >= 1100;
  if (box && !side) {
    // The bottom sheet sits just above the legend and zoom, however tall they wrap.
    const low = [$("#graph-legend"), $(".graph-zoom")].map((x) => x?.getBoundingClientRect().top).filter((y) => y > 0);
    box.style.bottom = low.length ? `${Math.max(56, stage.bottom - Math.min(...low) + 8)}px` : "";
  } else if (box) box.style.bottom = "";
  const q = box && !box.hidden ? box.getBoundingClientRect() : null;
  engine.setInsets({
    top: bar ? bar.bottom - stage.top + 8 : 0,
    right: q && side && !panelShut(engine.selected) ? stage.right - q.left + 8 : 0,
    bottom: q && !side ? stage.bottom - q.top + 8 : 0,
  });
}
function applyGraphFilter({ silent = false } = {}) {
  const f = GRAPH.filter;
  const cat = (l) => (l.record === "m" ? "membership" : l.record === "e" ? "employment" : l.category);
  GRAPH.engine?.applyFilter({
    node: (n) => f.kinds.has(n.kind) || n.id === GRAPH.local?.id,
    link: (l) => (!f.categories || f.categories.has(cat(l))) && (f.time === "all" ? !l.superseded : f.time === "current" ? l.state !== 1 : l.state === 1),
    isolated: f.isolated,
  });
  const active = 3 - f.kinds.size + (f.categories ? 1 : 0) + (f.time !== "all" ? 1 : 0) + (f.isolated ? 0 : 1);
  const badge = $("#graph-filter-count");
  if (badge) {
    badge.hidden = !active;
    badge.textContent = active;
  }
  if (!silent && GRAPH.engine) showGraphDetails(GRAPH.engine.selected, GRAPH.engine.selectionInfo(GRAPH.engine.selected));
}
function bindGraphFilters() {
  const box = $("#graph-filters");
  box.addEventListener("change", (event) => {
    const f = GRAPH.filter;
    const kind = event.target.dataset.graphKind;
    const cat = event.target.dataset.graphCat;
    if (kind) event.target.checked ? f.kinds.add(kind) : f.kinds.delete(kind);
    if (cat) {
      const all = $$("[data-graph-cat]", box).map((el) => el.dataset.graphCat);
      f.categories = new Set($$("[data-graph-cat]:checked", box).map((el) => el.dataset.graphCat));
      if (f.categories.size === all.length) f.categories = null;
    }
    if (event.target.id === "graph-isolated") f.isolated = event.target.checked;
    applyGraphFilter();
  });
}
function bindGraphSearch() {
  const input = $("#graph-q");
  const box = $("#graph-results");
  let items = [];
  let active = -1;
  const show = (open) => {
    box.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };
  const choose = (n) => {
    show(false);
    input.value = "";
    graphFocus(n.id);
    $("#graph-canvas")?.focus({ preventScroll: true });
  };
  input.addEventListener(
    "input",
    debounce(() => {
      const q = foldText(input.value);
      if (!q) return show(false);
      const engine = GRAPH.engine;
      items = engine.visibleNodes.filter((n) => foldText(n.label).includes(q)).sort((a, b) => b.shown - a.shown).slice(0, 8);
      box.innerHTML = items.length
        ? `<div class="rows">${items.map((n, i) => `<button class="row" type="button" role="option" id="gq-${i}" aria-selected="false" data-i="${i}" tabindex="-1"><span class="glyph-tile">${glyph(n.kind, 16)}</span><span class="grow"><span class="primary">${highlight(n.label, input.value)}</span><span class="secondary">${esc(t(KIND_NOUN[KIND_OF[n.kind]]))} · ${esc(plural(n.shown, "{count} connection", "{count} connections"))}</span></span></button>`).join("")}</div>`
        : `<p class="empty">${esc(engine.nodes.some((n) => foldText(n.label).includes(q)) ? t("Hidden by the current filters.") : t("No one matches “{q}”.", { q: input.value }))}</p>`;
      active = -1;
      show(true);
    }, 80),
  );
  input.addEventListener("keydown", (event) => {
    const count = items.length;
    const mark = (i) => {
      active = i;
      $$(".row", box).forEach((r, n) => r.classList.toggle("is-active", n === i) || r.setAttribute("aria-selected", String(n === i)));
      input.setAttribute("aria-activedescendant", `gq-${i}`);
    };
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      mark((active + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      mark((active - 1 + count) % count);
    } else if (event.key === "Enter" && count) {
      event.preventDefault();
      choose(items[Math.max(0, active)]);
    } else if (event.key === "Escape" && !box.hidden) {
      event.stopPropagation();
      show(false);
    }
  });
  box.addEventListener("mousedown", (event) => event.preventDefault());
  box.addEventListener("click", (event) => {
    const row = event.target.closest("[data-i]");
    if (row) choose(items[+row.dataset.i]);
  });
  input.addEventListener("blur", () => setTimeout(() => show(false), 120));
}
/** Select an entity and bring it into the free part of the canvas. */
function graphFocus(id) {
  const engine = GRAPH.engine;
  if (!engine) return;
  engine.select({ type: "node", id }, { silent: true });
  showGraphDetails(engine.selected, engine.selectionInfo(engine.selected));
  engine.frameAround(id);
}
/** A small card beside the pointer: what you are about to select. */
function graphTip(sel, info, at) {
  const tip = $("#graph-tip");
  if (!tip) return;
  const chosen = GRAPH.engine?.selected;
  const same = sel && chosen && sel.type === chosen.type && (sel.id ?? sel.key) === (chosen.id ?? chosen.key);
  if (!sel || !info || !at || same) {
    // The panel already describes what is selected; a card on top would hide it.
    tip.hidden = true;
    return;
  }
  if (sel.type === "node") {
    const n = info.node;
    tip.innerHTML = `<p class="tip-name">${glyph(n.kind)}<span>${esc(n.label)}</span></p><p class="tip-meta">${esc(t(KIND_NOUN[KIND_OF[n.kind]]))} · ${esc(plural(n.shown, "{count} connection", "{count} connections"))}</p>`;
  } else {
    const { a, b, links } = info;
    tip.innerHTML = `<p class="tip-name"><span>${esc(a.label)} · ${esc(b.label)}</span></p>${links
      .slice(0, 3)
      .map((l) => `<p class="tip-meta">${lineSample(edgeHue(l), edgePattern(l), l.spoke)}${esc(cap(t(linkPhrase(l, a.id))))}${statusWords(l).length ? ` · ${esc(statusWords(l).join(", "))}` : ""}</p>`)
      .join("")}${links.length > 3 ? `<p class="tip-meta">${esc(t("+{n} more", { n: links.length - 3 }))}</p>` : ""}`;
  }
  tip.hidden = false;
  const stage = $("#graph-stage").getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const x = at.x + 16 + w > stage.width ? at.x - w - 12 : at.x + 16;
  const y = Math.min(stage.height - h - 8, Math.max(8, at.y + 14));
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
let edgeToken = 0;
/** The panel: the overview list when nothing is selected, a node's connections, or the records behind an edge. */
async function showGraphDetails(sel, info) {
  const box = $("#graph-panel");
  const engine = GRAPH.engine;
  if (!box || !engine) return;
  const live = $("#graph-live");
  const narrow = innerWidth < 1100;
  const shut = panelShut(sel && info ? sel : null);
  const collapse = `<button class="graph-tool is-icon graph-collapse" data-act="graph-panel-toggle" aria-expanded="${!shut}" aria-controls="graph-panel-body" aria-label="${esc(shut ? t("Show details") : t("Hide details"))}" title="${esc(shut ? t("Show details") : t("Hide details"))}">${icon(shut ? "plus" : "minus")}</button>`;
  const head = (glyphHtml, eyebrow, title, extra = "") => `<div class="gp-head">${glyphHtml ? `<span class="glyph-tile is-large">${glyphHtml}</span>` : ""}<div class="grow"><p class="gp-eyebrow">${eyebrow}</p><h3>${title}</h3></div>${extra}${collapse}</div>`;
  const row = (l, other, fromId) => `<li><button class="gp-link ${l.state === 1 ? "is-past" : ""}" data-act="graph-focus" data-id="${esc(other.id)}"><span class="glyph-tile">${glyph(other.kind)}</span><span class="grow"><span class="primary">${esc(other.label)}</span><span class="secondary">${lineSample(edgeHue(l), edgePattern(l), l.spoke)}${esc(cap(t(linkPhrase(l, fromId))))}${statusWords(l).length ? `<span class="gp-status">${esc(statusWords(l).join(" · "))}</span>` : ""}</span></span></button></li>`;
  let html;
  if (!sel || !info) {
    // Nothing selected: the constellation as a browsable list (the canvas's text alternative).
    const nodes = [...engine.visibleNodes].sort((a, b) => b.shown - a.shown || a.label.localeCompare(b.label));
    const n = { p: 0, o: 0, g: 0 };
    nodes.forEach((x) => n[x.kind]++);
    const list = GRAPH.browseAll ? nodes.slice(0, 400) : nodes.slice(0, narrow ? 4 : 7);
    html = `${head("", esc(GRAPH.local ? t("Local graph") : t("Constellation")), esc(plural(nodes.length, "{count} entity", "{count} entities")))}
      <div class="gp-body" id="graph-panel-body" ${shut ? "hidden" : ""}>
        <p class="gp-counts">${glyph("p")}${n.p}<span class="dot">·</span>${glyph("o")}${n.o}<span class="dot">·</span>${glyph("g")}${n.g}<span class="dot">·</span>${esc(plural(engine.visibleLinks.length, "{count} connection", "{count} connections"))}</p>
        <p class="gp-label">${esc(GRAPH.browseAll ? t("Everyone in view") : t("Most connected"))}</p>
        <ul class="gp-links">${list.map((x) => `<li><button class="gp-link" data-act="graph-focus" data-id="${esc(x.id)}"><span class="glyph-tile">${glyph(x.kind)}</span><span class="grow"><span class="primary">${esc(x.label)}</span><span class="secondary">${esc(t(KIND_NOUN[KIND_OF[x.kind]]))} · ${esc(plural(x.shown, "{count} connection", "{count} connections"))}</span></span></button></li>`).join("")}</ul>
        ${nodes.length > list.length || GRAPH.browseAll ? `<button class="ae-btn ae-btn--sm ae-btn--quiet gp-more" data-act="graph-browse">${esc(GRAPH.browseAll ? t("Show fewer") : t("Browse all {n}", { n: nodes.length }))}</button>` : ""}
        <p class="gp-hint">${esc(t("Select an entity or a connection to see what is recorded."))}</p>
      </div>`;
    box.innerHTML = html;
    box.classList.toggle("is-collapsed", shut);
    graphInsets();
    return;
  }
  if (sel.type === "node") {
    const node = info.node;
    const kind = KIND_OF[node.kind];
    const links = info.links.map((l) => ({ l, other: l.source === node ? l.target : l.source })).sort((a, b) => a.l.state - b.l.state || a.other.label.localeCompare(b.other.label));
    const current = links.filter((x) => x.l.state !== 1);
    const past = links.filter((x) => x.l.state === 1);
    if (live) live.textContent = t("{name}, {kind}, {n}", { name: node.label, kind: t(KIND_NOUN[kind]).toLowerCase(), n: plural(links.length, "{count} connection", "{count} connections") });
    html = `${head(glyph(node.kind, 18), esc(t(KIND_NOUN[kind])) + (node.self ? ' <span class="self-badge">@me</span>' : ""), esc(node.label))}
      <div class="gp-actions"><button class="ae-btn ae-btn--primary ae-btn--sm" data-act="graph-open" data-id="${esc(node.id)}" data-kind="${kind}">${esc(t("Open profile"))}</button>${GRAPH.local?.id === node.id ? "" : `<button class="ae-btn ae-btn--sm" data-act="local-graph" data-id="${esc(node.id)}">${esc(t("Explore around"))}</button>`}<button class="ae-btn ae-btn--sm" data-act="tl-focus" data-id="${esc(node.id)}" data-kind="${kind}" data-name="${esc(node.label)}">${esc(t("Timeline"))}</button><button class="graph-tool is-icon" data-act="graph-deselect" aria-label="${esc(t("Clear selection"))}" title="${esc(t("Clear selection"))}">${icon("x")}</button></div>
      <div class="gp-body" id="graph-panel-body" ${shut ? "hidden" : ""}>
        <p class="gp-label">${esc(links.length ? plural(links.length, "{count} connection in view", "{count} connections in view") : t("No connections in view"))}</p>
        ${current.length ? `<ul class="gp-links">${current.map(({ l, other }) => row(l, other, node.id)).join("")}</ul>` : ""}
        ${past.length ? `<p class="gp-label">${esc(t("History"))}</p><ul class="gp-links">${past.map(({ l, other }) => row(l, other, node.id)).join("")}</ul>` : ""}
      </div>`;
    box.innerHTML = html;
    box.classList.toggle("is-collapsed", shut);
    graphInsets();
    return;
  }
  // An edge stands for one or more records; show what each one says.
  const { a, b } = info;
  const mine = ++edgeToken;
  if (live) live.textContent = t("Connection between {a} and {b}", { a: a.label, b: b.label });
  const top = head(`${glyph(a.kind)}${glyph(b.kind)}`, esc(plural(info.links.length, "{count} connection", "{count} connections")), `${esc(a.label)} <span class="muted">·</span> ${esc(b.label)}`);
  box.innerHTML = `${top}<div class="gp-body" id="graph-panel-body" ${shut ? "hidden" : ""}><p class="gp-hint">${esc(t("Loading…"))}</p></div>`;
  box.classList.toggle("is-collapsed", shut);
  graphInsets();
  let records;
  try {
    records = await api("/connections" + query({ a: a.id, b: b.id }));
  } catch (error) {
    if (mine === edgeToken) $("#graph-panel-body").innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    return;
  }
  if (mine !== edgeToken || !$("#graph-panel-body")) return;
  const status = (r) => [period(r), r.state === "former" ? t("ended") : r.state === "unknown" ? t("state unknown") : "", CONFIDENCE_TAG[r.confidence] ? t(CONFIDENCE_TAG[r.confidence]).toLowerCase() : "", r.sources?.length ? sourceText(r.sources) : ""].filter(Boolean);
  const record = (sentence, r, extra = "") => `<li class="gp-record ${r.state === "former" ? "is-past" : ""}"><p class="primary">${esc(sentence)}</p>${extra || status(r).length ? `<p class="secondary">${[extra, ...status(r).map(esc)].filter(Boolean).join(" · ")}</p>` : ""}</li>`;
  const named = (side) => side.display_name;
  const rels = records.relationships.map((r) => record(relationSentence(named(r.subject), r.state === "former" && FORMER_PHRASE[r.label] ? FORMER_PHRASE[r.label] : r.label, named(r.object), r.state === "former"), r, r.context ? `“${esc(r.context)}”` : ""));
  const members = records.memberships.map((m) => record(relationSentence(m.member.display_name, "member of", m.group.display_name, m.state === "former"), m, m.role ? esc(m.role) : ""));
  const work = records.employments.map((w) => record(`${w.person_name} ${w.state === "former" ? t("worked at") : t("works at")} ${w.organization_name}`, w, esc([w.title, w.department].filter(Boolean).join(" · "))));
  $("#graph-panel-body").innerHTML = `<ul class="gp-records">${[...rels, ...members, ...work].join("")}</ul>
    <div class="gp-actions"><button class="ae-btn ae-btn--sm" data-act="graph-open" data-id="${esc(a.id)}" data-kind="${KIND_OF[a.kind]}">${esc(t("Open {name}", { name: a.label }))}</button><button class="ae-btn ae-btn--sm" data-act="graph-open" data-id="${esc(b.id)}" data-kind="${KIND_OF[b.kind]}">${esc(t("Open {name}", { name: b.label }))}</button></div>
    <p class="gp-hint">${esc(t("Edit these on either profile."))}</p>`;
  graphInsets();
}

const REL_CATEGORIES = () => ({ family: "Family", partner: "Partners", social: "Friends and social", professional: "Professional", affiliation: "Organization affiliation", structure: "Organization structure", membership: "Group membership", employment: "Work", other: "Other" });

/* ───────────────────────── Organizations and Groups ───────────────────────── */

const KIND_NOUN = { person: "Person", organization: "Organization", group: "Group" };
const KIND_PLURAL = { person: "People", organization: "Organizations", group: "Groups" };
const KIND_VIEW = { person: "people", organization: "organizations", group: "groups" };
const entityApi = (e) => (e.kind === "person" ? `/people/${e.id}` : `/entities/${e.id}`);

async function viewEntity(sheet, token) {
  const pre = state.prefetch?.id === state.route.id ? state.prefetch.promise : null;
  state.prefetch = null;
  const entity = await (pre || api(`/entities/${state.route.id}`));
  if (stale(token)) return;
  if (entity.kind === "person") {
    state.route = { view: "person", id: entity.id };
    return viewPerson(sheet, token);
  }
  state.person = entity;
  state.route.kind = entity.kind;
  renderNav();
  setTitle([{ label: t(KIND_PLURAL[entity.kind]), view: KIND_VIEW[entity.kind] }, { label: entity.display_name }]);
  if (entity.deleted_at) {
    sheet.innerHTML = `<div class="page banded">${screenBand({ title: entity.display_name, meta: [`<span>${esc(t("In Trash since {when}", { when: relativeTime(entity.deleted_at) }))}</span>`] })}<div class="wrap body">${emptyState("trash", t("{name} is in Trash", { name: entity.display_name }), t("Restore it to see and edit it again."), `<button class="ae-btn ae-btn--primary" data-act="restore" data-id="${esc(entity.id)}" data-kind="${entity.kind}">${icon("restore")}<span>${esc(t("Restore"))}</span></button><button class="ae-btn" data-act="go" data-view="trash">${esc(t("Open Trash"))}</button>`)}</div></div>`;
    return;
  }
  if (!TABS(entity).some(([k]) => k === state.tab)) state.tab = "overview";
  sheet.innerHTML = `<div class="page banded" id="person-page">${personPage(entity)}</div>`;
  requestAnimationFrame(() => placeTabInk(true));
  runPendingEdit();
}

const ENTITY_LIST = { organization: { q: "" }, group: { q: "" } };
async function viewEntities(sheet, token, kind) {
  setTitle([{ label: t(KIND_PLURAL[kind]) }]);
  const data = await api("/entities" + query({ kind, q: ENTITY_LIST[kind].q, limit: 200 }));
  if (stale(token)) return;
  const noun = t(KIND_NOUN[kind]).toLowerCase();
  sheet.innerHTML = `<div class="page banded dir">
    ${screenBand({
      title: t(KIND_PLURAL[kind]),
      meta: [`<span id="entity-count">${esc(plural(data.total, `{count} ${noun}`, `{count} ${t(KIND_PLURAL[kind]).toLowerCase()}`))}</span>`],
      actions: `<button class="ae-btn" data-act="new-entity" data-kind="${kind}">${icon("plus")}<span>${esc(t("New {what}", { what: noun }))}</span></button>`,
      below: `<div class="dir-tools"><div class="search-box dir-search">${icon("search")}<input class="ae-input" id="entity-q" type="search" placeholder="${esc(t("Search {what}", { what: t(KIND_PLURAL[kind]).toLowerCase() }))}" aria-label="${esc(t("Search {what}", { what: t(KIND_PLURAL[kind]).toLowerCase() }))}" aria-controls="entity-list" maxlength="200" value="${esc(ENTITY_LIST[kind].q)}" autocomplete="off"></div></div>`,
    })}
    <div class="wrap body"><div id="entity-list">${entityList(kind, data.items)}</div></div></div>`;
  const input = $("#entity-q");
  let seq = 0;
  input.addEventListener(
    "input",
    debounce(async () => {
      ENTITY_LIST[kind].q = input.value.trim();
      const mine = ++seq;
      const fresh = await api("/entities" + query({ kind, q: ENTITY_LIST[kind].q, limit: 200 }));
      if (mine !== seq || !$("#entity-list")) return;
      $("#entity-list").innerHTML = entityList(kind, fresh.items);
      $("#entity-count").textContent = plural(fresh.total, `{count} ${noun}`, `{count} ${t(KIND_PLURAL[kind]).toLowerCase()}`);
    }, 160),
  );
}
function entityList(kind, items) {
  const q = ENTITY_LIST[kind].q;
  if (!items.length)
    return q
      ? emptyState("search", t("No one matches “{q}”", { q }), t("Search looks at names, contact details and notes."))
      : kind === "organization"
        ? emptyState("organizations", t("No organizations yet"), t("Organizations appear here when you add them, or when you record where someone works."), `<button class="ae-btn ae-btn--primary" data-act="new-entity" data-kind="organization">${icon("plus")}<span>${esc(t("New organization"))}</span></button>`)
        : emptyState("groups", t("No groups yet"), t("A group is a set of people that is not an organization: a friend group, a household, former classmates."), `<button class="ae-btn ae-btn--primary" data-act="new-entity" data-kind="group">${icon("plus")}<span>${esc(t("New group"))}</span></button>`);
  return `<div class="list dir-list">${items
    .map((x) => {
      const line = kind === "organization" ? (x.staff ? plural(x.staff, "{count} person at work here", "{count} people at work here") : "") : plural(x.members, "{count} member", "{count} members");
      return `<button class="row dir-row" data-act="open-entity" data-id="${esc(x.id)}" data-kind="${kind}">
        ${avatar(x.display_name, x.id, `is-${kind}`)}
        <span class="who"><span class="primary"><span class="nm">${highlight(x.display_name, q)}</span></span>${line ? `<span class="secondary">${esc(line)}</span>` : ""}</span>
        <span class="reach">${x.email ? `<span class="reach-item">${icon("mail")}<span>${highlight(x.email, q)}</span></span>` : ""}${x.phone ? `<span class="reach-item">${icon("phone")}<span>${highlight(x.phone, q)}</span></span>` : ""}</span>
        <span class="end">${esc(t("Updated {when}", { when: relativeTime(x.updated_at) }))}</span></button>`;
    })
    .join("")}</div>`;
}
function newEntity(kind) {
  const noun = t(KIND_NOUN[kind]).toLowerCase();
  openDialog(`<div class="ae-dialog-head"><h2>${esc(t("New {what}", { what: noun }))}</h2><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <div class="ae-dialog-body form" id="new-entity" data-kind="${kind}">
      <div class="ae-field"><label class="ae-label" for="ne-name">${esc(t("Name"))}</label><input class="ae-input" id="ne-name" maxlength="300" data-focus autocomplete="off" placeholder="${esc(kind === "organization" ? t("e.g. “Example University”") : t("e.g. “Tuesday climbing group”"))}"></div>
      <div class="ae-field"><label class="ae-label" for="ne-about">${esc(t("About (optional)"))}</label><textarea class="ae-textarea" id="ne-about" rows="3" maxlength="20000"></textarea></div>
      ${kind === "organization" ? `<div class="ae-field"><label class="ae-label" for="ne-web">${esc(t("Website (optional)"))}</label><input class="ae-input" id="ne-web" maxlength="320" inputmode="url" autocomplete="off"></div>` : ""}
      <p class="form-error" id="form-error" role="alert" hidden></p>
    </div>
    <div class="ae-dialog-foot"><button class="ae-btn" data-act="close">${esc(t("Cancel"))}</button><button class="ae-btn ae-btn--primary" data-act="create-entity">${esc(t("Add {what}", { what: noun }))}</button></div>`);
}
async function createEntity(button) {
  if (button.disabled) return;
  const kind = $("#new-entity").dataset.kind;
  const name = $("#ne-name").value.trim();
  try {
    if (!name) throw Error(t("Enter a name."));
    const web = $("#ne-web")?.value.trim();
    button.disabled = true;
    button.classList.add("is-busy");
    const created = await api("/entities", "POST", { kind, names: [{ kind: "full", value: name }], notes: $("#ne-about").value.trim(), contacts: web ? [{ channel: "website", value: web }] : [] });
    await closeDialog();
    await refreshCounts();
    toast(t("{name} was added", { name: created.display_name }), "good");
    go("entity", created.id);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
  }
}

/* ───────────────────────── Relationship and membership editors ───────────────────────── */

/*
 * Both use the side panel's shell, dirty guard and focus handling. The relationship form
 * reads as a sentence from this profile's side ("Peter is · parent of · Jana"): choosing
 * the phrase chooses the direction, and the record is stored once whichever side it was
 * entered from.
 */
let REL_TYPES = null;
async function relationshipTypes(force = false) {
  if (!REL_TYPES || force) REL_TYPES = await api("/relationship-types");
  return REL_TYPES;
}
const fits = (kinds, kind) => !kind || kinds.includes(kind);
/** The phrases this entity can use, grouped by category, each mapping to a type and direction. */
function typeOptions(anchorKind, targetKind, current) {
  const byCat = {};
  for (const tp of REL_TYPES.types) {
    const add = (dir, phrase) => (byCat[tp.category] ||= []).push(`<option value="${esc(tp.key)}|${dir}" ${current === `${tp.key}|${dir}` ? "selected" : ""}>${esc(t(phrase))}</option>`);
    if (fits(tp.subject_kinds, anchorKind) && fits(tp.object_kinds, targetKind)) add(tp.symmetric ? "mutual" : "out", tp.label);
    if (!tp.symmetric && fits(tp.object_kinds, anchorKind) && fits(tp.subject_kinds, targetKind)) add("in", tp.inverse);
  }
  const groups = Object.keys(REL_TYPES.categories)
    .filter((c) => byCat[c])
    .map((c) => `<optgroup label="${esc(t(REL_TYPES.categories[c]))}">${byCat[c].join("")}</optgroup>`);
  for (const c of Object.keys(byCat)) if (!REL_TYPES.categories[c]) groups.push(`<optgroup label="${esc(cap(c))}">${byCat[c].join("")}</optgroup>`);
  return `<option value="" ${current ? "" : "selected"} disabled>${esc(t("Choose…"))}</option>${groups.join("")}<option value="custom" ${current === "custom" ? "selected" : ""}>${esc(t("Something else…"))}</option>`;
}
/** Search-and-pick for People, Organizations and Groups, as a combobox. */
function entityPicker(id, { kinds, label, value = null, create = null }) {
  return `<div class="picker" id="${id}" data-kinds="${kinds.join(",")}" ${create ? `data-create="${create}"` : ""}>
    <input type="hidden" data-picked value="${esc(value?.id || "")}" data-kind="${esc(value?.kind || "")}" data-name="${esc(value?.display_name || "")}">
    <div class="picker-chosen" ${value ? "" : "hidden"}>${value ? pickerChosen(value) : ""}</div>
    <div class="search-box picker-search" ${value ? "hidden" : ""}>${icon("search")}
      <input class="ae-input" type="search" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-results" aria-label="${esc(label)}" placeholder="${esc(label)}" maxlength="200" autocomplete="off">
      <div class="search-results" id="${id}-results" role="listbox" hidden></div></div></div>`;
}
function pickerChosen(e) {
  return `${avatar(e.display_name, e.id, `sm is-${e.kind}`)}<span class="grow"><span class="primary">${esc(shownName(e))}${e.is_self ? ` <span class="self-badge">${esc(t("Me"))}</span>` : ""}</span><span class="secondary">${esc(t(KIND_NOUN[e.kind]))}</span></span><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="picker-change">${esc(t("Change"))}</button>`;
}
function bindPicker(root, { exclude = [], onPick = () => {} } = {}) {
  const input = $(".picker-search input", root);
  const box = $(".search-results", root);
  let items = [];
  let active = -1;
  let seq = 0;
  const show = (open) => {
    box.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };
  const highlightAt = (i) => {
    active = i;
    $$(".row", box).forEach((r, n) => r.setAttribute("aria-selected", String(n === i)) || r.classList.toggle("is-active", n === i));
    const row = $$(".row", box)[i];
    if (row) input.setAttribute("aria-activedescendant", row.id);
  };
  const pick = async (e) => {
    if (e.creating) {
      try {
        e = await api("/entities", "POST", { kind: e.creating, names: [{ kind: "full", value: e.display_name }] });
      } catch (error) {
        show(false);
        return toast(error.message, "danger");
      }
    }
    const hidden = $("[data-picked]", root);
    hidden.value = e.id;
    hidden.dataset.kind = e.kind;
    hidden.dataset.name = e.display_name; // sentences use the natural name, lists the preferred form
    $(".picker-chosen", root).innerHTML = pickerChosen(e);
    $(".picker-chosen", root).hidden = false;
    $(".picker-search", root).hidden = true;
    show(false);
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    onPick(e);
    $('[data-act="picker-change"]', root)?.focus();
  };
  root._pick = pick;
  root._unpick = () => {
    const hidden = $("[data-picked]", root);
    hidden.value = "";
    hidden.dataset.kind = "";
    hidden.dataset.name = "";
    $(".picker-chosen", root).hidden = true;
    $(".picker-search", root).hidden = false;
    input.value = "";
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    onPick(null);
    input.focus();
  };
  input.addEventListener(
    "input",
    debounce(async () => {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q) return show(false);
      const data = await api("/search" + query({ q, kinds: root.dataset.kinds })).catch(() => ({ entities: [] }));
      if (mine !== seq) return;
      items = data.entities.filter((e) => !exclude.includes(e.id));
      // A new one is offered only when nothing with this name exists; similar names stay visible above it.
      if (root.dataset.create && !data.alias && !data.entities.some((e) => foldText(e.display_name) === foldText(q))) items.push({ creating: root.dataset.create, display_name: q, id: "", kind: root.dataset.create });
      // @me is the person marked as the user (Settings → You); say so when no one is, or when
      // that person cannot be chosen here (this profile itself, or a picker for groups).
      const empty =
        data.alias === "me"
          ? data.self_missing
            ? t("No one is marked as you yet. Choose who you are in Settings → You.")
            : data.entities.length
              ? t("You can't be chosen here.")
              : t("@me is a person, and only {kinds} can be chosen here.", { kinds: root.dataset.kinds.split(",").map((k) => t(KIND_NOUN[k]).toLowerCase()).join(", ") })
          : t("No one matches “{q}”.", { q });
      box.innerHTML = items.length
        ? `<div class="rows">${items.map((e, i) => `<button class="row" type="button" role="option" id="${root.id}-o${i}" aria-selected="false" data-pick="${i}" tabindex="-1">${avatar(e.display_name, e.id, `sm is-${e.kind}`)}<span class="grow"><span class="primary">${e.creating ? esc(t("Create group “{name}”", { name: e.display_name })) : esc(shownName(e))}${e.is_self ? ` <span class="self-badge">${esc(t("Me"))}</span>` : ""}</span><span class="secondary">${e.creating ? esc(t("New group")) : esc(t(KIND_NOUN[e.kind]))}${e.work ? ` · ${esc(e.work)}` : ""}</span></span></button>`).join("")}</div>`
        : `<p class="empty">${esc(empty)}</p>`;
      active = -1;
      show(true);
    }, 150),
  );
  input.addEventListener("keydown", (event) => {
    const n = items.length;
    if (event.key === "ArrowDown" && n) {
      event.preventDefault();
      highlightAt((active + 1) % n);
    } else if (event.key === "ArrowUp" && n) {
      event.preventDefault();
      highlightAt((active - 1 + n) % n);
    } else if (event.key === "Enter" && n) {
      event.preventDefault();
      pick(items[Math.max(active, 0)]);
    } else if (event.key === "Escape" && !box.hidden) {
      event.stopPropagation();
      show(false);
    }
  });
  box.addEventListener("mousedown", (event) => event.preventDefault());
  box.addEventListener("click", (event) => {
    const row = event.target.closest("[data-pick]");
    if (row) pick(items[+row.dataset.pick]);
  });
}
function sourceRow(s = { kind: "observed", label: "" }, i = 0) {
  return `<div class="src-row" data-src>
    <div class="ae-field"><label class="ae-label" for="src-kind-${i}">${esc(t("How you know"))}</label><select class="ae-select" id="src-kind-${i}" data-k="kind">${Object.entries(SOURCE_KINDS).map(([k, l]) => `<option value="${k}" ${s.kind === k ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
    <div class="ae-field grow"><label class="ae-label" for="src-label-${i}">${esc(t("Details (optional)"))}</label><input class="ae-input" id="src-label-${i}" data-k="label" maxlength="300" value="${esc(s.entity_name && !s.label ? s.entity_name : s.label)}" placeholder="${esc(t("e.g. “Jana, at the wedding”, “company website”"))}"></div>
    <div class="ae-field src-learned"><span class="ae-label">${esc(t("Learned"))}</span>${dateInput(`src-learned-${i}`, s.learned)}</div>
    ${s.entity_id ? `<input type="hidden" data-k="entity_id" value="${esc(s.entity_id)}">` : ""}
    <button class="ae-btn ae-btn--quiet ae-btn--icon ae-btn--sm" data-act="src-remove" aria-label="${esc(t("Remove source"))}">${icon("x")}</button></div>`;
}
function readSources() {
  return $$("[data-src]", $("#panel-body")).map((row, i) => {
    const learned = readDate($("[data-date]", row));
    if (learned.error) throw Error(t("Source {n}: {e}", { n: i + 1, e: learned.error }));
    const entity = $('[data-k="entity_id"]', row)?.value;
    return { kind: $('[data-k="kind"]', row).value, label: $('[data-k="label"]', row).value.trim(), learned: learned.value, ...(entity ? { entity_id: entity } : {}) };
  });
}
function periodFields(r = {}) {
  return `<fieldset class="rel-period"><legend class="ae-label">${esc(t("When"))}</legend>
    <div class="rel-period-grid">
      <div class="ae-field"><span class="ae-label">${esc(t("Since"))}</span>${dateInput("rel-from", r.valid_from)}</div>
      <div class="ae-field"><span class="ae-label">${esc(t("Until"))}</span>${dateInput("rel-until", r.valid_until)}</div>
      <div class="ae-field"><label class="ae-label" for="rel-state">${esc(t("Now"))}</label><select class="ae-select" id="rel-state">${[["current", "Current"], ["former", "Ended — keep as history"], ["unknown", "Not known"]].map(([v, l]) => `<option value="${v}" ${(r.state || "current") === v ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
    </div><p class="ae-hint">${esc(t("Leave unknown parts empty: a year alone, or a month and year, is fine."))}</p></fieldset>`;
}
function knowledgeFields(r = {}) {
  return `<div class="ae-field"><label class="ae-label" for="rel-confidence">${esc(t("How sure are you?"))}</label><select class="ae-select" id="rel-confidence">${[["", "Not stated"], ["high", "Sure"], ["medium", "Fairly sure"], ["low", "Uncertain"], ["unknown", "Don't know"]].map(([v, l]) => `<option value="${v}" ${(r.confidence || "") === v ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
    <div class="rel-sources"><span class="ae-label">${esc(t("Where this comes from"))}</span><div id="src-rows">${(r.sources || []).map(sourceRow).join("")}</div>
      <button class="ae-btn ae-btn--sm" data-act="src-add">${icon("plus")}<span>${esc(t("Add a source"))}</span></button></div>
    <div class="ae-field"><label class="ae-label" for="rel-note">${esc(t("Note"))}</label><textarea class="ae-textarea" id="rel-note" rows="3" maxlength="2000">${esc(r.note || "")}</textarea></div>`;
}
/** Open the panel shell with any body; the regular editors use openPanel(). */
function openShell(section, { eyebrow, title, body, foot = "" }) {
  panel.session = null;
  const html = `<div class="panel-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2 id="panel-title">${esc(title)}</h2></div><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="panel-close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <div class="panel-body" id="panel-body">${body}</div>
    <div class="panel-foot"><p class="form-error" id="form-error" role="alert" hidden></p><div class="buttons">${foot}<span class="dirty" id="panel-dirty" aria-live="polite"></span><button class="ae-btn" data-act="panel-close">${esc(t("Cancel"))}</button><button class="ae-btn ae-btn--primary" data-act="panel-save">${esc(t("Save"))}</button></div></div>`;
  panel.section = section;
  const existing = panel.el();
  if (existing) {
    existing.innerHTML = html;
    animate($("#panel-body"), [{ opacity: 0 }, { opacity: 1 }], MOTION.fast);
  } else {
    document.body.insertAdjacentHTML("beforeend", `<div class="scrim" id="scrim" data-act="panel-close"></div><aside class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">${html}</aside>`);
    const narrow = innerWidth <= 640;
    animate($("#scrim"), [{ opacity: 0 }, { opacity: 1 }], MOTION.page);
    animate(panel.el(), [{ opacity: 0, transform: narrow ? "translateY(24px)" : "translateX(28px)" }, { opacity: 1, transform: "none" }], MOTION.panel);
    $("#app").setAttribute("aria-hidden", "true");
    $("#app").inert = true;
  }
}
const relEditor = { record: null, anchor: null };
async function openRelation(record, invoker) {
  if (panel.isDirty() && !(await confirmDiscard())) return;
  await relationshipTypes();
  const p = state.person;
  relEditor.record = record;
  relEditor.anchor = p;
  relEditor.allowSimilar = false;
  relEditor.suggested = null; // the start date last suggested, while the user has not changed it
  relEditor.ends = null; // ongoing relationships the user chose to end (creation only)
  panel.invoker = invoker && invoker.isConnected ? invoker : panel.invoker;
  const other = record?.other || null;
  const value = record ? `${record.type}|${record.direction}` : "";
  openShell("relationship", {
    eyebrow: p.display_name,
    title: record ? t("Relationship") : t("New relationship"),
    body: `<div class="rel-sentence">
        <div class="rel-self">${avatar(p.display_name, p.id, `sm is-${p.kind}`)}<span>${esc(p.display_name)}</span><span class="muted" id="rel-is">${esc(t("is"))}</span></div>
        <div class="ae-field"><label class="ae-label" for="rel-type">${esc(t("Relationship"))}</label><select class="ae-select" id="rel-type">${typeOptions(p.kind, other?.kind, value)}</select></div>
        <div class="ae-field"><span class="ae-label" id="rel-target-label">${esc(t("Of whom"))}</span>${entityPicker("rel-target", { kinds: ["person", "organization", "group"], label: t("Search people, organizations and groups"), value: other })}</div>
      </div>
      <div class="ae-field rel-kinship" id="rel-kinship-wrap" hidden><label class="ae-label" for="rel-kinship" id="rel-kinship-label"></label><select class="ae-select" id="rel-kinship" data-initial="${esc(record ? record.kinship || "" : "new")}"></select><p class="ae-hint" id="rel-kinship-hint"></p></div>
      <div id="rel-custom" class="rel-custom" hidden>
        <div class="ae-field"><label class="ae-label" for="rel-c-label">${esc(t("In words, from this side"))}</label><input class="ae-input" id="rel-c-label" maxlength="60" placeholder="${esc(t("e.g. “godparent of”"))}"></div>
        <div class="ae-field"><label class="ae-label" for="rel-c-inverse">${esc(t("From the other side (optional)"))}</label><input class="ae-input" id="rel-c-inverse" maxlength="60" placeholder="${esc(t("e.g. “godchild of” — empty if it reads the same both ways"))}"></div>
        <div class="ae-field"><label class="ae-label" for="rel-c-cat">${esc(t("Kind"))}</label><select class="ae-select" id="rel-c-cat">${Object.entries(REL_TYPES.categories).filter(([k]) => !["membership", "employment"].includes(k)).map(([k, l]) => `<option value="${k}" ${k === "other" ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
      </div>
      <p class="rel-reads" id="rel-reads" aria-live="polite"></p>
      <div class="ae-field"><label class="ae-label" for="rel-context">${esc(t("In your own words (optional)"))}</label><input class="ae-input" id="rel-context" maxlength="80" value="${esc(record?.context || "")}" placeholder="${esc(t("e.g. “best friend”, “maternal grandmother”"))}"></div>
      ${periodFields(record || {})}
      <p class="ae-hint rel-suggest" id="rel-suggest" aria-live="polite" hidden></p>
      ${knowledgeFields(record || {})}
      <div id="rel-similar" hidden></div>`,
    foot: record ? `<button class="ae-btn ae-btn--quiet is-danger" data-act="rel-remove">${icon("trash")}<span>${esc(t("Remove"))}</span></button>${record.state !== "former" ? `<button class="ae-btn ae-btn--quiet" data-act="rel-end">${esc(t("End it"))}</button>` : ""}` : "",
  });
  const picker = $("#rel-target");
  bindPicker(picker, {
    exclude: [p.id],
    onPick: () => {
      refreshTypeOptions();
      relKinship();
      relSuggest();
    },
  });
  $("#rel-type").addEventListener("change", () => {
    $("#rel-custom").hidden = $("#rel-type").value !== "custom";
    readsLine();
    relKinship();
    relSuggest();
  });
  $("#rel-kinship").addEventListener("change", () => {
    relKinshipHint();
    relSuggest();
  });
  relKinship();
  ["rel-c-label", "rel-c-inverse", "rel-context"].forEach((id) => $(`#${id}`).addEventListener("input", readsLine));
  readsLine();
  panel.snapshot = formState();
  (record ? $("#rel-type") : $(".picker-search input", picker))?.focus({ preventScroll: true });
}
/* Kinship origin (parent and sibling relationships): kept on the record, shown in details. */
const KINSHIP_CHOICES = {
  parent: { label: "Parenthood", options: { biological: "Biological", adoptive: "Adoptive", step: "Step-parent", "": "Not specified" } },
  sibling: { label: "Kind of siblings", options: { biological_full: "Full siblings", biological_half: "Half-siblings", biological: "Biological — full or half not known", adoptive: "Through adoption", step: "Step-siblings", "": "Not specified" } },
};
const KINSHIP_TEXT = {
  parent: { biological: "biological", adoptive: "adoptive", step: "step-parent" },
  sibling: { biological_full: "full siblings", biological_half: "half-siblings", biological: "biological siblings", adoptive: "siblings through adoption", step: "step-siblings" },
};
const kinshipText = (type, kinship) => (kinship && KINSHIP_TEXT[type]?.[kinship] ? t(KINSHIP_TEXT[type][kinship]) : "");
const relTypeKey = () => ($("#rel-type")?.value || "").split("|")[0];
/** Show the kinship control for parent and sibling relationships, keeping any choice made. */
function relKinship() {
  const wrap = $("#rel-kinship-wrap");
  if (!wrap) return;
  const key = relTypeKey();
  const spec = KINSHIP_CHOICES[key];
  wrap.hidden = !spec;
  if (!spec) return;
  const select = $("#rel-kinship");
  const initial = select.dataset.initial;
  const keep = select.dataset.type === key ? select.value : initial === "new" ? (key === "parent" ? "biological" : "") : initial;
  select.dataset.type = key;
  $("#rel-kinship-label").textContent = t(spec.label);
  const chosen = keep in spec.options ? keep : "";
  select.innerHTML = Object.entries(spec.options)
    .map(([v, l]) => `<option value="${v}" ${v === chosen ? "selected" : ""}>${esc(t(l))}</option>`)
    .join("");
  relKinshipHint();
}
function relKinshipHint() {
  const hint = $("#rel-kinship-hint");
  if (!hint) return;
  const key = relTypeKey();
  const v = $("#rel-kinship").value;
  let text = "";
  if (key === "parent" && v === "adoptive") text = t("Adoptive parenthood has its own dates and never replaces a biological parent.");
  else if (key === "parent" && v === "step") text = t("A parent's partner. Step-parents are not used to suggest siblings.");
  else if (key === "sibling") text = t("Shown as “sibling of”; the kind is kept in the details.");
  hint.textContent = text;
  hint.hidden = !text;
}
const relKinshipValue = () => ($("#rel-kinship-wrap")?.hidden !== false ? null : $("#rel-kinship").value || null);
function setDateInput(root, value) {
  let y = "", m = "", d = "";
  if (value?.startsWith("--")) [m, d] = [value.slice(2, 4), value.slice(5, 7)];
  else if (value) [y, m, d] = value.split("-");
  $("[data-part=y]", root).value = y || "";
  $("[data-part=m]", root).value = m || "";
  $("[data-part=d]", root).value = d ? String(+d) : "";
}
let relSuggestSeq = 0;
/** For a new parent relationship, offer the child's birth date as Since: shown, editable, and
    never written over a date the user entered. Until is never suggested. */
async function relSuggest() {
  const hint = $("#rel-suggest");
  if (!hint || relEditor.record) return;
  const mine = ++relSuggestSeq;
  const [key, dir] = ($("#rel-type").value || "").split("|");
  const targetId = $("#rel-target [data-picked]").value;
  const anchor = relEditor.anchor;
  let info = {};
  if (key === "parent" && targetId) {
    const ids = dir === "in" ? { subject_id: targetId, object_id: anchor.id } : { subject_id: anchor.id, object_id: targetId };
    info = await api("/relationship-suggestion" + query({ ...ids, type: key, kinship: relKinshipValue() || "" })).catch(() => ({}));
    if (mine !== relSuggestSeq || !$("#rel-suggest")) return;
  }
  const next = info.valid_from || null;
  const widget = $('[data-date="rel-from"]');
  const read = readDate(widget);
  const current = read.error ? "?" : read.value || null;
  const value = MeridianUX.takeSuggestion(current, relEditor.suggested, next);
  const userDate = current && current !== relEditor.suggested;
  if (!userDate && value !== current) setDateInput(widget, value);
  if (!userDate) relEditor.suggested = next;
  hint.hidden = !next || userDate;
  if (next && !userDate) hint.textContent = t(info.approximate ? "Since is set to {name}’s approximate birth date. Change it if the relationship began at another time." : "Since is set to {name}’s birth date. Change it if the relationship began at another time.", { name: info.child?.display_name || "" });
  const dirty = $("#panel-dirty");
  if (dirty) dirty.textContent = panel.isDirty() ? t("Unsaved changes") : "";
}
function refreshTypeOptions() {
  const select = $("#rel-type");
  const kind = $("#rel-target [data-picked]").dataset.kind || null;
  const before = select.value;
  select.innerHTML = typeOptions(relEditor.anchor.kind, kind, before);
  if (before && select.value !== before) select.value = "";
  $("#rel-custom").hidden = select.value !== "custom";
  readsLine();
}
/** The “is” after the anchor's name, only while the chosen phrase needs one: “is parent of”,
    but “studies at” or “has student”. Shown while no relationship is chosen. */
function relSelfVerb(value) {
  let phrase = "";
  if (value === "custom") phrase = $("#rel-c-label").value;
  else if (value) {
    const [key, dir] = value.split("|");
    const tp = REL_TYPES.types.find((x) => x.key === key);
    phrase = (dir === "in" ? tp?.inverse : tp?.label) || "";
  }
  $("#rel-is").hidden = MeridianUX.relationIsVerbPhrase(phrase);
}
/** The sentence the record will say, from this side, so direction is never ambiguous. */
function readsLine() {
  const line = $("#rel-reads");
  if (!line) return;
  const value = $("#rel-type").value;
  relSelfVerb(value);
  const target = $("#rel-target [data-picked]");
  const name = target.dataset.name;
  if (!value || !target.value || !name) return (line.textContent = "");
  const me = relEditor.anchor.display_name;
  let phrase;
  let back;
  if (value === "custom") {
    phrase = $("#rel-c-label").value.trim().toLowerCase();
    back = $("#rel-c-inverse").value.trim().toLowerCase() || phrase;
  } else {
    const [key, dir] = value.split("|");
    const tp = REL_TYPES.types.find((x) => x.key === key);
    phrase = dir === "in" ? tp.inverse : tp.label;
    back = dir === "in" ? tp.label : tp.inverse;
  }
  if (!phrase) return (line.textContent = "");
  const context = $("#rel-context").value.trim();
  line.innerHTML = `${icon("info")}<span>${esc(t("Reads as: {s}; and from {b}’s profile: {r}.", { s: relationSentence(me, phrase, name), b: name, r: relationSentence(name, back, me) }))}${context ? ` ${esc(t("Shown as “{c}”.", { c: context }))}` : ""}</span>`;
}
async function saveRelation(button, allowSimilar = false) {
  const box = $("#form-error");
  box.hidden = true;
  if (!panel.isDirty() && !allowSimilar) return closePanel();
  const p = relEditor.anchor;
  try {
    const targetId = $("#rel-target [data-picked]").value;
    if (!targetId) throw Error(t("Choose who or what the relationship is with."));
    let value = $("#rel-type").value;
    if (!value) throw Error(t("Choose a relationship."));
    if (value === "custom") {
      const label = $("#rel-c-label").value.trim();
      if (!label) throw Error(t("Describe the relationship in words."));
      const made = await api("/relationship-types", "POST", { label, inverse: $("#rel-c-inverse").value.trim(), symmetric: !$("#rel-c-inverse").value.trim(), category: $("#rel-c-cat").value });
      await relationshipTypes(true);
      value = `${made.key}|${made.symmetric ? "mutual" : "out"}`;
    }
    const [type, dir] = value.split("|");
    const from = readDate($('[data-date="rel-from"]'));
    const until = readDate($('[data-date="rel-until"]'));
    if (from.error || until.error) throw Error(t("When: {e}", { e: from.error || until.error }));
    const body = {
      subject_id: dir === "in" ? targetId : p.id,
      object_id: dir === "in" ? p.id : targetId,
      type,
      context: $("#rel-context").value.trim(),
      state: $("#rel-state").value,
      valid_from: from.value,
      valid_until: until.value,
      confidence: $("#rel-confidence").value || null,
      note: $("#rel-note").value.trim(),
      sources: readSources(),
      allow_similar: allowSimilar,
      kinship: relKinshipValue(),
    };
    button.classList.add("is-busy");
    const record = relEditor.record;
    relEditor.allowSimilar = allowSimilar;
    if (!allowSimilar) {
      const check = await api("/similar-relationships" + query({ subject_id: body.subject_id, object_id: body.object_id, type, exclude: record?.id || "", kinship: body.kinship || "" }));
      if (check.similar.length) {
        button.classList.remove("is-busy");
        return showSimilar(check.similar);
      }
    }
    // A new relationship between two who already have an ongoing one: ask before saving.
    if (!record && relEditor.ends === null) {
      const { active } = await api("/active-relationships" + query({ subject_id: body.subject_id, object_id: body.object_id, type }));
      if (active.length) {
        button.classList.remove("is-busy");
        return showTransition(active, body);
      }
    }
    if (!record && relEditor.ends?.length) body.end_relationships = relEditor.ends;
    const saved = await api(record ? `/relationships/${record.id}` : "/relationships", record ? "PUT" : "POST", body);
    const ended = body.end_relationships?.length || 0;
    await afterConnectionSave("relationships", ended ? plural(ended, "Relationship saved; {count} ended", "Relationship saved; {count} ended") : t("Relationship saved"));
    if (type === "parent") await offerSiblings(saved.id);
  } catch (error) {
    relEditor.ends = null; // ask again next time: the data may have changed meanwhile
    button?.classList.remove("is-busy");
    if (!panel.el()) return toast(error.message, "danger");
    box.textContent = error.message;
    box.hidden = false;
    animate(box, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
  }
}
/** Ongoing relationships between the same two: end some, keep all, or go back. Nothing changes
    until the new relationship is saved, and then everything is saved together. */
function showTransition(active, body) {
  const preselected = new Set(MeridianUX.preselectedEnds(active));
  const tp = REL_TYPES.types.find((x) => x.key === body.type);
  const sentence = (r) => relationSentence(r.subject.display_name, r.label, r.object.display_name);
  const rows = active
    .map((r) => {
      const facts = [period(r) || t("start not recorded"), r.state === "unknown" ? t("whether it continues is not recorded") : t("no end date"), r.context ? `“${r.context}”` : ""].filter(Boolean).join(" · ");
      return `<label class="tr-row"><input type="checkbox" class="ae-check" data-end="${esc(r.id)}" ${preselected.has(r.id) ? "checked" : ""}><span class="grow"><span class="primary">${esc(sentence(r))}</span><span class="secondary">${esc(facts)}</span></span></label>`;
    })
    .join("");
  const other = $("#rel-target [data-picked]").dataset.name || "";
  openDialog(
    `<div class="ae-dialog-head"><h2 id="tr-title">${esc(t("Still going on?"))}</h2></div>
    <div class="ae-dialog-body tr-body"><p class="muted" style="margin-top:0">${esc(t(active.length === 1 ? "{a} and {b} already have a relationship with no end date. You are adding “{phrase}”." : "{a} and {b} already have {n} relationships with no end date. You are adding “{phrase}”.", { a: relEditor.anchor.display_name, b: other, phrase: t(tp?.label || body.type), n: active.length }))}</p>
      <fieldset class="tr-list"><legend class="ae-label">${esc(t("End any of these when the new one begins?"))}</legend>${rows}</fieldset>
      <div class="ae-field tr-date"><span class="ae-label">${esc(t("Ended on"))}</span>${dateInput("tr-until", body.valid_from)}<p class="ae-hint">${esc(t("Leave it empty if you don't know; nothing is guessed. Ended relationships stay in their history."))}</p></div>
      <p class="form-error" id="tr-error" role="alert" hidden></p></div>
    <div class="ae-dialog-foot tr-foot"><button class="ae-btn" data-act="tr-cancel">${esc(t("Cancel"))}</button><button class="ae-btn" data-act="tr-keep">${esc(t("Keep all and save"))}</button><button class="ae-btn ae-btn--primary" data-act="tr-end">${esc(t("End selected and save"))}</button></div>`,
    { wide: true },
  );
  const d = dialog();
  d.setAttribute("aria-labelledby", "tr-title");
  const sync = () => {
    const any = $$("[data-end]:checked", d).length > 0;
    $('[data-act="tr-end"]', d).disabled = !any;
    $(".tr-date", d).hidden = !any;
  };
  d.onchange = sync;
  sync();
  ($('[data-act="tr-end"]:not(:disabled)', d) || $('[data-act="tr-keep"]', d)).focus();
  relEditor.transitionActive = active;
}
async function finishTransition(choice) {
  const d = dialog();
  d.onchange = null;
  const save = $('#panel [data-act="panel-save"]');
  if (choice === "cancel") {
    relEditor.ends = null;
    await closeDialog();
    return save?.focus();
  }
  let ends = [];
  if (choice === "end") {
    const until = readDate($('[data-date="tr-until"]', d));
    const chosen = $$("[data-end]:checked", d).map((el) => el.dataset.end);
    let problem = until.error || "";
    if (!problem && until.value?.startsWith("--")) problem = t("Add a year to the end date, or leave it empty.");
    if (!problem && relEditor.transitionActive.some((r) => chosen.includes(r.id) && !MeridianUX.endFits(r.valid_from, until.value))) problem = t("The end date is before one of these relationships began.");
    if (problem) {
      const error = $("#tr-error", d);
      error.textContent = problem;
      error.hidden = false;
      d.onchange = () => (error.hidden = true);
      return;
    }
    ends = chosen.map((id) => ({ id, valid_until: until.value || null }));
  }
  relEditor.ends = ends;
  await closeDialog();
  return saveRelation(save, relEditor.allowSimilar);
}
/* After a parent relationship is saved: the siblings its recorded parents point to, confirmed or
   declined together in one dialog. Nothing is created without the user's answer. */
const SIBLING_REASON = {
  two_biological: "Both have {parents} as biological parents.",
  one_biological_other_different: "Both have {parents} as a biological parent; their other biological parents are different people.",
  one_biological_other_unknown: "Both have {parents} as a biological parent. Whether they share their other parent is not recorded.",
  adoptive: "{parents} is an adoptive parent of at least one of them.",
  unspecified: "Both have {parents} as a parent; the kind of parenthood is not recorded.",
};
async function offerSiblings(relationshipId) {
  let data;
  try {
    data = await api("/sibling-suggestions" + query({ relationship: relationshipId }));
  } catch {
    return; // only a suggestion: the relationship itself is saved
  }
  const list = data.suggestions;
  if (!list.length) return;
  const names = (people) => people.map((x) => x.display_name).join(t(" and "));
  const rows = list
    .map((s, i) => {
      const { options, preselected } = MeridianUX.siblingChoices(s);
      const now = s.action === "update" ? t("Recorded now as {kind}.", { kind: kinshipText("sibling", s.current_kinship) || t("siblings, without details") }) + " " : "";
      const question = s.action === "update" ? t("Update their sibling relationship?") : t("Are {a} and {b} siblings?", { a: s.a.display_name, b: s.b.display_name });
      return `<li class="sib-row"><div class="sib-who">${avatar(s.a.display_name, s.a.id, "sm")}<span class="nm">${esc(shownName(s.a))}</span><span class="sib-and" aria-hidden="true">&amp;</span>${avatar(s.b.display_name, s.b.id, "sm")}<span class="nm">${esc(shownName(s.b))}</span></div>
        <p class="sib-why">${esc(now + t(SIBLING_REASON[s.reason] || SIBLING_REASON.unspecified, { parents: names(s.shared_parents) }))}</p>
        <div class="ae-field"><label class="ae-label" for="sib-${i}">${esc(question)}</label><select class="ae-select" id="sib-${i}" data-sib="${i}">${options.map((o) => `<option value="${esc(o.value)}" ${o.value === preselected ? "selected" : ""}>${esc(t(o.label))}</option>`).join("")}</select></div></li>`;
    })
    .join("");
  relEditor.siblings = list;
  openDialog(
    `<div class="ae-dialog-head"><h2 id="sib-title">${esc(list.length === 1 ? t("Possible sibling") : t("Possible siblings"))}</h2></div>
    <div class="ae-dialog-body"><p class="muted" style="margin-top:0">${esc(t("The parents recorded for {name} suggest these sibling relationships. Nothing is saved until you confirm.", { name: data.child.display_name }))}</p><ul class="sib-list">${rows}</ul><p class="form-error" id="sib-error" role="alert" hidden></p></div>
    <div class="ae-dialog-foot"><button class="ae-btn" data-act="sib-cancel">${esc(t("Not now"))}</button><button class="ae-btn ae-btn--primary" data-act="sib-save">${esc(t("Save answers"))}</button></div>`,
    { wide: true },
  );
  dialog().setAttribute("aria-labelledby", "sib-title");
}
async function saveSiblings(button) {
  const d = dialog();
  const list = relEditor.siblings || [];
  const items = MeridianUX.siblingItems(list, list.map((_, i) => $(`[data-sib="${i}"]`, d)?.value));
  if (!items.length) return closeDialog();
  button.classList.add("is-busy");
  try {
    const done = await api("/sibling-suggestions/apply", "POST", { items });
    await closeDialog();
    const n = done.created + done.updated;
    toast(n ? plural(n, "{count} sibling relationship saved", "{count} sibling relationships saved") : t("Already recorded"), n ? "good" : "");
    if (state.person && ["person", "entity"].includes(state.route.view)) {
      state.person = await api(entityApi(state.person));
      refreshPerson();
    }
    refreshCounts();
  } catch (error) {
    button.classList.remove("is-busy");
    const box = $("#sib-error", d);
    box.textContent = error.message;
    box.hidden = false;
  }
}
/** A similar relationship exists: show it, and let the user decide with full knowledge. */
function showSimilar(similar) {
  const box = $("#rel-similar");
  box.innerHTML = `<div class="notice warn">${icon("alert")}<div><p><b>${esc(t("This may already be recorded"))}</b></p>
    <ul class="similar-list">${similar.map((r) => `<li>${esc(cap(t(r.phrase)))} ${esc(r.other?.display_name || "")}${r.context ? ` · “${esc(r.context)}”` : ""}${period(r) ? ` · ${esc(period(r))}` : ""}${r.state === "former" ? ` · ${esc(t("ended"))}` : ""}</li>`).join("")}</ul>
    <p>${esc(t("Save anyway if this is a different relationship, for example a later period, or a different account of the same one. Nothing is merged automatically."))}</p>
    <div class="actions"><button class="ae-btn ae-btn--sm" data-act="rel-save-anyway">${esc(t("Save anyway"))}</button><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="edit-relation" data-id="${esc(similar[0].id)}">${esc(t("Edit the existing one"))}</button></div></div></div>`;
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  animate(box, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
  $('[data-act="rel-save-anyway"]', box).focus();
}
const memEditor = { record: null, anchor: null };
async function openMembership(record, invoker) {
  if (panel.isDirty() && !(await confirmDiscard())) return;
  const p = state.person;
  const fromGroup = p.kind === "group";
  memEditor.record = record;
  memEditor.anchor = p;
  panel.invoker = invoker && invoker.isConnected ? invoker : panel.invoker;
  const other = record ? (fromGroup ? record.member : record.group) : null;
  openShell("membership", {
    eyebrow: p.display_name,
    title: record ? t("Membership") : fromGroup ? t("Add a member") : t("Add to a group"),
    body: `<div class="ae-field"><span class="ae-label">${esc(fromGroup ? t("Member") : t("Group"))}</span>${entityPicker("mem-target", { kinds: fromGroup ? ["person", "organization"] : ["group"], label: fromGroup ? t("Search people and organizations") : t("Search groups, or type a new name"), value: other, create: fromGroup ? null : "group" })}</div>
      <div class="ae-field"><label class="ae-label" for="mem-role">${esc(t("Role (optional)"))}</label><input class="ae-input" id="mem-role" maxlength="80" value="${esc(record?.role || "")}" placeholder="${esc(t("e.g. “organizer”, “founding member”"))}"></div>
      ${periodFields(record || {})}
      ${knowledgeFields(record || {})}
      <p class="ae-hint">${esc(t("Being in the same group says nothing about how members relate to each other; record that as a relationship."))}</p>`,
    foot: record ? `<button class="ae-btn ae-btn--quiet is-danger" data-act="mem-remove">${icon("trash")}<span>${esc(t("Remove"))}</span></button>` : "",
  });
  bindPicker($("#mem-target"), { exclude: [p.id] });
  panel.snapshot = formState();
  (record ? $("#mem-role") : $("#mem-target .picker-search input"))?.focus({ preventScroll: true });
}
async function saveMembership(button) {
  const box = $("#form-error");
  box.hidden = true;
  if (!panel.isDirty()) return closePanel();
  const p = memEditor.anchor;
  try {
    const otherId = $("#mem-target [data-picked]").value;
    if (!otherId) throw Error(p.kind === "group" ? t("Choose a member.") : t("Choose a group."));
    const from = readDate($('[data-date="rel-from"]'));
    const until = readDate($('[data-date="rel-until"]'));
    if (from.error || until.error) throw Error(t("When: {e}", { e: from.error || until.error }));
    const body = {
      group_id: p.kind === "group" ? p.id : otherId,
      member_id: p.kind === "group" ? otherId : p.id,
      role: $("#mem-role").value.trim(),
      state: $("#rel-state").value,
      valid_from: from.value,
      valid_until: until.value,
      confidence: $("#rel-confidence").value || null,
      note: $("#rel-note").value.trim(),
      sources: readSources(),
    };
    button.classList.add("is-busy");
    const record = memEditor.record;
    await api(record ? `/memberships/${record.id}` : "/memberships", record ? "PUT" : "POST", body);
    await afterConnectionSave(p.kind === "group" ? "members" : "relationships", t("Membership saved"));
  } catch (error) {
    button.classList.remove("is-busy");
    box.textContent = error.message;
    box.hidden = false;
  }
}
/** After a relationship or membership change: reload this profile, close, mark the section. */
async function afterConnectionSave(section, message) {
  const button = $('#panel [data-act="panel-save"]');
  if (button) {
    button.classList.remove("is-busy");
    button.classList.add("is-done");
    button.innerHTML = `${icon("check")}<span>${esc(t("Saved"))}</span>`;
  }
  panel.snapshot = formState();
  state.person = await api(entityApi(state.person));
  await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 300));
  refreshPerson();
  panel.invoker = $(`.psection[data-section="${section}"] [data-act^="add-"]`) || $("[data-heading]");
  await closePanel();
  const target = $(`.psection[data-section="${section}"]`);
  if (target) {
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
  }
  toast(message, "good");
  refreshCounts();
}

/* ───────────────────────── Side panel (editing) ───────────────────────── */

const LABELS = { phone: ["mobile", "home", "work", "main", "fax", "other"], email: ["home", "work", "other"], website: ["personal", "work", "blog", "other"] };
const EDITORS = {
  contacts: {
    title: "Contact",
    add: "Add phone, email or website",
    blank: () => ({ channel: "phone", value: "", label: "mobile", is_primary: false }),
    fields: [
      { k: "channel", label: "Type", type: "select", options: [["phone", "Phone"], ["email", "Email"], ["website", "Website"]] },
      { k: "value", label: "Value", type: "text", max: 320 },
      { k: "label", label: "Label", type: "list", list: "contact-labels", max: 40 },
      { k: "is_primary", label: "Primary", type: "check" },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
  dates: {
    title: "Personal dates",
    add: "Add date",
    blank: () => ({ kind: "birth", date: null, approximate: false }),
    fields: [
      { k: "kind", label: "Kind", type: "select", options: [["birth", "Birthday"], ["name_day", "Name day"], ["anniversary", "Anniversary"], ["death", "Death"], ["custom", "Other date"]] },
      { k: "label", label: "Label (optional)", type: "text", max: 80 },
      { k: "date", label: "Date — leave unknown parts empty", type: "date" },
      { k: "approximate", label: "Approximate", type: "check" },
      { k: "description", label: "Or describe it", type: "text", max: 120, placeholder: "e.g. summer 2022" },
    ],
    more: ["confidence", "note"],
  },
  employments: {
    title: "Work",
    add: "Add organization or role",
    blank: () => ({ organization: "", title: "" }),
    fields: [
      { k: "organization", label: "Organization", type: "org", max: 200 },
      { k: "organization_id", type: "hidden" },
      { k: "title", label: "Title", type: "text", max: 200 },
      { k: "department", label: "Department", type: "text", max: 200 },
      { k: "role", label: "Role", type: "text", max: 200, placeholder: "e.g. founder, volunteer" },
      { k: "valid_from", label: "From", type: "partial" },
      { k: "valid_until", label: "Until", type: "partial" },
    ],
    more: ["confidence", "note"],
  },
  education: {
    title: "Education",
    add: "Add school, course or training",
    blank: () => ({ organization: "", kind: "university", status: "" }),
    fields: [
      { k: "organization", label: "School or institution", type: "org", max: 200 },
      { k: "organization_id", type: "hidden" },
      { k: "kind", label: "Kind", type: "kind", options: Object.keys(EDUCATION_KINDS), names: EDUCATION_KINDS },
      { k: "program", label: "Program", type: "text", max: 200 },
      { k: "field", label: "Field of study", type: "text", max: 200 },
      { k: "degree", label: "Degree or qualification", type: "text", max: 200, placeholder: "e.g. MSc, A-levels, certificate" },
      { k: "status", label: "Status", type: "kind", options: ["", ...Object.keys(EDUCATION_STATUS)], names: { "": "Not recorded", ...EDUCATION_STATUS } },
      { k: "valid_from", label: "From", type: "partial" },
      { k: "valid_until", label: "Until", type: "partial" },
      { k: "department", label: "School, faculty or department", type: "text", max: 200 },
      { k: "achievements", label: "Achievements", type: "text", max: 2000 },
    ],
    more: ["confidence", "note"],
  },
  interests: {
    title: "Interests and preferences",
    add: "Add interest or preference",
    blank: () => ({ subject: "", category: "hobbies", sentiment: "likes" }),
    fields: [
      { k: "subject", label: "What", type: "text", max: 300, placeholder: "e.g. chess, Radiohead, spicy food" },
      { k: "sentiment", label: "Feeling", type: "kind", options: Object.keys(SENTIMENTS), names: SENTIMENTS },
      { k: "category", label: "Category", type: "kind", options: Object.keys(INTEREST_CATEGORIES), names: INTEREST_CATEGORIES },
      { k: "context", label: "When or where (optional)", type: "text", max: 300, placeholder: "e.g. with dinner, when urgent" },
      { k: "target_kind", type: "hidden" },
      { k: "target_ref", type: "hidden" },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
  accounts: {
    title: "Online accounts",
    add: "Add account",
    blank: () => ({ service: "", handle: "", state: "active" }),
    fields: [
      { k: "service", label: "Service", type: "list", list: "services", max: 60 },
      { k: "handle", label: "Handle or username", type: "text", max: 200 },
      { k: "display_name", label: "Display name", type: "text", max: 200 },
      { k: "url", label: "Profile address", type: "text", max: 2048, placeholder: "https://" },
      { k: "state", label: "State", type: "select", options: [["active", "Active"], ["inactive", "Inactive"], ["deleted", "Deleted"], ["unknown", "Unknown"]] },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
  addresses: {
    title: "Addresses",
    add: "Add address",
    blank: () => ({ label: "home", is_primary: false }),
    addressSearch: true,
    lead: ["label", "is_primary"],
    fields: [
      { k: "label", label: "Label", type: "list", list: "address-labels", max: 40 },
      { k: "street", label: "Street and number", type: "text", max: 200 },
      { k: "extended", label: "Apartment, building", type: "text", max: 200 },
      { k: "postal_code", label: "Postal code", type: "text", max: 30 },
      { k: "locality", label: "City", type: "text", max: 120 },
      { k: "region", label: "Region", type: "text", max: 120 },
      { k: "country", label: "Country", type: "text", max: 120 },
      { k: "po_box", label: "PO box", type: "text", max: 60 },
      { k: "is_primary", label: "Primary", type: "check" },
      { k: "formatted", type: "hidden" },
      { k: "latitude", type: "hidden" },
      { k: "longitude", type: "hidden" },
      { k: "geo_precision", type: "hidden" },
      { k: "geo_key", type: "hidden" },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
  names: {
    title: "Names",
    add: "Add name",
    blank: () => ({ kind: "nickname", value: "" }),
    fields: [
      { k: "kind", label: "Kind", type: "kind", options: Object.keys(NAME_KINDS), names: NAME_KINDS },
      { k: "value", label: "Name as written", type: "text", max: 300 },
      { k: "given", label: "Given", type: "text", max: 120 },
      { k: "middle", label: "Middle", type: "text", max: 120 },
      { k: "family", label: "Family", type: "text", max: 120 },
      { k: "prefix", label: "Prefix", type: "text", max: 60 },
      { k: "suffix", label: "Suffix", type: "text", max: 60 },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
  facts: {
    title: "Other details",
    add: "Add detail",
    blank: () => ({ key: "", value: "" }),
    fields: [
      { k: "key", label: "Label", type: "text", max: 80 },
      { k: "value", label: "Value", type: "text", max: 4000 },
    ],
    more: ["valid_from", "valid_until", "confidence", "note"],
  },
};
const PANEL_ORDER = {
  person: ["contacts", "dates", "employments", "education", "interests", "accounts", "addresses", "names", "facts", "notes"],
  organization: ["names", "contacts", "addresses", "accounts", "dates", "facts", "notes"],
  group: ["names", "dates", "facts", "notes"],
};
const PANEL_TITLES = { notes: "Notes" };
const panelTitle = (s) => t(EDITORS[s]?.title || PANEL_TITLES[s]);
const MORE = {
  valid_from: { k: "valid_from", label: "Since", type: "partial" },
  valid_until: { k: "valid_until", label: "Until (marks it as former)", type: "partial" },
  confidence: { k: "confidence", label: "Confidence", type: "select", options: [["", "Not stated"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["unknown", "Unknown"]] },
  note: { k: "note", label: "Note", type: "text", max: 2000 },
};
const DATALISTS = `<datalist id="contact-labels">${[...new Set(Object.values(LABELS).flat())].map((l) => `<option value="${l}">`).join("")}</datalist>
  <datalist id="address-labels"><option value="home"><option value="work"><option value="mailing"><option value="other"></datalist>
  <datalist id="services">${["github", "linkedin", "instagram", "facebook", "x", "mastodon", "signal", "telegram", "whatsapp", "matrix", "xmpp", "skype", "youtube", "tiktok"].map((s) => `<option value="${s}">`).join("")}</datalist>`;
function control(f, value, uid) {
  const id = `f-${uid}-${f.k}`;
  // Kept as it is (a reserved cross-module target): not editable here, never dropped on save.
  if (f.type === "hidden") return `<input type="hidden" data-k="${f.k}" value="${esc(value ?? "")}">`;
  const label = `<label class="ae-label" for="${id}">${esc(t(f.label))}</label>`;
  if (f.type === "check") return `<label class="check-line"><input type="checkbox" id="${id}" data-k="${f.k}" ${value ? "checked" : ""}> ${esc(t(f.label))}</label>`;
  if (f.type === "org") return `<div class="ae-field combo">${label}<input class="ae-input" id="${id}" data-k="${f.k}" data-combo-input="org" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-list" maxlength="${f.max}" value="${esc(value ?? "")}" placeholder="${esc(t("Start typing to find one already in Meridian"))}" autocomplete="off"><div class="combo-list" id="${id}-list" role="listbox" hidden></div></div>`;
  if (f.type === "date") return `<div class="ae-field" style="grid-column:1 / -1"><span class="ae-label">${esc(t(f.label))}</span>${dateInput(f.k, value)}</div>`;
  if (f.type === "select" || f.type === "kind") {
    const opts = f.type === "kind" ? f.options.map((o) => [o, f.names[o]]) : f.options;
    const known = opts.some(([v]) => v === (value ?? ""));
    const all = known || !value ? opts : [...opts, [value, value]];
    return `<div class="ae-field">${label}<select class="ae-select" id="${id}" data-k="${f.k}">${all.map(([v, l]) => `<option value="${esc(v)}" ${(value ?? "") === v ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>`;
  }
  const placeholder = f.type === "partial" ? t("YYYY, YYYY-MM or YYYY-MM-DD") : f.placeholder ? t(f.placeholder) : "";
  return `<div class="ae-field">${label}<input class="ae-input" id="${id}" data-k="${f.k}" ${f.type === "list" ? `list="${f.list}"` : ""} maxlength="${f.max || 10}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}"></div>`;
}
let rowSerial = 0;
function editorRow(spec, record) {
  const uid = ++rowSerial;
  const moreFields = spec.more.map((k) => MORE[k]).filter((f) => !spec.fields.some((x) => x.k === f.k));
  const hasMore = moreFields.some((f) => record[f.k]);
  const lead = spec.lead ? spec.fields.filter((f) => spec.lead.includes(f.k)) : [];
  const details = spec.lead ? spec.fields.filter((f) => !spec.lead.includes(f.k)) : spec.fields;
  const searchBox = spec.addressSearch ? `<div class="combo address-search" data-address-search hidden><label class="ae-label" for="f-${uid}-search">${esc(t("Search for an address"))}</label><input class="ae-input address-search-input" id="f-${uid}-search" data-nosave data-combo-input="address" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="f-${uid}-search-list" maxlength="120" placeholder="${esc(t("Street and number, city or place"))}" autocomplete="off"><div class="combo-list" id="f-${uid}-search-list" role="listbox" hidden></div></div><p class="addr-preview" data-address-preview ${addressText(record) ? "" : "hidden"}>${esc(addressText(record))}</p><p class="ae-hint" data-address-note aria-live="polite"></p>` : "";
  return `<div class="editor-row" data-row data-id="${esc(record.id || "")}">
    ${spec.lead ? `<div class="fields">${lead.map((f) => control(f, record[f.k], uid)).join("")}</div>${searchBox}<details class="addr-details"><summary>${esc(t("Edit address details"))}</summary><div class="fields">${details.map((f) => control(f, record[f.k], uid)).join("")}</div></details>` : `<div class="fields">${details.map((f) => control(f, record[f.k], uid)).join("")}</div>`}
    <div class="row-tools">${moreFields.length ? `<details ${hasMore ? "open" : ""}><summary>${esc(t("Period, confidence and note"))}</summary><div class="fields">${moreFields.map((f) => control(f, record[f.k], uid)).join("")}</div></details>` : "<span></span>"}
      <button class="ae-btn ae-btn--quiet ae-btn--sm" data-act="remove-row">${icon("x")}<span>${esc(t("Remove"))}</span></button></div>
  </div>`;
}
class RowError extends Error {
  constructor(message, row) {
    super(message);
    this.row = row;
  }
}
function readRow(row, spec, index) {
  const record = { id: row.dataset.id || null };
  for (const f of [...spec.fields, ...spec.more.map((k) => MORE[k])]) {
    if (f.k in record && f.k !== "id") continue;
    if (f.type === "date") {
      const result = readDate($(`[data-date="${f.k}"]`, row));
      if (result.error) throw new RowError(`${t(spec.title)} ${index + 1}: ${result.error}`, index);
      record[f.k] = result.value;
      continue;
    }
    const el = $(`[data-k="${f.k}"]`, row);
    if (!el) continue;
    record[f.k] = el.type === "checkbox" ? el.checked : el.value.trim();
    if (NULLABLE.has(f.k) && record[f.k] === "") record[f.k] = null;
  }
  return record;
}

/** Contact tabs retain their form nodes, including incomplete and invalid input. */
const panel = {
  section: null,
  session: null,
  saving: false,
  snapshot: "",
  invoker: null,
  closing: null,
  el: () => $("#panel"),
  isDirty() {
    if (this.session && this.el() && !this.closing) return [...this.session.panes.values()].some((pane) => formState(pane.node) !== pane.snapshot);
    // An event's participants live outside the form fields, so they count as well.
    return !!this.el() && !this.closing && (this.section === "interaction" ? ixState() : this.section === "event" ? formState() + JSON.stringify(evEditor.participants) : formState()) !== this.snapshot;
  },
};
const FORM_FIELDS = "input:not([data-nosave]), select, textarea";
const rowState = (row) => JSON.stringify($$(FORM_FIELDS, row).map((el) => (el.type === "checkbox" ? el.checked : el.value)));
function formState(body = $("#panel-body")) {
  if (!body) return "";
  return JSON.stringify($$(`[data-row], ${FORM_FIELDS}`, body).map((el) => (el.matches("[data-row]") ? `row:${el.dataset.id}` : el.type === "checkbox" ? el.checked : el.value)));
}
function panelBody(section) {
  const p = panel.session?.person || state.person;
  if (section === "notes")
    return `<div class="ae-field" style="padding-top:18px"><label class="ae-label" for="notes">${esc(t("Notes about {name}", { name: p.display_name }))}</label><textarea class="ae-textarea" id="notes" rows="14" maxlength="20000">${esc(p.notes)}</textarea></div>`;
  const spec = EDITORS[section];
  const records = editable(p)[section];
  // An empty section opens ready to type into; an untouched blank row is ignored on save.
  const rows = records.length ? records.map((r) => editorRow(spec, r)) : [editorRow(spec, spec.blank()).replace("data-row ", "data-row data-starter ")];
  return `${DATALISTS}${section === "addresses" ? '<div id="address-search-status"></div>' : ""}<div id="editor-rows">${rows.join("")}</div>
    <button class="ae-btn ae-btn--sm" data-act="add-row" style="margin-top:14px">${icon("plus")}<span>${esc(t(spec.add))}</span></button>
    ${section === "names" ? `<p class="ae-hint" style="margin-top:14px">${esc(t("The first full name is the name Meridian shows. A person needs at least one name."))}</p>` : ""}
    ${section === "contacts" ? `<p class="ae-hint" style="margin-top:14px">${esc(t("No longer used? Set “Until” under Period instead of removing it — Meridian keeps it as a former value."))}</p>` : ""}`;
}
async function openPanel(section, invoker) {
  if (panel.saving) return;
  if (panel.session && panel.el()) {
    showContactTab(section);
    return;
  }
  if (panel.isDirty() && !(await confirmDiscard())) return;
  const existing = panel.el();
  panel.section = section;
  panel.invoker = invoker && invoker.isConnected ? invoker : panel.invoker;
  const p = state.person;
  panel.session = { person: structuredClone(p), panes: new Map() };
  const chips = PANEL_ORDER[p.kind || "person"].map((s) => `<button class="ae-chip ${s === section ? "is-active" : ""}" data-act="panel-section" data-section="${s}" aria-pressed="${s === section}">${esc(panelTitle(s))}</button>`).join("");
  const html = `<div class="panel-head"><div><p class="eyebrow">${esc(p.display_name)}</p><h2 id="panel-title">${esc(panelTitle(section))}</h2></div><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="panel-close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <nav class="panel-sections" aria-label="${esc(t("Sections to edit"))}">${chips}</nav>
    <div class="panel-body" id="panel-body"></div>
    <div class="panel-foot"><p class="form-error" id="form-error" role="alert" hidden></p><div class="buttons"><span class="dirty" id="panel-dirty" aria-live="polite"></span><button class="ae-btn" data-act="panel-cancel">${esc(t("Cancel"))}</button><button class="ae-btn ae-btn--primary" data-act="panel-save">${esc(t("Save"))}</button></div></div>`;
  if (existing) {
    existing.innerHTML = html;
    animate($("#panel-body"), [{ opacity: 0 }, { opacity: 1 }], MOTION.fast);
  } else {
    document.body.insertAdjacentHTML("beforeend", `<div class="scrim" id="scrim" data-act="panel-close"></div><aside class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">${html}</aside>`);
    const narrow = innerWidth <= 640;
    animate($("#scrim"), [{ opacity: 0 }, { opacity: 1 }], MOTION.page);
    animate(panel.el(), [{ opacity: 0, transform: narrow ? "translateY(24px)" : "translateX(28px)" }, { opacity: 1, transform: "none" }], MOTION.panel);
    $("#app").setAttribute("aria-hidden", "true");
    $("#app").inert = true;
  }
  showContactTab(section);
  ($("#panel-body input:not([type=checkbox]), #panel-body select, #panel-body textarea") || $('[data-act="panel-save"]'))?.focus({ preventScroll: true });
}
function showContactTab(section) {
  const session = panel.session;
  if (!session || !PANEL_ORDER[session.person.kind || "person"].includes(section)) return;
  let pane = session.panes.get(section);
  if (!pane) {
    const node = document.createElement("div");
    node.innerHTML = panelBody(section);
    $$("[data-starter]", node).forEach((row) => (row.dataset.starter = rowState(row)));
    pane = { node, snapshot: formState(node), scroll: 0 };
    session.panes.set(section, pane);
  }
  const body = $("#panel-body");
  const previous = session.panes.get(panel.section);
  if (previous) previous.scroll = body.scrollTop;
  panel.section = section;
  body.replaceChildren(pane.node);
  body.scrollTop = pane.scroll;
  $("#panel-title").textContent = panelTitle(section);
  if (section === "addresses") refreshAddressSearch();
  $$("[data-act=panel-section]", panel.el()).forEach((tab) => {
    const active = tab.dataset.section === section;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  updateContactStatus();
}
function updateContactStatus() {
  if (!panel.session) return;
  const dirty = panel.isDirty();
  $("#panel-dirty").textContent = dirty ? t("Unsaved changes") : "";
  const button = $('[data-act="panel-save"]', panel.el());
  button.disabled = !dirty || panel.saving;
  button.classList.toggle("is-busy", panel.saving);
  // Leaving a field fires this during the press; replacing the label then makes Safari drop the click.
  if (button.textContent !== t("Save")) button.textContent = t("Save");
}
function confirmContactClose() {
  if (panel.saving) return Promise.resolve(false);
  return new Promise((resolve) => {
    let answered = false;
    const answer = async (value) => {
      if (answered) return;
      answered = true;
      await closeDialog();
      resolve(value);
    };
    openDialog(`<div class="ae-dialog-head"><h2>${esc(t("Save your changes?"))}</h2></div>
      <div class="ae-dialog-body"><p>${esc(t("You have edits in the side panel that are not saved yet."))}</p></div>
      <div class="ae-dialog-foot"><button class="ae-btn" data-act="close" data-focus>${esc(t("Continue editing"))}</button><button class="ae-btn" id="contact-discard">${esc(t("Discard changes"))}</button><button class="ae-btn ae-btn--primary" id="contact-save">${esc(t("Save"))}</button></div>`);
    dialog().addEventListener("close", () => { if (!answered) { answered = true; resolve(false); } }, { once: true });
    $("#contact-discard").onclick = () => answer(true);
    $("#contact-save").onclick = async () => {
      // Close the prompt first so validation errors stay in the editor.
      answered = true;
      await closeDialog();
      resolve(await savePanel($('[data-act="panel-save"]', panel.el())));
    };
  });
}
/** Close the panel (after the caller has handled unsaved edits). */
function closePanel() {
  const el = panel.el();
  if (panel.saving) return Promise.resolve();
  if (!el || panel.closing) return panel.closing || Promise.resolve();
  const scrim = $("#scrim");
  const narrow = innerWidth <= 640;
  const invoker = panel.invoker;
  $("#app").removeAttribute("aria-hidden");
  $("#app").inert = false;
  animate(scrim, [{ opacity: 1 }, { opacity: 0 }], MOTION.exit, MOTION.exitEase);
  panel.closing = animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: narrow ? "translateY(16px)" : "translateX(20px)" }], MOTION.exit, MOTION.exitEase).then(() => {
    el.remove();
    scrim?.remove();
    panel.closing = null;
    panel.section = null;
    panel.session = null;
    panel.snapshot = "";
    if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    else $("[data-heading]")?.focus({ preventScroll: true });
    navigationPanelClosed();
  });
  return panel.closing;
}
async function requestClosePanel() {
  if (panel.saving) return;
  if (panel.isDirty() && !(await confirmDiscard())) return;
  closePanel();
}
function markInvalid(index) {
  const rows = $$("[data-row]", $("#editor-rows") || document);
  rows.forEach((r, i) => r.classList.toggle("is-invalid", i === index));
  rows[index]?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}
const ERROR_ROW = /^(Name|Contact|Address|Date|Work|Account|Detail|Education|Interest|Personal dates|Online accounts|Addresses|Names|Other details|Interests and preferences) (\d+):/;
async function savePanel(button) {
  if (panel.section === "relationship") return saveRelation(button);
  if (panel.section === "membership") return saveMembership(button);
  if (panel.section === "event") return saveEvent(button);
  if (panel.section === "interaction") return saveInteraction(button);
  if (panel.saving || !panel.isDirty()) return false;
  const session = panel.session;
  const box = $("#form-error", panel.el());
  box.hidden = true;
  markInvalid(-1);
  let section = panel.section;
  const activeField = document.activeElement;
  const focusIndex = $$("input, select, textarea", $("#panel-body")).indexOf(activeField);
  const selection = activeField?.tagName === "TEXTAREA" || activeField?.type === "text"
    ? [activeField.selectionStart, activeField.selectionEnd] : null;
  let focusTarget = activeField;
  panel.saving = true;
  updateContactStatus();
  // Freeze all editing until the response has established the new baseline.
  panel.el().inert = true;
  try {
    const doc = editable(session.person);
    for (const [key, pane] of session.panes) {
      section = key;
      if (formState(pane.node) === pane.snapshot) continue;
      if (key === "notes") doc.notes = $("#notes", pane.node).value;
      else doc[key] = $$("[data-row]", pane.node)
        .map((row, i) => [row, i])
        .filter(([row]) => !row.hasAttribute("data-starter") || rowState(row) !== row.dataset.starter)
        .map(([row, i]) => ({ ...doc[key].find((record) => record.id === row.dataset.id), ...readRow(row, EDITORS[key], i) }));
    }
    doc.expected_revision = session.person.edit_revision;
    const saved = await api(entityApi(session.person), "PUT", doc);
    state.person = saved;
    const current = panel.section;
    const scroll = $("#panel-body").scrollTop;
    const expanded = $$("details", $("#panel-body")).map((details) => details.open);
    session.person = structuredClone(saved);
    session.panes.clear(); // Rebuild from returned IDs and normalized values; retries cannot duplicate rows.
    showContactTab(current);
    $$("details", $("#panel-body")).forEach((details, i) => { details.open = expanded[i] ?? details.open; });
    $("#panel-body").scrollTop = scroll;
    refreshPerson();
    panel.invoker = $(`.psection[data-section="${current}"] [data-act="edit"]`) || $("[data-heading]");
    panel.el().inert = false;
    focusTarget = $$("input, select, textarea", $("#panel-body"))[focusIndex] || button;
    $("#panel-dirty").textContent = t("Saved");
    refreshCounts().catch(() => {});
    return true;
  } catch (error) {
    const serverSection = { Name: "names", Contact: "contacts", Address: "addresses", Date: "dates", Work: "employments", Account: "accounts", Detail: "facts", Education: "education", Interest: "interests" };
    const match = error.message.match(ERROR_ROW);
    if (error instanceof RowError) showContactTab(section);
    else if (match && serverSection[match[1]]) showContactTab(serverSection[match[1]]);
    box.textContent = error.message;
    box.hidden = false;
    if (/changed in another session/.test(error.message)) offerDraftOverride(box);
    const index = error instanceof RowError ? error.row : match ? +match[2] - 1 : -1;
    if (index >= 0) markInvalid(index);
    return false;
  } finally {
    panel.saving = false;
    panel.el().inert = false;
    const saved = !panel.isDirty();
    updateContactStatus();
    if (saved) $("#panel-dirty").textContent = t("Saved");
    if (saved && navigationHeld()) closePanel();
    if (focusTarget?.isConnected && !focusTarget.disabled) {
      focusTarget.focus({ preventScroll: true });
      if (selection) focusTarget.setSelectionRange?.(...selection);
    }
  }
}

document.addEventListener("change", (event) => {
  // A suggested label that does not fit the new channel follows it ("mobile" is not an email label).
  const select = event.target.closest('#panel [data-k="channel"]');
  const label = select && $('[data-k="label"]', select.closest("[data-row]"));
  if (!label) { updateContactStatus(); return; }
  const known = Object.values(LABELS).flat();
  if (known.includes(label.value) && !LABELS[select.value]?.includes(label.value)) label.value = LABELS[select.value][0];
  updateContactStatus();
});
document.addEventListener("input", (event) => {
  if (!event.target.closest("#panel")) return;
  if (panel.session) return updateContactStatus();
  const dirty = $("#panel-dirty");
  if (dirty) dirty.textContent = panel.isDirty() ? t("Unsaved changes") : "";
});
document.addEventListener("keydown", (event) => {
  const el = panel.el();
  if (!el || dialog().open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    requestClosePanel();
  } else if (event.key === "Tab") {
    // Keep focus inside the panel while it is open.
    const focusable = $$('button:not([disabled]), input, select, textarea, summary, [tabindex="0"]', el).filter((x) => x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    savePanel($('[data-act="panel-save"]', el));
  }
});

/* New person */

function newPerson({ makeSelf = false } = {}) {
  openDialog(`<div class="ae-dialog-head"><h2>${esc(makeSelf ? t("Create your profile") : t("New person"))}</h2><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <div class="ae-dialog-body form" id="new-person" data-self="${makeSelf ? 1 : ""}">
      <div class="form-grid">
        <div class="ae-field"><label class="ae-label" for="np-given">${esc(t("Given name"))}</label><input class="ae-input" id="np-given" maxlength="120" data-focus autocomplete="off"></div>
        <div class="ae-field"><label class="ae-label" for="np-family">${esc(t("Family name"))}</label><input class="ae-input" id="np-family" maxlength="120" autocomplete="off"></div>
        <div class="ae-field span"><label class="ae-label" for="np-full">${esc(t("Or the name as you know them"))}</label><input class="ae-input" id="np-full" maxlength="300" placeholder="${esc(t("e.g. “Peter from the climbing gym”"))}" autocomplete="off"></div>
        <div class="ae-field"><label class="ae-label" for="np-phone">${esc(t("Phone"))}</label><input class="ae-input" id="np-phone" maxlength="40" inputmode="tel" autocomplete="off"></div>
        <div class="ae-field"><label class="ae-label" for="np-email">${esc(t("Email"))}</label><input class="ae-input" id="np-email" maxlength="320" inputmode="email" autocomplete="off"></div>
        <div class="ae-field span"><span class="ae-label">${esc(t("Birthday — leave unknown parts empty"))}</span>${dateInput("birth", null)}</div>
        <div class="ae-field"><label class="ae-label" for="np-org">${esc(t("Organization"))}</label><div class="combo"><input class="ae-input" id="np-org" data-combo-input="org" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="np-org-list" maxlength="200" autocomplete="off"><div class="combo-list" id="np-org-list" role="listbox" hidden></div></div></div>
        <div class="ae-field"><label class="ae-label" for="np-title">${esc(t("Title"))}</label><input class="ae-input" id="np-title" maxlength="200" autocomplete="off"></div>
      </div>
      <p class="ae-hint">${esc(t("Only a name is required. You can add everything else later."))}</p>
      <p class="form-error" id="form-error" role="alert" hidden></p>
    </div>
    <div class="ae-dialog-foot"><button class="ae-btn" data-act="close">${esc(t("Cancel"))}</button><button class="ae-btn ae-btn--primary" data-act="create-person">${esc(t("Add person"))}</button></div>`, { wide: true });
}
async function createPerson(button) {
  const v = (id) => $(id).value.trim();
  try {
    const given = v("#np-given"), family = v("#np-family"), full = v("#np-full");
    if (!given && !family && !full) throw Error(t("Enter a name — given and family name, or the name as you know them."));
    const birth = readDate($('[data-date="birth"]'));
    if (birth.error) throw Error(t("Birthday: {e}", { e: birth.error }));
    const doc = {
      names: [{ kind: "full", value: full, given, family }],
      contacts: [
        ...(v("#np-phone") ? [{ channel: "phone", value: v("#np-phone"), label: "mobile", is_primary: true }] : []),
        ...(v("#np-email") ? [{ channel: "email", value: v("#np-email"), label: "", is_primary: true }] : []),
      ],
      dates: birth.value ? [{ kind: "birth", date: birth.value }] : [],
      employments: v("#np-org") || v("#np-title") ? [{ organization: v("#np-org"), title: v("#np-title") }] : [],
    };
    button.classList.add("is-busy");
    const created = await api("/people", "POST", doc);
    if ($("#new-person").dataset.self) await api("/self", "PUT", { person_id: created.id });
    await closeDialog();
    await refreshCounts();
    toast(t("{name} was added", { name: created.display_name }), "good");
    go("person", created.id);
  } catch (error) {
    showError(error);
  } finally {
    button.classList.remove("is-busy");
  }
}

/* Person menu */

function personMenu(anchor) {
  const p = state.person;
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "ae-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `${p.kind !== "person"
    ? `<button class="ae-menu-item" role="menuitem" data-act="add-relation">${icon("link")}<span>${esc(t("Add relationship"))}</span></button>`
    : p.is_self
      ? `<button class="ae-menu-item" role="menuitem" data-act="self-clear">${icon("star")}<span>${esc(t("This is not me"))}</span></button>`
      : `<button class="ae-menu-item" role="menuitem" data-act="self-set">${icon("star")}<span>${esc(t("This is me (@me)"))}</span></button>`}
    ${p.kind === "person" ? `<button class="ae-menu-item" role="menuitem" data-act="add-member">${icon("groups")}<span>${esc(t("Add to a group"))}</span></button>` : ""}
    <button class="ae-menu-item" role="menuitem" data-act="edit" data-section="names">${icon("names")}<span>${esc(t("Edit names"))}</span></button>
    <div class="ae-menu-sep" role="separator"></div>
    <button class="ae-menu-item ae-menu-item--danger" role="menuitem" data-act="${p.kind === "person" ? "trash-person" : "trash-entity"}">${icon("trash")}<span>${esc(t("Move to Trash"))}</span></button>`;
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  anchor.setAttribute("aria-expanded", "true");
  animate(menu, [{ opacity: 0, transform: "translateY(-4px) scale(.98)" }, { opacity: 1, transform: "none" }], MOTION.fast);
  $("button", menu).focus();
  menu.addEventListener("keydown", (event) => {
    const items = $$(".ae-menu-item", menu);
    const i = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      anchor.focus();
    }
  });
}
function closeMenu() {
  $$(".ae-menu").forEach((m) => m.remove());
  $$("[aria-expanded=true][aria-haspopup]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

/* Choosing @me */

function chooseSelf() {
  openDialog(`<div class="ae-dialog-head"><h2>${esc(t("Which person is you?"))}</h2><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <div class="ae-dialog-body form"><input class="ae-input" id="self-q" type="search" placeholder="${esc(t("Search people"))}" data-focus maxlength="200" autocomplete="off"><div class="list" id="self-results"></div><p class="form-error" id="form-error" hidden></p></div>`);
  const input = $("#self-q");
  const run = async () => {
    const data = await api("/people" + query({ q: input.value.trim(), limit: 20 }));
    $("#self-results").innerHTML = data.items.length ? data.items.map((p) => personRow(p).replace('data-act="open-person"', 'data-act="pick-self"')).join("") : `<p class="list-empty">${esc(t("No one matches."))}</p>`;
  };
  input.addEventListener("input", debounce(run, 180));
  run();
}
async function setSelf(id) {
  const data = await api("/self", "PUT", { person_id: id });
  state.self = data.self;
}

/* ───────────────────────── Import ───────────────────────── */

/*
 * A guided, four-step flow over the existing preview and commit endpoints:
 *   file → review (decide per contact) → confirm (summary) → done (what the server did).
 * Nothing is saved before the confirm step's button. The review lives in memory, so leaving
 * the screen and coming back resumes it; discarding it always asks.
 */
const MAX_FILE = 1_800_000;
const IMPORT_STEPS = [["file", "Choose file"], ["review", "Review"], ["confirm", "Confirm"], ["done", "Done"]];
const STEP_ORDER = IMPORT_STEPS.map(([k]) => k);
const importStep = () => (state.importing?.result ? "done" : state.importing?.step || "file");
function stepper(current) {
  const at = STEP_ORDER.indexOf(current);
  return `<ol class="steps" aria-label="${esc(t("Import steps"))}">${IMPORT_STEPS.map(
    ([k, l], n) => `<li class="${n < at ? "is-done" : n === at ? "is-current" : ""}" ${n === at ? 'aria-current="step"' : ""}><span class="step-dot" aria-hidden="true">${n < at ? icon("check") : n + 1}</span><span class="step-name">${esc(t(l))}</span>${n < at ? `<span class="sr-only">${esc(t("(done)"))}</span>` : ""}</li>`,
  ).join("")}</ol>`;
}
async function viewImport(sheet, token) {
  setTitle([{ label: t("Import contacts") }]);
  if (stale(token)) return;
  IMPORT_RENDER[importStep()](sheet);
}
/** Move between steps in place: forward slides in from the right, back from the left. */
function showImportStep(step) {
  const from = STEP_ORDER.indexOf(importStep());
  if (state.importing && step !== "done") state.importing.step = step;
  const sheet = $("#sheet");
  IMPORT_RENDER[step](sheet);
  for (const el of [sheet, document.scrollingElement, document.body]) if (el) el.scrollTop = 0;
  const dir = Math.sign(STEP_ORDER.indexOf(step) - from) || 1;
  animate($(".page", sheet), [{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: "none" }]);
  $("[data-heading]", sheet)?.focus({ preventScroll: true });
}
function importError(message) {
  const box = $("#import-error");
  if (!box) return toast(message, "danger");
  box.textContent = message;
  box.hidden = false;
  animate(box, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
}

/* Step 1: choose a file */
function renderImportFile(sheet) {
  const how = [
    ["search", t("You review first."), t("Meridian reads the file here and shows every contact. Nothing is saved until you confirm.")],
    ["people", t("Possible duplicates are flagged."), t("Matches come from email addresses, phone numbers and earlier imports. A matching name alone is only a hint.")],
    ["merge", t("Merging only adds."), t("Nothing already in a profile is changed or removed.")],
    ["info", t("Nothing is lost."), t("Fields Meridian cannot place are kept on the person under “Imported data”. Photos are not imported.")],
  ];
  sheet.innerHTML = `<div class="page banded imp">
    ${screenBand({ title: t("Import contacts"), meta: [`<span>${esc(t("From a .vcf (vCard) file"))}</span>`, `<span>${esc(t("Nothing changes until you confirm"))}</span>`], below: stepper("file") })}
    <div class="wrap body"><div class="imp-file">
      <div class="imp-pick">
        <label class="dropzone" id="drop">
          <input type="file" id="vcf-file" class="sr-only" accept=".vcf,.vcard,text/vcard,text/x-vcard" aria-describedby="drop-meta import-error">
          <span class="drop-icon">${icon("upload")}</span>
          <span class="drop-title" id="drop-title">${esc(t("Drop a .vcf file here"))}</span>
          <span class="drop-or">${esc(t("or"))} <span class="drop-btn">${esc(t("Choose a file"))}</span></span>
          <span class="drop-meta" id="drop-meta">${esc(t("vCard 2.1, 3.0 or 4.0 · up to 1.8 MB · up to 5,000 contacts"))}</span>
        </label>
        <p class="form-error" id="import-error" role="alert" hidden></p>
      </div>
      <aside class="imp-how" aria-labelledby="how-title"><h3 id="how-title">${esc(t("How import works"))}</h3>
        <ul>${how.map(([ic, b, text]) => `<li><span class="how-icon">${icon(ic)}</span><span><b>${esc(b)}</b> ${esc(text)}</span></li>`).join("")}</ul>
        <p class="hint">${esc(t("The file is read by your own installation only."))}</p></aside>
    </div></div></div>`;
  const drop = $("#drop");
  const input = $("#vcf-file");
  input.addEventListener("change", () => input.files[0] && readFile(input.files[0]));
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]);
  });
}
let reading = false;
function setReading(on, name = "") {
  reading = on;
  const drop = $("#drop");
  if (!drop) return;
  drop.classList.toggle("is-reading", on);
  drop.setAttribute("aria-busy", String(on));
  $("#vcf-file").disabled = on;
  $("#drop-title").textContent = on ? t("Reading {file}…", { file: name }) : t("Drop a .vcf file here");
}
function readFile(file) {
  if (reading) return;
  $("#import-error") && ($("#import-error").hidden = true);
  if (file.size > MAX_FILE) return importError(t("“{file}” is larger than 1.8 MB. Export fewer contacts at a time, or without photos.", { file: file.name }));
  if (!file.size) return importError(t("“{file}” is empty.", { file: file.name }));
  setReading(true, file.name);
  const reader = new FileReader();
  reader.onload = async () => {
    const content = String(reader.result);
    if (!/BEGIN:VCARD/i.test(content)) {
      setReading(false);
      return importError(t("“{file}” does not contain any vCard contacts. Export your contacts as a .vcf (vCard) file and try again.", { file: file.name }));
    }
    try {
      const preview = await api("/import/preview", "POST", { filename: file.name.slice(0, 200), content });
      if (state.route.view !== "import") return;
      const decisions = preview.contacts.map((c) => ({ index: c.index, action: c.default_action, target: null }));
      state.importing = { content, preview, decisions, step: "review", filter: "all", people: {}, initial: JSON.stringify(decisions) };
      reading = false;
      showImportStep("review");
    } catch (error) {
      setReading(false);
      importError(error.message);
    }
  };
  reader.onerror = () => {
    setReading(false);
    importError(t("“{file}” could not be read.", { file: file.name }));
  };
  reader.readAsText(file);
}

/* Step 2: review and decide */
const needsLook = (c) => c.candidates.length > 0 || c.in_file.length > 0 || !c.importable || c.kind !== "person";
function contactFacts(s) {
  return [
    ...s.phones.map((x) => ["phone", x]),
    ...s.emails.map((x) => ["mail", x]),
    ...s.work.map((x) => ["briefcase", x]),
    ...s.dates.map((d) => ["calendar", `${d.label || t(KIND_LABEL[d.kind] || d.kind)}: ${d.date ? formatPartial(d.date) : d.description}`]),
    ...s.addresses.map((x) => ["pin", x]),
    ...s.websites.map((x) => ["globe", x]),
    ...s.accounts.map((x) => ["at", x]),
    ...(s.nicknames.length ? [["names", t("Also {names}", { names: s.nicknames.join(", ") })]] : []),
    ...(s.notes ? [["note", s.notes.length > 140 ? s.notes.slice(0, 140) + "…" : s.notes]] : []),
  ];
}
/** The badge says why a contact needs a look, in words and with an icon, never by colour alone. */
function reviewBadge(c) {
  if (!c.importable) return `<span class="badge-flag is-stop">${icon("x")}${esc(t("Cannot be imported"))}</span>`;
  if (c.candidates.some((m) => m.strength === "strong")) return `<span class="badge-flag is-warn">${icon("alert")}${esc(t("Possible duplicate"))}</span>`;
  if (c.candidates.length) return `<span class="badge-flag is-info">${icon("people")}${esc(t("Similar name in Meridian"))}</span>`;
  if (c.in_file.length) return `<span class="badge-flag is-info">${icon("copy")}${esc(t("Repeated in this file"))}</span>`;
  if (c.kind !== "person") return `<span class="badge-flag is-info">${icon("organizations")}${esc(t(c.kind === "organization" ? "Organization card" : "Group card"))}</span>`;
  return "";
}
function decisionControl(c, d) {
  const opt = (value, label, iconName, disabled = false) =>
    `<label class="decide-opt" data-kind="${value}"><input type="radio" name="d-${c.index}" value="${value}" data-act="decide" data-index="${c.index}" ${d.action === value ? "checked" : ""} ${disabled ? "disabled" : ""}><span class="decide-face">${icon(iconName)}<span>${esc(label)}</span></span></label>`;
  return `<fieldset class="decide"><legend class="sr-only">${esc(t("What to do with {name}", { name: c.display_name }))}</legend>
    ${opt("create", t("Import as new"), "userplus", !c.importable)}${c.candidates.length ? opt("merge", t("Merge"), "merge") : ""}${opt("skip", t("Skip"), "x")}</fieldset>`;
}
function matchPanel(c, d) {
  if (!c.candidates.length) return "";
  const strong = c.candidates.some((m) => m.strength === "strong");
  const many = c.candidates.length > 1;
  return `<div class="match-panel ${strong ? "is-strong" : ""}">
    <p class="match-title">${icon(strong ? "alert" : "people")}<span>${esc(strong ? t("This may be someone already in Meridian") : t("Someone in Meridian has a similar name"))}</span></p>
    ${c.candidates
      .map((m) => {
        const target = d.target || c.candidates[0].id;
        return `<div class="match-row">
        ${many ? `<label class="target-pick" ${d.action === "merge" ? "" : "hidden"}><input type="radio" name="t-${c.index}" value="${esc(m.id)}" data-act="target" data-index="${c.index}" ${target === m.id ? "checked" : ""}><span class="sr-only">${esc(t("Merge into {name}", { name: m.display_name }))}</span></label>` : ""}
        ${avatar(m.display_name, m.id, "sm")}
        <span class="grow"><span class="primary">${esc(m.display_name)}</span><span class="secondary">${esc(m.reasons.join(" · "))}</span></span>
        <button class="ae-btn ae-btn--sm" data-act="compare" data-index="${c.index}" data-id="${esc(m.id)}" aria-expanded="false" aria-controls="cmp-${c.index}-${esc(m.id)}">${esc(t("Compare"))}</button>
      </div><div class="compare" id="cmp-${c.index}-${esc(m.id)}" hidden></div>`;
      })
      .join("")}
  </div>`;
}
function reviewItem(c) {
  const d = state.importing.decisions[c.index];
  const facts = contactFacts(c.summary);
  const shown = facts.slice(0, 6);
  const extra = c.unmapped.length + c.media.length;
  const twins = c.in_file.map((i) => state.importing.preview.contacts[i]?.display_name || `#${i + 1}`);
  return `<article class="imp-item" data-index="${c.index}" data-action="${d.action}" data-look="${needsLook(c)}" aria-labelledby="imp-name-${c.index}">
    <div class="imp-main">
      ${avatar(c.display_name, c.display_name, "md")}
      <div class="grow">
        <h3 class="imp-name" id="imp-name-${c.index}">${esc(c.display_name)} ${reviewBadge(c)}</h3>
        ${shown.length ? `<ul class="imp-facts">${shown.map(([ic, text]) => `<li>${icon(ic)}<span>${esc(text)}</span></li>`).join("")}${facts.length > shown.length ? `<li class="muted">${esc(t("+{n} more", { n: facts.length - shown.length }))}</li>` : ""}</ul>` : `<p class="muted imp-none">${esc(t("No details besides the name"))}</p>`}
      </div>
      ${decisionControl(c, d)}
    </div>
    ${matchPanel(c, d)}
    ${twins.length ? `<p class="notice info">${icon("copy")}<span>${esc(t("Shares an email address or phone number with {names} in this file. Importing both creates two people.", { names: twins.join(", ") }))}</span></p>` : ""}
    ${c.reason && !c.candidates.length && !twins.length ? `<p class="notice info">${icon("info")}<span>${esc(c.reason)}</span></p>` : ""}
    ${c.warnings.map((w) => `<p class="notice warn">${icon("alert")}<span>${esc(w)}</span></p>`).join("")}
    ${extra ? `<details class="imp-raw"><summary>${esc(plural(extra, "{count} field kept for review", "{count} fields kept for review"))}</summary><ul>${c.unmapped.map((u) => `<li><code>${esc(u.name)}</code><span>${esc(u.value.slice(0, 200))}</span></li>`).join("")}${c.media.map((m) => `<li><code>${esc(m.name)}</code><span>${esc(t("Embedded image — not imported"))}</span></li>`).join("")}</ul></details>` : ""}
  </article>`;
}
function tallies() {
  const tally = { create: 0, merge: 0, skip: 0 };
  state.importing.decisions.forEach((d) => tally[d.action]++);
  return tally;
}
const tallyText = (n) => [plural(n.create, "{count} new", "{count} new"), plural(n.merge, "{count} merge", "{count} merges"), plural(n.skip, "{count} skipped", "{count} skipped")].join(" · ");
function reviewFilters() {
  const imp = state.importing;
  const n = tallies();
  const look = imp.preview.contacts.filter(needsLook).length;
  return [
    ["all", t("All {n}", { n: imp.preview.total })],
    ...(look ? [["look", t("Needs a look {n}", { n: look })]] : []),
    ["create", t("New {n}", { n: n.create })],
    ...(n.merge || imp.preview.contacts.some((c) => c.candidates.length) ? [["merge", t("Merge {n}", { n: n.merge })]] : []),
    ["skip", t("Skipped {n}", { n: n.skip })],
  ];
}
function renderImportReview(sheet) {
  const imp = state.importing;
  const { preview } = imp;
  const look = preview.contacts.filter(needsLook).length;
  const kept = preview.contacts.filter((c) => c.unmapped.length || c.media.length).length;
  const meta = [
    `<span>${esc(plural(preview.total, "{count} contact", "{count} contacts"))}</span>`,
    look ? `<span class="meta-warn">${icon("alert")}${esc(plural(look, "{count} needs a look", "{count} need a look"))}</span>` : `<span>${esc(t("No possible duplicates"))}</span>`,
    kept ? `<span>${esc(plural(kept, "{count} with fields kept for review", "{count} with fields kept for review"))}</span>` : "",
  ].filter(Boolean);
  const tools = `${stepper("review")}<div class="imp-tools">
      <div id="imp-filter">${segmented("imp-filter", t("Show"), reviewFilters(), imp.filter)}</div>
      <div class="imp-bulk"><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="import-reset-defaults">${esc(t("Use suggestions"))}</button><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="import-skip-all">${esc(t("Skip all"))}</button></div></div>`;
  const n = tallies();
  sheet.innerHTML = `<div class="page banded imp">
    ${screenBand({ eyebrow: esc(preview.filename), title: t("Review contacts"), meta, below: tools })}
    <div class="wrap body">
      <div class="list imp-list" id="imp-list">${preview.contacts.map(reviewItem).join("")}</div>
      <p class="list list-empty" id="imp-none" hidden>${esc(t("No contacts in this view."))}</p>
      <div class="imp-bar" role="region" aria-label="${esc(t("Import decision summary"))}">
        <p class="imp-tally" id="tally" aria-live="polite">${esc(tallyText(n))}</p>
        <div class="imp-bar-actions"><button class="ae-btn ae-btn--quiet" data-act="import-restart">${icon("restore")}<span>${esc(t("Choose another file"))}</span></button>
          <button class="ae-btn ae-btn--primary" data-act="import-continue" ${n.create + n.merge ? "" : "disabled"} aria-describedby="tally">${esc(t("Continue"))}</button></div>
      </div>
    </div></div>`;
  applyReviewFilter();
}
function applyReviewFilter() {
  const f = state.importing.filter;
  let shown = 0;
  $$(".imp-item").forEach((item) => {
    const visible = f === "all" || (f === "look" ? item.dataset.look === "true" : item.dataset.action === f);
    item.hidden = !visible;
    if (visible) shown++;
  });
  const none = $("#imp-none");
  if (none) none.hidden = shown > 0;
}
/** A decision changed: update that contact, the counts and the Continue button, nothing else. */
function decide(index, action) {
  const imp = state.importing;
  const c = imp.preview.contacts[index];
  const d = imp.decisions[index];
  d.action = action;
  d.target = action === "merge" ? d.target || c.candidates[0]?.id || null : null;
  const item = $(`.imp-item[data-index="${index}"]`);
  if (item) {
    item.dataset.action = action;
    $$(".target-pick", item).forEach((el) => (el.hidden = action !== "merge"));
    $$('[data-act="target"]', item).forEach((el) => (el.checked = el.value === d.target));
  }
  updateTally();
}
function updateTally() {
  const n = tallies();
  const tally = $("#tally");
  if (tally) tally.textContent = tallyText(n);
  const go = $('[data-act="import-continue"]');
  if (go) go.disabled = !(n.create + n.merge);
  const group = $("#imp-filter");
  if (group) group.innerHTML = segmented("imp-filter", t("Show"), reviewFilters(), state.importing.filter);
}
/** Compare a file contact with the person it may duplicate: what a merge adds, what is already there. */
const phoneKey = (v) => {
  let digits = String(v || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 9 ? digits.slice(-9) : digits;
};
const looseKey = (v) => foldText(v).replace(/[\s,]+/g, " ");
async function toggleCompare(button) {
  const imp = state.importing;
  const box = $(`#${CSS.escape(button.getAttribute("aria-controls"))}`);
  const open = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!open));
  button.textContent = open ? t("Compare") : t("Hide comparison");
  if (open) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (!box.dataset.ready) {
    box.innerHTML = `<p class="muted">${esc(t("Loading…"))}</p>`;
    try {
      imp.people[button.dataset.id] ||= await api(`/people/${button.dataset.id}`);
      box.innerHTML = compareTable(imp.preview.contacts[+button.dataset.index], imp.people[button.dataset.id]);
      box.dataset.ready = "1";
    } catch (error) {
      box.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    }
  }
  animate(box, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
}
function compareTable(c, person) {
  const s = c.summary;
  const work = (e) => [e.title, e.organization].filter(Boolean).join(" · ");
  const rows = [
    [t("Name"), person.names.map((n) => n.value || [n.given, n.family].filter(Boolean).join(" ")), [c.display_name], foldText],
    [t("Phone"), person.contacts.filter((x) => x.channel === "phone").map((x) => x.value), s.phones, phoneKey],
    [t("Email"), person.contacts.filter((x) => x.channel === "email").map((x) => x.value), s.emails, (v) => String(v).trim().toLowerCase()],
    [t("Website"), person.contacts.filter((x) => x.channel === "website").map((x) => x.value), s.websites, looseKey],
    [t("Work"), person.employments.map(work), s.work, looseKey],
    [t("Dates"), person.dates.map((d) => `${dateKind(d)}: ${formatDateRecord(d)}`), s.dates.map((d) => `${d.label || t(KIND_LABEL[d.kind] || d.kind)}: ${d.date ? formatPartial(d.date) : d.description}`), looseKey],
    [t("Address"), person.addresses.map((a) => addressText(a).replace(/\n/g, ", ")), s.addresses, looseKey],
    [t("Accounts"), person.accounts.map((a) => `${a.service}: ${a.handle || a.url}`), s.accounts, looseKey],
  ].filter(([, have, file]) => have.length || file.length);
  const body = rows
    .map(([label, have, file, key]) => {
      const known = new Set(have.map(key));
      return `<tr><th scope="row">${esc(label)}</th>
        <td data-col="${esc(t("In Meridian"))}">${have.length ? have.map((v) => `<span class="cmp-val">${esc(v)}</span>`).join("") : `<span class="muted">${esc(t("Nothing"))}</span>`}</td>
        <td data-col="${esc(t("In this file"))}">${file.length ? file.map((v) => (known.has(key(v)) ? `<span class="cmp-val"><span class="cmp-tag is-same">${icon("check")}${esc(t("Already there"))}</span>${esc(v)}</span>` : `<span class="cmp-val is-new"><span class="cmp-tag is-new">${icon("plus")}${esc(t("Adds"))}</span>${esc(v)}</span>`)).join("") : `<span class="muted">${esc(t("Nothing"))}</span>`}</td></tr>`;
    })
    .join("");
  return `<table class="cmp-table"><caption class="sr-only">${esc(t("{a} compared with {b}", { a: c.display_name, b: person.display_name }))}</caption>
    <thead><tr><th scope="col"><span class="sr-only">${esc(t("Field"))}</span></th><th scope="col">${esc(t("In Meridian · {name}", { name: person.display_name }))}</th><th scope="col">${esc(t("In this file"))}</th></tr></thead><tbody>${body}</tbody></table>
    <p class="hint">${esc(t("A merge adds what is marked “Adds”. Nothing already in {name}’s profile is changed or removed; a different name is kept as another name.", { name: person.display_name }))}</p>`;
}

/* Step 3: confirm */
function renderImportConfirm(sheet) {
  const imp = state.importing;
  const contacts = imp.preview.contacts;
  const by = (action) => imp.decisions.filter((d) => d.action === action).map((d) => ({ c: contacts[d.index], d }));
  const create = by("create");
  const merge = by("merge");
  const skip = by("skip");
  const targetName = (c, d) => c.candidates.find((m) => m.id === d.target)?.display_name || "";
  const col = (kind, iconName, title, items, line) =>
    `<section class="confirm-col" data-kind="${kind}" aria-labelledby="cf-${kind}"><h3 id="cf-${kind}">${icon(iconName)}<span>${esc(title)}</span><span class="count">${items.length}</span></h3>
      ${items.length ? `<ul class="list confirm-list">${items.map(line).join("")}</ul>` : `<p class="list list-empty">${esc(t("None"))}</p>`}</section>`;
  const unsupported = Object.entries(imp.preview.unsupported);
  const total = create.length + merge.length;
  sheet.innerHTML = `<div class="page banded imp">
    ${screenBand({ eyebrow: esc(imp.preview.filename), title: t("Confirm import"), meta: [`<span>${esc(t("{n} of {total} contacts will be imported", { n: total, total: imp.preview.total }))}</span>`], below: stepper("confirm") })}
    <div class="wrap body">
      <div class="confirm-grid">
        ${col("create", "userplus", t("New people"), create, ({ c }) => `<li>${avatar(c.display_name, c.display_name, "sm")}<span>${esc(c.display_name)}</span></li>`)}
        ${col("merge", "merge", t("Merged into existing people"), merge, ({ c, d }) => `<li>${avatar(targetName(c, d), d.target, "sm")}<span><b>${esc(targetName(c, d))}</b> <span class="muted">${esc(t("gets new details from “{name}”", { name: c.display_name }))}</span></span></li>`)}
        ${col("skip", "x", t("Skipped"), skip, ({ c }) => `<li class="is-skip">${avatar(c.display_name, c.display_name, "sm")}<span>${esc(c.display_name)}</span></li>`)}
      </div>
      <ul class="confirm-notes">
        <li>${icon("check")}<span>${esc(t("Everything is saved together: if anything goes wrong, nothing is changed."))}</span></li>
        <li>${icon("merge")}<span>${esc(t("Merges only add details; nothing already in those profiles is changed or removed."))}</span></li>
        ${unsupported.length ? `<li>${icon("info")}<span>${esc(t("Fields Meridian cannot place are kept on each person under “Imported data”: {fields}.", { fields: unsupported.map(([k, n]) => `${k} (${n})`).join(", ") }))}</span></li>` : ""}
      </ul>
      <p class="form-error" id="import-error" role="alert" hidden></p>
      <div class="imp-bar">
        <p class="imp-tally">${esc(tallyText(tallies()))}</p>
        <div class="imp-bar-actions"><button class="ae-btn" data-act="import-back">${esc(t("Back to review"))}</button>
          <button class="ae-btn ae-btn--primary" data-act="import-commit">${icon("check")}<span>${esc(plural(total, "Import {count} contact", "Import {count} contacts"))}</span></button></div>
      </div>
    </div></div>`;
}
async function commitImport(button) {
  const imp = state.importing;
  if (!imp || imp.committing) return;
  imp.committing = true;
  button.classList.add("is-busy");
  button.disabled = true;
  const back = $('[data-act="import-back"]');
  if (back) back.disabled = true;
  $("#import-error") && ($("#import-error").hidden = true);
  try {
    imp.result = await api("/import/commit", "POST", {
      filename: imp.preview.filename,
      content: imp.content,
      sha256: imp.preview.sha256,
      decisions: imp.decisions.map((d) => (d.action === "merge" ? d : { index: d.index, action: d.action })),
    });
    imp.content = null;
    await refreshCounts();
    if (state.route.view === "import") showImportStep("done");
  } catch (error) {
    importError(error.message);
    button.disabled = false;
    if (back) back.disabled = false;
  } finally {
    imp.committing = false;
    button.classList.remove("is-busy");
  }
}

/* Step 4: what the server did */
function renderImportResult(sheet) {
  const r = state.importing.result;
  const rows = (action) => r.results.filter((x) => x.action === action);
  const created = rows("create");
  const merged = rows("merge");
  const skipped = rows("skip");
  const unsupported = Object.entries(r.unsupported);
  const personRows = (items, label) =>
    `<div class="list">${items.map((x) => `<button class="row" data-act="open-person" data-id="${esc(x.id)}">${avatar(x.display_name, x.id)}<span class="grow"><span class="primary">${esc(x.display_name)}</span><span class="secondary">${esc(label)}</span></span><span class="end">${icon("external")}</span></button>`).join("")}</div>`;
  sheet.innerHTML = `<div class="page banded imp">
    ${screenBand({ eyebrow: esc(r.filename), title: t("Import finished"), meta: [`<span>${esc(plural(r.total, "{count} contact in the file", "{count} contacts in the file"))}</span>`], below: stepper("done") })}
    <div class="wrap body imp-done">
      <div class="stat-row">
        <div class="stat-tile"><b>${esc(r.created)}</b><span>${esc(plural(r.created, "new person", "new people"))}</span></div>
        <div class="stat-tile"><b>${esc(r.merged)}</b><span>${esc(t("merged into existing people"))}</span></div>
        <div class="stat-tile"><b>${esc(r.skipped)}</b><span>${esc(t("skipped"))}</span></div>
      </div>
      ${unsupported.length ? `<p class="notice info">${icon("info")}<span>${esc(t("Fields Meridian could not place were kept on each person under “Imported data”: {fields}.", { fields: unsupported.map(([k, n]) => `${k} (${n})`).join(", ") }))}</span></p>` : ""}
      ${created.length ? `<section class="psection"><div class="section-head"><h3>${icon("userplus")}${esc(t("New in Meridian"))} <span class="count">${created.length}</span></h3></div>${personRows(created, t("New person"))}</section>` : ""}
      ${merged.length ? `<section class="psection"><div class="section-head"><h3>${icon("merge")}${esc(t("Merged"))} <span class="count">${merged.length}</span></h3></div>${personRows(merged, t("New details added"))}</section>` : ""}
      ${skipped.length ? `<details class="imp-raw"><summary>${esc(plural(skipped.length, "{count} contact skipped", "{count} contacts skipped"))}</summary><ul>${skipped.map((x) => `<li><span>${esc(x.display_name)}</span></li>`).join("")}</ul></details>` : ""}
      <div class="actions-row"><button class="ae-btn ae-btn--primary" data-act="go" data-view="people">${icon("people")}<span>${esc(t("Go to People"))}</span></button><button class="ae-btn" data-act="import-again">${icon("upload")}<span>${esc(t("Import another file"))}</span></button></div>
    </div></div>`;
}
const IMPORT_RENDER = { file: renderImportFile, review: renderImportReview, confirm: renderImportConfirm, done: renderImportResult };

/* ───────────────────────── Trash ───────────────────────── */

async function viewTrash(sheet, token) {
  setTitle([{ label: t("Trash") }]);
  const data = await api("/trash");
  if (stale(token)) return;
  state.trash = data.items;
  sheet.innerHTML = `<div class="page banded trash">
    ${screenBand({ title: t("Trash"), meta: [`<span id="trash-count">${esc(plural(data.items.length, "{count} person", "{count} people"))}</span>`, `<span>${esc(t("Meridian never empties Trash on its own"))}</span>`] })}
    <div class="wrap body"><div class="measure-wide" id="trash-body">${trashBody()}</div></div></div>`;
}
function trashBody() {
  if (!state.trash.length)
    return emptyState("trash", t("Trash is empty"), t("People you move to Trash stay here until you restore them or delete them permanently."), `<button class="ae-btn" data-act="go" data-view="people">${icon("people")}<span>${esc(t("Go to People"))}</span></button>`);
  return `<p class="notice info trash-note">${icon("info")}<span>${esc(t("Restoring brings a person back with everything they had. Deleting permanently removes everything Meridian knows about them and cannot be undone."))}</span></p>
    <div class="list trash-list">${state.trash
      .map(
        (p) => `<div class="trash-row" data-id="${esc(p.id)}">
        ${avatar(p.display_name, p.id, `is-trashed is-${p.kind}`)}
        <span class="who"><button class="link primary" data-act="open-entity" data-kind="${p.kind}" data-id="${esc(p.id)}">${esc(p.display_name)}</button><span class="secondary">${esc([p.kind !== "person" ? t(KIND_NOUN[p.kind]) : "", p.work, p.email || p.phone].filter(Boolean).join(" · ") || t("No details"))}</span></span>
        <span class="when" title="${esc(new Date(p.deleted_at).toLocaleString(activeLocale))}">${esc(t("Deleted {when}", { when: relativeTime(p.deleted_at) }))}</span>
        <span class="acts"><button class="ae-btn ae-btn--sm" data-act="restore" data-kind="${p.kind}" data-id="${esc(p.id)}">${icon("restore")}<span>${esc(t("Restore"))}</span></button><button class="ae-btn ae-btn--sm ae-btn--quiet is-danger" data-act="purge" data-id="${esc(p.id)}" data-name="${esc(p.display_name)}">${icon("trash")}<span>${esc(t("Delete permanently"))}</span></button></span>
      </div>`,
      )
      .join("")}</div>`;
}
/** A row leaves Trash: it fades out, the list re-renders, focus moves to the next row. */
async function leaveTrash(id) {
  const row = $(`.trash-row[data-id="${CSS.escape(id)}"]`);
  const index = state.trash.findIndex((p) => p.id === id);
  if (row) await animate(row, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(12px)" }], MOTION.exit, MOTION.exitEase);
  state.trash = state.trash.filter((p) => p.id !== id);
  const body = $("#trash-body");
  if (!body) return;
  body.innerHTML = trashBody();
  const count = $("#trash-count");
  if (count) count.textContent = plural(state.trash.length, "{count} person", "{count} people");
  const next = $$(".trash-row")[Math.min(index, state.trash.length - 1)];
  ($('[data-act="restore"]', next || document) || $("[data-heading]"))?.focus({ preventScroll: true });
}

/* ───────────────────────── Settings ───────────────────────── */

function setSection(id, title, text, content) {
  return `<section class="set-section" aria-labelledby="set-${id}"><div class="set-head"><h3 id="set-${id}">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}</div>${content}</section>`;
}
async function viewSettings(sheet, token) {
  setTitle([{ label: t("Settings") }]);
  const [stateData, imports] = await Promise.all([api("/state"), api("/imports")]);
  if (stale(token)) return;
  state.self = stateData.self;
  state.version = stateData.version;
  if (stateData.settings) state.prefs = stateData.settings;
  const me = state.self;
  const you = me
    ? `<div class="list"><div class="set-row">${avatar(me.display_name, me.id, "md self")}<span class="who"><span class="primary">${esc(me.display_name)} <span class="self-badge">@me</span></span><span class="secondary">${esc(me.work || me.email || me.phone || "")}</span></span>
        <span class="acts"><button class="ae-btn ae-btn--sm" data-act="open-person" data-id="${esc(me.id)}">${esc(t("Open profile"))}</button><button class="ae-btn ae-btn--sm" data-act="choose-self">${esc(t("Change"))}</button><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="self-clear">${esc(t("Clear"))}</button></span></div></div>`
    : `<div class="list set-empty"><p>${esc(t("No one is marked as you yet."))}</p><div class="actions"><button class="ae-btn ae-btn--sm" data-act="choose-self">${esc(t("Choose a person"))}</button><button class="ae-btn ae-btn--sm ae-btn--quiet" data-act="new-person" data-self="1">${esc(t("Create my profile"))}</button></div></div>`;
  const history = imports.items.length
    ? `<div class="list">${imports.items
        .map(
          (i) => `<button class="row set-import" data-act="import-detail" data-id="${esc(i.id)}"><span class="file-tile">${icon("note")}</span><span class="grow"><span class="primary">${esc(i.filename)}</span><span class="secondary">${esc(t("{create} new · {merge} merged · {skip} skipped", { create: i.created, merge: i.merged, skip: i.skipped }))}</span></span><span class="end">${esc(new Date(i.created_at).toLocaleDateString(activeLocale, { day: "numeric", month: "short", year: "numeric" }))}</span></button>`,
        )
        .join("")}</div>`
    : `<div class="list set-empty"><p>${esc(t("No imports yet."))}</p><div class="actions"><button class="ae-btn ae-btn--sm" data-act="go" data-view="import">${icon("upload")}<span>${esc(t("Import contacts"))}</span></button></div></div>`;
  const facts = [
    [t("Where it is stored"), t("In this Aureate Empyrean installation only.")],
    [t("Backups"), t("Included when Nexus backs up this installation.")],
    [t("Online lookups"), t("None. Meridian sends nothing to other services and never looks anyone up online.")],
    [t("Deleted people"), t("Kept in Trash until you restore them or delete them permanently.")],
  ];
  sheet.innerHTML = `<div class="page banded settings">
    ${screenBand({ title: t("Settings"), meta: [`<span>${esc(t("Meridian {version}", { version: state.version }))}</span>`] })}
    <div class="wrap body"><div class="measure">
      ${setSection("me", t("You (@me)"), t("An ordinary person marked as you. Other Aureate Empyrean applications refer to you through it. Type @me in any person search to find it."), you)}
      ${setSection("people", t("People"), t("How names are ordered and written in the People list, searches and pickers. Stored names are never changed."), peopleSettings())}
      ${setSection("imports", t("Import history"), t("Every import, with what it added. Open one to see each contact's outcome."), history)}
      ${setSection("data", t("Your data"), "", `<div class="list vrows">${facts.map(([k, v]) => vrow(k, esc(v))).join("")}</div>`)}
      ${setSection("about", t("About"), "", `<div class="list vrows">${vrow(t("Version"), esc(state.version))}</div>`)}
    </div></div></div>`;
}
/** Settings → People: sorting and display order, chosen independently. */
function peopleSettings() {
  const p = state.prefs;
  return `<div class="list vrows set-prefs">
    <div class="vrow set-pref"><span class="label" id="pref-sort-label">${esc(t("Sort by"))}</span><span class="value">${segmented("pref-sort", t("Sort people by"), [["given", t("First name → Last name")], ["family", t("Last name → First name")]], p.people_sort)}</span></div>
    <div class="vrow set-pref"><span class="label" id="pref-display-label">${esc(t("Show names as"))}</span><span class="value">${segmented("pref-display", t("Show names as"), [["given", t("First name Last name")], ["family", t("Last name, First name")]], p.people_display)}</span></div>
    <p class="ae-hint set-pref-hint">${esc(t("Alphabetical order follows Slovak rules (č after c, ch after h). People recorded with their name as one piece of text, without first and last name parts, are sorted and shown as written."))}</p></div>`;
}
async function savePreference(el, key) {
  const value = el.dataset.value;
  if (state.prefs[key] === value) return;
  const before = state.prefs[key];
  pressOnly(el.parentElement, el);
  try {
    state.prefs = await api("/settings", "PUT", { [key]: value });
    state.people.items = [];
    toast(t("Saved"), "good");
  } catch (error) {
    state.prefs[key] = before;
    pressOnly(el.parentElement, $(`[data-value="${before}"]`, el.parentElement));
    toast(error.message, "danger");
  }
}
async function importDetail(id) {
  const d = await api(`/imports/${id}`);
  const tag = (a) => (a === "create" ? t("New") : a === "merge" ? t("Merged") : t("Skipped"));
  openDialog(
    `<div class="ae-dialog-head"><h2>${esc(d.filename)}</h2><button class="ae-btn ae-btn--quiet ae-btn--icon" data-act="close" aria-label="${esc(t("Close"))}">${icon("x")}</button></div>
    <div class="ae-dialog-body"><p class="muted" style="margin-top:0">${esc(new Date(d.created_at).toLocaleString(activeLocale))} · ${esc(t("{create} new · {merge} merged · {skip} skipped", { create: d.created, merge: d.merged, skip: d.skipped }))}</p>
      <div class="list">${d.items
        .map((i) => {
          const live = i.present && !i.deleted_at;
          const note = i.entity_id && !i.present ? t("deleted since") : i.deleted_at ? t("in Trash") : "";
          return `<${live ? `button class="row" data-act="open-person" data-id="${esc(i.entity_id)}"` : 'div class="row is-static"'}>${avatar(i.label || "?", i.entity_id || i.label)}<span class="grow"><span class="primary">${esc(i.label || t("(no name)"))}</span><span class="secondary">${esc([tag(i.action), note].filter(Boolean).join(" · "))}</span></span></${live ? "button" : "div"}>`;
        })
        .join("")}</div></div>`,
    { wide: true },
  );
}

/* ───────────────────────── Actions ───────────────────────── */

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return toast(t("Copied"), "good");
  } catch {
    /* the sandboxed frame may not allow the clipboard API */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(area);
  area.select();
  const ok = document.execCommand?.("copy");
  area.remove();
  toast(ok ? t("Copied") : t("Copying is not available here; select the text instead."), ok ? "good" : "danger");
}
/** The graph's filter popover closes on a click outside it or on Escape. */
function closeGraphFilters(returnFocus = false) {
  const box = $("#graph-filters");
  if (!box || box.hidden) return false;
  box.hidden = true;
  const toggle = $('[data-act="graph-filters"]');
  toggle?.setAttribute("aria-expanded", "false");
  if (returnFocus) toggle?.focus();
  return true;
}
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".ae-menu") && !event.target.closest("[aria-haspopup]")) closeMenu();
  if (!event.target.closest("#graph-filters") && !event.target.closest('[data-act="graph-filters"]')) closeGraphFilters();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && closeGraphFilters(true)) event.stopPropagation();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
  // "/" finds a person from anywhere.
  if (event.key === "/" && !typing(document.activeElement) && !panel.el() && !dialog().open) {
    const target = $("#dash-search") || $("#people-q") || $("#graph-q") || $("#entity-q") || $("#quick-search");
    if (target && target.offsetParent !== null) {
      event.preventDefault();
      target.focus();
    }
  }
  const entry = event.target.closest?.("#people-list [data-act='open-person']");
  if (entry && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const all = $$("#people-list [data-act='open-person']");
    const i = all.indexOf(entry);
    const grid = state.people.view === "grid";
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: grid ? 1 : 0, ArrowLeft: grid ? -1 : 0 }[event.key] ?? 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : i + step;
    if (step || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (next < 0) $("#people-q")?.focus();
      else all[Math.min(next, all.length - 1)]?.focus();
    }
  }
  // Arrow keys move between profile tabs.
  const tab = event.target.closest?.(".tab");
  if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const tabs = $$(".tab");
    const i = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    switchTab(tabs[next].dataset.tab, true);
  }
});
document.addEventListener("change", (event) => {
  const el = event.target.closest('[data-act="decide"]');
  if (el?.checked) decide(+el.dataset.index, el.value);
  const target = event.target.closest('[data-act="target"]');
  if (target?.checked) state.importing.decisions[+target.dataset.index].target = target.value;
  const kind = event.target.closest('#panel [data-k="channel"]');
  if (kind) {
    const label = $('[data-k="label"]', kind.closest("[data-row]"));
    if (label && !label.value) label.value = LABELS[kind.value][0];
  }
  if (event.target.closest("#panel")) {
    const dirty = $("#panel-dirty");
    if (dirty) dirty.textContent = panel.isDirty() ? t("Unsaved changes") : "";
  }
});
document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-act]");
  if (!el || el.disabled || el.tagName === "SELECT") return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  try {
    if (act === "go") {
      if (el.dataset.view === "import" && state.importing?.result) state.importing = null;
      return go(el.dataset.view);
    }
    if (act === "open-person") {
      if (dialog().open) await closeDialog();
      return openPerson(id, el);
    }
    if (act === "peek-person") return go("person", id);
    if (act === "retry") return render();
    if (act === "close") return closeDialog();
    if (act === "new-person") return newPerson({ makeSelf: !!el.dataset.self });
    if (act === "create-person") return createPerson(el);
    if (act === "tab") return switchTab(el.dataset.tab);
    if (act === "local-graph") {
      GRAPH.local = { id, depth: 1 };
      GRAPH.selected = { type: "node", id };
      return state.route.view === "graph" ? (saveGraphState(), render()) : go("graph");
    }
    if (act === "graph-whole") {
      const centre = GRAPH.local?.id;
      saveGraphState();
      GRAPH.selected = centre ? { type: "node", id: centre } : null;
      GRAPH.local = null;
      GRAPH.camera = null;
      return render();
    }
    if (act === "graph-depth") {
      GRAPH.local.depth = +el.dataset.value;
      saveGraphState();
      GRAPH.camera = null;
      return render({ focus: false });
    }
    if (act === "graph-filters") {
      const box = $("#graph-filters");
      const open = box.hidden;
      box.hidden = !open;
      el.setAttribute("aria-expanded", String(open));
      if (open) {
        animate(box, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.fast);
        $("input", box)?.focus();
      }
      return;
    }
    if (act === "graph-time") {
      GRAPH.filter.time = el.dataset.value;
      pressOnly(el.parentElement, el);
      return applyGraphFilter();
    }
    if (act === "graph-reset-filters") {
      GRAPH.filter = { kinds: new Set(["p", "o", "g"]), categories: null, time: "all", isolated: true };
      $$("#graph-filters input[type=checkbox]").forEach((c) => (c.checked = true));
      $$('#graph-filters [data-act="graph-time"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "all")));
      return applyGraphFilter();
    }
    if (act === "graph-zoom") return GRAPH.engine?.zoomBy(el.dataset.z === "in" ? 1.4 : 1 / 1.4, undefined, undefined, 220);
    if (act === "graph-fit") return GRAPH.engine?.fit();
    if (act === "graph-reset") {
      GRAPH.engine?.select(null);
      GRAPH.engine?.hover && (GRAPH.engine.hover = null);
      return GRAPH.engine?.fit();
    }
    if (act === "graph-deselect") {
      GRAPH.engine?.select(null);
      $("#graph-live") && ($("#graph-live").textContent = t("Selection cleared"));
      return $("#graph-canvas")?.focus({ preventScroll: true });
    }
    if (act === "graph-focus") return graphFocus(id);
    if (act === "graph-panel-toggle") {
      GRAPH.collapsed = !panelShut(GRAPH.engine?.selected);
      showGraphDetails(GRAPH.engine?.selected, GRAPH.engine?.selectionInfo(GRAPH.engine?.selected));
      return $('[data-act="graph-panel-toggle"]')?.focus();
    }
    if (act === "graph-browse") {
      GRAPH.browseAll = !GRAPH.browseAll;
      showGraphDetails(null, null);
      return $('[data-act="graph-browse"]')?.focus();
    }
    if (act === "graph-legend") {
      GRAPH.legend = !GRAPH.legend;
      try {
        localStorage.setItem("meridian.graph.legend", GRAPH.legend ? "1" : "0");
      } catch {
        /* a convenience */
      }
      $("#graph-legend").classList.toggle("is-closed", !GRAPH.legend);
      $("#graph-legend-body").hidden = !GRAPH.legend;
      el.setAttribute("aria-expanded", String(GRAPH.legend));
      return graphInsets();
    }
    if (act === "graph-open") {
      saveGraphState();
      return go(el.dataset.kind === "person" ? "person" : "entity", id, el.dataset.kind);
    }
    if (act === "open-entity") {
      if (dialog().open) await closeDialog();
      return openPerson(id, el, el.dataset.kind || "person");
    }
    if (act === "new-entity") return newEntity(el.dataset.kind);
    if (act === "pick-image") return state.person && openPicture(state.person);
    if (act === "create-entity") return createEntity(el);
    if (act === "trash-entity") {
      closeMenu();
      const p = state.person;
      return confirmAction(t("Move {name} to Trash?", { name: p.display_name }), t("Its relationships and memberships are kept with it and come back if you restore it."), t("Move to Trash"), async () => {
        await api(`/entities/${p.id}`, "DELETE");
        await refreshCounts();
        toast(t("{name} was moved to Trash", { name: p.display_name }));
        go(KIND_VIEW[p.kind]);
      });
    }
    if (act === "add-relation") {
      closeMenu();
      return openRelation(null, el.closest(".ae-menu") ? $('[data-act="person-menu"]') : el);
    }
    if (act === "edit-relation") {
      const record = state.person.relationships.find((r) => r.id === id);
      if (record) {
        if (panel.el() && panel.section === "relationship") panel.snapshot = formState();
        return openRelation(record, el.closest("#panel") ? panel.invoker : el);
      }
      return;
    }
    if (act === "add-member") {
      closeMenu();
      return openMembership(null, el.closest(".ae-menu") ? $('[data-act="person-menu"]') : el);
    }
    if (act === "edit-membership") {
      const record = state.person.memberships.find((m) => m.id === id);
      return record && openMembership(record, el);
    }
    if (act === "rel-save-anyway") return saveRelation($('#panel [data-act="panel-save"]'), true);
    if (act === "tr-cancel") return finishTransition("cancel");
    if (act === "tr-keep") return finishTransition("keep");
    if (act === "tr-end") return finishTransition("end");
    if (act === "sib-cancel") return closeDialog();
    if (act === "sib-save") return saveSiblings(el);
    if (act === "rel-end") {
      $("#rel-state").value = "former";
      const until = $('[data-date="rel-until"]');
      if (!$("[data-part=y]", until).value) {
        const [y, m] = todayIso().split("-");
        $("[data-part=y]", until).value = y;
        $("[data-part=m]", until).value = m;
      }
      $("[data-part=y]", until).focus();
      $("#panel-dirty").textContent = panel.isDirty() ? t("Unsaved changes") : "";
      // Family records: ending closes this record's period; it never says the kinship stopped.
      if (relEditor.record?.permanent) return toast(t("This record is set to ended with this month. A family tie does not end through distance or conflict; if the record is wrong, correct it or remove it instead."));
      return toast(t("Set to ended with this month; adjust the date if you know it, then save."));
    }
    if (act === "rel-remove" || act === "mem-remove") {
      const relation = act === "rel-remove";
      const record = relation ? relEditor.record : memEditor.record;
      return confirmAction(
        relation ? t("Remove this relationship?") : t("Remove this membership?"),
        relation && record.permanent ? t("Use this when it was recorded by mistake, for example the wrong person. Removing it does not record that contact stopped, and family ties are not ended by distance or conflict.") : relation ? t("Use this when it was recorded by mistake. If it was real but is over, choose “End it” instead, so its history stays.") : t("Use this when it was recorded by mistake. If it was real but is over, set an end date instead, so its history stays."),
        t("Remove"),
        async () => {
          await api(relation ? `/relationships/${record.id}` : `/memberships/${record.id}`, "DELETE");
          panel.snapshot = formState();
          state.person = await api(entityApi(state.person));
          refreshPerson();
          panel.invoker = $("[data-heading]");
          await closePanel();
          toast(relation ? t("Relationship removed") : t("Membership removed"));
          refreshCounts();
        },
      );
    }
    if (act === "src-add") {
      const rows = $("#src-rows");
      rows.insertAdjacentHTML("beforeend", sourceRow(undefined, rows.children.length + Date.now() % 1000));
      const row = rows.lastElementChild;
      animate(row, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.page);
      $("select", row).focus();
      $("#panel-dirty").textContent = panel.isDirty() ? t("Unsaved changes") : "";
      return;
    }
    if (act === "src-remove") {
      el.closest("[data-src]").remove();
      $("#panel-dirty").textContent = panel.isDirty() ? t("Unsaved changes") : "";
      return $('[data-act="src-add"]')?.focus();
    }
    if (act === "picker-change") return el.closest(".picker")._unpick();
    if (act === "edit") {
      closeMenu();
      return openPanel(el.dataset.section, el.closest(".ae-menu") ? $('[data-act="person-menu"]') : el);
    }
    if (act === "panel-section") return openPanel(el.dataset.section);
    if (act === "panel-cancel") {
      if (!panel.saving) return closePanel();
      return;
    }
    if (act === "panel-close") return requestClosePanel();
    if (act === "panel-save") return savePanel(el);
    if (act === "address-search-consent") {
      await api("/address-search/consent", "PUT", { enabled: el.dataset.enabled === "1" });
      return refreshAddressSearch();
    }
    if (act === "add-row") {
      const spec = EDITORS[panel.section];
      $("#editor-rows").insertAdjacentHTML("beforeend", editorRow(spec, spec.blank()));
      if (spec.addressSearch) refreshAddressSearch();
      const row = $("#editor-rows [data-row]:last-child");
      animate(row, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], MOTION.page);
      $("input:not([type=checkbox]), select", row)?.focus();
      const dirty = $("#panel-dirty");
      if (dirty) dirty.textContent = t("Unsaved changes");
      updateContactStatus();
      return;
    }
    if (act === "remove-row") {
      const row = el.closest("[data-row]");
      await animate(row, [{ opacity: 1 }, { opacity: 0 }], MOTION.fast, MOTION.exitEase);
      row.remove();
      const dirty = $("#panel-dirty");
      if (dirty) dirty.textContent = panel.isDirty() ? t("Unsaved changes") : "";
      updateContactStatus();
      return $('[data-act="add-row"]')?.focus();
    }
    if (act === "person-menu") return el.getAttribute("aria-expanded") === "true" ? closeMenu() : personMenu(el);
    if (act === "self-set") {
      closeMenu();
      await setSelf(state.person.id);
      state.person.is_self = true;
      toast(t("{name} is now @me", { name: state.person.display_name }), "good");
      return state.route.view === "person" ? refreshPerson() : render();
    }
    if (act === "self-clear") {
      closeMenu();
      await setSelf(null);
      if (state.person) state.person.is_self = false;
      toast(t("No one is marked as @me now"));
      return state.route.view === "person" ? refreshPerson() : render();
    }
    if (act === "choose-self") return chooseSelf();
    if (act === "pick-self") {
      await setSelf(id);
      await closeDialog();
      toast(t("Saved"), "good");
      return render({ focus: false });
    }
    if (act === "trash-person") {
      closeMenu();
      const p = state.person;
      return confirmAction(t("Move {name} to Trash?", { name: p.display_name }), t("You can restore them from Trash. Nothing is deleted permanently until you empty it."), t("Move to Trash"), async () => {
        await api(`/people/${p.id}`, "DELETE");
        await refreshCounts();
        toast(t("{name} was moved to Trash", { name: p.display_name }));
        go("people");
      });
    }
    if (act === "restore") {
      if (el.disabled) return;
      el.disabled = true;
      el.classList.add("is-busy");
      try {
        const kind = el.dataset.kind || "person";
        const view = kind === "person" ? "person" : "entity";
        const restored = await api(kind === "person" ? `/people/${id}/restore` : `/entities/${id}/restore`, "POST");
        await refreshCounts();
        if (state.route.view !== "trash") return go(view, id, kind);
        await leaveTrash(id);
        toast(t("{name} was restored", { name: restored.display_name }), "good", { label: t("Open profile"), run: () => go(view, id, kind) });
      } finally {
        el.disabled = false;
        el.classList.remove("is-busy");
      }
      return;
    }
    if (act === "purge")
      return confirmAction(t("Delete {name} permanently?", { name: el.dataset.name }), t("Everything Meridian knows about {name} is removed: names, contact details, dates, notes and imported data. This cannot be undone. Other applications that refer to this person will see that it was deleted.", { name: el.dataset.name }), t("Delete permanently"), async () => {
        await api(`/trash/${id}`, "DELETE");
        await refreshCounts();
        await leaveTrash(id);
        toast(t("{name} was deleted permanently", { name: el.dataset.name }));
      });
    if (act === "drop-imported") {
      state.person = await api(`/people/${state.person.id}/imported/${id}`, "DELETE");
      if (!state.person.imported.length) state.tab = "overview";
      return refreshPerson();
    }
    if (act === "filter") {
      const f = el.dataset.filter;
      state.people.has.has(f) ? state.people.has.delete(f) : state.people.has.add(f);
      el.setAttribute("aria-pressed", String(state.people.has.has(f)));
      return refreshPeople();
    }
    if (act === "pref-sort") return savePreference(el, "people_sort");
    if (act === "pref-display") return savePreference(el, "people_display");
    if (act === "sort") {
      if (state.people.sort === el.dataset.value) return;
      state.people.sort = el.dataset.value;
      pressOnly(el.parentElement, el);
      return refreshPeople({ fade: true });
    }
    if (act === "view") {
      if (state.people.view === el.dataset.value) return;
      state.people.view = el.dataset.value;
      try {
        localStorage.setItem(VIEW_KEY, state.people.view);
      } catch {
        /* the view is a convenience */
      }
      pressOnly(el.parentElement, el);
      return renderPeopleList({ fade: true });
    }
    if (act === "clear-search" || act === "clear-filters") {
      if (act === "clear-search") state.people.q = "";
      else state.people.has.clear();
      const input = $("#people-q");
      if (input) input.value = state.people.q;
      $$('[data-act="filter"]').forEach((b) => b.setAttribute("aria-pressed", String(state.people.has.has(b.dataset.filter))));
      await refreshPeople({ fade: true });
      return (act === "clear-search" ? input : $("#people-list [data-act='open-person']"))?.focus();
    }
    if (act === "people-retry") return refreshPeople();
    if (act === "more-people") {
      if (el.disabled) return;
      el.disabled = true;
      const first = state.people.items.length;
      state.people.limit += 100;
      if (await loadPeople(true)) renderPeopleList();
      return $$("#people-list [data-act='open-person']")[first]?.focus();
    }
    if (act === "copy") return copyText(el.dataset.value);
    if (act === "external") return bridge("external", { url: el.dataset.url }).catch((e) => toast(e.message, "danger"));
    if (act === "open-module") return bridge("navigate", { module: el.dataset.module, ...(el.dataset.path ? { path: el.dataset.path } : {}) }).catch((e) => toast(e.message, "danger"));
    if (act === "import-commit") return commitImport(el);
    if (act === "import-continue") return showImportStep("confirm");
    if (act === "import-back") return showImportStep("review");
    if (act === "import-again") {
      state.importing = null;
      return showImportStep("file");
    }
    if (act === "import-restart") {
      const leave = () => {
        state.importing = null;
        showImportStep("file");
      };
      return confirmAction(t("Discard this review?"), t("Your choices for {n} contacts are not kept. Nothing has been imported.", { n: state.importing.preview.total }), t("Discard review"), async () => leave(), { danger: false });
    }
    if (act === "imp-filter") {
      state.importing.filter = el.dataset.value;
      pressOnly(el.parentElement, el);
      applyReviewFilter();
      return animate($("#imp-list"), [{ opacity: 0.4 }, { opacity: 1 }], MOTION.fast);
    }
    if (act === "compare") return toggleCompare(el);
    if (act === "import-skip-all" || act === "import-reset-defaults") {
      const imp = state.importing;
      imp.decisions = imp.preview.contacts.map((c) => ({ index: c.index, action: act === "import-skip-all" ? "skip" : c.default_action, target: null }));
      for (const d of imp.decisions) {
        $$(`[data-act="decide"][data-index="${d.index}"]`).forEach((r) => (r.checked = r.value === d.action));
        decide(d.index, d.action);
      }
      return toast(act === "import-skip-all" ? t("Every contact is set to Skip") : t("Suggestions restored"));
    }
    if (act === "import-detail") return importDetail(id);
  } catch (error) {
    toast(error.message, "danger");
  }
});

/* ───────────────────────── Start ───────────────────────── */

async function start() {
  try {
    state.context = await bridge("context");
  } catch {
    /* standalone preview: keep defaults */
  }
  activeLocale = safeLocale(state.context.locale);
  document.documentElement.lang = activeLocale;
  try {
    const data = await api("/state");
    Object.assign(state, { counts: data.counts, self: data.self, version: data.version, prefs: data.settings || state.prefs });
  } catch (error) {
    $("#app").innerHTML = `<div class="ae-empty">${icon("alert")}<h3>${esc(t("Meridian could not start"))}</h3><p>${esc(error.message)}</p></div>`;
    return;
  }
  state.route = routeFromLocation();
  renderShell();
  // Inside a Nexus that supports it, the browser URL and Back/Forward follow Meridian's screens.
  if (state.context.navigation?.versions?.includes(1)) {
    try {
      if (await meridianNavigation.start(state.context)) {
        // Show the canonical address for the first screen without adding a history entry.
        if (shownRoute) await queueNavigation(shownRoute, "replace").catch(() => {});
        return;
      }
    } catch {
      /* the host did not answer the handshake: keep the in-memory navigation below */
    }
  }
  render({ focus: false });
}
start();
