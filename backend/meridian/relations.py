"""Relationships between entities, Group memberships, their provenance, and the graph view.

A relationship is one authoritative record: subject, type, object. Its type says how it
reads in each direction ("parent of" / "child of"); the inverse is derived when the record
is read from the object's side and is never stored as a second record. Symmetric types
("friend of") read the same both ways. Types are an open vocabulary: built-ins below, plus
user-defined types in the relationship_types table, so no migration is needed for a new one.

Group membership is a separate record (member, Group, role, period). Sharing a Group never
creates or implies a relationship, and nothing here infers relationships from shared
attributes: every edge in the graph is a stored record.
"""

from datetime import date

from .util import iso_now, uuid7

PER, ORG, GRP = "person", "organization", "group"
ANY = (PER, ORG, GRP)
STATES = ("current", "former", "unknown")

# category: (label, order). Categories are for filtering and colour; open for custom types.
CATEGORIES = {
    "family": "Family",
    "partner": "Partners",
    "social": "Friends and social",
    "professional": "Professional",
    "affiliation": "Organization affiliation",
    "structure": "Organization structure",
    "membership": "Group membership",
    "employment": "Work",
    "other": "Other",
}


def _t(key, category, label, inverse=None, subject=(PER,), object_=(PER,)):
    return key, {
        "key": key, "category": category, "label": label, "inverse": inverse or label,
        "symmetric": inverse is None, "subject_kinds": list(subject), "object_kinds": list(object_),
        "builtin": True,
    }  # fmt: skip


BUILTIN = dict(
    [
        # Family
        _t("parent", "family", "parent of", "child of"),
        _t("sibling", "family", "sibling of"),
        _t("grandparent", "family", "grandparent of", "grandchild of"),
        _t("aunt_uncle", "family", "aunt or uncle of", "niece or nephew of"),
        _t("cousin", "family", "cousin of"),
        _t("guardian", "family", "guardian of", "in the care of"),
        _t("relative", "family", "relative of"),
        # Partners (a former partnership is the same type with state "former")
        _t("partner", "partner", "partner of"),
        _t("spouse", "partner", "married to"),
        _t("engaged", "partner", "engaged to"),
        _t("dating", "partner", "dating"),
        # Friends and social
        _t("friend", "social", "friend of"),
        _t("acquaintance", "social", "knows"),
        _t("classmate", "social", "classmate of"),
        _t("roommate", "social", "roommate of"),
        _t("neighbor", "social", "neighbor of"),
        # Professional, between people
        _t("colleague", "professional", "colleague of"),
        _t("manager", "professional", "manager of", "reports to"),
        _t("mentor", "professional", "mentor of", "mentored by"),
        _t("teacher", "professional", "teacher of", "student of"),
        _t("client", "professional", "client of", "provides services to"),
        _t("business_partner", "professional", "business partner of"),
        # People and organizations with organizations. Employment is not here: it is the
        # Work record, which the graph shows as its own edge.
        _t("founder", "affiliation", "founder of", "founded by", (PER, ORG), (ORG,)),
        _t("owner", "affiliation", "owner of", "owned by", (PER, ORG), (ORG,)),
        _t("board_member", "affiliation", "board member of", "has board member", (PER,), (ORG,)),
        _t("member", "affiliation", "member of", "has member", (PER, ORG), (ORG,)),
        _t("volunteer", "affiliation", "volunteer at", "has volunteer", (PER,), (ORG,)),
        _t("studies_at", "affiliation", "studies at", "has student", (PER,), (ORG,)),
        _t("teaches_at", "affiliation", "teaches at", "has teacher", (PER,), (ORG,)),
        _t("contractor", "affiliation", "contractor for", "contracts", (PER, ORG), (ORG,)),
        _t("customer", "affiliation", "customer of", "has customer", (PER, ORG), (ORG,)),
        _t("affiliated", "affiliation", "affiliated with", None, ANY, ANY),
        # Organization structure (a hierarchy does not imply legal ownership)
        _t("subsidiary", "structure", "subsidiary of", "parent company of", (ORG,), (ORG,)),
        _t("part_of", "structure", "part of", "includes", (ORG,), (ORG,)),
        _t("branch", "structure", "branch of", "has branch", (ORG,), (ORG,)),
        _t("successor", "structure", "successor of", "predecessor of", (ORG,), (ORG,)),
        _t("acquired_by", "structure", "acquired by", "acquired", (ORG,), (ORG,)),
        _t("partner_org", "structure", "partners with", None, (ORG,), (ORG,)),
    ]
)
# Edges derived from other authoritative records, described like types for the graph.
MEMBERSHIP = {"key": "membership", "category": "membership", "label": "member of",
              "inverse": "has member", "symmetric": False}  # fmt: skip
