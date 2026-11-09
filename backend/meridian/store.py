"""Persistence of Person documents over the entity core and its record tables."""

import hashlib
import json

from . import relations
from .util import email_key, fold, iso_now, phone_digits, phone_key, uuid7

# Section name in a Person document -> (table, entity column, editable columns)
COMMON = ("valid_from", "valid_until", "confidence", "note")
SECTIONS = {
    "names": ("names", "entity_id", ("kind", "value", "given", "middle", "family", "prefix", "suffix")),
    "contacts": ("contact_points", "entity_id", ("channel", "value", "label", "is_primary")),
    "addresses": (
        "addresses",
        "entity_id",
        ("label", "street", "extended", "po_box", "locality", "region", "postal_code", "country",
         "formatted", "is_primary"),
    ),
    "dates": ("personal_dates", "entity_id", ("kind", "label", "date", "description", "approximate")),
    "employments": ("employments", "person_id", ("organization_id", "title", "department", "role")),
    "accounts": ("accounts", "entity_id", ("service", "handle", "display_name", "url", "state")),
    "facts": ("facts", "entity_id", ("key", "value")),
    # 0.7.0 (schema 7): dedicated records (owner decision D7).
    "education": (
        "educations",
        "person_id",
        ("organization_id", "kind", "department", "program", "field", "degree", "status",
         "achievements"),
    ),
    "interests": (
        "interests",
        "entity_id",
        ("category", "subject", "sentiment", "context", "target_kind", "target_ref"),
    ),
}  # fmt: skip
NULLABLE = ("valid_from", "valid_until", "confidence", "date", "organization_id", "target_ref")


def compose(name: dict) -> str:
    parts = (name.get("prefix"), name.get("given"), name.get("middle"), name.get("family"),
             name.get("suffix"))  # fmt: skip
    return " ".join(p for p in parts if p)


def name_text(name: dict) -> str:
    return name.get("value") or compose(name)


def display_name(names: list) -> str:
    full = [n for n in names if n.get("kind") == "full"]
    return name_text((full or names)[0]) if names else ""


def sort_key(names: list) -> str:
    full = [n for n in names if n.get("kind") == "full"] or names
    if not full:
        return ""
    first = full[0]
    if first.get("family"):
        return fold(f"{first['family']} {first.get('given', '')} {first.get('middle', '')}")
    return fold(name_text(first))


def _joined(*parts) -> str:
    return " ".join(p for p in parts if p)


def name_orders(names: list) -> tuple:
    """(first-name-first, last-name-first, "Last, First" display) for the main name.

    Structured parts decide; prefixes and suffixes never take part in sorting. A name stored
    only as one piece of text ("Vzorko Kvázimenný" without parts) is used as it is in every
    order: Meridian does not guess which word is the family name."""
    full = [n for n in names if n.get("kind") == "full"] or names
    if not full:
        return "", "", ""
    n = full[0]
    given, middle, family = n.get("given", ""), n.get("middle", ""), n.get("family", "")
    if not (given or middle or family):
        text = name_text(n)
        return text, text, text
    given_first = _joined(given, middle, family)
    family_first = _joined(family, given, middle)
    if family and (given or middle):
        shown = f"{family}, {_joined(n.get('prefix'), given, middle)}"
        if n.get("suffix"):
            shown += f", {n['suffix']}"
    else:
        shown = name_text(n)
    return given_first, family_first, shown


def refresh_names(conn, entity_id: str):
    """Recompute only the name-order columns (also used by the schema 6 migration)."""
    names = [dict(r) for r in conn.execute(
        "SELECT * FROM names WHERE entity_id=? ORDER BY position", (entity_id,))]  # fmt: skip
    if not names:
        # Entities created before they had name records keep their display name.
        row = conn.execute("SELECT display_name FROM entities WHERE id=?", (entity_id,)).fetchone()
        text = row[0] if row and row[0] != "Unnamed" else ""
        orders = (text, text, text)
    else:
        orders = name_orders(names)
    conn.execute(
        "UPDATE entities SET name_given_first=?, name_family_first=?, display_family_first=? "
        "WHERE id=?",
        (*orders, entity_id),
    )


