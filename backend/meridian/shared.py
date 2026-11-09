"""What Meridian shares with other modules, through Nexus, and what it reads back.

Provided projections (architecture/concepts/projections.md):
- `dated-items` v1: birthdays and anniversaries as yearly, all-day, read-only dated items.
  Only month-and-day dates are projected; nothing is invented (no year for --MM-DD dates, no
  occurrences after a recorded death). Chronos shows them only when the owner turns the source
  on (owner decision D4, 2026-11-07).
- `people-directory` v1: name search over live People, for pickers in other modules. Names and
  the self marker only: no contacts, dates, notes or anything else (decision D5).
- `contact-addresses` v1 (ADR 0030): the addresses of live contacts, for Atlas's map layer. Read
  live and not copied; only Atlas may read it, and only with a scope the owner reviewed.
Nexus forwards only requesters the owner granted in their manifests (decision D6: Chronos and
Mnemosyne, People only). Meridian stays the owner of every Person and date.

Read back: references other modules created *to* Meridian People (Chronos events, Mnemosyne
notes and tasks), when they listed Meridian as a reader, resolved to their current labels.
"""

import calendar
from datetime import date

from . import nexus, store
from .util import fold, reference

KINDS = {"birth": "meridian.birthday", "anniversary": "meridian.anniversary"}
PAGE = 500
MAX_SPAN = 800
SELF_ALIASES = ("@", "@m", "@me")


class BadQuery(ValueError):
    pass


def _month_day(value):
    if not value:
        return None
    if value.startswith("--"):
        return None, int(value[2:4]), int(value[5:7])
    if len(value) == 10:
        return int(value[:4]), int(value[5:7]), int(value[8:10])
    return None  # a year or a month alone has no yearly occurrence


def _ended(death, when):
    """True when `when` falls after a recorded death date, at the precision it is known."""
    if not death or death.startswith("--"):
        return False
    text = when.isoformat()[: len(death)]
    return text > death


def dated_items(conn, query, cursor=None):
    try:
        start = date.fromisoformat(str(query.get("from")))
        end = date.fromisoformat(str(query.get("to")))
    except ValueError as exc:
        raise BadQuery("from and to must be ISO dates") from exc
    if end <= start or (end - start).days > MAX_SPAN:
        raise BadQuery(f"The range must be 1 to {MAX_SPAN} days")
    deaths = {}
    for r in conn.execute(
        "SELECT entity_id, date FROM personal_dates WHERE kind='death' AND date IS NOT NULL "
        "AND valid_until IS NULL ORDER BY position"
    ):
        deaths.setdefault(r["entity_id"], r["date"])
    rows = conn.execute(
        "SELECT d.*, e.display_name FROM personal_dates d JOIN entities e ON e.id=d.entity_id "
        "WHERE e.kind='person' AND e.deleted_at IS NULL AND d.kind IN ('birth','anniversary') "
        "AND d.date IS NOT NULL AND d.valid_until IS NULL"
    ).fetchall()
    items = []
    for r in rows:
        parts = _month_day(r["date"])
        if not parts:
            continue
        born, month, day = parts
        for year in range(start.year, end.year + 1):
            if born and year < born:
                continue
            last = calendar.monthrange(year, month)[1]
            when = date(year, month, min(day, last))
            if not (start <= when < end) or _ended(deaths.get(r["entity_id"]), when):
                continue
            items.append(_item(r, when, born, day > last))
    items.sort(key=lambda x: (x["start"], x["id"]))
    offset = int(cursor) if cursor and str(cursor).isdigit() else 0
    page = items[offset : offset + PAGE]
    following = offset + PAGE if offset + PAGE < len(items) else None
    return {"items": page, "next_cursor": str(following) if following else None}


def _item(r, when, born, shifted):
    name = r["display_name"]
    birthday = r["kind"] == "birth"
    title = f"Birthday · {name}" if birthday else f"{r['label'] or 'Anniversary'} · {name}"
    years = when.year - born if born and not r["approximate"] else None
    summary = []
    if years is not None and years > 0:
        summary.append(f"Turns {years}" if birthday else f"{years} years")
    if shifted:
        summary.append("29 February in leap years")
    if r["description"]:
        summary.append(r["description"])
    item = {
        "id": f"{r['id']}:{when.year}",
        "resource": reference("person", r["entity_id"]),
        "kind": KINDS[r["kind"]],
        "title": title[:200],
        "start": when.isoformat(),
        "all_day": True,
        "certainty": "estimated" if r["approximate"] else "confirmed",
        "status": "scheduled",
        "updated_at": r["updated_at"],
    }
    if summary:
        item["summary"] = " · ".join(summary)[:300]
    return item


