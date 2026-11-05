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
  shown wording reads, from the focused entity's side: "Renáta parent of Viktor" points to
  Viktor; with Viktor selected, "Viktor child of Renáta" points to Renáta. With only a line
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

## 10. Known limits

- **Cross-module references:** Organizations and Groups are not yet resolvable for other
  modules (the manifest still declares only `person`).
- **Membership limits:** memberships have one role; Group↔Group membership is not
  supported; and there is no merge of duplicate entities.
- **Provenance scope:** provenance rows exist for relationships and memberships. Milestone
  1 records keep their single import `source_id`.
- **Graph state:** layout positions are kept for the session, not stored on the server. A
  new session lays the graph out again.

The periods of relationships, memberships and work also appear on the Timeline, projected from
these same records (docs/TIMELINE.md). Ending or re-dating a relationship changes its Timeline
entries at once; nothing is copied.
