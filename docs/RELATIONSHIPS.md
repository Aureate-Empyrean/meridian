# Meridian — relationships, Organizations, Groups and the graph (Milestone 2)

This implements the relationship parts of the V1 boundary in
[`architecture/modules/meridian.md`](../../architecture/modules/meridian.md):
- relationships between People, Organizations and Groups, with temporal validity;
- many-to-many temporal Group membership;
- multi-source provenance;
- a graph view derived from those records.

It follows the architecture's established decisions and fills in one of its Open questions,
the inverse-relationship mechanism (see § 2). The UI conventions are in
[`DESIGN.md`](DESIGN.md) §§ 19–21.

Code: `backend/meridian/relations.py` (domain), `backend/meridian/db.py` (migrations 2–3),
`backend/meridian/app.py` (API), `frontend/graph.js` (graph engine), `frontend/app.js`
(views and editors), `frontend/vendor/d3-force.bundle.js` (layout library).

---

## 1. Data model

Migration 2 adds four tables. Migration 3 gives Organizations created by Milestone 1 work
records a name record, so their names can be shown and edited.

| Table | One row is | Key columns |
| --- | --- | --- |
| `relationships` | one authoritative relationship | `subject_id`, `object_id` (entities), `type` (type key), `context`, `state` (`current` / `former` / `unknown`), `valid_from`, `valid_until` (partial dates), `confidence`, `note`, timestamps |
| `relationship_types` | a user-defined type | `id` (`c-<uuid>`), `category`, `label`, `inverse_label`, `symmetric` |
| `memberships` | one Group membership | `group_id`, `member_id`, `role`, `state`, `valid_from`, `valid_until`, `confidence`, `note` |
| `provenance` | one source of a record | `record_kind` (`relationship` / `membership`), `record_id`, `kind` (`observed`, `told`, `document`, `imported`, `other`; open), `entity_id` (e.g. the Person who told you), `label`, `learned` (partial date) |

**Constraints:**
- A relationship cannot connect an entity to itself (`CHECK(subject_id <> object_id)`).
- Deleting an entity permanently cascades to its relationships and memberships, and
  triggers remove their provenance rows.
- Moving an entity to Trash keeps its relationships. They are hidden from the graph and
  return on restore.

---

## 2. Direction and inverse semantics

A relationship is stored **once**, as *subject — type — object*.
- **Direction:** each type has a `label`, read subject → object ("parent of"), and an
  `inverse`, read object → subject ("child of"). On a profile, the record is read from that
  entity's side: Peter's profile shows "Parent of · Jana", Jana's shows "Child of · Peter".
  It is the same record (`id`). There is never a second, diverging fact.
- **Symmetric types:** for these ("friend of", "married to") `label == inverse`, and the
  direction carries no meaning.
- **Context labels:** `context` holds a human label for one relationship ("best friend",
  "maternal grandmother") without creating a global type.
- **Built-in types** live in code (`relations.BUILTIN`), grouped by category:

  | Category | Types |
  | --- | --- |
  | Family | parent/child, sibling, grandparent/grandchild, aunt-or-uncle/niece-or-nephew, cousin, guardian, relative |
  | Partners | partner, married to, engaged to, dating |
  | Friends and social | friend, knows, classmate, roommate, neighbor |
  | Professional | colleague, manager/reports to, mentor, teacher/student, client, business partner |
  | Organization affiliation | founder, owner, board member, member, volunteer, studies at, teaches at, contractor, customer, affiliated with |
  | Organization structure | subsidiary/parent company, part of/includes, branch, successor/predecessor, acquired by, partners with |

- **Which kinds a type joins:** each type lists the entity kinds allowed on each side; for
  example, "subsidiary of" is Organization → Organization. Custom types may join any
  kinds.
- **Custom types:** a user-defined type is created from the editor ("Something else…")
  and stored in `relationship_types`, so new vocabulary needs no migration. Asking for an
  existing label and inverse returns that type instead of a duplicate.
- **Former relationships:** "former partner" is not a type. It is a partnership whose
  `state` is `former`.
- **Employment is deliberately not a relationship type.** The Work record (Milestone 1's
  `employments`) is authoritative for work. The graph shows it as its own "works at" edge,
  and an Organization lists "People at work here" from it. There is one authority, not two.

---

## 3. Organizations and Groups

- **Records:** both are `entities` with the same structured records as people where they
  make sense: names and aliases (`full`, `alias`, `abbreviation`, …), contact points,
  addresses, accounts, dates, details and notes ("About"). Work records belong to people,
  and `EntityDoc` refuses them for these kinds.
