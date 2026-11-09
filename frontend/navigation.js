/* Meridian adapter for the Nexus navigation contract (`empyrean-navigation-v1`, SDK in
   vendor/nexus-navigation.js, kept in sync by empyrean-nexus/scripts/sync-navigation.mjs).
   Nexus owns the browser URL and history; Meridian owns its routes. A route reference is
   only the screen and the entity ID (e.g. `/people/<uuid>`); tabs, filters, search text and
   unsaved edits never go into the URL. Without a supporting host, Meridian keeps its old
   in-memory navigation. */

const MeridianRoutes = {
  /** A route reference → Meridian's route. Unknown paths fall back to the Dashboard. */
  parse(value) {
    return routeFromPath(String(value || "/").split(/[?#]/, 1)[0]);
  },
  /** Meridian's route → a canonical route reference. */
  serialize(route) {
    if (route.view === "person") return `/people/${route.id}`;
    if (route.view === "entity") return `/${route.kind === "group" ? "groups" : "organizations"}/${route.id}`;
    return route.view === "dashboard" || !route.view ? "/" : `/${route.view}`;
  },
};

let shownRoute = null;
const meridianNavigation = EmpyreanNavigation.createClient({
  async apply(value, message) {
    const next = MeridianRoutes.parse(value);
    const reference = MeridianRoutes.serialize(next);
    // Our own commit of what is already on screen (initial canonicalization): nothing to do.
    if (message.cause === "commit" && reference === shownRoute) return;
    // Back/Forward cannot be cancelled. Unsaved side-panel edits are never dropped silently:
    // if the owner keeps them, Meridian returns to the screen they belong to.
    if (shownRoute && reference !== shownRoute && panel.isDirty()) {
      const previous = shownRoute;
      if (!(await confirmDiscard())) {
        if (message.isCurrent()) setTimeout(() => queueNavigation(previous, "push").catch(() => {}), 0);
        return;
      }
    }
    if (!message.isCurrent()) return;
    shownRoute = reference;
    leaveView();
    await showRoute(next, { focus: message.cause !== "initial" });
  },
  // No `beforeLeave`: Nexus asks it before every route change (Back inside Meridian too) and
  // waits only seconds, so it must not ask questions. Back/Forward inside Meridian is guarded in
  // `apply`; leaving Meridian with unsaved side-panel edits discards them, as before.
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
