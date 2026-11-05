# Meridian

The Aureate Empyrean module for People, Organizations and Groups: profiles, what you know about
them, how they relate, a graph of the network, and a timeline of how it changed. Ecosystem scope and
the long-term model are in
[`architecture/modules/meridian.md`](../architecture/modules/meridian.md); this file says what exists.

## Module facts

| | |
| --- | --- |
| Module ID, version | `meridian`, 0.3.1 (schema 4) |
| Port | 17333 |
| Nexus range | `>=0.1.8,<0.2.0` (tested on 0.1.9) |
| Capabilities | `ui.application`, `storage.data` |
| Resources | `person` (resolvable), Entity References v2; no outgoing references, no read or resolve scopes |
| Projections | None provided or read |
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
| Local `aetest` (`http://localhost:12334`) | 0.3.1 | Verified 2026-11-05. Test data |
| Production Nexus | 0.3.0 | Installed empty on 2026-11-05 (`../DEPLOYMENT_MERIDIAN_2026-11-05.md`); not re-checked since. It does not have the 0.3.1 graph arrow fix |

## Status

The owner approved Milestone 1 and UI stages A.2 and B. No recorded approval exists for Milestone 2,
the Celestial Graph or Milestone 3, whose last status was "awaiting visual review".

### Implemented and tested

Automated: 99 Python tests and 16 Chromium graph tests, all passing on 2026-11-05. Browser QA ran in
the real Nexus iframe when each milestone was delivered.

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
- Backup v1, name resolution for `person`, gateway protection.

### Implemented but unverified

- A full restore of a real backup through Nexus for 0.3.x. Backup creation ran on production; the
  round trip is covered only by automated tests in the test client.
- The 0.3.1 arrow fix was checked in the browser at 1440 px only.

### Work in progress

- **Profile images** through Argus. Nothing is in this repository yet. The plan and its order are in
  [`../argus/docs/STATUS.md`](../argus/docs/STATUS.md).

### Planned

The V1 parts not implemented are listed in
[`architecture/modules/meridian.md`](../architecture/modules/meridian.md#implementation-status):
Education records, Interests and Preferences, Interactions, outgoing cross-module references.

### Known limitations

See `docs/RELATIONSHIPS.md` § 10 and `docs/TIMELINE.md` § 10. In short: only `person` is resolvable by
other modules; memberships have one role; no merging of duplicate entities; provenance rows only for
relationships, memberships and events; layouts and Timeline filters are kept per session; timelines above
8,000 entries are truncated with a notice.

## Develop and test

Tests run in Linux containers; Windows-native pytest is not supported in this workspace. This needs no
prepared image and was verified on 2026-11-05 (99 passed):

```bash
docker run --rm -v G:/AureateEmpyrean/meridian:/src -w /src python:3.13-slim sh -c "pip install -q --root-user-action=ignore -r requirements-dev.lock && python -m pytest -q -p no:cacheprovider && ruff check backend tests && ruff format --check backend tests"
```

Graph engine tests and benchmark run in Chromium, using the Playwright installed under `mnemosyne`:

```bash
cd G:/AureateEmpyrean/meridian/tests/perf
PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node graph-tests.cjs
PLAYWRIGHT_PATH=G:/AureateEmpyrean/mnemosyne/node_modules/playwright node graph-bench.cjs
```

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
