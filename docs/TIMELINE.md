# Meridian Timeline (Milestone 3)

The Timeline answers "how did these connections evolve over time?". The Celestial Graph
answers "how is everything connected?". Both are views of the same authoritative records.

---

## 1. Architectural decisions

| Decision | Why |
| --- | --- |
| **The Timeline is a projection, not a store.** `GET /api/timeline` derives its entries from relationships, memberships, work records and personal dates on every request. | Each fact keeps one authority. Editing or ending a relationship changes the Timeline at once, with nothing stale or duplicated to keep in sync, as the graph projection already does. |
| **A native `events` table only for occurrences no record can hold.** Examples: a first meeting, a graduation, a move, a founding, a group event. | A relationship start, a membership or a job is already a record with a period; copying it into an event would create two diverging truths. |
| **Events reuse the existing conventions.** They use partial dates, the confidence vocabulary, the `provenance` table (`record_kind = 'event'`), UUIDv7 identifiers and hard deletion of records entered by mistake. | No parallel temporal model, and provenance stays one mechanism. |
| **Participants are a join table** (`event_participants`) with an optional role. | An event can involve several people, organizations and groups; purging an entity removes it from events without deleting them. |
| **No time of day.** | Life events are dated to the day at most. |
| **No audit-log content.** `created_at` and `updated_at` are metadata, never timeline entries. | Database mutations are not life events. |
| **Chronos keeps scheduling.** Meridian projects only what it owns, and makes no cross-module reads or writes. | Ownership boundaries; future integrations can add projections beside these. |

## 2. Temporal precision

Dates are Meridian's partial dates (see `backend/meridian/dates.py`):

| Stored | Meaning | Shown as |
| --- | --- | --- |
| `1990` | year only | "1990", listed under "During 1990" before that year's months |
| `1990-05` | month and year | "May 1990", listed under May before its days |
| `1990-05-17` | exact day | "17 May 1990" |
| `--05-17` | day and month, year unknown (birthdays) | "17 May, year unknown", in "Date unknown" |
| no date | unknown | in "Date unknown", never guessed |

- **Approximate:** events and personal dates carry an `approximate` flag ("about May 1990").
- **Uncertain:** relationships, memberships and work express uncertainty through `confidence`.
- **Stored as entered:** the original value is stored and returned unchanged. A year is never
  turned into 1 January.
- **Sorting:** entries sort by year, then month, then day. A missing part sorts before the
  known parts of the same period, so "1990" comes before "May 1990", which comes before
  "17 May 1990". On the same date the order is: occurrence, then began, then ended, then
  title. Undated entries come last, in their own section.

## 3. Projection rules

| Source record | Entries |
| --- | --- |
| Relationship, membership, work | **Began** at `valid_from`. **Ended** at `valid_until`. A record that has ended (`former`) but has no end date gets an undated "Ended, date unknown" entry. A current record with no end is ongoing: only "Began", marked ongoing. An `unknown` state is shown as "whether it continues is not recorded". A record with no dates at all gets one undated entry. |
| Personal date with a year | One occurrence: born, died, founded (birth of an organization or group), an anniversary or a custom date. Name days recur yearly and are not history, so they are left out. |
| Event | One occurrence, or a span when it has an end or is ongoing. |

Entries that involve an entity in Trash are left out, as in the graph. An event is shown while
at least one participant is outside Trash.

Every entry carries a stable id (`relationship:<id>:start`, `event:<id>`, and so on), the
authoritative record it comes from, and `editable: true` only for native events. A projected
entry is never edited as an event: its details link to the relationship, membership or
profile editor that owns it.

## 4. Duplicates

Before saving an event, the editor asks `GET /api/similar-events`. That returns existing events
and projected entries that may say the same thing. An entry counts when:
- its date is compatible: equal at the precision both share, with at least the month known on
  both unless both are years only;
- it involves the same entities: two of them, or all of them when fewer are given.

