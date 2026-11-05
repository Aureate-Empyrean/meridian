"""The Timeline: a projection of Meridian's records onto time, plus native events.

Relationships, memberships, work records and personal dates already say when they began and
ended; their timeline entries are derived from them on every request and never stored, so
editing a record changes the Timeline at once and nothing can go stale. Native events
(`events`) hold only occurrences no other record represents. See docs/TIMELINE.md.

Dates keep their precision: "1990" stays a year and sorts before "1990-05", which sorts
before "1990-05-17". Nothing is ever placed on 1 January, and an unknown date stays unknown.
"""

from . import relations
from .relations import Invalid, sources_of
from .util import iso_now, uuid7

# Built-in event categories: an open vocabulary (any lower-case word is accepted and kept),
# with these offered by the interface.
EVENT_CATEGORIES = {
    "milestone": "Milestone",
    "meeting": "Meeting",
    "education": "Education",
    "move": "Move",
    "career": "Career",
    "founding": "Founding",
    "gathering": "Gathering",
    "other": "Other",
}
# What a personal date means on the timeline, by the kind of entity it belongs to.
LIFE = {
    "birth": {"person": "born", "organization": "founded", "group": "founded"},
    "death": {"person": "died", "organization": "closed", "group": "closed"},
}
SKIP_DATES = {"name_day"}  # recurs every year; not a moment in history
MOMENT_ORDER = {"at": 0, "span": 0, "start": 1, "end": 2, "record": 3}
RECORDS = ("relationship", "membership", "employment", "date", "event")
MAX_ENTRIES = 8000  # stays well inside the 2 MiB gateway limit (about 1.3 MB measured)


def sort_key(value):
    """'19900000' for 1990, '19900500' for May 1990, '19900517' for 17 May 1990; None when
    the year is unknown. A missing part sorts before the known parts of the same period."""
    if not value or value.startswith("--"):
        return None
    y, m, d = (value.split("-") + ["00", "00"])[:3]
    return f"{y}{m}{d}"


def _clean(entry):
    return {k: v for k, v in entry.items() if v not in (None, False, "", [])}


