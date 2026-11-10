/* Search-as-you-type fields in the contact editor: real-world addresses, and Organizations that
   already exist. They are different sources sharing one behaviour. Listeners sit on the document
   because editor rows are created lazily, and rebuilt when a draft is restored. */

const COMBO_SOURCES = {};
const comboState = new WeakMap();
const comboOf = (input) => {
  if (!comboState.has(input)) comboState.set(input, { serial: 0, timer: null, options: [], active: -1 });
  return comboState.get(input);
};
const comboListOf = (input) => input.closest(".combo").querySelector(".combo-list");
function comboClose(input) {
  const list = comboListOf(input);
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  const combo = comboOf(input);
  // A search still on its way must not reopen a list that has been dismissed.
  clearTimeout(combo.timer);
  combo.timer = null;
  combo.serial++;
  combo.options = [];
  combo.active = -1;
}
/** The visible area the list must fit in: the viewport, narrowed by any scrolling or clipping
    container around the field (the editor body), so the list is never cut off or drawn under
    the editor's buttons. */
function comboBounds(input) {
  let top = 0;
  let bottom = innerHeight;
  for (let el = input.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowY)) continue;
    const r = el.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return { top, bottom };
}
/** Below the field when it fits, otherwise on the side with more room, shortened to fit. The
    list is positioned inside the field's .combo, so it moves with the field when the editor
    scrolls; this only decides the side and the height. */
function comboPlace(input) {
  const list = comboListOf(input);
  if (list.hidden) return;
  const gap = 4;
  const margin = 8;
  const field = input.getBoundingClientRect();
  const bounds = comboBounds(input);
  const below = bounds.bottom - field.bottom - gap - margin;
  const above = field.top - bounds.top - gap - margin;
  // A scrolling list is keyboard-focusable in Chromium; Tab must leave the field, not enter it.
  list.tabIndex = -1;
  list.style.maxHeight = "";
  const limit = parseFloat(getComputedStyle(list).maxHeight) || Infinity;
  const wanted = Math.min(list.scrollHeight, limit);
  const up = wanted > below && above > below;
  const top = input.offsetTop;
  list.style.top = up ? "auto" : `${top + input.offsetHeight + gap}px`;
  list.style.bottom = up ? `${input.offsetParent.clientHeight - top + gap}px` : "auto";
  list.style.maxHeight = `${Math.max(48, Math.floor(Math.min(limit, up ? above : below)))}px`;
  list.classList.toggle("is-above", up);
}
function comboMessage(input, text) {
  const list = comboListOf(input);
  list.innerHTML = `<p class="combo-note">${esc(text)}</p>`;
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  comboOf(input).options = [];
  comboPlace(input);
}
function comboShow(input, options, foot = "") {
  const combo = comboOf(input);
  const list = comboListOf(input);
  combo.options = options;
  combo.active = -1;
  list.innerHTML = options.map((o, i) => `<button type="button" class="combo-option" role="option" id="${list.id}-${i}" data-combo-option="${i}" aria-selected="false" tabindex="-1"><span class="primary">${esc(o.primary)}</span>${o.secondary ? `<span class="secondary">${esc(o.secondary)}</span>` : ""}</button>`).join("") + (foot ? `<p class="combo-foot">${esc(foot)}</p>` : "");
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  comboPlace(input);
}
function comboHighlight(input, index) {
  const combo = comboOf(input);
  combo.active = index;
  $$(".combo-option", comboListOf(input)).forEach((el, i) => {
    el.setAttribute("aria-selected", String(i === index));
    el.classList.toggle("is-active", i === index);
    if (i === index) {
      input.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    }
  });
}
function comboPick(input, index) {
  const source = COMBO_SOURCES[input.dataset.comboInput];
  const option = comboOf(input).options[index];
  if (!option) return;
  comboClose(input);
  source.pick(input, option);
}
/** Debounced; a response that is no longer the latest one is dropped. */
function comboRun(input, delay = null) {
  const source = COMBO_SOURCES[input.dataset.comboInput];
  const combo = comboOf(input);
  clearTimeout(combo.timer);
  const q = input.value.trim();
  if (q.length < source.minLength) return comboClose(input);
  const mine = ++combo.serial;
  combo.timer = setTimeout(async () => {
    combo.timer = null;
    if (source.loading) comboMessage(input, source.loading);
    await source.search(input, q, () => mine === combo.serial);
  }, delay ?? source.debounce);
}
document.addEventListener("input", (event) => {
  const input = event.target.closest?.("[data-combo-input]");
  if (!input) return;
  COMBO_SOURCES[input.dataset.comboInput].changed?.(input);
  comboRun(input);
});
document.addEventListener("keydown", (event) => {
  const input = event.target.closest?.("[data-combo-input]");
  if (!input) return;
  const combo = comboOf(input);
  const open = !comboListOf(input).hidden;
  const count = combo.options.length;
  if (event.key === "ArrowDown" && open && count) {
    event.preventDefault();
    comboHighlight(input, (combo.active + 1) % count);
  } else if (event.key === "ArrowUp" && open && count) {
    event.preventDefault();
    comboHighlight(input, (combo.active - 1 + count) % count);
  } else if (event.key === "Enter" && open && count) {
    event.preventDefault();
    comboPick(input, Math.max(combo.active, 0));
  } else if (event.key === "Escape" && (open || combo.timer !== null)) {
    event.preventDefault();
    event.stopPropagation(); // closes the suggestions, not the whole panel
    comboClose(input);
  }
}, true);
document.addEventListener("mousedown", (event) => {
  const option = event.target.closest?.("[data-combo-option]");
  if (!option) return;
  event.preventDefault(); // keeps focus in the field
  comboPick(option.closest(".combo").querySelector("[data-combo-input]"), +option.dataset.comboOption);
});
document.addEventListener("focusout", (event) => {
  const input = event.target.closest?.("[data-combo-input]");
  if (input && !input.closest(".combo").contains(event.relatedTarget)) comboClose(input);
});
// An open list follows its field; after scrolling or resizing, the side with room may change.
const comboReplace = (event) => {
  const input = document.activeElement?.closest?.("[data-combo-input]");
  if (input && !(event?.target instanceof Element && event.target.closest(".combo-list"))) comboPlace(input);
};
document.addEventListener("scroll", comboReplace, true);
addEventListener("resize", comboReplace);