- **API:** `GET/POST /api/entities`, `GET/PUT/DELETE /api/entities/{id}`,
  `POST /api/entities/{id}/restore`. Trash and permanent deletion cover every kind.
- **Organizations** take part in relationships with people and with other organizations
  (affiliation and structure). Their people at work come from work records; a work record
  keeps `organization_id`, so renaming the Organization keeps the link.
- **Groups are not Organizations.** Membership is its own record, many-to-many and
  temporal. **Sharing a Group never creates or implies a relationship**: Alice and Bob in
  the same gym group have no edge between them unless one is recorded, and tests assert
  this. Members are People or Organizations; a Group cannot be a member. A Group can still
  have relationships, such as "affiliated with" or custom ones.

---

## 4. Temporal behaviour

- **Periods:** `valid_from` and `valid_until` are partial dates (`YYYY`, `YYYY-MM`,
  `YYYY-MM-DD`). A period must not end before it starts, compared at the shared precision.
  Month-day-only values (`--MM-DD`) are refused for periods.
- **State:** `current`, `former` or `unknown`. An end date that has passed turns a current
  relationship into a former one. **Nothing is deleted when a relationship ends.**
  Profiles and the graph show it under History, dashed in the graph.
- **"End it" vs "Remove":**
  - "End it" sets the state to former with an end date. Use it for a real relationship
    that is over.
  - "Remove" deletes a record made by mistake. Its confirmation explains the difference.
- **Timeline compatibility:** the future Timeline view can read relationships, memberships
  and work records directly, from their periods and states, with no timeline copies. A
  relationship's start and end become "began"/"ended" moments of the same record,
  following the architecture's "the timeline is a derived view" rule.

---

## 5. Provenance and confidence

- **Sources:** each relationship or membership has zero or more sources (`provenance`
  rows). A source is one of:
  - observed it myself;
  - told by someone (optionally linked to a Person);
  - a document or record;
  - imported;
  - other.

  Each can carry a label and the date it was learned.
- **Confidence** stays a separate word scale (`unknown`, `low`, `medium`, `high`, or not
  stated), with no numbers. Low confidence is shown as "Uncertain" on the profile and
  dotted in the graph, so a doubtful claim never looks like an established fact.
- **No automatic deduplication:**
  - Before saving, the editor asks `GET /api/similar-relationships`: same type, same pair,
    either direction for symmetric types.
  - If something similar exists, the user sees it and may still save, for example a later
    period or a contradicting account. The server refuses an unconfirmed duplicate
    (`409`) as a safety net.
  - Contradictory claims are kept side by side.

---

## 6. Graph projection

`GET /api/graph` builds the graph on every request from the authoritative tables. There is
no separate graph store to keep in sync, and nothing is inferred.

- **Nodes:** every entity not in Trash, as `[id, kind ("p"/"o"/"g"), label, is_self]`.
- **Edges:** every stored relationship, membership (member → group) and work record
  (person → organization) whose ends are both present, as
  `[subjectIndex, objectIndex, record ("r"/"m"/"e"), typeIndex, state (0/1/2), confidence (0–4)]`.
  Edges refer to node indexes, so the payload stays small.
- **Types:** the descriptions of the types used (`key`, `category`, `label`, `inverse`,
  `symmetric`).
- **Caps:** 20,000 nodes and 60,000 edges, with `truncated` set beyond that, to stay
  within Nexus's 2 MiB response limit.
- **Edge details:** names, contexts, sources and notes are not in the projection. Selecting
  an edge fetches its records from `GET /api/connections?a=&b=`, which returns all
  relationships, memberships and work records between the two entities.

Measured (`tests/test_relationships.py::test_graph_projection_scales`): 2,000 entities and
6,000 connections project in **36 ms** as **252 KB**.

---

## 7. Rendering approach

| Option | Why not, or why |
| --- | --- |
| DOM/SVG nodes | thousands of elements; slow layout and paint at the sizes required |
| Cytoscape.js | capable, but a large dependency with its own styling model |
| Sigma.js + graphology (WebGL) | fastest for very large graphs, but two libraries and a WebGL renderer to theme, for a scale beyond Meridian's needs |
| **d3-force + our own Canvas 2D renderer** | **chosen**: the established force layout (Barnes-Hut many-body, links, collision), ISC-licensed, 17 KB with d3-dispatch, d3-quadtree and d3-timer; rendering stays fully in Meridian's design language |

