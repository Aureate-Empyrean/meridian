# Meridian

The Aureate Empyrean module for People, Organizations and Groups: profiles, what you know about
them, how they relate, a graph of the network, and a timeline of how it changed. Ecosystem scope and
the long-term model are in
[`architecture/modules/meridian.md`](../architecture/modules/meridian.md); this file says what exists.

## Module facts

| | |
| --- | --- |
| Module ID, version | `meridian`, 0.12.0 (schema 8) in this source and on aetest; 0.10.0 in production |
| Port | 17333 |
| Nexus range | `>=0.1.8,<0.2.0` (0.6.1 tested on Nexus 0.1.13 on aetest; production runs 0.1.14, which supports every contract used) |
| Capabilities | `ui.application`, `storage.data`, `projections.read`, `references.create`, and since 0.6.0 `events.publish`, `references.read`, `references.resolve` |
| Resources | `person`, `organization`, `group` (resolvable), Entity References v2 with enumeration; outgoing `meridian.representative-image` edges to Argus photos (readers `argus`); resolve scopes `chronos`/`event`, `mnemosyne`/`note`, `task`, `project`, `collection` (to name the items that link here) |
| Projections | Reads `argus`/`photo-library`, `argus`/`photo-renditions` and, since 0.12.0, `atlas`/`address-suggest`; provides `dated-items` (birthdays, anniversaries) and `people-directory` (names only) |
| Events | Produces `meridian.dated-items.changed` (a hint after person writes) |
| Backup | Backup v1, format `meridian-sqlite`; a backup is restorable by `>=<its version>,<1` |
| Runtime | Python 3.13, FastAPI, SQLite; d3-force vendored in the page; no external services |

| Variable | Set by | Meaning |
| --- | --- | --- |
| `MODULE_PORT` | Nexus broker | Listen port (default 17333) |
| `NEXUS_RESOLVER_KEY` | Nexus broker | Authenticates the gateway and protocol calls. Without it, `/api/` refuses access |
| `MERIDIAN_DATA` | Development only | Data directory (default `/data`) |

### Where it runs

| Installation | Version | Notes |
| --- | --- | --- |
| This source tree | 0.10.0 | Adds the `contact-addresses` projection for Atlas ([record](../VALIDATION_ATLAS_MARKERS_AETEST_2026-11-09.md)); roadmap Phase 3, the backlinks standard and Place links ([record](../VALIDATION_PHASE4_AETEST_2026-11-09.md)) |
| Local `aetest` (`http://localhost:12334`) | **0.10.0** (schema 7) | Updated through Nexus with verified backups (0.5.0 → 0.5.1 → 0.6.0 → 0.6.1). Inside the real Nexus: 0.5 UX journey 83/83, Phase 2 cross-module journey, navigation 17/17, pictures 12/12 ([Phase 2 record](../VALIDATION_PHASE2_AETEST_2026-11-07.md), [Phase 1](../VALIDATION_PHASE1_AETEST_2026-11-07.md), [0.5.0](../VALIDATION_MERIDIAN_0.5.0_AETEST_2026-11-07.md)). Test data |
| Production Nexus | **0.10.0** | Deployed and service-verified 2026-11-09 ([record](../DEPLOYMENT_ATLAS_MERIDIAN_EXODUS_2026-11-09.md)); schema 7, existing data preserved. 0.6.1 deployed 2026-11-07 (schema 5 → 6, data preserved; [record](../DEPLOYMENT_PHASE2_EXODUS_2026-11-07.md)); owner browser checks outstanding. 0.4.0 deployed 2026-11-07 with data preserved ([record](../DEPLOYMENT_MERIDIAN_ARGUS_2026-11-07.md)); 0.4.1 (navigation adapter) deployed the same day on Nexus 0.1.11 ([record](../DEPLOYMENT_NAVIGATION_2026-11-07.md)). Owner confirmed Mouse 4 / Back in production; the picture UI and other navigation scenarios are not verified there |

## Status

The owner approved Milestone 1 and UI stages A.2 and B. No recorded approval exists for Milestone 2,
the Celestial Graph or Milestone 3, whose last status was "awaiting visual review".

### Implemented and tested

Automated (0.7.0, 2026-11-09): 179 Python tests; earlier (0.6.1, 2026-11-07): Node helper and route tests, 16 Chromium graph tests (last run
for 0.5.0), and the browser journeys listed under Develop and test. Browser QA ran in the real Nexus iframe when
each milestone was delivered.

