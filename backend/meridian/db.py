import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Model (architecture/modules/meridian.md):
# - entities: the common core of Person, Organization and Group (first-class, stable UUIDv7
#   identities, the future graph's nodes). Kind-specific knowledge lives in record tables.
# - Record tables hold structured knowledge about an entity. Every record carries:
#   position (display order), valid_from/valid_until (partial dates; a record with
#   valid_until is a former value, kept rather than overwritten), source_id (provenance;
#   NULL = entered by the user), confidence (unknown/low/medium/high or NULL), note.
# - Labels and kinds are open text (lower-case vocabulary in the interface), never closed
#   enumerations, except where a value is structural (contact channel, entity kind).
# - Dates are partial: YYYY, YYYY-MM, YYYY-MM-DD or --MM-DD (meridian.dates).
# - deleted_at moves an entity to Trash; purging deletes it and leaves a tombstone so
#   references from other modules resolve as "gone" (410).
RECORD = (
    "position INTEGER NOT NULL DEFAULT 0, valid_from TEXT, valid_until TEXT,"
    " source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, confidence TEXT"
    " CHECK(confidence IS NULL OR confidence IN ('unknown','low','medium','high')),"
    " note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL"
)
MIGRATIONS = [
    f"""
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources(id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{{}}', created_at TEXT NOT NULL);
CREATE TABLE entities(id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('person','organization','group')),
 display_name TEXT NOT NULL, sort_key TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '', is_self INTEGER NOT NULL DEFAULT 0 CHECK(is_self IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX entities_kind ON entities(kind, deleted_at, sort_key);
CREATE INDEX entities_updated ON entities(kind, deleted_at, updated_at);
-- At most one distinguished self profile (@me), and only a Person can be it.
CREATE UNIQUE INDEX entities_one_self ON entities(is_self) WHERE is_self=1;
CREATE TRIGGER entities_self_is_person BEFORE UPDATE OF is_self ON entities
 WHEN NEW.is_self=1 AND NEW.kind<>'person'
 BEGIN SELECT RAISE(ABORT, 'Only a Person can be the self profile'); END;
CREATE TABLE names(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', given TEXT NOT NULL DEFAULT '',
 middle TEXT NOT NULL DEFAULT '', family TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL DEFAULT '',
 suffix TEXT NOT NULL DEFAULT '', {RECORD});
CREATE INDEX names_entity ON names(entity_id);
CREATE TABLE contact_points(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('phone','email','website')), value TEXT NOT NULL,
 match_key TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '',
 is_primary INTEGER NOT NULL DEFAULT 0, {RECORD});
CREATE INDEX contact_points_entity ON contact_points(entity_id);
CREATE INDEX contact_points_match ON contact_points(channel, match_key);
CREATE TABLE addresses(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 label TEXT NOT NULL DEFAULT '', street TEXT NOT NULL DEFAULT '', extended TEXT NOT NULL DEFAULT '',
 po_box TEXT NOT NULL DEFAULT '', locality TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
 postal_code TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
 formatted TEXT NOT NULL DEFAULT '', place_ref TEXT, is_primary INTEGER NOT NULL DEFAULT 0, {RECORD});
CREATE INDEX addresses_entity ON addresses(entity_id);
CREATE TABLE personal_dates(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', date TEXT, description TEXT NOT NULL DEFAULT '',
 approximate INTEGER NOT NULL DEFAULT 0, {RECORD});
CREATE INDEX personal_dates_entity ON personal_dates(entity_id);
-- Employment/professional activity. The organization is an Organization entity, not a
-- text field on the Person; a title without a known organization is allowed.
CREATE TABLE employments(id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 organization_id TEXT REFERENCES entities(id) ON DELETE SET NULL, title TEXT NOT NULL DEFAULT '',
 department TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', {RECORD});
CREATE INDEX employments_person ON employments(person_id);
CREATE INDEX employments_organization ON employments(organization_id);
-- Online accounts are records, never username columns on Person. hermes_ref will link a
-- Hermes communication identity by generic reference.
CREATE TABLE accounts(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 service TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
 url TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'unknown', hermes_ref TEXT, {RECORD});
CREATE INDEX accounts_entity ON accounts(entity_id);
-- Generic facts / custom information: subject, key, value, validity, source, confidence.
CREATE TABLE facts(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 key TEXT NOT NULL, value TEXT NOT NULL, {RECORD});
CREATE INDEX facts_entity ON facts(entity_id);
CREATE TABLE identifiers(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 system TEXT NOT NULL, value TEXT NOT NULL, source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL, UNIQUE(entity_id, system, value));
CREATE INDEX identifiers_lookup ON identifiers(system, value);
-- Imported information Meridian could not map, kept for review instead of being dropped.
CREATE TABLE raw_properties(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, name TEXT NOT NULL,
 params TEXT NOT NULL DEFAULT '{{}}', value TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX raw_properties_entity ON raw_properties(entity_id);
CREATE TABLE imports(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
 filename TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
 total INTEGER NOT NULL, created INTEGER NOT NULL, merged INTEGER NOT NULL, skipped INTEGER NOT NULL,
 summary TEXT NOT NULL DEFAULT '{{}}');
CREATE TABLE import_items(import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('create','merge','skip')),
 entity_id TEXT, label TEXT NOT NULL DEFAULT '', PRIMARY KEY(import_id, position));
CREATE TABLE tombstones(id TEXT PRIMARY KEY, kind TEXT NOT NULL, deleted_at TEXT NOT NULL);
""",
    # Milestone 2: relationships, Group membership and multi-source provenance.
    f"""
-- User-defined relationship types. Built-in types live in code (meridian.relations), so the
-- vocabulary grows without migrations; a relationship stores the type key either way.
-- label reads subject -> object ("mentor of"), inverse_label object -> subject ("mentored
-- by"); a symmetric type reads the same both ways.
CREATE TABLE relationship_types(id TEXT PRIMARY KEY, category TEXT NOT NULL,
 label TEXT NOT NULL, inverse_label TEXT NOT NULL,
 symmetric INTEGER NOT NULL DEFAULT 0 CHECK(symmetric IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- One authoritative record per relationship. Its inverse ("child of" for "parent of") is
-- derived from the type when read from the other side, never stored as a second record.
-- context is the human label for this one relationship ("best friend", "maternal
-- grandmother") without becoming a global type. state is current, former or unknown; an
-- ended relationship is kept as history, not deleted.
CREATE TABLE relationships(id TEXT PRIMARY KEY,
 subject_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 object_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 type TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'current' CHECK(state IN ('current','former','unknown')),
 {RECORD}, CHECK(subject_id <> object_id));
CREATE INDEX relationships_subject ON relationships(subject_id);
CREATE INDEX relationships_object ON relationships(object_id);
CREATE INDEX relationships_type ON relationships(type);
-- Group membership is its own many-to-many temporal record, distinct from any
-- relationship: sharing a Group never implies one.
CREATE TABLE memberships(id TEXT PRIMARY KEY,
 group_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'current' CHECK(state IN ('current','former','unknown')),
 {RECORD}, CHECK(group_id <> member_id));
CREATE INDEX memberships_group ON memberships(group_id);
CREATE INDEX memberships_member ON memberships(member_id);
-- Where a record's knowledge came from: zero or more sources per record (observed, told
-- by a Person, a document, an import...). Provenance, confidence and date precision stay
-- separate notions.
CREATE TABLE provenance(id TEXT PRIMARY KEY, record_kind TEXT NOT NULL, record_id TEXT NOT NULL,
 kind TEXT NOT NULL, entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
 label TEXT NOT NULL DEFAULT '', learned TEXT, position INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL);
CREATE INDEX provenance_record ON provenance(record_kind, record_id);
CREATE TRIGGER relationships_drop_provenance AFTER DELETE ON relationships BEGIN
 DELETE FROM provenance WHERE record_kind='relationship' AND record_id=OLD.id; END;
CREATE TRIGGER memberships_drop_provenance AFTER DELETE ON memberships BEGIN
 DELETE FROM provenance WHERE record_kind='membership' AND record_id=OLD.id; END;
""",
    # Organizations created from work records before Milestone 2 had only a display name;
    # give them a name record so their profile can show and edit it.
    lambda db: backfill_organization_names(db),
    # Milestone 3: native events, for occurrences no other record can hold (a first meeting,
    # a graduation, a move, a founding). Relationship, membership and work periods are not
    # copied here: the Timeline projects them from their own records (meridian.timeline).
    # Dates are partial dates with a year; `ends` makes the event a span, `ongoing` a span
    # that has not ended. `approximate` marks a date as "about". No time of day.
    """
CREATE TABLE events(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'milestone', starts TEXT, ends TEXT,
 ongoing INTEGER NOT NULL DEFAULT 0 CHECK(ongoing IN (0,1)),
 approximate INTEGER NOT NULL DEFAULT 0 CHECK(approximate IN (0,1)),
 confidence TEXT CHECK(confidence IS NULL OR confidence IN ('unknown','low','medium','high')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(ends IS NULL OR starts IS NOT NULL), CHECK(NOT (ongoing=1 AND ends IS NOT NULL)));
CREATE INDEX events_starts ON events(starts);
-- Who or what an event involves. Purging an entity removes it from its events; the event,
-- which may involve others, stays.
CREATE TABLE event_participants(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(event_id, entity_id));
CREATE INDEX event_participants_entity ON event_participants(entity_id);
CREATE TRIGGER events_drop_provenance AFTER DELETE ON events BEGIN
 DELETE FROM provenance WHERE record_kind='event' AND record_id=OLD.id; END;
-- Timeline projections read records by their dates.
CREATE INDEX relationships_from ON relationships(valid_from);
CREATE INDEX memberships_from ON memberships(valid_from);
""",
]


def backfill_organization_names(db):
    from .util import iso_now, uuid7

    now = iso_now()
    rows = db.execute(
        "SELECT id, display_name FROM entities e WHERE kind='organization' "
        "AND NOT EXISTS(SELECT 1 FROM names n WHERE n.entity_id=e.id)"
    ).fetchall()
    for row in rows:
        db.execute(
            "INSERT INTO names(id,entity_id,kind,value,position,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (uuid7(), row["id"], "full", row["display_name"], 0, now, now),
        )


RECORD_TABLES = (
    "names",
    "contact_points",
    "addresses",
    "personal_dates",
    "accounts",
    "facts",
)


class Database:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    def migrate(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > len(MIGRATIONS):
                raise RuntimeError("Database is newer than this application")
            for i in range(version, len(MIGRATIONS)):
                step = MIGRATIONS[i]
                if callable(step):
                    db.execute("BEGIN IMMEDIATE")
                    step(db)
                    db.execute(f"PRAGMA user_version={i + 1}")
                    db.commit()
                else:
                    db.executescript(
                        "BEGIN IMMEDIATE;\n" + step + f"\nPRAGMA user_version={i + 1}; COMMIT;"
                    )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()
