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
# Kinship origin (schema 6): how a parent or sibling relationship came about, stored on the
# record itself so "sibling of" stays one type. NULL means "not recorded" (every record made
# before 0.5.0): it is never read as biological. Biological and adoptive kinship are separate
# records and may coexist; adoption never replaces a biological record.
KINSHIP = {
    "parent": ("biological", "adoptive", "step"),
    "sibling": ("biological_full", "biological_half", "biological", "adoptive", "step"),
}
# Kinship that a new relationship never ends: it does not stop through death, estrangement or
# lost contact (conflict is a separate matter, recorded separately).
PERMANENT = {"parent", "sibling", "grandparent", "aunt_uncle", "cousin", "relative"}
# Categories in which a new relationship usually takes over from an ongoing one (dating, then
# engaged, then married); only these are offered for ending by default.
SUCCESSIVE = {"partner"}
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


def similar(conn, subject, object_, type_key, exclude=None, symmetric=False, kinship=None) -> list:
    """Existing relationships of the same type between the same two entities (either
    direction for a symmetric type). Similar is not identical: the caller asks the user.
    Records with different known kinship (a biological and an adoptive parent record) are
    not similar; an unrecorded kinship may be either, so it is."""
    pairs = [(subject, object_)] + ([(object_, subject)] if symmetric else [])
    found = []
    for a, b in pairs:
        found += conn.execute(
            "SELECT * FROM relationships WHERE subject_id=? AND object_id=? AND type=? AND id IS NOT ?",
            (a, b, type_key, exclude),
        ).fetchall()
    return [dict(r) for r in found if not kinship or not r["kinship"] or r["kinship"] == kinship]


def check_kinship(type_key, kinship):
    if kinship is None:
        return None
    if kinship not in KINSHIP.get(type_key, ()):
        raise Invalid("Kinship applies to parent and sibling relationships only")
    return kinship


def save_relationship(conn, body: dict, rid=None, allow_similar=False) -> str:
    known = types(conn)
    t = known.get(body["type"])
    if not t:
        raise Invalid("Choose a relationship type")
    kinship = check_kinship(t["key"], body.get("kinship"))
    subject, object_ = _entity(conn, body["subject_id"]), _entity(conn, body["object_id"])
    if not subject or not object_ or subject["deleted_at"] or object_["deleted_at"]:
        raise Invalid("Both sides must be people, organizations or groups in Meridian")
    if subject["id"] == object_["id"]:
        raise Invalid("A relationship needs two different entities")
    if subject["kind"] not in t["subject_kinds"] or object_["kind"] not in t["object_kinds"]:
        raise Invalid(f"“{t['label']}” does not fit a {subject['kind']} and a {object_['kind']}")
    _ordered(body.get("valid_from"), body.get("valid_until"))
    if not allow_similar:
        twins = similar(conn, subject["id"], object_["id"], t["key"], rid, t["symmetric"], kinship)
        if twins:
            raise Similar(twins)
    now = iso_now()
    row = {
        "subject_id": subject["id"], "object_id": object_["id"], "type": t["key"], "kinship": kinship,
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
        "kinship": row["kinship"], "permanent": t["key"] in PERMANENT,
        "sources": sources_of(conn, "relationship", row["id"]),
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }  # fmt: skip


def date_suggestion(conn, subject, object_, type_key, kinship=None) -> dict:
    """A start date to suggest for a new relationship: for biological (or not yet specified)
    parenthood, the child's birth date at the precision it is known. Adoptive and step
    parenthood do not begin at birth, so nothing is suggested for them; nothing is ever
    suggested as an end date."""
    if type_key != "parent" or kinship in ("adoptive", "step"):
        return {}
    child = _entity(conn, object_)
    if not child or child["kind"] != PER or child["deleted_at"]:
        return {}
    row = conn.execute(
        "SELECT date, approximate FROM personal_dates WHERE entity_id=? AND kind='birth' "
        "AND date IS NOT NULL AND valid_until IS NULL ORDER BY position LIMIT 1",
        (object_,),
    ).fetchone()
    if not row or row["date"].startswith("--"):
        return {}  # a birthday without a year cannot be a start date
    return {"valid_from": row["date"], "approximate": bool(row["approximate"]),
            "reason": "birth", "child": _side(conn, object_)}  # fmt: skip


# ── Ongoing relationships when another begins ──────────────────────────


def ongoing(row) -> bool:
    """No end date and not marked ended: possibly still going on. A record marked former
    without a date has ended at an unknown time, so it is not a candidate."""
    return not row["valid_until"] and row["state"] != "former"