class Projection:
    """Builds entries, sharing one table of the entities they involve."""

    def __init__(self, conn):
        self.conn = conn
        self.known = relations.types(conn)
        self.entities = {}
        self.index = {}
        self.ids = []
        self.types = {}  # relationship types the entries use: wording lives here, once
        rows = conn.execute("SELECT id, kind, display_name, is_self, deleted_at FROM entities")
        for r in rows:
            self.entities[r["id"]] = r

    def live(self, *ids):
        return all(i in self.entities and not self.entities[i]["deleted_at"] for i in ids if i)

    def ref(self, eid):
        if eid not in self.index:
            self.index[eid] = len(self.ids)
            self.ids.append(eid)
        return self.index[eid]

    def table(self):
        rows = sorted(self.index.items(), key=lambda item: item[1])
        return [
            [eid, self.entities[eid]["kind"][0], self.entities[eid]["display_name"][:80],
             self.entities[eid]["is_self"]]
            for eid, _ in rows
        ]  # fmt: skip

    # ── Periods: relationships, memberships, work ──────────────────────

    def period(self, record, rid, base, start, until, state):
        """Began / Ended entries for a record with a period, at the precision it is known."""
        out = []
        ongoing = state == "current" and not until
        common = {**base, "state": state}
        if not start and not until:
            out.append({"id": f"{record}:{rid}:record", "moment": "record", "date": None, **common})
            return out
        if start:
            # A beginning carries its end (or none: still ongoing), an end its beginning.
            out.append({"id": f"{record}:{rid}:start", "moment": "start", "date": start,
                        "until": until, "ongoing": ongoing, **common})  # fmt: skip
        if until:
            out.append({"id": f"{record}:{rid}:end", "moment": "end", "date": until,
                        "since": start, **common})  # fmt: skip
        elif state == "former":
            # Ended, but when is not recorded: say so, without inventing a date.
            out.append({"id": f"{record}:{rid}:end", "moment": "end", "date": None,
                        "since": start, **common})  # fmt: skip
        return out

    def relationship(self, r):
        if not self.live(r["subject_id"], r["object_id"]):
            return []
        t = self.known.get(r["type"]) or {"key": r["type"], "category": "other",
                                          "label": r["type"], "inverse": r["type"], "symmetric": True}  # fmt: skip
        self.types[t["key"]] = {k: t[k] for k in ("category", "label", "inverse", "symmetric")}
        base = {
            "category": "relationship", "type": t["key"],
            "detail": r["context"], "confidence": r["confidence"],
            "entities": [self.ref(r["subject_id"]), self.ref(r["object_id"])],
        }  # fmt: skip
        return self.period(
            "relationship", r["id"], base, r["valid_from"], r["valid_until"], r["state"]
        )

    def membership(self, m):
        if not self.live(m["member_id"], m["group_id"]):
            return []
        base = {
            "category": "membership", "detail": m["role"], "confidence": m["confidence"],
            "entities": [self.ref(m["member_id"]), self.ref(m["group_id"])],
        }  # fmt: skip
        return self.period(
            "membership", m["id"], base, m["valid_from"], m["valid_until"], m["state"]
        )

    def employment(self, w):
        if not self.live(w["person_id"]) or (
            w["organization_id"] and not self.live(w["organization_id"])
        ):
            return []
        people = [self.ref(w["person_id"])] + (
            [self.ref(w["organization_id"])] if w["organization_id"] else []
        )
        detail = " · ".join(x for x in (w["title"], w["department"], w["role"]) if x)
        base = {
            "category": "employment", "detail": detail, "confidence": w["confidence"], "entities": people,
            "sources": 1 if w["source_id"] else 0,
        }  # fmt: skip
        state = "former" if w["valid_until"] else "current"
        return self.period("employment", w["id"], base, w["valid_from"], w["valid_until"], state)

    # ── Occurrences: personal dates and events ─────────────────────────

    def life(self, d):
        if d["kind"] in SKIP_DATES or not self.live(d["entity_id"]):
            return []
        if not d["date"] and not d["description"]:
            return []
        kind = self.entities[d["entity_id"]]["kind"]
        phrase = LIFE.get(d["kind"], {}).get(kind) or d["label"] or d["kind"]
        return [_clean({
            "id": f"date:{d['id']}", "moment": "at",
            "category": "life", "type": d["kind"], "phrase": phrase,
            "date": d["date"], "approximate": bool(d["approximate"]), "detail": d["description"],
            "confidence": d["confidence"], "entities": [self.ref(d["entity_id"])],
            "sources": 1 if d["source_id"] else 0,
        })]  # fmt: skip

    def event(self, e, participants):
        people = [p for p in participants if self.live(p)]
        if participants and not people:
            return []  # everyone it involves is in Trash
        span = bool(e["ends"] or e["ongoing"])
        return [_clean({
            "id": f"event:{e['id']}",
            "moment": "span" if span else "at", "category": "event", "type": e["category"],
            "title": e["title"], "date": e["starts"],
            "end": e["ends"], "ongoing": bool(e["ongoing"]), "approximate": bool(e["approximate"]),
            "confidence": e["confidence"], "entities": [self.ref(p) for p in people],
            "sources": e["sources"], "editable": True,
        })]  # fmt: skip


def _participants(conn, event_ids=None):
    sql = "SELECT event_id, entity_id FROM event_participants"
    args = ()
    if event_ids is not None:
        sql += f" WHERE event_id IN ({','.join('?' * len(event_ids))})"
        args = tuple(event_ids)
    out = {}
    for r in conn.execute(sql + " ORDER BY event_id, position", args):
        out.setdefault(r["event_id"], []).append(r["entity_id"])
    return out


EVENT_SQL = (
    "SELECT e.*, (SELECT count(*) FROM provenance p WHERE p.record_kind='event' AND p.record_id=e.id) "
    "AS sources FROM events e"
)