EMPLOYMENT = {"key": "employment", "category": "employment", "label": "works at",
              "inverse": "employs", "symmetric": False}  # fmt: skip


class Invalid(ValueError):
    """A request that cannot be stored as asked; the message is shown to the user."""


class Similar(Exception):
    """A similar relationship already exists; the caller decides with full knowledge."""

    def __init__(self, records):
        super().__init__("A similar relationship already exists")
        self.records = records


def types(conn) -> dict:
    """Every relationship type: built-ins, then user-defined ones."""
    result = dict(BUILTIN)
    for r in conn.execute("SELECT * FROM relationship_types ORDER BY label"):
        result[r["id"]] = {
            "key": r["id"], "category": r["category"], "label": r["label"],
            "inverse": r["inverse_label"], "symmetric": bool(r["symmetric"]),
            "subject_kinds": list(ANY), "object_kinds": list(ANY), "builtin": False,
        }  # fmt: skip
    return result


def create_type(conn, label: str, inverse: str, symmetric: bool, category: str) -> dict:
    label = " ".join(label.split()).lower()
    inverse = " ".join((inverse or "").split()).lower()
    if symmetric or not inverse:
        symmetric, inverse = True, label
    existing = [t for t in types(conn).values() if t["label"] == label and t["inverse"] == inverse]
    if existing:
        return existing[0]
    tid = "c-" + uuid7()
    now = iso_now()
    conn.execute(
        "INSERT INTO relationship_types(id,category,label,inverse_label,symmetric,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (tid, category or "other", label, inverse, 1 if symmetric else 0, now, now),
    )
    return types(conn)[tid]


def _entity(conn, eid):
    return conn.execute(
        "SELECT id, kind, display_name, deleted_at FROM entities WHERE id=?", (eid,)
    ).fetchone()


def _ordered(start, end):
    """A period whose end is not before its start, at whatever precision each is known."""
    if start and end:
        if start.startswith("--") or end.startswith("--"):
            raise Invalid("A start or end date needs a year")
        n = min(len(start), len(end))
        if end[:n] < start[:n]:
            raise Invalid("The end is before the start")


def _state(state, until):
    """An end date makes a current relationship a former one; it is kept, not deleted."""
    if until and state == "current" and until <= date.today().isoformat()[: len(until)]:
        return "former"
    return state


def _sources(conn, kind, rid, sources):
    conn.execute("DELETE FROM provenance WHERE record_kind=? AND record_id=?", (kind, rid))
    now = iso_now()
    for i, s in enumerate(sources):
        ref = s.get("entity_id")
        if ref and not _entity(conn, ref):
            raise Invalid("A source refers to someone who is not in Meridian")
        conn.execute(
            "INSERT INTO provenance(id,record_kind,record_id,kind,entity_id,label,learned,position,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (uuid7(), kind, rid, s["kind"], ref, s.get("label", ""), s.get("learned"), i, now),
        )


