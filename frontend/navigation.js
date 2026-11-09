/* Meridian adapter for the Nexus navigation contract (`empyrean-navigation-v1`, SDK in
   vendor/nexus-navigation.js, kept in sync by empyrean-nexus/scripts/sync-navigation.mjs).
   Nexus owns the browser URL and history; Meridian owns its routes. A route reference is
   only the screen and the entity ID (e.g. `/people/<uuid>`); search text, filters and tabs
   are private per-entry view state, and unsaved edits are draft checkpoints. Neither enters
   the URL. Without a supporting host, Meridian keeps its old in-memory navigation.

   Unsaved edits: a click inside Meridian asks first (go()). Browser Back/Forward cannot be
   cancelled, so while the side panel has unsaved edits the address moves but the screen and
   the editor stay, with a notice; nothing is written to history, so Forward survives. Saving
   or discarding then shows the screen the address names. Leaving Meridian (Nexus launcher,
   backlink, reload) stores an acknowledged draft checkpoint, offered again on return. */

const MeridianRoutes = {
  /** A route reference → Meridian's route. Unknown paths become an explicit not-found route. */
  parse(value) {
    return routeFromPath(String(value || "/").split(/[?#]/, 1)[0]);
  },
  /** Meridian's route → a canonical route reference. */
  serialize(route) {
    if (route.view === "not-found") return route.path;
    if (route.interaction) return `/interactions/${route.interaction}`;
    const address = route.address ? `/addresses/${route.address}` : "";
    if (route.view === "person") return `/people/${route.id}${address}`;
    if (route.view === "entity") return `/${route.kind === "group" ? "groups" : "organizations"}/${route.id}${address}`;
    return route.view === "dashboard" || !route.view ? "/" : `/${route.view}`;
  },
};

let shownRoute = null;
/** The address Back/Forward moved to while the editor stayed open on `shownRoute`. */
let heldRoute = null;
const retainedDrafts = new Map();

const fieldValues = (root) => $$(FORM_FIELDS, root).map((el) => (el.type === "checkbox" || el.type === "radio" ? el.checked : el.value));
function setFields(root, values) {
  $$(FORM_FIELDS, root).forEach((el, i) => {
    if (values[i] === undefined) return;
    if (el.type === "checkbox" || el.type === "radio") el.checked = !!values[i];
    else el.value = values[i];
  });
}
function shellRecordId() {
  if (panel.section === "relationship") return relEditor.record?.id || null;
  if (panel.section === "membership") return memEditor.record?.id || null;
  return evEditor.record?.id || null;
}
/** A JSON copy of the open side panel, or null when there is nothing unsaved to protect. */
function captureDraft() {
  if (!panel.el() || panel.closing || !panel.isDirty()) return null;
  const base = { route: shownRoute, section: panel.section, at: Date.now() };
  if (panel.session) {
    const { person, panes } = panel.session;
    return {
      ...base,
      kind: "contact",
      key: `contact:${person.id}`,
      label: person.display_name,
      personId: person.id,
      revision: person.edit_revision,
      panes: [...panes]
        .filter(([, pane]) => formState(pane.node) !== pane.snapshot)
        .map(([section, pane]) => (section === "notes" ? { section, notes: $("#notes", pane.node).value } : { section, rows: $$("[data-row]", pane.node).map((row) => ({ id: row.dataset.id || "", starter: row.hasAttribute("data-starter"), values: fieldValues(row) })) })),
    };
  }
  const body = $("#panel-body");
  const pickers = {};
  for (const picker of $$(".picker", body)) {
    const hidden = $("[data-picked]", picker);
    if (hidden.value) pickers[picker.id] = { id: hidden.value, kind: hidden.dataset.kind, display_name: hidden.dataset.name };
  }
  const record = shellRecordId();
  const eventLike = panel.section === "event" || panel.section === "interaction";
  return {
    ...base,
    kind: "shell",
    key: `${panel.section}:${record || "new"}:${shownRoute}`,
    label: `${$("#panel-title").textContent} · ${$(".panel-head .eyebrow")?.textContent || ""}`,
    recordId: record,
    values: fieldValues(body),
    pickers,
    sources: $("#src-rows")?.children.length || 0,
    ...(eventLike ? { participants: evEditor.participants } : {}),
    ...(panel.section === "interaction" ? { links: evEditor.links } : {}),
  };
}
function restorePane(pane, saved) {
  if (saved.section === "notes") {
    $("#notes", pane.node).value = saved.notes;
    return;
  }
  const spec = EDITORS[saved.section];
  const holder = $("#editor-rows", pane.node);
  const existing = new Map($$("[data-row]", holder).filter((row) => row.dataset.id).map((row) => [row.dataset.id, row]));
  const blank = () => {
    const box = document.createElement("div");
    box.innerHTML = editorRow(spec, spec.blank());
    return box.firstElementChild;
  };
  holder.replaceChildren(
    ...saved.rows.map((row) => {
      const el = existing.get(row.id) || blank();
      if (row.starter) {
        el.setAttribute("data-starter", "");
        el.dataset.starter = rowState(el);
      } else el.removeAttribute("data-starter");
      setFields(el, row.values);
      return el;
    }),
  );
}
async function reopenDraft(draft) {
  if (draft.kind === "contact") {
    if (state.person?.id !== draft.personId) throw Error("That record is not on screen");
    await openPanel(draft.section, null);
    // The edit was made against this revision: a later change must surface as a conflict.
    panel.session.person.edit_revision = draft.revision;
    panel.session.recovered = true;
    for (const saved of draft.panes) {
      showContactTab(saved.section);
      restorePane(panel.session.panes.get(saved.section), saved);
    }
    showContactTab(draft.section);
    updateContactStatus();
    return;
  }
  let record = null;
  if (draft.section === "relationship") {
    if (draft.recordId && !(record = state.person?.relationships.find((r) => r.id === draft.recordId))) throw Error("That relationship no longer exists");
    await openRelation(record, null);
  } else if (draft.section === "membership") {
    if (draft.recordId && !(record = state.person?.memberships.find((m) => m.id === draft.recordId))) throw Error("That membership no longer exists");
    await openMembership(record, null);
  } else if (draft.section === "event") await openEvent(draft.recordId ? await api(`/events/${draft.recordId}`) : null);
  else if (draft.section === "interaction") await openInteraction(draft.recordId ? await api(`/interactions/${draft.recordId}`) : null);
  else throw Error("This draft cannot be reopened");
  if (draft.participants && $("#ev-people")) {
    evEditor.participants = draft.participants;
    evPeople();
  }
  if (draft.links && $("#ix-links")) {
    evEditor.links = draft.links;
    ixLinks();
  }
  const sources = $("#src-rows");
  while (sources && sources.children.length < draft.sources) sources.insertAdjacentHTML("beforeend", sourceRow(undefined, sources.children.length + (Date.now() % 1000)));
  for (const [id, value] of Object.entries(draft.pickers)) $(`#${CSS.escape(id)}`)?._pick?.(value);
  const body = $("#panel-body");
  setFields(body, draft.values);
  // A relationship's type decides which other fields exist; set them once they do.
  $("#rel-type")?.dispatchEvent(new Event("change", { bubbles: true }));
  setFields(body, draft.values);
  $("#panel-dirty").textContent = t("Unsaved changes");
}

/* ── Draft checkpoints ── */
let lastCheckpointDirty = false;
function checkpointValue() {
  const live = captureDraft();
  const drafts = [...retainedDrafts.values()].filter((d) => d.key !== live?.key);
  if (live) drafts.push(live);
  return { version: 1, dirty: drafts.length > 0, drafts };
}
/** Store the drafts in Nexus's tab storage. Rejects when they could not be stored. */
function checkpointNow() {
  if (!meridianNavigation.enabled) return Promise.resolve();
  const value = checkpointValue();
  if (!value.dirty && !lastCheckpointDirty) return Promise.resolve();
  return meridianNavigation.checkpoint(value).then(() => {
    lastCheckpointDirty = value.dirty;
  });
}
let checkpointTimer;
function scheduleCheckpoint() {
  clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => checkpointNow().catch((error) => toast(error.message, "danger")), 400);
}
document.addEventListener("input", (event) => event.target.closest("#panel") && scheduleCheckpoint());
document.addEventListener("change", (event) => event.target.closest("#panel") && scheduleCheckpoint());

function renderDraftTray() {
  let tray = $("#draft-tray");
  if (!retainedDrafts.size) return tray?.remove();
  if (!tray) {
    tray = document.createElement("div");
    tray.id = "draft-tray";
    tray.className = "draft-tray ae-glass";
    tray.setAttribute("role", "status");
    document.body.append(tray);
  }
  tray.replaceChildren(
    ...[...retainedDrafts.values()].map((draft) => {
      const row = document.createElement("div");
      row.className = "draft-tray-row";
      row.innerHTML = `<span class="grow">${esc(t("Unsaved edits are kept in this tab: {label}", { label: draft.label }))}</span><button class="ae-btn ae-btn--sm ae-btn--primary" data-draft="resume">${esc(t("Resume editing"))}</button><button class="ae-btn ae-btn--sm ae-btn--quiet" data-draft="discard">${esc(t("Discard"))}</button>`;
      $('[data-draft="resume"]', row).onclick = () => resumeDraft(draft.key);
      $('[data-draft="discard"]', row).onclick = () => {
        retainedDrafts.delete(draft.key);
        renderDraftTray();
        checkpointNow().catch((error) => toast(error.message, "danger"));
      };
      return row;
    }),
  );
}
async function resumeDraft(key) {
  const draft = retainedDrafts.get(key);
  if (!draft) return;
  if (panel.isDirty() && !(await confirmDiscard())) return;
  if (panel.el()) await closePanel();
  try {
    if (draft.route !== shownRoute) await queueNavigation(draft.route, "push");
    await reopenDraft(draft);
  } catch (error) {
    toast(t("This draft could not be reopened. It stays available here."), "danger");
    return;
  }
  retainedDrafts.delete(key);
  renderDraftTray();
  scheduleCheckpoint();
}

/* ── Browser traversal while the editor is open ── */
function renderHoldNotice() {
  const el = panel.el();
  if (!el) return;
  let notice = $("#panel-hold", el);
  if (!heldRoute) return notice?.remove();
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "panel-hold";
    notice.className = "panel-hold";
    notice.setAttribute("role", "status");
    notice.innerHTML = `<p>${esc(t("The browser moved to another page. Your unsaved edits stay here until you save or discard them, or use Back and Forward to return."))}</p><button class="ae-btn ae-btn--sm" id="panel-hold-discard">${esc(t("Discard and continue"))}</button>`;
    $("#panel-body", el).before(notice);
    $("#panel-hold-discard", notice).onclick = () => closePanel();
  }
}
/** The address the screen should follow once the editor is out of the way. */
function navigationHeld() {
  return !!heldRoute;
}
function navigationPanelClosed() {
  scheduleCheckpoint();
  if (!heldRoute || panel.isDirty()) return;
  const { reference, route } = heldRoute;
  heldRoute = null;
  shownRoute = reference;
  showRoute(route);
}
/** A recovered draft met a newer saved version: the owner may keep theirs on top of it. */
function offerDraftOverride(box) {
  const session = panel.session;
  if (!session?.recovered) return;
  const button = document.createElement("button");
  button.className = "ae-btn ae-btn--sm";
  button.textContent = t("Keep my version");
  button.onclick = async () => {
    try {
      session.person = await api(entityApi(session.person));
      box.hidden = true;
      $("#panel-dirty").textContent = t("Your edits will replace the newer saved version when you save.");
    } catch (error) {
      toast(error.message, "danger");
    }
  };
  box.append(" ", button);
}

function captureView() {
  if (heldRoute || !state.route) return null;
  const p = state.people;
  return {
    scroll: scrollPos(),
    tab: state.tab,
    ...(state.route.view === "people" ? { people: { q: p.q, has: [...p.has], sort: p.sort, limit: p.limit } } : {}),
  };
}
function restoreView(view) {
  if (view?.people) {
    Object.assign(state.people, { q: view.people.q, has: new Set(view.people.has), sort: view.people.sort, restoreLimit: view.people.limit });
    state.people.scroll = 0;
  }
  return view ? { tab: view.tab, scroll: view.scroll } : {};
}

const meridianNavigation = EmpyreanNavigation.createClient({
  async apply(value, message) {
    const next = MeridianRoutes.parse(value);
    const reference = MeridianRoutes.serialize(next);
    if (message.checkpoint?.version === 1) {
      for (const draft of message.checkpoint.drafts || []) retainedDrafts.set(draft.key, draft);
      lastCheckpointDirty = !!message.checkpoint.dirty;
      renderDraftTray();
    }
    // Already on screen: our own commit, a failed leave resuming, or a return to the editor's page.
    if (reference === shownRoute) {
      if (heldRoute) {
        heldRoute = null;
        renderHoldNotice();
      }
      return;
    }
    if (shownRoute && panel.isDirty()) {
      heldRoute = { reference, route: next };
      renderHoldNotice();
      return;
    }
    if (!message.isCurrent()) return;
    heldRoute = null;
    const previous = shownRoute;
    shownRoute = reference;
    leaveView();
    const outcome = await showRoute(next, { focus: message.cause !== "initial", isCurrent: message.isCurrent, ...restoreView(message.viewState) });
    // Superseded while loading: the next restore must show its page. An editor opened meanwhile
    // still belongs to the page that was on screen.
    if (!message.isCurrent() && shownRoute === reference) shownRoute = panel.isDirty() ? previous : null;
    return outcome;
  },
  beforeLeave: checkpointNow,
  captureView,
  onError(error) {
    toast(error.message, "danger");
  },
});

/** One navigation intent at a time (the SDK refuses a second pending one): later moves wait
 *  for earlier ones instead of being dropped. */
let navigationQueue = Promise.resolve();
function queueNavigation(reference, mode) {
  const next = navigationQueue.catch(() => {}).then(() => meridianNavigation.navigate(reference, mode));
  navigationQueue = next;
  return next;
}