def address_text(address: dict) -> str:
    if address.get("formatted"):
        return address["formatted"]
    lines = [address.get("po_box"), address.get("extended"), address.get("street"),
             " ".join(p for p in (address.get("postal_code"), address.get("locality")) if p),
             address.get("region"), address.get("country")]  # fmt: skip
    return ", ".join(line for line in lines if line)


def match_key(channel: str, value: str) -> str:
    if channel == "phone":
        return phone_key(value)
    if channel == "email":
        return email_key(value)
    return fold(value).rstrip("/")


def organization_id(conn, name: str, now: str):
    """The Organization entity with this name, created when none exists. Matching is by
    exact name (ignoring case and accents); anything fuzzier needs the user's review."""
    name = (name or "").strip()
    if not name:
        return None
    key = fold(name)
    row = conn.execute(
        "SELECT id FROM entities WHERE kind='organization' AND deleted_at IS NULL AND sort_key=?",
        (key,),
    ).fetchone()
    if row:
        return row["id"]
    oid = uuid7()
    conn.execute(
        "INSERT INTO entities(id,kind,display_name,sort_key,search_text,name_given_first,"
        "name_family_first,display_family_first,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (oid, "organization", name, key, key, name, name, name, now, now),
    )
    conn.execute(
        "INSERT INTO names(id,entity_id,kind,value,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        (uuid7(), oid, "full", name, 0, now, now),
    )
    return oid


def work_organization(conn, values: dict, now: str):
    """The Organization a work record is at: the linked one while its name still matches,
    otherwise found or created by name."""
    oid = values.pop("organization_id", None)
    name = values.pop("organization", "")
    if (
        oid
        and conn.execute(
            "SELECT 1 FROM entities WHERE id=? AND kind='organization' AND sort_key=?",
            (oid, fold(name)),
        ).fetchone()
    ):
        return oid
    return organization_id(conn, name, now)


def edit_revision(conn, entity_id):
    """Token for owned contact data only; relationships remain independently owned."""
    entity = conn.execute(
        "SELECT kind, notes, deleted_at FROM entities WHERE id=?", (entity_id,)
    ).fetchone()
    content = [dict(entity)]
    for table, owner, _ in SECTIONS.values():
        content.append(
            [
                dict(row)
                for row in conn.execute(
                    f"SELECT * FROM {table} WHERE {owner}=? ORDER BY id", (entity_id,)
                )
            ]
        )
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def save_person(conn, doc: dict, entity_id=None, source_id=None, keep=False, kind="person"):
    """Create or update a Person from a validated document.

    Records are matched by id within this person only. Unchanged records keep their
    provenance; a record whose content the user changes becomes the user's (source NULL).
    Records missing from the document are removed, unless keep=True (imports and merges
    only ever add). Returns the entity id."""
    now = iso_now()
    if entity_id is None:
        entity_id = uuid7()
        conn.execute(
            "INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?)",
            (entity_id, kind, "", "", now, now),
        )
    for section, (table, owner, fields) in SECTIONS.items():
        existing = {
            r["id"]: dict(r)
            for r in conn.execute(f"SELECT * FROM {table} WHERE {owner}=?", (entity_id,))
        }
        seen = set()
        primaries = set()
        # Additions (imports, merges) go after what is already there.
        base = (max((r["position"] for r in existing.values()), default=-1) + 1) if keep else 0
        if keep:
            for r in existing.values():
                if r.get("is_primary"):
                    primaries.add(r.get("channel", "address"))
        for offset, item in enumerate(doc.get(section, [])):
            position = base + offset
            values = dict(item)
            if section in ("employments", "education"):
                values["organization_id"] = work_organization(conn, values, now)
            if section in ("contacts", "addresses"):
                group = values.get("channel", "address")
                values["is_primary"] = (
                    1 if values.get("is_primary") and group not in primaries else 0
                )
                if values["is_primary"]:
                    primaries.add(group)
            if section == "dates":
                values["approximate"] = 1 if values.get("approximate") else 0
            row = {k: values.get(k) for k in fields + COMMON}
            for k, v in row.items():
                if v is None and k not in NULLABLE:
                    row[k] = ""
            extra = {}
            if section == "contacts":
                extra["match_key"] = match_key(row["channel"], row["value"])
            rid = values.get("id")
            if rid in existing and rid not in seen:
                seen.add(rid)
                old = existing[rid]
                changed = any(old.get(k) != v for k, v in {**row, **extra}.items())
                if changed or old["position"] != position:
                    assignments = {**row, **extra, "position": position, "updated_at": now}
                    if changed:
                        assignments["source_id"] = None
                    columns = ",".join(f"{k}=?" for k in assignments)
                    conn.execute(
                        f"UPDATE {table} SET {columns} WHERE id=?", (*assignments.values(), rid)
                    )
                continue
            new = {"id": uuid7(), owner: entity_id, **row, **extra, "position": position,
                   "source_id": source_id, "created_at": now, "updated_at": now}  # fmt: skip
            conn.execute(
                f"INSERT INTO {table}({','.join(new)}) VALUES({','.join('?' * len(new))})",
                tuple(new.values()),
            )
        if not keep:
            for rid in set(existing) - seen:
                conn.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
    if "notes" in doc:
        conn.execute("UPDATE entities SET notes=? WHERE id=?", (doc["notes"], entity_id))
    refresh(conn, entity_id, now)
    return entity_id