def active_between(conn, subject, object_, type_key, exclude=None) -> list:
    """Relationships between the two entities, in either direction, that may still be going
    on and that a new `type_key` relationship could take over from. Permanent kinship is
    never offered, nor is the same type (that is the duplicate check's question). Each comes
    with `suggest_end`: true only where one usually follows the other (partners)."""
    known = types(conn)
    new = known.get(type_key)
    if not new or new["key"] in PERMANENT:
        return []
    rows = conn.execute(
        "SELECT * FROM relationships WHERE ((subject_id=? AND object_id=?) OR (subject_id=? AND object_id=?)) "
        "AND type<>? AND id IS NOT ? ORDER BY coalesce(valid_from,''), created_at",
        (subject, object_, object_, subject, new["key"], exclude),
    ).fetchall()
    out = []
    for r in rows:
        if r["type"] in PERMANENT or not ongoing(r):
            continue
        record = relationship_record(conn, r, subject, known)
        record["suggest_end"] = (
            record["category"] == new["category"] and new["category"] in SUCCESSIVE
        )
        out.append(record)
    return out


def end_for_transition(conn, subject, object_, items) -> list:
    """End the chosen ongoing relationships because a new one begins: set the end date when
    it is known, mark them former either way. Runs inside the caller's transaction, after the
    new record is written, so a refusal here rolls back the whole transition."""
    ended = []
    for item in items:
        row = conn.execute("SELECT * FROM relationships WHERE id=?", (item["id"],)).fetchone()
        if not row or {row["subject_id"], row["object_id"]} != {subject, object_}:
            raise Invalid("A relationship to end is not between these two")
        if row["type"] in PERMANENT:
            raise Invalid("Kinship does not end because another relationship begins")
        if not ongoing(row):
            raise Conflict("That relationship has changed meanwhile; review it and try again")
        until = item.get("valid_until")
        _ordered(row["valid_from"], until)
        conn.execute(
            "UPDATE relationships SET valid_until=?, state='former', updated_at=? WHERE id=?",
            (until, iso_now(), row["id"]),
        )
        ended.append(row["id"])
    return ended


class Conflict(Exception):
    """The data changed between what the user saw and what they confirmed."""


# ── Siblings from shared parents ───────────────────────────────────────

KINSHIP_RANK = {"biological": 1, "biological_half": 2, "biological_full": 2}


def parents_of(conn, child) -> dict:
    """{parent id: set of kinship values} for a child's recorded parents (live entities).
    Step-parent links are left out: they say nothing about siblinghood by themselves."""
    out = {}
    for r in conn.execute(
        "SELECT r.subject_id, r.kinship FROM relationships r JOIN entities e ON e.id=r.subject_id "
        "WHERE r.type='parent' AND r.object_id=? AND e.deleted_at IS NULL",
        (child,),
    ):
        if r["kinship"] != "step":
            out.setdefault(r["subject_id"], set()).add(r["kinship"])
    return out


def _not_biological(parent, links: dict) -> bool:
    """Certainly not this child's biological parent: an adoptive link and no biological one,
    or the child already has two other confirmed biological parents."""
    kinds = links.get(parent, set())
    if "biological" in kinds:
        return False
    if "adoptive" in kinds:
        return True
    bio = {p for p, k in links.items() if "biological" in k}
    return len(bio) >= 2 and parent not in bio


def classify(links_a: dict, links_b: dict):
    """What recorded parents say about two people: None when they share no parent, else
    (kinship or None, reason). Only explicitly biological links count as biological; an
    unknown second parent is uncertainty, never a half-sibling conclusion."""
    shared = set(links_a) & set(links_b)
    if not shared:
        return None
    bio_shared = {p for p in shared if "biological" in links_a[p] and "biological" in links_b[p]}
    if len(bio_shared) >= 2:
        return "biological_full", "two_biological"
    if len(bio_shared) == 1:
        others_a = {p for p, k in links_a.items() if "biological" in k} - bio_shared
        others_b = {p for p, k in links_b.items() if "biological" in k} - bio_shared
        if any(_not_biological(p, links_b) for p in others_a) or any(
            _not_biological(p, links_a) for p in others_b
        ):
            return "biological_half", "one_biological_other_different"
        return "biological", "one_biological_other_unknown"
    if any("adoptive" in links_a[p] or "adoptive" in links_b[p] for p in shared):
        return "adoptive", "adoptive"
    return None, "unspecified"


def _brief(conn, eid):
    r = conn.execute("SELECT id, kind, display_name FROM entities WHERE id=?", (eid,)).fetchone()
    return {"id": r["id"], "kind": r["kind"], "display_name": r["display_name"]}


def sibling_records(conn, a, b) -> list:
    return [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM relationships WHERE type='sibling' AND "
            "((subject_id=? AND object_id=?) OR (subject_id=? AND object_id=?)) ORDER BY created_at",
            (a, b, b, a),
        )
    ]