def _entries(proj, conn, records=RECORDS, entity=None):
    """Every entry, optionally only those of the given record kinds or involving `entity`."""
    where_rel = where_mem = where_work = where_date = ""
    args = ()
    if entity:
        where_rel = " WHERE subject_id=? OR object_id=?"
        where_mem = " WHERE member_id=? OR group_id=?"
        where_work = " WHERE person_id=? OR organization_id=?"
        where_date = " WHERE entity_id=?"
        args = (entity, entity)
    out = []
    if "relationship" in records:
        for r in conn.execute("SELECT * FROM relationships" + where_rel, args):
            out += proj.relationship(r)
    if "membership" in records:
        for m in conn.execute("SELECT * FROM memberships" + where_mem, args):
            out += proj.membership(m)
    if "employment" in records:
        for w in conn.execute("SELECT * FROM employments" + where_work, args):
            out += proj.employment(w)
    if "date" in records:
        for d in conn.execute("SELECT * FROM personal_dates" + where_date, args[:1]):
            out += proj.life(d)
    if "event" in records:
        if entity:
            rows = conn.execute(
                EVENT_SQL
                + " WHERE e.id IN (SELECT event_id FROM event_participants WHERE entity_id=?)",
                (entity,),
            ).fetchall()
        else:
            rows = conn.execute(EVENT_SQL).fetchall()
        who = _participants(conn, [r["id"] for r in rows]) if entity else _participants(conn)
        for e in rows:
            out += proj.event(e, who.get(e["id"], []))
    return [_clean(x) for x in out]


def record_of(entry_id):
    """('relationship', '<id>') from 'relationship:<id>:start'."""
    parts = entry_id.split(":")
    return parts[0], parts[1] if len(parts) > 1 else ""


def describe(proj, e):
    """An entry with its record and wording spelled out, for single entries and checks."""
    record, rid = record_of(e["id"])
    out = {**e, "record": record, "record_id": rid}
    if e["category"] == "relationship":
        t = proj.types.get(e["type"], {})
        out.update(phrase=t.get("label"), inverse=t.get("inverse"), symmetric=t.get("symmetric"),
                   group=t.get("category"))  # fmt: skip
    elif e["category"] == "membership":
        out["phrase"] = "member of"
    elif e["category"] == "employment":
        out["phrase"] = "works at"
    return out


def order(entries):
    """Dated entries chronologically (partial dates first within their period), then the
    undated ones. Returns (dated, undated)."""
    dated, undated = [], []
    for e in entries:
        key = sort_key(e.get("date"))
        (dated if key else undated).append((key, e))
    dated.sort(
        key=lambda x: (
            x[0],
            MOMENT_ORDER[x[1]["moment"]],
            x[1].get("title") or x[1].get("phrase") or x[1].get("type", ""),
            x[1]["id"],
        )
    )
    undated.sort(key=lambda x: (RECORDS.index(record_of(x[1]["id"])[0]), x[1]["id"]))
    return [e for _, e in dated], [e for _, e in undated]


def project(conn, entity=None, records=RECORDS, year_from=None, year_to=None) -> dict:
    proj = Projection(conn)
    entries = _entries(proj, conn, records, entity)
    if entity:
        mine = proj.index.get(entity)
        entries = [e for e in entries if mine is not None and mine in e.get("entities", [])]
    if year_from or year_to:
        lo, hi = year_from or 1, year_to or 9999

        def inside(e):
            key = sort_key(e.get("date"))
            return key is not None and lo <= int(key[:4]) <= hi

        entries = [e for e in entries if inside(e)]
    dated, undated = order(entries)
    total = len(dated) + len(undated)
    truncated = total > MAX_ENTRIES
    if truncated:
        dated = dated[:MAX_ENTRIES]
        undated = undated[: max(0, MAX_ENTRIES - len(dated))]
    # Only the entities that the kept entries refer to; indexes are rebuilt compactly.
    used = sorted({i for e in dated + undated for i in e.get("entities", [])})
    remap = {old: new for new, old in enumerate(used)}
    table = proj.table()
    for e in dated + undated:
        if "entities" in e:
            e["entities"] = [remap[i] for i in e["entities"]]
    kept = dated + undated
    return {
        "entities": [table[i] for i in used],
        "types": {
            k: proj.types[k] for k in {e["type"] for e in kept if e["category"] == "relationship"}
        },
        "entries": dated,
        "undated": undated,
        "categories": EVENT_CATEGORIES,
        "relationship_categories": relations.CATEGORIES,
        "truncated": truncated,
    }