def refresh(conn, entity_id: str, now=None):
    """Recompute the derived display name, sort key and search text of a person."""
    names = [dict(r) for r in conn.execute(
        "SELECT * FROM names WHERE entity_id=? ORDER BY position", (entity_id,))]  # fmt: skip
    texts = [n["value"] for n in names] + [compose(n) for n in names]
    for r in conn.execute(
        "SELECT channel, value FROM contact_points WHERE entity_id=?", (entity_id,)
    ):
        texts.append(r["value"])
        if r["channel"] == "phone":
            texts.append(phone_digits(r["value"]))
    texts += [address_text(dict(r)) for r in conn.execute(
        "SELECT * FROM addresses WHERE entity_id=?", (entity_id,))]  # fmt: skip
    for r in conn.execute(
        "SELECT e.title, e.department, o.display_name FROM employments e "
        "LEFT JOIN entities o ON o.id=e.organization_id WHERE e.person_id=?",
        (entity_id,),
    ):
        texts += [r["title"], r["department"], r["display_name"] or ""]
    for r in conn.execute(
        "SELECT e.program, e.field, e.degree, e.department, o.display_name FROM educations e "
        "LEFT JOIN entities o ON o.id=e.organization_id WHERE e.person_id=?",
        (entity_id,),
    ):
        texts += [r["program"], r["field"], r["degree"], r["department"], r["display_name"] or ""]
    texts += [
        r["subject"]
        for r in conn.execute("SELECT subject FROM interests WHERE entity_id=?", (entity_id,))
    ]
    for r in conn.execute("SELECT * FROM accounts WHERE entity_id=?", (entity_id,)):
        texts += [r["service"], r["handle"], r["display_name"]]
    texts += [
        r["value"] for r in conn.execute("SELECT value FROM facts WHERE entity_id=?", (entity_id,))
    ]
    notes = conn.execute("SELECT notes FROM entities WHERE id=?", (entity_id,)).fetchone()[0]
    texts.append(notes)
    conn.execute(
        "UPDATE entities SET display_name=?, sort_key=?, search_text=?, updated_at=?, "
        "name_given_first=?, name_family_first=?, display_family_first=? WHERE id=?",
        (
            display_name(names) or "Unnamed",
            sort_key(names),
            fold(" ".join(t for t in texts if t)),
            now or iso_now(),
            *name_orders(names),
            entity_id,
        ),
    )


# Owner preferences, in the settings table (key -> value). Absent keys mean the default for a
# new installation; the schema 6 migration stores 'people.sort' = 'family' for installations
# that already had people, so their ordering does not change under them.
PREFERENCES = {"people.sort": ("given", "family"), "people.display": ("given", "family")}
DEFAULTS = {"people.sort": "given", "people.display": "given"}