- **People, Organizations, Groups:** names, contacts, addresses, dates, work, accounts, facts, notes;
  `@me`; Trash, restore and purge with tombstones; directory with search, filters and sorting.
- **vCard import** with preview, duplicate review and import history.
- **Relationships:** one record per relationship, inverse wording derived, custom types, context, states,
  partial dates, confidence, multi-source provenance. [docs/RELATIONSHIPS.md](docs/RELATIONSHIPS.md)
- **Group membership** and **work records** as temporal records.
- **Celestial Graph:** whole and local graph, filters, keyboard, drag physics, and arrows that follow the
  shown wording. [docs/DESIGN.md](docs/DESIGN.md) § 22
- **Timeline:** a projection of those records plus native events with partial dates, on its own screen and
  on each profile. [docs/TIMELINE.md](docs/TIMELINE.md)
- Backup v1, name resolution for `person`, `organization` and `group`, gateway protection.

### Implemented but unverified

- A full restore of a real backup through Nexus for 0.3.x. Backup creation ran on production; the
  round trip is covered only by automated tests in the test client.
- The 0.3.1 arrow fix was checked in the browser at 1440 px only.

### Pictures (0.4.0)

People, Organizations and Groups can have a picture: an Argus photo plus a square crop chosen in
Meridian (click the large avatar on a profile). Meridian stores only the photo ID and the crop
(schema 5); Argus renders the image through the `photo-renditions` projection, and every avatar falls
back to initials when there is no picture or Argus cannot provide it. Meridian registers
`meridian.representative-image` references shared with Argus and enumerates them at
`/empyrean/v1/references/outgoing`. Organizations and Groups are now resolvable by other modules.
Status and verification: [`../argus/docs/STATUS.md`](../argus/docs/STATUS.md). Browser journey:
`tests/e2e/pictures_e2e.py` (aetest only).

### Navigation (0.11.0 on aetest)

Back/Forward and deep links through Nexus navigation history: `frontend/navigation.js` is the route adapter
(routes `/`, `/people[/<id>]`, `/organizations[/<id>]`, `/groups[/<id>]`, `/interactions/<id>`, `/graph`, `/timeline`,
`/import`, `/trash`, `/settings`). An unknown address is an explicit not-found page. An Interaction link selects that
Interaction on its first remaining participant's profile. Search, filters, loaded count, tab and scroll are private
per-entry state.

Unsaved side-panel edits are protected everywhere: a click asks first; Back/Forward moves the address and keeps the
editor and a notice, without touching history; leaving Meridian or reloading keeps an acknowledged draft, offered in a
tray. A recovered contact draft that meets a newer saved record is refused as a conflict, with **Keep my version**.
Nexus owns the browser URL; see `../empyrean-nexus/docs/navigation-history.md`.

### Address search and reuse of records (0.12.0 on aetest)

The address editor can find real addresses as you type, after you turn it on there and Atlas's online maps are on. Only the search text leaves, through Atlas to Photon; Meridian itself has no network access. Choosing a result fills the structured fields. Every field stays editable by hand, and a corrected address loses its map position. Work, education and New Organization find existing Organizations; Membership finds or creates groups. Similar names are never merged. Design: [ADR 0031](../architecture/decisions/0031-address-suggestions-through-atlas.md). Browser journey: `tests/e2e/qol_e2e.cjs` (aetest only). Larger requests: [audit](../architecture/audits/2026-11-09-meridian-contact-editing-qol-audit.md).

### Education, Interests and Interactions (0.7.0; 0.9.0 on aetest)

Education and Interests are sections of the contact editor. Interactions are entered from a profile, stored once and
shown for every participant; they may link any accessible Chronos event, Mnemosyne note or task, or Atlas Place found by search. Each link is shared with the linked item's module (backlinks standard).
All three reach the Timeline as projections (Interests only when their period is known). Design and results:
[validation record](../VALIDATION_PHASE3_AETEST_2026-11-09.md). Browser checks: `tests/e2e/records_e2e.cjs` (harness, or the real aetest Nexus with
`NEXUS_URL`) and `tests/e2e/records_links_e2e.cjs` (aetest only).

### Planned

