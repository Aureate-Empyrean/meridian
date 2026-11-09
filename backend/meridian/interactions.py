"""Interactions (0.7.0, roadmap Phase 3, owner decision D8).

An Interaction is Meridian's record of the human meaning of contact or activity between
participants ("had coffee with Peter", "the FI group met for drinks"). It is entered manually,
stored once and shown for every participant; a Group is optional context and never stands in
for participants whose identities are known. Hermes communications are never copied here.

An Interaction may link resources other modules own: Chronos events, Mnemosyne notes, tasks,
projects and collections, and Atlas places. Meridian keeps only the reference (plus the label seen
when it was linked, so a deleted target stays readable as unresolved) and registers it with Nexus
as a `meridian.interaction-about` edge. Under the backlinks standard (ADR 0024) the target's module
is the edge's reader, so it can show the link; the summary is released only to such a module.
Candidates to link are the items those modules already link to the participants (Phase 2
`chronos.involves` / `mnemosyne.related` references), and Places from Atlas's `place-directory`.
"""

import hashlib
import json
import logging
import threading
import time

from . import nexus, relations
from .models import LINKABLE
from .relations import Invalid, sources_of
from .util import iso_now, uuid7

log = logging.getLogger("meridian.interactions")
RELATION = "meridian.interaction-about"
MODULE_NAMES = {"chronos": "Chronos", "mnemosyne": "Mnemosyne", "atlas": "Atlas"}


def reference(iid):
    return f"nexus:v1:meridian:interaction:{iid}"


def readers_of(resource):
    """The module that owns the linked item: it may see the link (backlinks standard)."""
    return resource.split(":")[2]


def resolve(conn, iid, requester):
    """A label for a module this Interaction links to, and for no other. (None, status) when
    refused: 404 unknown, 403 not linked to that module."""
    row = conn.execute("SELECT summary FROM interactions WHERE id=?", (iid,)).fetchone()
    if not row:
        return None, 404
    modules = {readers_of(r[0]) for r in conn.execute(
        "SELECT resource FROM interaction_links WHERE interaction_id=?", (iid,))}  # fmt: skip
    if requester not in modules:
        return None, 403
    has_participant = conn.execute(
        "SELECT 1 FROM interaction_participants p JOIN entities x ON x.id=p.entity_id "
        "WHERE p.interaction_id=? AND x.deleted_at IS NULL LIMIT 1",
        (iid,),
    ).fetchone()
    out = {"resource": reference(iid), "label": row["summary"][:200]}
    if has_participant:
        out["open_path"] = f"/interactions/{iid}"
    return out, 200


SEARCHED = (("atlas", "place-directory", "Atlas"), ("chronos", "link-search", "Chronos"), ("mnemosyne", "link-search", "Mnemosyne"))


def search(q):
    """Items to link, from each owner's permission-controlled projection (ADR 0029). Only a
    reference and a label come back, nothing is copied, and a missing module just adds nothing."""
    items, reachable = [], False
    for module, projection, name in SEARCHED:
        try:
            page = nexus.call(
                "POST",
                "/projections/query",
                {"module": module, "projection": projection, "query": {"q": q[:100], "limit": 8}, "cursor": None},
            )
        except (nexus.NexusRefused, nexus.NexusUnavailable):
            continue
        if page.get("availability") != "available":
            continue
        reachable = True
        for x in page.get("items") or []:
            parts = str(x.get("resource", "")).split(":")
            if len(parts) == 5 and (parts[2], parts[3]) in LINKABLE:
                items.append({"resource": x["resource"], "module": parts[2], "module_name": name, "type": parts[3],
                              "label": str(x.get("label") or "")[:200], "availability": "available"})  # fmt: skip
    return {"availability": "available" if reachable else "nexus_unreachable", "items": items}