The library is vendored unmodified in `frontend/vendor/` with its licence, because the
module page is self-contained and the sandboxed frame has no network.

`frontend/graph.js` (`MeridianGraph.Engine`) handles:
- **Settling:** the first layout advances in time-boxed slices each frame. It gets 8 ms
  while you interact and 26 ms when idle. It stops once settled, so the graph does not keep
  drifting. Large graphs use fewer iterations, and no collision pass above 3,000 nodes.
- **Dragging:** live, one tick per frame. On release the dropped node stays pinned while the
  network cools on a time-based exponential schedule (1–3 s by disturbance), then the
  simulation stops. Batched ticks are never used here: in a small graph they would finish
  the whole cool-down within one frame, so the graph would appear to freeze.
- **Remembered layout:** positions are kept for the session, so returning from a profile
  shows the same arrangement and camera. New entities start beside a placed neighbour.
- **Drawing (Celestial, see DESIGN.md § 22):** one canvas. Edges are batched into one
  `Path2D` per colour, pattern and focus level; entities are drawn by kind (circle,
  diamond, hollow hexagon) and culled to the viewport. Halos are cached gradient sprites,
  never per-node blur. Above 3,000 visible entities they become plain points.
- **Labels:** drawn in screen space with exact rectangle tests on a 48 px spatial hash,
  within an area-based budget, fading rather than popping. Relationship wording appears
  on the connections in focus.
- **Clusters:** connected components are packed apart on a spiral, each sized by the
  footprint measured for the graph's density, with lone entities in one loose cluster.
- **Several records between one pair** fan out as separate lanes.
- **Direction:** a small chevron on directional connections in focus. It points the way the
  shown wording reads, from the focused entity's side: "Ukážka parent of Vzorko" points to
  Vzorko; with Vzorko selected, "Vzorko child of Ukážka" points to Ukážka. With only a line
  selected, it reads from the subject. `Engine.reads()` decides wording and arrow together
  (since 0.3.1).
- **Edge styles:** relationships arc, memberships and employment are straight spokes;
  ended is dashed, uncertain dotted.
- **Hit testing:** a quadtree for nodes, distance to the curve for edges.
- **Reduced motion:** the layout is computed out of sight, and camera moves are instant.

---

## 8. Performance (measured)

`tests/perf/graph-bench.html` runs the real engine on deterministic synthetic networks:
communities of people with organizations and groups, dense within a community. Run it with:

```
PLAYWRIGHT_PATH=<playwright> node tests/perf/graph-bench.cjs
```

The behaviour of the Celestial engine is guarded by 16 Chromium regression tests on the same
page and the synthetic fixtures in `tests/perf/fixtures.cjs`:

```
PLAYWRIGHT_PATH=<playwright> node tests/perf/graph-tests.cjs
```

They check that the engine stops drawing when idle; that hover, selection and filters never
move the layout; that separate networks never overlap; and that hit targets stay at least
11 px. They also check the panel-aware fit and framing, separately selectable parallel
records, non-overlapping labels, both ends named on a selected connection, arcs versus
spokes, reduced-motion camera moves, gentle sizing, and arrows that follow the shown wording
from either side. With the real mouse, they also
check that a released node lets its network keep moving and settle within 1–3 s without
snapping back, that a small nudge settles sooner than a big drag, and that returning to the
same graph restores it exactly.

Chromium, 1440×900, device pixel ratio 1, this development machine. The Celestial
engine against the Milestone 2 (0.2.0) engine, same benchmark, same session, two or three
runs each:

| Nodes | Edges | Settle (0.2.0 → Celestial) | Full redraw median | Full redraw p95 | Focused redraw | Edge hit test |
| --- | --- | --- | --- | --- | --- | --- |
| 200 | 400 | 0.21–0.24 → 0.21–0.24 s | 0.4 → 0.4–0.5 ms | 0.5 → 0.7–0.8 ms | 0.4–0.5 → 1.3 ms | 0.4 → 0.1–0.2 ms |
| 500 | 1,000 | 0.38 → 0.38–0.41 s | 0.6–0.7 → 0.9 ms | 0.9 → 1.1–1.3 ms | 0.4–0.5 → 1.1–1.4 ms | 0.2 → 0.1–0.3 ms |
| 2,000 | 5,000 | 2.1 → 2.1–2.2 s | 3.9 → 2.5–2.7 ms | 4.3–4.4 → 3.4 ms | 2.8 → 1.7–1.9 ms | 0.9 → 0.2–0.6 ms |
| 5,000 | 12,500 | 6.3 → 5.4–5.5 s | 17.6–18.1 → 10.4–10.7 ms | 20.7–20.8 → 12.9–13.2 ms | 11.7 → 3.2 ms | 1.6 → 0.7–0.9 ms |