What remains is listed in
[`architecture/modules/meridian.md`](../architecture/modules/meridian.md#implementation-status).

### Unified contact editor (0.6.0; in production with 0.6.1)

The side panel edits a contact's sections as tabs in one session: switching tabs keeps every draft (including
incomplete input), one Save sends all changed sections atomically, and a save based on an outdated contact is refused
with "This contact changed in another session" (an `edit_revision` token; HTTP 409) while the edits stay in the
panel. Closing with unsaved edits asks "Save your changes?" (Continue editing / Discard / Save). Rules:
`docs/DESIGN.md` (contact tabs). Tests: `tests/test_contact_editing.py`, `tests/e2e/contact_editing_e2e.cjs`.
Relationships keep their own editor.

### People and dates for other modules (0.6.0; in production with 0.6.1)

Roadmap Phase 2 (owner decisions D4–D6), with Chronos 0.2.0 and Mnemosyne 1.3.0:

- **`dated-items`:** birthdays and anniversaries as yearly all-day dates (no invented years, nothing after a recorded
  death, 29 February on 28 February in common years). Chronos shows them only after you turn the source on.
  Person writes announce `meridian.dated-items.changed`.
- **`people-directory`:** a names-only search of live People (with `@me`) for pickers in Chronos and Mnemosyne.
  Nothing else about a person leaves Meridian this way.
- **Linked from other modules:** a profile lists the Chronos events and Mnemosyne notes, tasks and projects that link
  the person and share the link with Meridian, with their owners' current titles. Meridian stores none of them.
- Manifest: provides both projections; new capabilities `events.publish`, `references.read`, `references.resolve`
  (resolve scopes `chronos`/`event`, `mnemosyne`/`note|task|project|collection`), approved at the aetest update.
- Code: `backend/meridian/shared.py`; tests `tests/test_shared.py`; browser journey across the three modules
  `tests/e2e/phase2_e2e.cjs` (aetest only, run once per installation).

### Approved UX improvements (0.5.x; in production with 0.6.1)

