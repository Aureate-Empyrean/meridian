"""Persistence of Person documents over the entity core and its record tables."""

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
}  # fmt: skip


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
        "INSERT INTO entities(id,kind,display_name,sort_key,search_text,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (oid, "organization", name, key, key, now, now),
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
            if section == "employments":
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
                if v is None and k not in ("valid_from", "valid_until", "confidence", "date",
                                           "organization_id"):  # fmt: skip
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
    for r in conn.execute("SELECT * FROM accounts WHERE entity_id=?", (entity_id,)):
        texts += [r["service"], r["handle"], r["display_name"]]
    texts += [
        r["value"] for r in conn.execute("SELECT value FROM facts WHERE entity_id=?", (entity_id,))
    ]
    notes = conn.execute("SELECT notes FROM entities WHERE id=?", (entity_id,)).fetchone()[0]
    texts.append(notes)
    conn.execute(
        "UPDATE entities SET display_name=?, sort_key=?, search_text=?, updated_at=? WHERE id=?",
        (
            display_name(names) or "Unnamed",
            sort_key(names),
            fold(" ".join(t for t in texts if t)),
            now or iso_now(),
            entity_id,
        ),
    )


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
    for item in employments:
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
                "WHERE w.organization_id=? ORDER BY w.valid_until IS NOT NULL, p.sort_key",
                (entity_id,),
            )
        ]
        if row["kind"] == "organization"
        else []
    )  # fmt: skip
    return {
        "id": row["id"],
        "kind": row["kind"],
        "relationships": connections["relationships"],
        "memberships": connections["memberships"],
        "work_here": work_here,
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
    order="e.sort_key, e.display_name",
    limit=200,
    offset=0,
    kinds=("person",),
):
    """List rows for people: primary phone/email and current work, without loading everything."""
    rows = conn.execute(
        f"""
        SELECT e.id, e.kind, e.display_name, e.is_self, e.updated_at, e.created_at, e.deleted_at,
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