Node hit tests stay at 0.001–0.006 ms throughout.

What this means:
- **Small graphs** cost a little more per frame (halos, shapes, label fading), still far
  under 2 ms.
- **2,000 and 5,000 entities** are faster than before: batching, points-only level of
  detail and cheaper labels more than pay for the richer styling. At 5,000, redraws now
  fit the 16.7 ms frame budget (about 75–95 fps), and the first layout takes about 5.5 s.
  The graph is shown and usable while it settles.
- Load matters: a run made while Docker was building took twice as long to settle.

---

## 9. Privacy boundaries

- **Local processing:** the graph is projected by the module and rendered in the browser.
  No external graph services, telemetry, enrichment, scraping or relationship inference.
- **Access:** every relationship, membership, type and graph endpoint is under `/api/`.
  They are reachable only with the Nexus gateway key, and a test asserts 403 without it.
  Nothing is shareable publicly.
- **Logs:** the server runs without an access log (`--no-access-log`), so search terms in
  URLs are not logged. Relationship endpoints carry only identifiers in their URLs anyway.
- **Backups:** these tables are in the same SQLite database, so Nexus backups include them. A
  backup is restorable by its own version and later 0.x versions (`>=<version>,<1`), never by
  an older one.

---

## 9a. Kinship, siblings and relationship transitions (0.5.0)