def _proposal(existing: list, kinship):
    """('create', None) or ('update', record) or None for a pair already recorded as well
    as the evidence allows. Specific known kinship is never downgraded to a vaguer one."""
    kinds = [r["kinship"] for r in existing]
    if kinship in kinds and kinship is not None:
        return None
    if kinship is None:
        return None if existing else ("create", None)
    if not existing:
        return "create", None
    if kinship == "adoptive":
        target = next((r for r in existing if r["kinship"] in (None, "step")), None)
        return ("update", target) if target else None
    # A biological classification: refine an unrecorded or vaguer biological record, or
    # correct full/half when the parents now confirm the other; otherwise add it beside an
    # adoptive or step record (both kinds of siblinghood can be true at once).
    bio = [r for r in existing if r["kinship"] in KINSHIP_RANK]
    if bio:
        target = bio[0]
        if KINSHIP_RANK[kinship] < KINSHIP_RANK[target["kinship"]]:
            return None
        return "update", target
    blank = next((r for r in existing if r["kinship"] is None), None)
    if blank:
        return "update", blank
    return "create", None


def sibling_suggestions(conn, rid) -> dict:
    """Possible siblings of the child in parent relationship `rid`, from the parents recorded
    so far. A suggestion only: nothing is written here."""
    row = conn.execute("SELECT * FROM relationships WHERE id=?", (rid,)).fetchone()
    if not row:
        raise LookupError
    if row["type"] != "parent" or row["kinship"] == "step":
        return {"child": None, "suggestions": []}
    parent, child = row["subject_id"], row["object_id"]
    people = {
        r["id"]: r
        for r in conn.execute(
            "SELECT id, kind, deleted_at FROM entities WHERE id IN (?,?)", (parent, child)
        )
    }
    if any(people.get(x) is None or people[x]["deleted_at"] or people[x]["kind"] != PER
           for x in (parent, child)):  # fmt: skip
        return {"child": None, "suggestions": []}
    mine = parents_of(conn, child)
    others = [
        r["object_id"]
        for r in conn.execute(
            "SELECT DISTINCT r.object_id FROM relationships r JOIN entities e ON e.id=r.object_id "
            "WHERE r.type='parent' AND r.subject_id=? AND r.object_id<>? AND e.deleted_at IS NULL "
            "AND e.kind='person' AND (r.kinship IS NULL OR r.kinship<>'step')",
            (parent, child),
        )
    ]
    out = []
    for other in others:
        theirs = parents_of(conn, other)
        found = classify(mine, theirs)
        if not found:
            continue
        kinship, reason = found
        existing = sibling_records(conn, child, other)
        decision = _proposal(existing, kinship)
        if not decision:
            continue
        action, record = decision
        shared = sorted(set(mine) & set(theirs))
        out.append({
            "a": _brief(conn, child), "b": _brief(conn, other), "action": action,
            "kinship": kinship, "reason": reason,
            "record_id": record["id"] if record else None,
            "current_kinship": record["kinship"] if record else None,
            "shared_parents": [
                {**_brief(conn, p), "a": sorted(k or "" for k in mine[p]),
                 "b": sorted(k or "" for k in theirs[p])}
                for p in shared
            ],
        })  # fmt: skip
    return {"child": _brief(conn, child), "suggestions": out}


CONFIRMED_SOURCE = {
    "kind": "other",
    "label": "Confirmed by you from the parents recorded in Meridian",
}


def apply_siblings(conn, items) -> dict:
    """Create or update the sibling records the user confirmed, all or nothing. A pair that
    meanwhile got the same record is skipped rather than duplicated."""
    created = updated = skipped = 0
    for item in items:
        a, b, kinship = item["a"], item["b"], check_kinship("sibling", item.get("kinship"))
        existing = sibling_records(conn, a, b)
        if item.get("record_id"):
            target = next((r for r in existing if r["id"] == item["record_id"]), None)
            if not target:
                raise Conflict("A sibling relationship changed meanwhile; review it and try again")
            if target["kinship"] == kinship:
                skipped += 1
                continue
            conn.execute(
                "UPDATE relationships SET kinship=?, updated_at=? WHERE id=?",
                (kinship, iso_now(), target["id"]),
            )
            updated += 1
            continue
        if any(r["kinship"] == kinship or kinship is None for r in existing):
            skipped += 1
            continue
        if any(r["kinship"] is None for r in existing):
            # A sibling record appeared meanwhile; it may be this one, so ask again.
            raise Conflict("A sibling relationship changed meanwhile; review it and try again")
        save_relationship(
            conn,
            {"subject_id": a, "object_id": b, "type": "sibling", "kinship": kinship,
             "sources": [CONFIRMED_SOURCE]},
            allow_similar=True,
        )  # fmt: skip
        created += 1
    return {"created": created, "updated": updated, "skipped": skipped}


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