def sources_of(conn, kind, rid) -> list:
    return [
        {"kind": r["kind"], "entity_id": r["entity_id"], "entity_name": r["display_name"],
         "label": r["label"], "learned": r["learned"]}
        for r in conn.execute(
            "SELECT p.*, e.display_name FROM provenance p LEFT JOIN entities e ON e.id=p.entity_id "
            "WHERE p.record_kind=? AND p.record_id=? ORDER BY p.position",
            (kind, rid),
        )
    ]  # fmt: skip


def similar(conn, subject, object_, type_key, exclude=None, symmetric=False) -> list:
    """Existing relationships of the same type between the same two entities (either
    direction for a symmetric type). Similar is not identical: the caller asks the user."""
    pairs = [(subject, object_)] + ([(object_, subject)] if symmetric else [])
    found = []
    for a, b in pairs:
        found += conn.execute(
            "SELECT * FROM relationships WHERE subject_id=? AND object_id=? AND type=? AND id IS NOT ?",
            (a, b, type_key, exclude),
        ).fetchall()
    return [dict(r) for r in found]


def save_relationship(conn, body: dict, rid=None, allow_similar=False) -> str:
    known = types(conn)
    t = known.get(body["type"])
    if not t:
        raise Invalid("Choose a relationship type")
    subject, object_ = _entity(conn, body["subject_id"]), _entity(conn, body["object_id"])
    if not subject or not object_ or subject["deleted_at"] or object_["deleted_at"]:
        raise Invalid("Both sides must be people, organizations or groups in Meridian")
    if subject["id"] == object_["id"]:
        raise Invalid("A relationship needs two different entities")
    if subject["kind"] not in t["subject_kinds"] or object_["kind"] not in t["object_kinds"]:
        raise Invalid(f"“{t['label']}” does not fit a {subject['kind']} and a {object_['kind']}")
    _ordered(body.get("valid_from"), body.get("valid_until"))
    if not allow_similar:
        twins = similar(conn, subject["id"], object_["id"], t["key"], rid, t["symmetric"])
        if twins:
            raise Similar(twins)
    now = iso_now()
    row = {
        "subject_id": subject["id"], "object_id": object_["id"], "type": t["key"],
        "context": body.get("context", ""), "state": _state(body.get("state", "current"), body.get("valid_until")),
        "valid_from": body.get("valid_from"), "valid_until": body.get("valid_until"),
        "confidence": body.get("confidence"), "note": body.get("note", ""), "updated_at": now,
    }  # fmt: skip
    if rid:
        columns = ",".join(f"{k}=?" for k in row)
        if not conn.execute(
            f"UPDATE relationships SET {columns} WHERE id=?", (*row.values(), rid)
        ).rowcount:
            raise LookupError
    else:
        rid = uuid7()
        row.update(id=rid, created_at=now)
        conn.execute(
            f"INSERT INTO relationships({','.join(row)}) VALUES({','.join('?' * len(row))})",
            tuple(row.values()),
        )
    _sources(conn, "relationship", rid, body.get("sources", []))
    return rid


def save_membership(conn, body: dict, mid=None) -> str:
    group, member = _entity(conn, body["group_id"]), _entity(conn, body["member_id"])
    if not group or group["kind"] != GRP or group["deleted_at"]:
        raise Invalid("Choose a group")
    if not member or member["deleted_at"] or member["kind"] == GRP:
        raise Invalid("Members are people or organizations in Meridian")
    _ordered(body.get("valid_from"), body.get("valid_until"))
    now = iso_now()
    row = {
        "group_id": group["id"], "member_id": member["id"], "role": body.get("role", ""),
        "state": _state(body.get("state", "current"), body.get("valid_until")),
        "valid_from": body.get("valid_from"), "valid_until": body.get("valid_until"),
        "confidence": body.get("confidence"), "note": body.get("note", ""), "updated_at": now,
    }  # fmt: skip
    if mid:
        columns = ",".join(f"{k}=?" for k in row)
        if not conn.execute(
            f"UPDATE memberships SET {columns} WHERE id=?", (*row.values(), mid)
        ).rowcount:
            raise LookupError
    else:
        mid = uuid7()
        row.update(id=mid, created_at=now)
        conn.execute(
            f"INSERT INTO memberships({','.join(row)}) VALUES({','.join('?' * len(row))})",
            tuple(row.values()),
        )
    _sources(conn, "membership", mid, body.get("sources", []))
    return mid