def _participants(conn, ids):
    if not ids:
        return {}
    out = {}
    for r in conn.execute(
        "SELECT p.interaction_id, p.role, x.id, x.kind, x.display_name, x.deleted_at "
        "FROM interaction_participants p JOIN entities x ON x.id=p.entity_id "
        f"WHERE p.interaction_id IN ({','.join('?' * len(ids))}) ORDER BY p.position",
        tuple(ids),
    ):
        out.setdefault(r["interaction_id"], []).append(
            {
                "entity": {
                    "id": r["id"],
                    "kind": r["kind"],
                    "display_name": r["display_name"],
                    "deleted": bool(r["deleted_at"]),
                },
                "role": r["role"],
            }  # fmt: skip
        )
    return out


def _links(conn, ids):
    if not ids:
        return {}
    out = {}
    for r in conn.execute(
        "SELECT * FROM interaction_links "
        f"WHERE interaction_id IN ({','.join('?' * len(ids))}) ORDER BY position",
        tuple(ids),
    ):
        module, kind = r["resource"].split(":")[2:4]
        out.setdefault(r["interaction_id"], []).append(
            {
                "resource": r["resource"],
                "module": module,
                "module_name": MODULE_NAMES.get(module, module),
                "type": kind,
                "label": r["label_hint"],
                "availability": "unknown",
            }  # fmt: skip
        )
    return out


def _view(conn, row, people, links):
    group = None
    if row["group_id"]:
        g = conn.execute(
            "SELECT id, display_name, deleted_at FROM entities WHERE id=?", (row["group_id"],)
        ).fetchone()
        if g:
            group = {"id": g["id"], "kind": "group", "display_name": g["display_name"],
                     "deleted": bool(g["deleted_at"])}  # fmt: skip
    return {
        "id": row["id"], "record": "interaction", "type": row["type"], "summary": row["summary"],
        "notes": row["notes"], "occurred": row["occurred"], "approximate": bool(row["approximate"]),
        "confidence": row["confidence"], "group": group, "participants": people,
        "links": links, "created_at": row["created_at"], "updated_at": row["updated_at"],
    }  # fmt: skip


def revision(conn, iid):
    """Token for one interaction's own content (row, participants, links, sources), so an
    edit made elsewhere since the editor opened is detected rather than overwritten."""
    content = [dict(conn.execute("SELECT * FROM interactions WHERE id=?", (iid,)).fetchone() or {})]
    for sql in (
        "SELECT entity_id, role, position FROM interaction_participants WHERE interaction_id=? ORDER BY position",
        "SELECT resource, position FROM interaction_links WHERE interaction_id=? ORDER BY position",
        "SELECT kind, entity_id, label, learned, position FROM provenance "
        "WHERE record_kind='interaction' AND record_id=? ORDER BY position",
    ):
        content.append([dict(r) for r in conn.execute(sql, (iid,))])
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def get(conn, iid, resolve=False):
    row = conn.execute("SELECT * FROM interactions WHERE id=?", (iid,)).fetchone()
    if not row:
        return None
    links = _links(conn, [iid]).get(iid, [])
    if resolve:
        resolve_links(links)
    out = _view(conn, row, _participants(conn, [iid]).get(iid, []), links)
    out["sources"] = sources_of(conn, "interaction", iid)
    out["revision"] = revision(conn, iid)
    return out


def for_entity(conn, eid, limit=200):
    """An entity's interactions, newest first (undated last): where it is a participant, or the
    Group an interaction happened in."""
    rows = conn.execute(
        "SELECT i.* FROM interactions i WHERE i.group_id=? OR i.id IN "
        "(SELECT interaction_id FROM interaction_participants WHERE entity_id=?) "
        "ORDER BY i.occurred IS NULL, i.occurred DESC, i.created_at DESC LIMIT ?",
        (eid, eid, limit),
    ).fetchall()
    ids = [r["id"] for r in rows]
    people, links = _participants(conn, ids), _links(conn, ids)
    return [_view(conn, r, people.get(r["id"], []), links.get(r["id"], [])) for r in rows]