/* ── Existing Organizations: for work and education ── */
COMBO_SOURCES.org = {
  minLength: 1,
  debounce: 160,
  changed(input) {
    // Typing makes this a name again, not the Organization that was chosen.
    const id = input.closest("[data-row]")?.querySelector('[data-k="organization_id"]');
    if (id) id.value = "";
  },
  async search(input, q, current) {
    const data = await api("/search" + query({ q, kinds: "organization" })).catch(() => null);
    if (!current()) return;
    if (!data) return comboMessage(input, t("Organizations could not be searched. You can still type the name."));
    const typed = foldText(q);
    const options = data.entities.map((e) => ({ primary: e.display_name, secondary: e.work || t("Organization already in Meridian"), id: e.id, name: e.display_name }));
    if (!data.entities.some((e) => foldText(e.display_name) === typed)) options.push({ primary: t("Create “{name}” when you save", { name: q }), secondary: options.length ? t("Only if none of the above is the same one") : t("New Organization"), create: true, name: q });
    comboShow(input, options);
  },
  pick(input, option) {
    input.value = option.name;
    const id = input.closest("[data-row]")?.querySelector('[data-k="organization_id"]');
    if (id) id.value = option.create ? "" : option.id;
    id?.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    updateContactStatus();
  },
};

/* ── Real-world addresses ── */
const GEOGRAPHY = ["street", "postal_code", "locality", "region", "country"];
const geoKey = (values) => GEOGRAPHY.map((k) => String(values[k] ?? "").trim().toLowerCase()).join("|");
const addressField = (row, key) => row.querySelector(`[data-k="${key}"]`);
function setAddressNote(row, text) {
  const note = row.querySelector("[data-address-note]");
  if (note) note.textContent = text;
}
function refreshAddressPreview(row) {
  const parts = ["extended", "street"].map((k) => addressField(row, k)?.value.trim());
  const city = [addressField(row, "postal_code")?.value.trim(), addressField(row, "locality")?.value.trim()].filter(Boolean).join(" ");
  const text = [...parts, city, addressField(row, "region")?.value.trim(), addressField(row, "country")?.value.trim()].filter(Boolean).join(", ");
  const preview = row.querySelector("[data-address-preview]");
  if (preview) {
    preview.textContent = text;
    preview.hidden = !text;
  }
}
let addressSearchInfo = null;
const addressRetry = new WeakMap();
COMBO_SOURCES.address = {
  minLength: 3,
  debounce: 300,
  get loading() {
    return t("Searching…");
  },
  async search(input, q, current) {
    const data = await api("/address-search", "POST", { q }).catch(() => null);
    if (!current()) return;
    if (!data) return comboMessage(input, t("Address search is not available right now. You can enter the address by hand."));
    if (data.availability === "busy" && !addressRetry.get(input)) {
      addressRetry.set(input, true);
      return setTimeout(() => current() && comboRun(input, 0), 500);
    }
    addressRetry.delete(input);
    const reason = { consent_required: t("Address search is off."), atlas_offline: t("Atlas's online maps are off, so address search is not available."), offline: t("The address service did not answer. You can enter the address by hand."), busy: t("Address search is busy. Keep typing, or enter the address by hand.") }[data.availability];
    if (data.availability !== "available") return comboMessage(input, reason || t("Address search is not available right now. You can enter the address by hand."));
    if (!data.items.length) return comboMessage(input, t("No address matches. Check the spelling, or enter it by hand."));
    comboShow(input, data.items.map((item) => ({ primary: item.label, secondary: item.detail, item })), data.attribution || "");
  },
  pick(input, option) {
    const row = input.closest("[data-row]");
    const item = option.item;
    row.dataset.applyingAddress = "1";
    for (const [k, value] of Object.entries({ street: item.street, postal_code: item.postal_code, locality: item.locality, region: item.region, country: item.country })) {
      const field = addressField(row, k);
      if (field) field.value = value || ""; // nothing the provider did not supply is invented
    }
    addressField(row, "formatted").value = "";
    addressField(row, "latitude").value = item.latitude;
    addressField(row, "longitude").value = item.longitude;
    addressField(row, "geo_precision").value = item.precision || "";
    addressField(row, "geo_key").value = geoKey({ street: item.street, postal_code: item.postal_code, locality: item.locality, region: item.region, country: item.country });
    delete row.dataset.applyingAddress;
    input.value = "";
    refreshAddressPreview(row);
    setAddressNote(row, item.precision === "house" ? t("Located at this building.") : t("Located approximately. Check the details below."));
    row.querySelector(".addr-details").open = true;
    updateContactStatus();
    addressField(row, "street").dispatchEvent(new Event("change", { bubbles: true }));
  },
};
/* A corrected address must not keep the coordinates of the one that was chosen. */
document.addEventListener("input", (event) => {
  const field = event.target.closest?.('#panel [data-row] input[data-k], #panel [data-row] select[data-k]');
  const row = field?.closest("[data-row]");
  if (!row || !addressField(row, "geo_key") || row.dataset.applyingAddress) return;
  refreshAddressPreview(row);
  // An imported one-line address is shown in place of the fields, so it must not outlive a correction.
  if ([...GEOGRAPHY, "extended", "po_box"].includes(field.dataset.k)) addressField(row, "formatted").value = "";
  if (GEOGRAPHY.includes(field.dataset.k)) {
    if (addressField(row, "latitude").value) {
      for (const k of ["latitude", "longitude", "geo_precision", "geo_key"]) addressField(row, k).value = "";
      setAddressNote(row, t("The address changed, so its map position was removed. Atlas can locate it again."));
    }
  }
});
async function refreshAddressSearch() {
  const box = $("#address-search-status");
  if (!box) return;
  addressSearchInfo = await api("/address-search/status").catch(() => ({ consent: false, availability: "unavailable" }));
  const info = addressSearchInfo;
  const ready = info.consent && info.availability === "available";
  $$("[data-address-search]").forEach((el) => (el.hidden = !ready));
  // With no search available, the manual fields are the form.
  $$("#panel .addr-details").forEach((el) => {
    if (!ready) el.open = true;
  });
  const openAtlas = (state.context.applications || []).some((a) => a.id === "atlas") ? `<button class="ae-btn ae-btn--sm" data-act="open-module" data-module="atlas" data-path="/settings">${esc(t("Open Atlas settings"))}</button>` : "";
  if (!info.consent) {
    box.innerHTML = `<div class="address-consent"><p><strong>${esc(t("Find real addresses as you type?"))}</strong> ${esc(t("What you type in the search box is sent through Atlas to {provider}. Names and other contact details are never sent. You can always enter an address by hand instead.", { provider: info.provider || t("a map search service") }))}</p><button class="ae-btn ae-btn--sm ae-btn--primary" data-act="address-search-consent" data-enabled="1">${esc(t("Turn on address search"))}</button></div>`;
  } else if (info.availability === "atlas_offline") {
    box.innerHTML = `<div class="address-consent"><p>${esc(t("Address search uses Atlas's online maps, which are off."))}</p>${openAtlas}</div>`;
  } else if (info.availability !== "available") {
    box.innerHTML = `<div class="address-consent"><p>${esc(t("Address search is not available right now. You can enter the address by hand."))}</p></div>`;
  } else {
    box.innerHTML = `<p class="ae-hint address-attribution">${esc(t("Address search sends what you type to {provider}.", { provider: info.provider }))} ${esc(info.attribution || "")} <button class="link" data-act="address-search-consent" data-enabled="0">${esc(t("Turn off"))}</button></p>`;
  }
}