def preferences(conn) -> dict:
    stored = {
        r["key"]: r["value"]
        for r in conn.execute(
            f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(PREFERENCES))})",
            tuple(PREFERENCES),
        )
    }
    return {
        k: stored[k] if stored.get(k) in allowed else DEFAULTS[k]
        for k, allowed in PREFERENCES.items()
    }


def set_preferences(conn, values: dict) -> dict:
    for k, v in values.items():
        if k not in PREFERENCES or v not in PREFERENCES[k]:
            raise ValueError(f"Unknown setting {k}")
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (k, v),
        )
    return preferences(conn)


def name_order(conn, alias="e") -> str:
    """ORDER BY for names under the owner's sorting preference, with Slovak collation. The
    whole ordering happens in the query, so pagination never sorts only a loaded page."""
    column = (
        "name_family_first" if preferences(conn)["people.sort"] == "family" else "name_given_first"
    )
    a = f"{alias}." if alias else ""
    return f"{a}{column} COLLATE meridian_name, {a}display_name COLLATE meridian_name, {a}id"


def source_labels(conn) -> dict:
    return {r["id"]: {"kind": r["kind"], "label": r["label"]}
            for r in conn.execute("SELECT id, kind, label FROM sources")}  # fmt: skip


def load_person(conn, entity_id: str, include_deleted=False, kinds=("person",)):
    row = conn.execute(
        f"SELECT * FROM entities WHERE id=? AND kind IN ({','.join('?' * len(kinds))})"
        + ("" if include_deleted else " AND deleted_at IS NULL"),
        (entity_id, *kinds),
    ).fetchone()
    if not row:
        return None
    sources = source_labels(conn)

    def records(table, owner):
        out = []
        for r in conn.execute(
            f"SELECT * FROM {table} WHERE {owner}=? ORDER BY position", (entity_id,)
        ):
            item = dict(r)
            item.pop(owner, None)
            item["source"] = sources.get(item.pop("source_id", None))
            for key in ("is_primary", "approximate"):
                if key in item:
                    item[key] = bool(item[key])
            out.append(item)
        return out

    employments = records("employments", "person_id")
    education = records("educations", "person_id")
    for item in employments + education:
        org = item.pop("organization_id")
        name = (
            conn.execute("SELECT display_name FROM entities WHERE id=?", (org,)).fetchone()
            if org
            else None
        )
        item["organization"] = name[0] if name else ""
        item["organization_id"] = org
    contacts = records("contact_points", "entity_id")
    for item in contacts:
        item.pop("match_key", None)
    connections = relations.for_entity(conn, entity_id)
    # People connected to an Organization through their work records (derived, not stored).
    work_here = (
        [
            {"id": w["id"], "person_id": w["person_id"], "person_name": w["display_name"],
             "title": w["title"], "department": w["department"], "role": w["role"],
             "valid_from": w["valid_from"], "valid_until": w["valid_until"],
             "deleted": bool(w["deleted_at"])}
            for w in conn.execute(
                "SELECT w.*, p.display_name, p.deleted_at FROM employments w JOIN entities p ON p.id=w.person_id "
                f"WHERE w.organization_id=? ORDER BY w.valid_until IS NOT NULL, {name_order(conn, 'p')}",
                (entity_id,),
            )
        ]
        if row["kind"] == "organization"
        else []
    )  # fmt: skip
    # People who studied at an Organization, from their Education records (derived).
    studied_here = (
        [
            {"id": s["id"], "person_id": s["person_id"], "person_name": s["display_name"],
             "kind": s["kind"], "program": s["program"], "field": s["field"], "degree": s["degree"],
             "status": s["status"], "valid_from": s["valid_from"], "valid_until": s["valid_until"],
             "deleted": bool(s["deleted_at"])}
            for s in conn.execute(
                "SELECT s.*, p.display_name, p.deleted_at FROM educations s JOIN entities p ON p.id=s.person_id "
                f"WHERE s.organization_id=? ORDER BY s.valid_until IS NOT NULL, {name_order(conn, 'p')}",
                (entity_id,),
            )
        ]
        if row["kind"] == "organization"
        else []
    )  # fmt: skip
    from .images import get as image_of

    return {
        "id": row["id"],
        "edit_revision": edit_revision(conn, entity_id),
        "kind": row["kind"],
        "image": image_of(conn, row["id"]),
        "relationships": connections["relationships"],
        "memberships": connections["memberships"],
        "work_here": work_here,
        "studied_here": studied_here,
        "interaction_count": conn.execute(
            "SELECT count(*) FROM interactions i WHERE i.group_id=? OR i.id IN "
            "(SELECT interaction_id FROM interaction_participants WHERE entity_id=?)",
            (entity_id, entity_id),
        ).fetchone()[0],
        "display_name": row["display_name"],
        "is_self": bool(row["is_self"]),
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "deleted_at": row["deleted_at"],
        "names": records("names", "entity_id"),
        "contacts": contacts,
        "addresses": records("addresses", "entity_id"),
        "dates": records("personal_dates", "entity_id"),
        "employments": employments,
        "education": education,
        "interests": records("interests", "entity_id"),
        "accounts": records("accounts", "entity_id"),
        "facts": records("facts", "entity_id"),
        "identifiers": [
            {"id": r["id"], "system": r["system"], "value": r["value"]}
            for r in conn.execute("SELECT * FROM identifiers WHERE entity_id=? ORDER BY created_at", (entity_id,))
        ],
        "imported": [
            {"id": r["id"], "name": r["name"], "params": json.loads(r["params"]), "value": r["value"],
             "source": sources.get(r["source_id"]), "created_at": r["created_at"]}
            for r in conn.execute("SELECT * FROM raw_properties WHERE entity_id=? ORDER BY created_at, rowid", (entity_id,))
        ],
    }  # fmt: skip