def save(conn, body: dict, iid=None) -> str:
    # Someone already part of this interaction may be in Trash; editing it must still work.
    kept, kept_group = set(), None
    if iid:
        kept = {r[0] for r in conn.execute(
            "SELECT entity_id FROM interaction_participants WHERE interaction_id=?", (iid,))}  # fmt: skip
        old = conn.execute("SELECT group_id FROM interactions WHERE id=?", (iid,)).fetchone()
        kept_group = old["group_id"] if old else None
    for p in body["participants"]:
        row = conn.execute(
            "SELECT deleted_at FROM entities WHERE id=?", (p["entity_id"],)
        ).fetchone()
        if not row or (row["deleted_at"] and p["entity_id"] not in kept):
            raise Invalid("Everyone involved must be a person, organization or group in Meridian")
    if body.get("group_id"):
        g = conn.execute(
            "SELECT kind, deleted_at FROM entities WHERE id=?", (body["group_id"],)
        ).fetchone()
        if not g or g["kind"] != "group" or (g["deleted_at"] and body["group_id"] != kept_group):
            raise Invalid("The group must be a Group in Meridian")
    now = iso_now()
    row = {
        "type": body.get("type") or "meeting", "summary": body["summary"],
        "notes": body.get("notes", ""), "occurred": body.get("occurred"),
        "approximate": 1 if body.get("approximate") else 0, "group_id": body.get("group_id"),
        "confidence": body.get("confidence"), "updated_at": now,
    }  # fmt: skip
    if iid:
        if not conn.execute("SELECT 1 FROM interactions WHERE id=?", (iid,)).fetchone():
            raise LookupError
        expected = body.get("expected_revision")
        if expected and expected != revision(conn, iid):
            raise Conflict
        columns = ",".join(f"{k}=?" for k in row)
        conn.execute(f"UPDATE interactions SET {columns} WHERE id=?", (*row.values(), iid))
        conn.execute("DELETE FROM interaction_participants WHERE interaction_id=?", (iid,))
    else:
        iid = uuid7()
        row.update(id=iid, created_at=now)
        conn.execute(
            f"INSERT INTO interactions({','.join(row)}) VALUES({','.join('?' * len(row))})",
            tuple(row.values()),
        )
    for i, p in enumerate(body["participants"]):
        conn.execute(
            "INSERT INTO interaction_participants(interaction_id,entity_id,role,position) "
            "VALUES(?,?,?,?)",
            (iid, p["entity_id"], p.get("role", ""), i),
        )
    _save_links(conn, iid, body.get("links", []), now)
    relations._sources(conn, "interaction", iid, body.get("sources", []))
    return iid