def people_directory(conn, query, cursor=None):
    """Live People whose names match every word of `q` (accents and case ignored), in the
    owner's name order. `@me` finds the person marked as the user. Names only."""
    q = str(query.get("q") or "")[:100]
    try:
        limit = max(1, min(int(query.get("limit") or 10), 20))
    except (TypeError, ValueError) as exc:
        raise BadQuery("limit must be a number") from exc
    alias = fold(q) in SELF_ALIASES
    tokens = [] if alias else [t for t in fold(q).split(" ") if t][:8]
    order = store.name_order(conn)
    rows = conn.execute(
        f"SELECT e.id, e.display_name, e.is_self FROM entities e WHERE e.kind='person' "
        f"AND e.deleted_at IS NULL {'AND e.is_self=1' if alias else ''} ORDER BY {order}"
    ).fetchall()
    names = {}
    if tokens:
        for n in conn.execute(
            "SELECT entity_id, value, given, middle, family, prefix, suffix FROM names"
        ):
            names.setdefault(n["entity_id"], []).append(
                fold(" ".join(x for x in (n["value"], store.compose(dict(n))) if x))
            )
    matches = []
    for r in rows:
        if tokens:
            text = " ".join(names.get(r["id"], [])) + " " + fold(r["display_name"])
            if not all(t in text for t in tokens):
                continue
        matches.append(r)
    offset = int(cursor) if cursor and str(cursor).isdigit() else 0
    page = matches[offset : offset + limit]
    following = offset + limit if offset + limit < len(matches) else None
    return {
        "items": [
            {"id": r["id"], "resource": reference("person", r["id"]),
             "label": r["display_name"][:200], "self": bool(r["is_self"])}
            for r in page
        ],
        "next_cursor": str(following) if following else None,
    }  # fmt: skip


ADDRESS_READERS = {"atlas"}
ADDRESS_PAGE = 100
ADDRESS_SECTIONS = {"person": "people", "organization": "organizations", "group": "groups"}


def contact_addresses(conn, query, cursor=None):
    """Every address of every live contact, oldest identifier first so paging is stable. An
    address past its `valid_until` is marked as not current. Trashed contacts are absent."""
    try:
        limit = max(1, min(int(query.get("limit") or ADDRESS_PAGE), ADDRESS_PAGE))
    except (TypeError, ValueError) as exc:
        raise BadQuery("limit must be a number") from exc
    offset = int(cursor) if cursor and str(cursor).isdigit() else 0
    rows = conn.execute(
        "SELECT a.*, e.kind AS entity_kind, e.display_name FROM addresses a JOIN entities e ON e.id=a.entity_id "
        "WHERE e.deleted_at IS NULL ORDER BY a.id LIMIT ? OFFSET ?",
        (limit + 1, offset),
    ).fetchall()
    today = date.today().isoformat()
    items = []
    for r in rows[:limit]:
        until = r["valid_until"]
        items.append({
            "id": r["id"], "resource": reference(r["entity_kind"], r["entity_id"]),
            "label": r["display_name"][:200], "address_label": r["label"][:40],
            "text": store.address_text(dict(r))[:1000],
            "parts": {"street": r["street"], "postal_code": r["postal_code"], "locality": r["locality"],
                      "region": r["region"], "country": r["country"]},
            "current": not until or today[: len(until)] <= until, "primary": bool(r["is_primary"]),
            "open_path": f"/{ADDRESS_SECTIONS[r['entity_kind']]}/{r['entity_id']}",
            "place_ref": r["place_ref"], "updated_at": r["updated_at"],
        })  # fmt: skip
    following = offset + limit if len(rows) > limit else None
    return {"items": items, "next_cursor": str(following) if following else None}


MODULE_NAMES = {"chronos": "Chronos", "mnemosyne": "Mnemosyne"}


def linked_from(kind, eid):
    """Resources in other modules that link to this entity and let Meridian see the link,
    with their current labels. {"availability", "items"}; never raises."""
    target = reference(kind, eid)
    try:
        page = nexus.call("GET", f"/references?resource={target}&direction=incoming&limit=100")
    except nexus.NexusRefused as exc:
        return {"availability": "not_granted" if exc.status == 403 else "nexus_error", "items": []}
    except nexus.NexusUnavailable:
        return {"availability": "nexus_unreachable", "items": []}
    items = []
    for edge in page.get("references") or []:
        source = edge.get("source", "")
        module = source.split(":")[2] if source.count(":") >= 4 else ""
        if not module or module == "meridian":
            continue
        entry = {"source": source, "module": module, "relation": edge.get("relation", ""),
                 "type": source.split(":")[3], "label": "", "availability": "unknown"}  # fmt: skip
        try:
            resolved = nexus.call("POST", "/resources/resolve", {"resource": source})
            entry["availability"] = resolved.get("availability") or "unknown"
            if entry["availability"] == "available":
                entry["label"] = str(resolved.get("label") or "")[:200]
                entry["open_path"] = (resolved.get("open") or {}).get("module_path")
        except nexus.NexusRefused as exc:
            entry["availability"] = "forbidden" if exc.status == 403 else "unknown"
        except nexus.NexusUnavailable:
            entry["availability"] = "temporarily_unavailable"
        items.append(entry)
    return {"availability": "available", "items": items}


def announce_dates_changed():
    """Hint for Chronos that dated items may have changed; it reconciles through the projection
    either way, so a lost hint only delays the update (Chronos refreshes every 15 minutes)."""
    try:
        nexus.call("POST", "/events", {"type": "meridian.dated-items.changed", "payload": {}})
    except (nexus.NexusRefused, nexus.NexusUnavailable):
        pass