def _side(conn, eid):
    e = _entity(conn, eid)
    return {"id": e["id"], "kind": e["kind"], "display_name": e["display_name"],
            "deleted": bool(e["deleted_at"])} if e else None  # fmt: skip


def relationship_record(conn, row, perspective=None, known=None) -> dict:
    """A relationship as stored, plus how it reads from `perspective`'s side."""
    known = known or types(conn)
    t = known.get(row["type"]) or {"key": row["type"], "category": "other", "label": row["type"],
                                   "inverse": row["type"], "symmetric": True}  # fmt: skip
    as_subject = perspective != row["object_id"]
    other = row["object_id"] if as_subject else row["subject_id"]
    return {
        "id": row["id"], "record": "relationship", "type": t["key"], "category": t["category"],
        "label": t["label"], "inverse": t["inverse"], "symmetric": t["symmetric"],
        "phrase": t["label"] if as_subject else t["inverse"],
        "direction": "mutual" if t["symmetric"] else ("out" if as_subject else "in"),
        "subject": _side(conn, row["subject_id"]), "object": _side(conn, row["object_id"]),
        "other": _side(conn, other) if perspective else None,
        "context": row["context"], "state": row["state"], "valid_from": row["valid_from"],
        "valid_until": row["valid_until"], "confidence": row["confidence"], "note": row["note"],
        "sources": sources_of(conn, "relationship", row["id"]),
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }  # fmt: skip


def membership_record(conn, row, perspective=None) -> dict:
    as_member = perspective != row["group_id"]
    return {
        "id": row["id"], "record": "membership", "type": "membership", "category": "membership",
        "phrase": "member of" if as_member else "has member", "direction": "out" if as_member else "in",
        "group": _side(conn, row["group_id"]), "member": _side(conn, row["member_id"]),
        "other": _side(conn, row["group_id"] if as_member else row["member_id"]) if perspective else None,
        "role": row["role"], "state": row["state"], "valid_from": row["valid_from"],
        "valid_until": row["valid_until"], "confidence": row["confidence"], "note": row["note"],
        "sources": sources_of(conn, "membership", row["id"]),
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }  # fmt: skip


def for_entity(conn, eid) -> dict:
    """Everything that connects an entity to others, read from its side."""
    known = types(conn)
    rels = [
        relationship_record(conn, r, eid, known)
        for r in conn.execute(
            "SELECT * FROM relationships WHERE subject_id=? OR object_id=? ORDER BY "
            "CASE state WHEN 'current' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, "
            "coalesce(valid_from,''), created_at",
            (eid, eid),
        )
    ]
    members = [
        membership_record(conn, r, eid)
        for r in conn.execute(
            "SELECT * FROM memberships WHERE group_id=? OR member_id=? ORDER BY "
            "CASE state WHEN 'current' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, "
            "coalesce(valid_from,''), created_at",
            (eid, eid),
        )
    ]
    return {"relationships": rels, "memberships": members}