# ── One entry, in full ─────────────────────────────────────────────────


def entry(conn, entry_id: str):
    """Everything about one entry, read from its authoritative record."""
    parts = entry_id.split(":")
    if len(parts) not in (2, 3) or parts[0] not in RECORDS:
        return None
    record, rid = parts[0], parts[1]
    proj = Projection(conn)
    extra = {}
    if record == "relationship":
        row = conn.execute("SELECT * FROM relationships WHERE id=?", (rid,)).fetchone()
        built = proj.relationship(row) if row else []
        if row:
            extra = {"note": row["note"], "sources": sources_of(conn, "relationship", rid),
                     "subject_id": row["subject_id"], "object_id": row["object_id"]}  # fmt: skip
    elif record == "membership":
        row = conn.execute("SELECT * FROM memberships WHERE id=?", (rid,)).fetchone()
        built = proj.membership(row) if row else []
        if row:
            extra = {"note": row["note"], "sources": sources_of(conn, "membership", rid),
                     "group_id": row["group_id"], "member_id": row["member_id"]}  # fmt: skip
    elif record == "employment":
        row = conn.execute(
            "SELECT w.*, s.label AS source_label FROM employments w LEFT JOIN sources s ON s.id=w.source_id WHERE w.id=?",
            (rid,),
        ).fetchone()
        built = proj.employment(row) if row else []
        if row:
            extra = {"note": row["note"], "person_id": row["person_id"],
                     "sources": [{"kind": "imported", "label": row["source_label"]}] if row["source_label"] else []}  # fmt: skip
    elif record == "date":
        row = conn.execute(
            "SELECT d.*, s.label AS source_label FROM personal_dates d LEFT JOIN sources s ON s.id=d.source_id WHERE d.id=?",
            (rid,),
        ).fetchone()
        built = proj.life(row) if row else []
        if row:
            extra = {"note": row["note"], "entity_id": row["entity_id"], "label": row["label"],
                     "sources": [{"kind": "imported", "label": row["source_label"]}] if row["source_label"] else []}  # fmt: skip
    else:
        row = conn.execute(EVENT_SQL + " WHERE e.id=?", (rid,)).fetchone()
        built = proj.event(row, _participants(conn, [rid]).get(rid, [])) if row else []
        if row:
            extra = {"description": row["description"], "sources": sources_of(conn, "event", rid),
                     "roles": event_roles(conn, rid), "created_at": row["created_at"],
                     "updated_at": row["updated_at"]}  # fmt: skip
    match = next((_clean(e) for e in built if e["id"] == entry_id), None)
    if not match:
        return None
    match = describe(proj, match)
    if record in ("relationship", "membership", "employment"):
        match["period"] = [row["valid_from"], row["valid_until"]]
    table = proj.table()
    match["entities"] = [
        {"id": table[i][0], "kind": {"p": "person", "o": "organization", "g": "group"}[table[i][1]],
         "display_name": table[i][2]}
        for i in match.get("entities", [])
    ]  # fmt: skip
    return {**match, **extra}


def event_roles(conn, eid):
    return {r["entity_id"]: r["role"] for r in conn.execute(
        "SELECT entity_id, role FROM event_participants WHERE event_id=?", (eid,))}  # fmt: skip


# ── Native events ──────────────────────────────────────────────────────