def summaries(
    conn,
    where="",
    params=(),
    order=None,
    limit=200,
    offset=0,
    kinds=("person",),
):
    """List rows for people: primary phone/email and current work, without loading everything.
    Without an explicit order, rows follow the owner's name-sorting preference."""
    order = order or name_order(conn)
    rows = conn.execute(
        f"""
        SELECT e.id, e.kind, e.display_name, e.display_family_first, e.is_self, e.updated_at,
          e.created_at, e.deleted_at,
          (SELECT count(*) FROM memberships m WHERE m.group_id=e.id AND m.state<>'former') AS members,
          (SELECT count(DISTINCT w.person_id) FROM employments w WHERE w.organization_id=e.id AND w.valid_until IS NULL) AS staff,
          (SELECT n.value FROM names n WHERE n.entity_id=e.id AND n.kind='preferred' ORDER BY n.position LIMIT 1) AS preferred,
          (SELECT c.value FROM contact_points c WHERE c.entity_id=e.id AND c.channel='phone' AND c.valid_until IS NULL
             ORDER BY c.is_primary DESC, c.position LIMIT 1) AS phone,
          (SELECT c.value FROM contact_points c WHERE c.entity_id=e.id AND c.channel='email' AND c.valid_until IS NULL
             ORDER BY c.is_primary DESC, c.position LIMIT 1) AS email,
          (SELECT trim(coalesce(w.title,'') || CASE WHEN w.title<>'' AND o.display_name IS NOT NULL THEN ' · ' ELSE '' END
                  || coalesce(o.display_name,''))
             FROM employments w LEFT JOIN entities o ON o.id=w.organization_id
             WHERE w.person_id=e.id AND w.valid_until IS NULL ORDER BY w.position LIMIT 1) AS work
        FROM entities e WHERE e.kind IN ({",".join("?" * len(kinds))}) {where} ORDER BY {order} LIMIT ? OFFSET ?
        """,
        (*kinds, *params, limit, offset),
    ).fetchall()
    return [{**dict(r), "is_self": bool(r["is_self"])} for r in rows]