def between(conn, a, b) -> dict:
    """Every stored record that connects two entities: what a graph edge stands for."""
    known = types(conn)
    rels = conn.execute(
        "SELECT * FROM relationships WHERE (subject_id=? AND object_id=?) OR (subject_id=? AND object_id=?) "
        "ORDER BY created_at",
        (a, b, b, a),
    ).fetchall()
    members = conn.execute(
        "SELECT * FROM memberships WHERE (group_id=? AND member_id=?) OR (group_id=? AND member_id=?) "
        "ORDER BY created_at",
        (a, b, b, a),
    ).fetchall()
    work = conn.execute(
        "SELECT w.*, p.display_name AS person_name, o.display_name AS organization_name FROM employments w "
        "JOIN entities p ON p.id=w.person_id JOIN entities o ON o.id=w.organization_id "
        "WHERE (w.person_id=? AND w.organization_id=?) OR (w.person_id=? AND w.organization_id=?) "
        "ORDER BY w.position",
        (a, b, b, a),
    ).fetchall()
    return {
        "relationships": [relationship_record(conn, r, a, known) for r in rels],
        "memberships": [membership_record(conn, r, a) for r in members],
        "employments": [
            {"id": w["id"], "record": "employment", "person_id": w["person_id"],
             "person_name": w["person_name"], "organization_id": w["organization_id"],
             "organization_name": w["organization_name"], "title": w["title"],
             "department": w["department"], "role": w["role"],
             "state": "former" if w["valid_until"] else "current",
             "valid_from": w["valid_from"], "valid_until": w["valid_until"]}
            for w in work
        ],
    }  # fmt: skip


# The graph projection is derived from the authoritative records on every request: there
# is no separate graph store to keep in sync. It is compact (edges refer to node indexes,
# details are fetched on selection) so large graphs stay within the gateway's 2 MiB limit.
MAX_NODES = 20000
MAX_EDGES = 60000
STATE_CODE = {"current": 0, "former": 1, "unknown": 2}
CONF_CODE = {None: 0, "unknown": 1, "low": 2, "medium": 3, "high": 4}


def graph(conn) -> dict:
    rows = conn.execute(
        "SELECT id, kind, display_name, is_self FROM entities WHERE deleted_at IS NULL "
        "ORDER BY kind, sort_key LIMIT ?",
        (MAX_NODES + 1,),
    ).fetchall()
    truncated = len(rows) > MAX_NODES
    rows = rows[:MAX_NODES]
    index = {r["id"]: i for i, r in enumerate(rows)}
    nodes = [[r["id"], r["kind"][0], r["display_name"][:80], r["is_self"]] for r in rows]
    known = types(conn)
    used, edges = {}, []

    def add(a, b, kind, type_key, state, confidence=None):
        if a in index and b in index and len(edges) < MAX_EDGES:
            if type_key not in used:
                used[type_key] = len(used)
            edges.append(
                [
                    index[a],
                    index[b],
                    kind,
                    used[type_key],
                    STATE_CODE.get(state, 2),
                    CONF_CODE.get(confidence, 0),
                ]
            )

    for r in conn.execute(
        "SELECT subject_id, object_id, type, state, confidence FROM relationships"
    ):
        add(r[0], r[1], "r", r[2], r[3], r[4])
    for r in conn.execute("SELECT member_id, group_id, state, confidence FROM memberships"):
        add(r[0], r[1], "m", "membership", r[2], r[3])
    for r in conn.execute(
        "SELECT person_id, organization_id, valid_until, confidence FROM employments WHERE organization_id IS NOT NULL"
    ):
        add(r[0], r[1], "e", "employment", "former" if r[2] else "current", r[3])
    total_edges = (
        conn.execute("SELECT count(*) FROM relationships").fetchone()[0]
        + conn.execute("SELECT count(*) FROM memberships").fetchone()[0]
        + conn.execute(
            "SELECT count(*) FROM employments WHERE organization_id IS NOT NULL"
        ).fetchone()[0]
    )
    describe = {**known, "membership": MEMBERSHIP, "employment": EMPLOYMENT}
    type_list = [None] * len(used)
    for key, i in used.items():
        t = describe.get(key) or {
            "key": key,
            "category": "other",
            "label": key,
            "inverse": key,
            "symmetric": True,
        }
        type_list[i] = {k: t[k] for k in ("key", "category", "label", "inverse", "symmetric")}
    return {
        "nodes": nodes,
        "edges": edges,
        "types": type_list,
        "truncated": truncated or len(edges) < total_edges and len(edges) >= MAX_EDGES,
    }