def event_record(conn, eid) -> dict | None:
    e = conn.execute("SELECT * FROM events WHERE id=?", (eid,)).fetchone()
    if not e:
        return None
    people = conn.execute(
        "SELECT p.role, x.id, x.kind, x.display_name, x.deleted_at FROM event_participants p "
        "JOIN entities x ON x.id=p.entity_id WHERE p.event_id=? ORDER BY p.position",
        (eid,),
    ).fetchall()
    return {
        "id": e["id"], "record": "event", "title": e["title"], "description": e["description"],
        "category": e["category"], "starts": e["starts"], "ends": e["ends"],
        "ongoing": bool(e["ongoing"]), "approximate": bool(e["approximate"]),
        "confidence": e["confidence"],
        "participants": [
            {"entity": {"id": p["id"], "kind": p["kind"], "display_name": p["display_name"],
                        "deleted": bool(p["deleted_at"])}, "role": p["role"]}
            for p in people
        ],
        "sources": sources_of(conn, "event", eid),
        "created_at": e["created_at"], "updated_at": e["updated_at"],
    }  # fmt: skip


def save_event(conn, body: dict, eid=None) -> str:
    for p in body["participants"]:
        row = conn.execute(
            "SELECT deleted_at FROM entities WHERE id=?", (p["entity_id"],)
        ).fetchone()
        if not row or row["deleted_at"]:
            raise Invalid("Everyone involved must be a person, organization or group in Meridian")
    now = iso_now()
    row = {
        "title": " ".join(body["title"].split()), "description": body.get("description", ""),
        "category": body.get("category") or "milestone", "starts": body.get("starts"),
        "ends": body.get("ends"), "ongoing": 1 if body.get("ongoing") else 0,
        "approximate": 1 if body.get("approximate") else 0, "confidence": body.get("confidence"),
        "updated_at": now,
    }  # fmt: skip
    if eid:
        columns = ",".join(f"{k}=?" for k in row)
        if not conn.execute(
            f"UPDATE events SET {columns} WHERE id=?", (*row.values(), eid)
        ).rowcount:
            raise LookupError
        conn.execute("DELETE FROM event_participants WHERE event_id=?", (eid,))
    else:
        eid = uuid7()
        row.update(id=eid, created_at=now)
        conn.execute(
            f"INSERT INTO events({','.join(row)}) VALUES({','.join('?' * len(row))})",
            tuple(row.values()),
        )
    for i, p in enumerate(body["participants"]):
        conn.execute(
            "INSERT INTO event_participants(event_id,entity_id,role,position) VALUES(?,?,?,?)",
            (eid, p["entity_id"], p.get("role", ""), i),
        )
    relations._sources(conn, "event", eid, body.get("sources", []))
    return eid


def _compatible(a, b):
    """Two partial dates that may be the same day: equal at the precision both have, and
    at least a month known on both unless both are years."""
    if not a or not b or a.startswith("--") or b.startswith("--"):
        return False
    if (len(a) == 4) != (len(b) == 4):
        return False
    n = min(len(a), len(b))
    return a[:n] == b[:n]


def similar(conn, starts, entity_ids, exclude=None) -> list:
    """Entries already on the Timeline that a new event may repeat: on a compatible date and
    involving the same entities (two of them, or all when fewer). Similar is not identical;
    the user decides."""
    if not starts or not entity_ids:
        return []
    wanted = set(entity_ids)
    proj = Projection(conn)
    found = []
    seen = set()
    for eid in wanted:
        for e in _entries(proj, conn, entity=eid):
            if e["id"] in seen or (exclude and record_of(e["id"])[1] == exclude):
                continue
            if not _compatible(e.get("date"), starts):
                continue
            ids = {proj.ids[i] for i in e.get("entities", [])}
            need = min(2, len(wanted), len(ids))
            if len(ids & wanted) >= need:
                found.append(e)
                seen.add(e["id"])
    table = proj.table()
    found = [describe(proj, e) for e in found]
    for e in found:
        e["entities"] = [{"id": table[i][0], "kind": {"p": "person", "o": "organization", "g": "group"}[table[i][1]],
                          "display_name": table[i][2]} for i in e.get("entities", [])]  # fmt: skip
    return order(found)[0][:10]