The seven improvements the owner approved on 2026-11-07
([requirements](../architecture/modules/meridian.md#approved-ux-improvements-2026-11-07)) are
implemented in 0.5.0 and carried in 0.6.1, tested automatically, in a browser against a local harness and inside
the real Nexus on aetest ([record](../VALIDATION_MERIDIAN_0.5.0_AETEST_2026-11-07.md)). They reached production with
0.6.1 on 2026-11-07, which migrated schema 5 → 6 there ([record](../DEPLOYMENT_PHASE2_EXODUS_2026-11-07.md)).

1. **Parent/child dates and adoption:** a new parent relationship suggests the child's birth date
   as Since (editable, precision kept, never Until, never for adoptive or step parenthood, never
   over a date the user typed). Kinship origin (`biological`, `adoptive`, `step`) is stored on the
   record; older records stay "not specified".
2. **Sibling suggestions:** after a parent relationship is saved, one dialog proposes full,
   half, uncertain or adoptive siblinghood from the parents actually recorded; nothing is created
   without an answer, duplicates are skipped, a vaguer recorded classification can be updated on
   confirmation. Shown as "Sibling of", kinship in the details.
3. **Relationship selector:** category headings and options are readable in the dark theme
   (native `<select>` kept).
4. **`@me` in person pickers and searches**, resolving the existing self Person; a clear message
   when no one is marked.
5. **Settings → People:** independent sorting (first or last name first) and display ("First Last"
   or "Last, First"), Slovak collation, sorted before pagination; existing installations keep
   family-first sorting until changed, new ones sort by first name.
6. **Ongoing relationships when another begins:** "Still going on?" lists them with end / keep all /
   cancel and an editable or unknown transition date; the ending and the new record are saved in
   one transaction. Kinship is never ended; the graph hides superseded history under "All".
7. **Timeline:** entries on the same exact date and precision share one date label.

Details: `docs/RELATIONSHIPS.md` § 9a, `docs/TIMELINE.md` § 10a, `docs/DESIGN.md` § 24.

### Known limitations

See `docs/RELATIONSHIPS.md` § 10 and `docs/TIMELINE.md` § 10. In short: memberships have one role; no merging of duplicate entities; provenance rows only for
relationships, memberships and events; layouts and Timeline filters are kept per session; timelines above
8,000 entries are truncated with a notice. Phase 2: only People can be picked by other modules (names only);
"Linked from other modules" is read when a profile opens; Chronos shows Meridian dates only after the source is
turned on, refreshing within seconds of a change (or every 15 minutes); name days and death anniversaries are not
shared. People sorting and display preferences are installation-wide. Leaving Meridian for another module with
unsaved side-panel edits still discards them.

## Develop and test

Tests run in Linux containers; Windows-native pytest is not supported in this workspace. This needs no
prepared image (0.6.1 on 2026-11-07: 163 passed, ruff clean for `backend` and the unit tests):

```bash
docker run --rm -v G:/AureateEmpyrean/meridian:/src -w /src python:3.13-slim sh -c "pip install -q --root-user-action=ignore -r requirements-dev.lock && python -m pytest -q -p no:cacheprovider && ruff check backend tests && ruff format --check backend tests"
```

Graph engine tests and benchmark run in Chromium, using the Playwright installed under `mnemosyne`:

```bash
cd G:/AureateEmpyrean/meridian/tests/perf
PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node graph-tests.cjs
PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node graph-bench.cjs
```

Helpers and the 0.5.0 browser journey (fresh synthetic data in a local harness that stands in for
the Nexus bridge; screenshots in `docs/screenshots/0.5.0/`):

```bash
node tests/ux.test.cjs
node tests/navigation-routes.test.cjs
node tests/relationship-sentences.test.cjs
docker run -d --name meridian-ux-harness -p 127.0.0.1:17399:8000 -v G:/AureateEmpyrean/meridian/tests/e2e:/harness:ro -e PYTHONPATH=/app/backend -e MERIDIAN_DATA=/tmp/h meridian:0.5.0 python /harness/harness.py 8000
PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node tests/e2e/ux_e2e.cjs
docker rm -f meridian-ux-harness
```

`tests/e2e/contact_editing_e2e.cjs` checks the unified contact editor against the harness (port 17401; `PHONE=1`
for 390 px). Inside the real aetest Nexus: `tests/e2e/phase2_e2e.cjs` (cross-module journey; creates synthetic data,
run once per installation) and `tests/e2e/phase2_readonly_check.cjs` (read-only re-check for later releases). The UX journey also runs inside the real Nexus on aetest (never production) with
`NEXUS_URL=http://localhost:12334`; it adds synthetic people, so run it once per installation.
`scripts/db_fingerprint.py` and `scripts/compare_rows.py` compare a database before and after an update.

## Build and deploy

```bash
docker compose build -q
python scripts/manifest.py    # pins manifest.local.json to the built image; re-run after every rebuild
```

If the manifest is not regenerated, Nexus answers 409 on update. Install or update through the normal
Nexus review (`empyrean-nexus/docs/lifecycle-and-recovery.md`). On production, follow
`../DEPLOYMENT_UI_2026-11-03.md`, and only with the owner's explicit authorization. Meridian is already
installed there, so changes are updates: `python -m nexus.manage <manifest> --update`, then
`--update --approve --backup-first`.

Before a schema migration on any installation with data, take an integrity-checked copy of the database.
0.5.0 migrates schema 5 → 6 (additive; `docs/RELATIONSHIPS.md` § 9a "Schema 6 and going back"); 0.6.x adds no
schema. A 0.5/0.6 backup cannot be restored by 0.4.x; roll back with the pre-update backup. The prepared production
release of 0.6.1 (with Chronos 0.2.0 and Mnemosyne 1.3.0) and its rollback are in
[`../DEPLOYMENT_PLAN_PHASE2_EXODUS_2026-11-08.md`](../DEPLOYMENT_PLAN_PHASE2_EXODUS_2026-11-08.md).
`backups/` holds the local aetest copy made before Milestone 3 (test data, schema 3).

## Notes for whoever continues

- The Nexus bridge relays only an error's `detail` string, never a response body. Anything the UI must read
  after a refusal needs its own GET (hence `/api/similar-relationships` and `/api/similar-events`).
- Module requests and responses are capped at 2 MiB, so the graph and Timeline projections are compact.
- The page is self-contained (no network): `frontend/graph.js`, `app.js`, `timeline.js` and the vendored
  library are inlined by `backend/meridian/app.py`. A test checks this.
- The sandbox has no `allow-forms`: a `<form>` submit never fires. Use button handlers.
- In `graph.js`, `this.frame` holds the animation-frame ID.

## Licence

AGPL-3.0-or-later.