Implemented in 0.5.0 (schema 6) from the owner-approved requirements in
[`architecture/modules/meridian.md`](../../architecture/modules/meridian.md#approved-ux-improvements-2026-11-07).
Tests: `tests/test_ux.py` (backend), `tests/ux.test.cjs` (helpers), `tests/e2e/ux_e2e.cjs` (browser).

### Kinship origin

`relationships.kinship` records how a parent or sibling relationship came about, on the record
itself, so there is still one `parent` type and one `sibling` type and no duplicate types:

| Type | Values | Shown as |
| --- | --- | --- |
| `parent` | `biological`, `adoptive`, `step` | "Parent of" / "Child of"; *adoptive* or *step-parent* in the row detail |
| `sibling` | `biological_full`, `biological_half`, `biological` (full or half not known), `adoptive`, `step` | "Sibling of"; *full siblings*, *half-siblings*, *siblings through adoption*... in the detail |

- `NULL` means **not recorded**. Every record made before 0.5.0 keeps `NULL`; nothing is
  reinterpreted as biological or adoptive. The form shows it as "Not specified".
- Any other type refuses a kinship value (422).
- A new parent relationship starts with **Biological** selected in the form (visible and
  changeable); a new sibling relationship starts with **Not specified**.
- Biological and adoptive records are separate records and may coexist, even for the same pair.
  The duplicate check (`/api/similar-relationships`, now with `kinship`) treats records with
  different known kinship as different; an unrecorded kinship may be either, so it still counts
  as similar.
- Kinship is permanent: a new relationship never ends a `parent`, `sibling`, `grandparent`,
  `aunt_uncle`, `cousin` or `relative` record (`relations.PERMANENT`). Three operations stay
  distinct (owner decision, 2026-11-07): **ending** a temporal relationship (an end date, kept
  as history); **correcting** a wrong record (edit it, or Remove it); and a change of **contact or
  circumstances** (no contact, estrangement, conflict), which is not represented by ending
  kinship and has no data model in 0.5.0. "End it" remains available on family records; for
  them its notice and the Remove confirmation say that a family tie does not end through
  distance or conflict and that a wrong record should be corrected or removed.

### Start date suggestion (parent/child)

`GET /api/relationship-suggestion?subject_id&object_id&type&kinship` returns the child's birth
date (the object of `parent of`, whichever side the form was opened from) as `valid_from`, at
its stored precision (`1990`, `1990-05`, `1990-05-17`). Nothing is returned for adoptive or step
parenthood (adoption does not begin at birth), for a birthday without a year, or for other types.
An end date is never suggested. The form fills **Since** only while it is empty or still shows
the previous untouched suggestion, explains where the date came from, and withdraws an untouched
suggestion when the kinship becomes adoptive; a date the user typed is never replaced
(`MeridianUX.takeSuggestion`). New records only.

### Sibling suggestions

After a parent relationship is saved, the form asks
`GET /api/sibling-suggestions?relationship=<id>`. For the child of that record it compares the
recorded parents with those of every other child of the same parent (step-parent links are
ignored) — `relations.classify`:

| Recorded parents | Suggestion |
| --- | --- |
| Two shared, both explicitly biological for both children | `biological_full` |
| One shared biological parent, and the other biological parents are confirmed different (two confirmed biological parents each, or an adoptive link) | `biological_half` |
| One shared biological parent, the other parent unknown or not confirmed | `biological` (uncertain; never assumed half) |
| A shared parent who is adoptive for at least one child | `adoptive` (never step, never half) |
| A shared parent whose kinship is not recorded | candidate without classification |

Existing sibling records between the pair decide the action: none → *create*; the same kinship
→ nothing; an unrecorded or vaguer biological record (or a contradicted full/half) → *update*
that record for confirmation; only adoptive or step records → *create* a biological record beside
them. A recorded classification is never downgraded to a vaguer one.

Nothing is written by the suggestion. One dialog lists every candidate with *Yes, they are
siblings*, *Yes, they are half-siblings*, *full or half not known*, *through adoption*, *no
details* and *No, do not create a sibling relationship* (*Keep it as recorded* for updates),
preselecting the evidence. `POST /api/sibling-suggestions/apply` saves the answers in one
transaction: a pair that meanwhile got the same record is skipped, a changed one is a 409 and
nothing is saved. Updates change only `kinship`; dates, notes, context and provenance stay.
Created records carry the source *"Confirmed by you from the parents recorded in Meridian"*.

### Ongoing relationships when another begins

Before a **new** relationship is saved, the form asks
`GET /api/active-relationships?subject_id&object_id&type`: relationships between the two in
either direction that have no end date and are not marked `former` (`unknown` counts as
possibly ongoing; `former` without a date has ended at an unknown time). Excluded: permanent
kinship, the same type (the duplicate check's question), and every case where the new type is
itself kinship. Each candidate carries `suggest_end`, true only within the partner category
(dating → engaged → married), so friends, colleagues, roommates and the like start unselected.

The dialog offers **End selected and save** (with an editable transition date, defaulting to the
new Since, or empty for unknown), **Keep all and save**, and **Cancel** (nothing changes and the
form stays open). Ending is part of the same request:
`POST /api/relationships` with `end_relationships: [{id, valid_until}]`. In one transaction
Meridian writes the new record, then for each chosen record checks that it is between the same
two, not kinship, still ongoing (else 409), and that the end is not before its start (else 422),
and sets `valid_until` (when given) and `state = former`. Any refusal or failure rolls back the
new record and every ending. Editing (`PUT`) refuses `end_relationships`. Earlier records keep
their dates, notes, context and provenance; the Timeline shows their "Ended" entry (or, without
a date, the undated "ended, date unknown" entry).

The graph (`graphData` in `app.js`) hides, under the default **All**, an ended relationship edge
when the same pair has a current edge of the same category, so the current state reads clearly;
**Ended** still shows it, the pair's detail panel lists every record, and concurrent current
relationships all stay.

### Schema 6 and going back

Schema 6 adds `relationships.kinship`, `entities.name_given_first`, `name_family_first` and
`display_family_first` (derived name orders, see `docs/DESIGN.md` § 24), and stores
`people.sort = family` in `settings` on installations that already hold people. Existing rows
are not changed otherwise. Without a backup, `db.SCHEMA_6_REVERSAL` returns a database to schema
5 for 0.4.x (SQLite 3.35+; kinship and preferences recorded since are lost). The normal path is
the Nexus pre-update backup. A 0.5.0 backup is not restorable by 0.4.x.

---

## 10. Known limits

- **Cross-module references:** since 0.4.0 People, Organizations and Groups are resolvable
  for modules Nexus grants a resolve scope (Argus; since 0.6.0 Chronos and Mnemosyne for People).
  Meridian's own outgoing references are still only representative images; since 0.6.0 it resolves
  Chronos events and Mnemosyne notes, tasks, projects and collections that link to its entities, to list
  them under "Linked from other modules".
- **Membership limits:** memberships have one role; Group↔Group membership is not
  supported; and there is no merge of duplicate entities.
- **Provenance scope:** provenance rows exist for relationships and memberships. Milestone
  1 records keep their single import `source_id`.
- **Graph state:** layout positions are kept for the session, not stored on the server. A
  new session lays the graph out again.

The periods of relationships, memberships and work also appear on the Timeline, projected from
these same records (docs/TIMELINE.md). Ending or re-dating a relationship changes its Timeline
entries at once; nothing is copied.
