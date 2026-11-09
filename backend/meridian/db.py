import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import collation

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
    # 0.4.0: a representative image per entity. Argus owns the photo; Meridian keeps only the
    # photo's ID and the owner's square crop (0-1 of the picture as viewed). Purging the
    # entity removes it. `nexus_*` track the Nexus reference shared with Argus; the reference
    # IDs of edges to remove later wait in `reference_cleanup`.
    """
CREATE TABLE representative_images(entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
 photo_id TEXT NOT NULL,
 crop_x REAL NOT NULL CHECK(crop_x >= 0 AND crop_x < 1), crop_y REAL NOT NULL CHECK(crop_y >= 0 AND crop_y < 1),
 crop_w REAL NOT NULL CHECK(crop_w > 0 AND crop_w <= 1), crop_h REAL NOT NULL CHECK(crop_h > 0 AND crop_h <= 1),
 updated_at TEXT NOT NULL,
 nexus_reference_id TEXT, nexus_state TEXT NOT NULL DEFAULT 'pending' CHECK(nexus_state IN ('pending','registered')));
CREATE INDEX representative_images_photo ON representative_images(photo_id);
CREATE TABLE reference_cleanup(reference_id TEXT PRIMARY KEY, queued_at TEXT NOT NULL);
""",
    # 0.5.0: kinship origin, name-order columns and People preferences (schema 6).
    lambda db: schema_6(db),
    # 0.7.0 (schema 7, roadmap Phase 3, owner decisions D7/D8): Education and Interests as
    # dedicated records, Interactions as manual records stored once. All additive.
    f"""
-- Education: a temporal domain record (like work). The school is an Organization entity;
-- kind and status are open vocabularies offered by the interface. valid_from/valid_until are
-- the period; a record with valid_until is former, kept as history.
CREATE TABLE educations(id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 organization_id TEXT REFERENCES entities(id) ON DELETE SET NULL, kind TEXT NOT NULL DEFAULT '',
 department TEXT NOT NULL DEFAULT '', program TEXT NOT NULL DEFAULT '', field TEXT NOT NULL DEFAULT '',
 degree TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', achievements TEXT NOT NULL DEFAULT '',
 {RECORD});
CREATE INDEX educations_person ON educations(person_id);
CREATE INDEX educations_organization ON educations(organization_id);
-- Interests and preferences: extensible records, never favorite_* columns. "favorite" is a
-- sentiment, so several favorites are possible; history is kept through valid_until.
-- target_ref is reserved for a cross-module reference (a Lyra title later); the subject text
-- always stays, so a preference never depends on another module.
CREATE TABLE interests(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 category TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, sentiment TEXT NOT NULL DEFAULT '',
 context TEXT NOT NULL DEFAULT '', target_kind TEXT NOT NULL DEFAULT '', target_ref TEXT, {RECORD});
CREATE INDEX interests_entity ON interests(entity_id);
-- Interactions: contact or activity between participants, stored once and shown for each of
-- them. Manually entered (D8); Hermes communications are never copied here. group_id is
-- optional context and never stands in for known participants.
CREATE TABLE interactions(id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'meeting',
 summary TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', occurred TEXT,
 approximate INTEGER NOT NULL DEFAULT 0 CHECK(approximate IN (0,1)),
 group_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
 confidence TEXT CHECK(confidence IS NULL OR confidence IN ('unknown','low','medium','high')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX interactions_occurred ON interactions(occurred);
CREATE TABLE interaction_participants(interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
 entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(interaction_id, entity_id));
CREATE INDEX interaction_participants_entity ON interaction_participants(entity_id);
-- Optional links to resources other modules own (a Chronos event, a Mnemosyne note). Only the
-- reference is stored, plus the label seen when it was linked, so a link whose target was
-- deleted stays readable as unresolved. Registered with Nexus as meridian.interaction-about.
CREATE TABLE interaction_links(id TEXT PRIMARY KEY,
 interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
 resource TEXT NOT NULL, label_hint TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
 nexus_reference_id TEXT, nexus_state TEXT NOT NULL DEFAULT 'pending' CHECK(nexus_state IN ('pending','registered')),
 created_at TEXT NOT NULL, UNIQUE(interaction_id, resource));
CREATE INDEX interaction_links_state ON interaction_links(nexus_state);
CREATE TRIGGER interaction_links_cleanup AFTER DELETE ON interaction_links
 WHEN OLD.nexus_reference_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO reference_cleanup(reference_id, queued_at)
 VALUES(OLD.nexus_reference_id, strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
-- Provenance rows (multi-source) extend to the new records.
CREATE TRIGGER educations_drop_provenance AFTER DELETE ON educations BEGIN
 DELETE FROM provenance WHERE record_kind='education' AND record_id=OLD.id; END;
CREATE TRIGGER interests_drop_provenance AFTER DELETE ON interests BEGIN
 DELETE FROM provenance WHERE record_kind='interest' AND record_id=OLD.id; END;
CREATE TRIGGER interactions_drop_provenance AFTER DELETE ON interactions BEGIN
 DELETE FROM provenance WHERE record_kind='interaction' AND record_id=OLD.id; END;
""",
    # 0.12.0 (schema 8): where an address chosen from a search is. geo_key records the address
    # the coordinates belong to, so they cannot outlive a later correction.
    """
ALTER TABLE addresses ADD COLUMN latitude REAL;
ALTER TABLE addresses ADD COLUMN longitude REAL;
ALTER TABLE addresses ADD COLUMN geo_precision TEXT NOT NULL DEFAULT '';
ALTER TABLE addresses ADD COLUMN geo_key TEXT NOT NULL DEFAULT '';
""",
]