For example, "Started at Acme" in June 2015 for Hana and Acme is flagged when a work record at
Acme already begins that month. The user then decides with that knowledge, as with similar
relationships. The server checks again on save (`409` unless `allow_similar`). An edit that
keeps the date and the participants is not asked again.

## 5. API

All endpoints are under `/api/` and reachable only through the Nexus gateway (a test asserts
403 without it).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/timeline?entity=&records=&year_from=&year_to=` | The projection, described below |
| `GET /api/timeline/entry?id=` | One entry in full, read from its record: sources, note or description, roles, the record id and the ids of its owners |
| `GET /api/event-categories` | Built-in event kinds: milestone, meeting, education, move, career, founding, gathering, other |
| `GET /api/similar-events?starts=&entities=&exclude=` | Entries a new event may repeat (§ 4) |
| `POST /api/events`, `GET/PUT/DELETE /api/events/{id}` | Native events |

`GET /api/timeline` returns:
- `entities`: an `[id, kind, name, self]` table, holding only the entities the entries involve;
- `types`: the wording of each relationship type used, once (`label`, `inverse`, `symmetric`,
  `category`);
- `entries`: dated entries in order;
- `undated`: entries with no year;
- `categories`, `relationship_categories` and `truncated`.

An entry is compact:
- always `id`, `moment` (`start`, `end`, `at`, `span`, `record`), `category` (`relationship`,
  `membership`, `employment`, `life`, `event`) and `entities` (indexes into the table);
- for some kinds, `type`, `title` (events) and `phrase` (life dates);
- dates and state: `date` as stored, `until` on a beginning, `since` on an end, `end` on a span,
  `ongoing`, `approximate`, `state` and `confidence`;
- `detail` (context, role or job title), `sources` (a count) and `editable` (events only).

Absent keys mean "not known" or "no". About 206 bytes per entry, so the first `MAX_ENTRIES =
8000` fit well inside the Nexus 2 MiB response limit (measured 1.3 MB for 6,302). Above that the
response is flagged `truncated`, and an entity or a span of years returns the rest complete.

Event input (`EventIn`) takes:
- `title` (required) and an optional `description`;
- `category`: an open lower-case word, with the built-ins offered;
- `starts` / `ends`: partial dates with a year, `ends` not before `starts`;
- `ongoing` (needs a start and no end) and `approximate`;
- `confidence` and `sources` (the provenance shape);
- `participants`: 1–50 distinct entities, each with an optional `role`;
- `allow_similar`.

Deleting an event removes its participants and provenance (a trigger) and nothing else.

## 6. Interface

- **Where:** "Timeline" in the main navigation, beside Graph. Each profile (person,
  organization, group) has a Timeline tab with "Open in Timeline" and "Add event". A selected
  graph node offers "Timeline". Each person in a Timeline entry offers "over time" (focus) and
  "Show in the graph".
- **Layout:** a year rail (density bars; dotted gaps for quiet years), one thread through the
  stream, and the details column (a key to the marks when nothing is selected). Below 1,100 px
  the details are a sheet; on phones the rail becomes a swipeable year strip and each entry
  stacks its date above its words. Visual rules: DESIGN.md § 23.
- **Order:** oldest first, by year. "During 1990" (year-only entries) comes before the months,
  and months before their days. Quiet stretches are shown ("12 quiet years"), not collapsed
  away. "Date unknown" comes last. Entries on the same exact date share one date label
  (0.5.0, § 10a).
- **Grouping for dense periods:**
  - **Overview** (the default above 160 entries) shows each year's summary by kind and its
    three most telling entries (events, then life dates, then connections), with "Show all N
    in 1990".
  - **Detail** shows every month, six entries per month before "Show N more from May 1990".
- **Focus:** "Focus on someone" narrows the Timeline to one entity (`?entity=`). Relationships
  then read from that entity's side ("Jana child of Peter"), and its name reads quieter than the
  other party's.
- **Filters** (only those that change something are shown):
  - involving people, organizations or groups;
  - kind of entry;
  - connections: all, still in effect, or ended (relationships, memberships and work only);
  - from and to year (undated entries are hidden while a range is set);
  - reset. An empty result says how many entries the filters hide, with "Reset filters".
- **Details:**
  - what happened, the kind of entry, and its date with precision ("Month and year",
    "approximate");
  - the period and its length for connections ("10 years so far");
  - certainty, the people and things involved, the note or description, and sources;
  - Earlier / Later stepping;
  - for events, "Edit event" and "Delete";
  - for projected entries, the record they come from: "Edit relationship", "Edit membership",
    "Edit work" or "Edit dates" open the owning profile with that editor. Projected entries are
    never edited as events.
- **Event editor:** a side panel with what happened, kind, date and optional "until", "still
  going on", "approximate", who or what was involved (with roles), description, certainty and
  sources. It shows the similar-entry warning before saving.

## 7. Accessibility

- **Keyboard:**
  - One entry is in the Tab order (roving focus). Up and Down move between entries, Page Up and
    Page Down between years, Home and End to the ends.
  - Enter or Space selects, keeping focus on the entry. Escape closes the details and returns
    focus.
  - "/" focuses "Focus on someone".
  - Year-rail buttons jump to a year and focus its first entry.
- **Screen readers:**
  - Years are sections labelled by their heading, and entries are lists of buttons. Each button
    is labelled with date, kind, sentence and context.
  - A polite live region announces the selection and the number of entries after filtering.
  - The details column is a labelled region; the rail is a labelled navigation.
- **Not by colour alone:** the marks differ in shape (arc, hexagon, diamond, circle, star) and
  fill (filled began or happened, hollow ended, dotted uncertain). Every entry also carries a
  word ("Began", "Ended", "Born", "Meeting").
- **Motion:** the only motion is the smooth scroll to a year or entry and the sheet's entrance.
  Under `prefers-reduced-motion` both are instant. Nothing animates while idle (verified: no
  running animations).

## 8. Performance (measured)

Chromium in the real Nexus iframe, 1440×900, this development machine. The synthetic
timelines are seeded in isolated QA instances.

| Entries | Overview render | Detail render | Rows built at first (Overview / Detail) |
| --- | --- | --- | --- |
| 10 | 0.9 ms | 2.0 ms | 3 / 10 |
| 100 | 5.3 ms | 16.7 ms | 33 / 100 |
| 1,000 | 10.4 ms | 2.1 ms (years built as they come near) | 117 / 0 |
| 6,302 | 25.6 ms | 7.9 ms (years built as they come near) | 291 / 0 |

- **Large Detail views:** above 600 entries, Detail builds a year's entries only when the year
  comes within about two screens, or when you jump, select or move into it. Each year is first
  a placeholder of estimated height, and Chrome's scroll anchoring keeps the view steady as
  years fill. Before this, Detail at 6,302 entries took 418 ms and built 4,683 rows.
- **Off-screen years** of a large timeline also use `content-visibility: auto`.
- **Interactions at 6,302 entries:** filtering takes 5–22 ms. Selecting an entry 4,000 rows down
  takes 46 ms and lands centred.
- **Projection:** 5 ms for 63 entries, 36 ms for 163, 53 ms for 1,915 and 98 ms for 6,302, plus
  about 40 ms through the Nexus bridge.

## 9. Testing

- `tests/test_timeline.py` (24 tests) covers:
  - projection from relationships, start and end, ongoing, ended without a date, and undated
    records;
  - unknown state with confidence, membership history, several work periods, and life dates
    (including name days left out and birthdays without a year);
  - partial-date sorting and dates returned as entered, and date validation;
  - event CRUD with several entities, provenance and roles; ongoing events; participant rules;
  - similar-entry detection;
  - that editing or deleting relationships and profile work updates the Timeline with no stale
    entries;
  - Trash, restore and purge;
  - filters, no duplicates, scale at the entry cap within 2 MiB, upgrading a Milestone 2
    database, and gateway protection.
- **Browser QA in the real Nexus iframe** used the isolated synthetic instances, with the page
  served with the Nexus headers. It covered:
  - 2560×1440, 1440×900, 820×1180 and 390×844, with no page overflow;
  - event create, similar warning, edit and delete;
  - editing a projected relationship through its profile, with the Timeline updated and no
    duplicate;
  - keyboard and reduced motion;
  - Graph ↔ Timeline.

  A read-only pass ran on the real aetest data.
- **0.5.0 same-date grouping:** `tests/ux.test.cjs` (matching rules: precision, approximate,
  other years, year-only and undated entries, runs), `tests/test_ux.py`
  (`test_timeline_keeps_same_day_entries_distinct_and_adjacent`), and the browser journey
  `tests/e2e/ux_e2e.cjs` (Timeline view and profile tab, 1440 and 390 px: one "Aug 23" label,
  two distinct entries, each still announcing its full date).

## 10. Known limits

- **Timeline state:** the view mode and filters are kept for the session only, like the
  graph's.
- **Approximate dates:** "approximate" exists for events and personal dates. Relationships,
  memberships and work express uncertainty through confidence, as in Milestone 2.
- **Contradictory accounts:** two records that disagree, such as two different start dates,
  both appear as recorded. Nothing reconciles them.
- **Event participants:** an event whose participants have all been purged keeps its title and
  date but involves no one. It stays on the whole-Meridian timeline only.
- **Chronos:** Chronos events are not projected yet. The projection boundary (`timeline.py`, one
  builder per source) is where they would join.
- **Large timelines:** above 8,000 entries the whole-Meridian timeline is truncated (flagged).
  Narrowing by entity or years returns the rest.

## 10a. Same-date grouping (0.5.0)

Implemented in 0.5.0 from the owner-approved requirement
([`architecture/modules/meridian.md`](../../architecture/modules/meridian.md#7-timeline--group-events-by-exact-date)).
Presentation only: the projection, its order, ids and counts are unchanged, and nothing is stored.

- Consecutive entries with the **same date string and the same `approximate` flag**, at month or
  day precision, share one date label (`MeridianUX.sameDay` / `dayRuns` in `frontend/ux.js`).
  For example, under *1987*: **Aug 23** · *Born — Vzorko Kvázimenný*, then *Began — Vzorko
  Kvázimenný child of Ukážka Kvázimenná* without a second "Aug 23".
- Never grouped: `1987-08` with `1987-08-23`; an approximate date with an exact one; the same
  month and day in another year; year-only entries (they have no day label; they sit under
  "During <year>" as before); `--MM-DD` and undated entries ("Date unknown" is unchanged).
- Each entry stays its own row and button with its icon, tag, sentence, details, selection and
  keyboard focus; its accessible name still states its full date. A following same-day row
  (`.is-day-cont`) sits closer to the first and a hairline in the date column ties them; on
  phones the repeated date line is simply omitted.
- Applies wherever entries are listed: Detail month groups, Overview's highlighted entries, the
  "Show N more" expansion (grouping is computed on the rows actually shown), lazily built
  years, filtered views, and the Timeline tab on profiles.
- Relationship entries now also carry `kinship` (0.5.0): the second line names half-siblings,
  siblings through adoption, adoptive or step parenthood.

## 11. Schema and migration

Migration 4 (schema 3 → 4), additive only:
- `events`: `id`, `title`, `description`, `category`, `starts`, `ends`, `ongoing`,
  `approximate`, `confidence`, `created_at`, `updated_at`. Checks ensure an end needs a start
  and an ongoing event has no end.
- `event_participants`: `event_id`, `entity_id`, `role`, `position`, keyed by event and entity.
  It cascades from both sides.
- The trigger `events_drop_provenance`, and indexes on `events.starts`,
  `relationships.valid_from` and `memberships.valid_from`.

Existing tables and rows are not touched. Before the aetest upgrade, a verified copy of the
database was kept in `meridian/backups/` (integrity check, schema 3, row counts and a SHA-256
file). After the upgrade, every existing table had the same row counts. Schema 4 was introduced
with module version 0.3.0.