def _save_links(conn, iid, links, now):
    """Keep links that stay (and their Nexus edge), add new ones, drop removed ones (the
    delete trigger queues their Nexus edge for removal)."""
    existing = {
        r["resource"]: r
        for r in conn.execute("SELECT * FROM interaction_links WHERE interaction_id=?", (iid,))
    }
    wanted = [link["resource"] for link in links]
    for resource in set(existing) - set(wanted):
        conn.execute("DELETE FROM interaction_links WHERE id=?", (existing[resource]["id"],))
    for i, link in enumerate(links):
        module, kind = link["resource"].split(":")[2:4]
        if (module, kind) not in LINKABLE:
            raise Invalid("Only Chronos events, Mnemosyne items and Atlas places can be linked")
        old = existing.get(link["resource"])
        if old:
            conn.execute(
                "UPDATE interaction_links SET position=?, label_hint=? WHERE id=?",
                (i, (link.get("label") or old["label_hint"])[:200], old["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO interaction_links(id,interaction_id,resource,label_hint,position,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (uuid7(), iid, link["resource"], (link.get("label") or "")[:200], i, now),
            )


def delete(conn, iid) -> bool:
    return bool(conn.execute("DELETE FROM interactions WHERE id=?", (iid,)).rowcount)


class Conflict(Exception):
    """The interaction changed since the editor opened it."""


# ── Linked items in other modules ──────────────────────────────────────


def resolve_links(links):
    """Current label and availability of each link, through Nexus (Meridian's existing
    `references.resolve` scopes). A link whose target is gone keeps its last label and says
    so; nothing here raises."""
    for link in links:
        try:
            out = nexus.call("POST", "/resources/resolve", {"resource": link["resource"]})
            link["availability"] = out.get("availability") or "unknown"
            if link["availability"] == "available" and out.get("label"):
                link["label"] = str(out["label"])[:200]
        except nexus.NexusRefused as exc:
            link["availability"] = "forbidden" if exc.status == 403 else "unknown"
        except nexus.NexusUnavailable:
            link["availability"] = "temporarily_unavailable"
    return links


def candidates(conn, entity_ids):
    """Items other modules already link to these participants and let Meridian see: the
    choices for "Link an item". {"availability", "items"}."""
    from .shared import linked_from

    items, seen, availability = [], set(), "available"
    rows = conn.execute(
        f"SELECT id, kind FROM entities WHERE id IN ({','.join('?' * len(entity_ids))})",
        tuple(entity_ids),
    ).fetchall() if entity_ids else []  # fmt: skip
    for r in rows:
        found = linked_from(r["kind"], r["id"])
        if found["availability"] != "available":
            availability = found["availability"]
            continue
        for item in found["items"]:
            key = (item["module"], item["type"])
            if key not in LINKABLE or item["source"] in seen:
                continue
            seen.add(item["source"])
            items.append(
                {
                    "resource": item["source"],
                    "module": item["module"],
                    "module_name": MODULE_NAMES.get(item["module"], item["module"]),
                    "type": item["type"],
                    "label": item["label"],
                    "availability": item["availability"],
                }  # fmt: skip
            )
    return {"availability": availability if not items else "available", "items": items}


# ── Nexus edges ─────────────────────────────────────────────────────────


def sync_references(db):
    """Best effort: register pending link edges with Nexus. Obsolete edges are removed by the
    shared cleanup queue (meridian.images.sync_references)."""
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, interaction_id, resource FROM interaction_links WHERE nexus_state<>'registered'"
        ).fetchall()
    for row in rows:
        try:
            ref_id = nexus.create_reference(
                reference(row["interaction_id"]), row["resource"], RELATION, [readers_of(row["resource"])]
            )
            state = ("registered", ref_id)
        except nexus.NexusRefused as exc:
            # 422: the owning module is not installed (type undeclared) or similar.
            state = ("pending", None)
            log.warning("Reference not registered (%s): %s", exc.status, exc.detail)
        except nexus.NexusUnavailable as exc:
            state = ("pending", None)
            log.warning("Reference not registered: %s", exc)
        with db.connect() as conn:
            conn.execute(
                "UPDATE interaction_links SET nexus_state=?, nexus_reference_id=? WHERE id=?",
                (state[0], state[1], row["id"]),
            )


_retry_lock = threading.Lock()
_last_retry = [0.0]


def retry_pending(db, every=60):
    with _retry_lock:
        if time.monotonic() - _last_retry[0] < every:
            return
        _last_retry[0] = time.monotonic()
    with db.connect() as conn:
        pending = conn.execute(
            "SELECT 1 FROM interaction_links WHERE nexus_state<>'registered' LIMIT 1"
        ).fetchone()
    if pending:
        threading.Thread(target=sync_references, args=(db,), daemon=True).start()


def outgoing(conn, limit, cursor):
    """Entity References v2 enumeration of link edges, ordered by link id."""
    rows = conn.execute(
        "SELECT id, interaction_id, resource FROM interaction_links WHERE id > ? ORDER BY id LIMIT ?",
        (cursor or "", limit + 1),
    ).fetchall()
    page = rows[:limit]
    return {
        "references": [
            {
                "source": reference(r["interaction_id"]),
                "target": r["resource"],
                "relation": RELATION,
                "metadata": {}, "readers": [readers_of(r["resource"])],
            }
            for r in page
        ],  # fmt: skip
        "next_cursor": page[-1]["id"] if len(rows) > limit else None,
    }