# 0.12.0 (schema 8): going back to 0.11.0 without a backup loses only stored address positions.
SCHEMA_8_REVERSAL = """
ALTER TABLE addresses DROP COLUMN latitude;
ALTER TABLE addresses DROP COLUMN longitude;
ALTER TABLE addresses DROP COLUMN geo_precision;
ALTER TABLE addresses DROP COLUMN geo_key;
PRAGMA user_version=7;
"""

# 0.7.0 (schema 7): going back to 0.6.x without a backup drops only what schema 7 added;
# Education, Interests and Interactions recorded since are lost (queue their Nexus edges for
# removal first, or reconcile Nexus afterwards). Everything else is untouched.
SCHEMA_7_REVERSAL = """
DROP TRIGGER IF EXISTS interaction_links_cleanup;
DROP TABLE IF EXISTS interaction_links;
DROP TABLE IF EXISTS interaction_participants;
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS interests;
DROP TABLE IF EXISTS educations;
DELETE FROM provenance WHERE record_kind IN ('education','interest','interaction');
PRAGMA user_version=6;
"""

# 0.5.0 (schema 6), all additive:
# - relationships.kinship: how a parent or sibling relationship came about. NULL means "not
#   recorded" and is what every older record keeps: nothing is reinterpreted as biological or
#   adoptive without the user saying so. Parent: biological | adoptive | step. Sibling:
#   biological_full | biological_half | biological (full or half not known) | adoptive | step.
# - entities.name_given_first / name_family_first: the name as sorted first-name-first and
#   last-name-first; entities.display_family_first: "Family, Given". Derived from the names
#   (meridian.store.refresh), never edited, and compared with the `meridian_name` collation.
# - settings 'people.sort' = 'family' on installations that already hold people, so their
#   family-first ordering is kept until the owner changes it; new installations sort by first
#   name. Reversal: docs/RELATIONSHIPS.md § 11.
# Going back to 0.4.x (schema 5) without a backup: drops only what schema 6 added. Kinship and
# preferences recorded since are lost; everything else is untouched. Needs SQLite 3.35+.
SCHEMA_6_REVERSAL = """
ALTER TABLE relationships DROP COLUMN kinship;
ALTER TABLE entities DROP COLUMN name_given_first;
ALTER TABLE entities DROP COLUMN name_family_first;
ALTER TABLE entities DROP COLUMN display_family_first;
DELETE FROM settings WHERE key IN ('people.sort', 'people.display');
PRAGMA user_version=5;
"""
KINSHIP_VALUES = ("biological", "biological_full", "biological_half", "adoptive", "step")


def schema_6(db):
    from .store import refresh_names

    values = ",".join(f"'{v}'" for v in KINSHIP_VALUES)
    db.execute(
        "ALTER TABLE relationships ADD COLUMN kinship TEXT"
        f" CHECK(kinship IS NULL OR kinship IN ({values}))"
    )
    for column in ("name_given_first", "name_family_first", "display_family_first"):
        db.execute(f"ALTER TABLE entities ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
    for row in db.execute("SELECT id FROM entities").fetchall():
        refresh_names(db, row["id"])
    if db.execute("SELECT 1 FROM entities WHERE kind='person' LIMIT 1").fetchone():
        db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('people.sort', 'family')")


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
    "interests",
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
        db.create_collation(collation.NAME, collation.compare)
        try:
            with db:
                yield db
        finally:
            db.close()
