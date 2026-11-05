"""vCard import: preview without writing, then an all-or-nothing commit of explicit choices.

Possible duplicates are found by vCard UID, email address and phone number (strong hints)
and by name (a weak hint: two people can share a name). Nothing is merged or overwritten
without the user's decision. A merge only adds what the existing person does not already
have; differing values (for example another birthday) are kept side by side, each with
its source, rather than replacing what is there.
"""

import hashlib
import json

from pydantic import ValidationError

from . import store, vcard
from .models import AccountIn, AddressIn, ContactIn, DateIn, EmploymentIn, FactIn, NameIn
from .util import fold, iso_now, uuid7

MODELS = {"names": NameIn, "contacts": ContactIn, "addresses": AddressIn, "dates": DateIn,
          "employments": EmploymentIn, "accounts": AccountIn, "facts": FactIn}  # fmt: skip
LIST_KEYS = list(MODELS)


class ImportError_(ValueError):
    pass


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clean(mapped: dict) -> dict:
    """Validate each mapped record on its own. A record Meridian cannot accept is kept
    as unmapped imported data with a warning, never silently dropped."""
    doc = mapped["doc"]
    out = {key: [] for key in LIST_KEYS}
    for key, model in MODELS.items():
        for item in doc[key]:
            try:
                out[key].append(model(**item).model_dump(exclude_none=False))
            except ValidationError:
                value = " ".join(str(v) for v in item.values() if v and not isinstance(v, bool))
                mapped["raw"].append({"name": key.upper(), "params": {}, "value": value[:4096]})
                mapped["warnings"].append(
                    f"A {key[:-1]} value could not be used and is kept unmapped"
                )
    out["notes"] = doc["notes"]
    mapped["doc"] = out
    return mapped


def analyse(text: str):
    cards = vcard.parse(text)
    return [clean(vcard.map_card(card)) for card in cards]


def card_name(doc: dict) -> str:
    return store.display_name(doc["names"]) if doc["names"] else ""


def candidates(conn, mapped: dict) -> list:
    doc = mapped["doc"]
    found: dict = {}

    def hit(rows, reason, strength):
        for r in rows:
            entry = found.setdefault(r["id"], {"id": r["id"], "display_name": r["display_name"],
                                               "reasons": [], "strength": "weak"})  # fmt: skip
            if reason not in entry["reasons"]:
                entry["reasons"].append(reason)
            if strength == "strong":
                entry["strength"] = "strong"

    alive = "e.kind='person' AND e.deleted_at IS NULL"
    for ident in mapped["identifiers"]:
        hit(conn.execute(
            f"SELECT e.id, e.display_name FROM identifiers i JOIN entities e ON e.id=i.entity_id "
            f"WHERE {alive} AND i.system=? AND i.value=?", (ident["system"], ident["value"])),
            "same contact ID as an earlier import", "strong")  # fmt: skip
    for contact in doc["contacts"]:
        if contact["channel"] not in ("email", "phone"):
            continue
        key = store.match_key(contact["channel"], contact["value"])
        if contact["channel"] == "phone" and len(key) < 7:
            continue
        hit(conn.execute(
            f"SELECT DISTINCT e.id, e.display_name FROM contact_points c JOIN entities e ON e.id=c.entity_id "
            f"WHERE {alive} AND c.channel=? AND c.match_key=?", (contact["channel"], key)),
            f"same {'email address' if contact['channel'] == 'email' else 'phone number'} {contact['value']}",
            "strong")  # fmt: skip
    name = fold(card_name(doc))
    if name:
        rows = [r for r in conn.execute(
            f"SELECT e.id, e.display_name FROM entities e WHERE {alive} AND e.sort_key<>'' "
            f"AND e.search_text LIKE ?", ("%" + name + "%",)) if fold(r["display_name"]) == name]  # fmt: skip
        hit(rows, "same name (names alone do not prove it is the same person)", "weak")
    return sorted(
        found.values(), key=lambda c: (c["strength"] != "strong", fold(c["display_name"]))
    )


def summary(doc: dict) -> dict:
    count = lambda channel: [c["value"] for c in doc["contacts"] if c["channel"] == channel]  # noqa: E731
    return {
        "phones": count("phone"), "emails": count("email"), "websites": count("website"),
        "addresses": [store.address_text(a) for a in doc["addresses"]],
        "dates": [{"kind": d["kind"], "label": d["label"], "date": d["date"], "description": d["description"]}
                  for d in doc["dates"]],
        "work": [" · ".join(p for p in (e["title"], e["organization"]) if p) for e in doc["employments"]],
        "accounts": [f"{a['service']}: {a['handle'] or a['url']}" for a in doc["accounts"]],
        "nicknames": [n["value"] for n in doc["names"] if n["kind"] == "nickname"],
        "notes": doc["notes"][:300],
    }  # fmt: skip


def preview(conn, text: str, filename: str) -> dict:
    items = analyse(text)
    seen: dict = {}
    contacts = []
    unsupported: dict = {}
    for index, mapped in enumerate(items):
        doc = mapped["doc"]
        name = card_name(doc)
        in_file = []
        for contact in doc["contacts"]:
            if contact["channel"] in ("email", "phone"):
                key = (contact["channel"], store.match_key(contact["channel"], contact["value"]))
                if key[1] and key in seen and seen[key] != index and seen[key] not in in_file:
                    in_file.append(seen[key])
                seen.setdefault(key, index)
        matches = candidates(conn, mapped)
        importable = bool(name)
        if not importable:
            default, reason = "skip", "The contact has nothing that identifies it"
        elif mapped["kind"] != "person":
            default, reason = "skip", ("This card describes an organization or group. Organizations "
                                       "and Groups are not available yet; you can still import it as a person.")  # fmt: skip
        elif any(m["strength"] == "strong" for m in matches):
            default, reason = "skip", "Possibly already in Meridian; review before importing"
        elif in_file:
            default, reason = "create", "Possibly the same person as another contact in this file"
        else:
            default, reason = "create", ""
        for item in mapped["raw"]:
            unsupported[item["name"]] = unsupported.get(item["name"], 0) + 1
        for item in mapped["media"]:
            unsupported[item["name"]] = unsupported.get(item["name"], 0) + 1
        contacts.append({
            "index": index, "kind": mapped["kind"], "display_name": name or "(no name)",
            "summary": summary(doc), "unmapped": mapped["raw"],
            "media": mapped["media"], "warnings": mapped["warnings"], "candidates": matches,
            "in_file": in_file, "importable": importable, "default_action": default,
            "reason": reason,
        })  # fmt: skip
    return {
        "filename": filename, "sha256": digest(text), "total": len(items), "contacts": contacts,
        "unsupported": unsupported,
        "technical": sorted({t for m in items for t in m["technical"]}),
    }  # fmt: skip


def merge_additions(existing: dict, doc: dict) -> dict:
    """What an imported document adds to an existing person, without duplicates."""
    have_names = {(n["kind"], fold(store.name_text(n))) for n in existing["names"]}
    have_name_texts = {fold(store.name_text(n)) for n in existing["names"]}
    names = []
    for n in doc["names"]:
        text = fold(store.name_text(n))
        if n["kind"] == "full":
            if text not in have_name_texts:
                names.append({**n, "kind": "alias"})
        elif (n["kind"], text) not in have_names:
            names.append(n)
    have_contacts = {
        (c["channel"], store.match_key(c["channel"], c["value"])) for c in existing["contacts"]
    }
    contacts = []
    for c in doc["contacts"]:
        key = (c["channel"], store.match_key(c["channel"], c["value"]))
        if key not in have_contacts:
            have_contacts.add(key)
            contacts.append({**c, "is_primary": False})
    have_addr = {fold(store.address_text(a)) for a in existing["addresses"]}
    addresses = [
        {**a, "is_primary": False}
        for a in doc["addresses"]
        if fold(store.address_text(a)) not in have_addr
    ]
    have_dates = {(d["kind"], d["date"], fold(d["description"])) for d in existing["dates"]}
    dates = [
        d for d in doc["dates"] if (d["kind"], d["date"], fold(d["description"])) not in have_dates
    ]
    have_work = {(fold(e["organization"]), fold(e["title"])) for e in existing["employments"]}
    employments = [
        e
        for e in doc["employments"]
        if (fold(e["organization"]), fold(e["title"])) not in have_work
    ]
    have_accounts = {
        (fold(a["service"]), fold(a["handle"] or a["url"])) for a in existing["accounts"]
    }
    accounts = [
        a
        for a in doc["accounts"]
        if (fold(a["service"]), fold(a["handle"] or a["url"])) not in have_accounts
    ]
    have_facts = {(fold(f["key"]), fold(f["value"])) for f in existing["facts"]}
    facts = [f for f in doc["facts"] if (fold(f["key"]), fold(f["value"])) not in have_facts]
    additions = {"names": names, "contacts": contacts, "addresses": addresses, "dates": dates,
                 "employments": employments, "accounts": accounts, "facts": facts}  # fmt: skip
    if doc["notes"] and fold(doc["notes"]) not in fold(existing["notes"]):
        additions["notes"] = (existing["notes"] + "\n\n" if existing["notes"] else "") + doc[
            "notes"
        ]
    return additions


def add_extras(conn, entity_id, mapped, source_id, now):
    for ident in mapped["identifiers"]:
        conn.execute(
            "INSERT OR IGNORE INTO identifiers(id,entity_id,system,value,source_id,created_at) VALUES(?,?,?,?,?,?)",
            (uuid7(), entity_id, ident["system"], ident["value"], source_id, now),
        )
    for item in mapped["raw"]:
        conn.execute(
            "INSERT INTO raw_properties(id,entity_id,source_id,name,params,value,created_at) VALUES(?,?,?,?,?,?,?)",
            (
                uuid7(),
                entity_id,
                source_id,
                item["name"],
                json.dumps(item["params"]),
                item["value"],
                now,
            ),
        )
    for item in mapped["media"]:
        # Photos belong to Argus and shared storage; Meridian records only that one existed.
        size = (
            f"{max(1, round(item['bytes'] * 3 / 4 / 1024))} KB" if item["bytes"] else "unknown size"
        )
        conn.execute(
            "INSERT INTO raw_properties(id,entity_id,source_id,name,params,value,created_at) VALUES(?,?,?,?,?,?,?)",
            (uuid7(), entity_id, source_id, item["name"], json.dumps({"not_imported": "embedded media"}),
             f"Embedded image not imported ({size}). Photos belong to the media library, not Meridian.", now),
        )  # fmt: skip


def commit(conn, text: str, filename: str, sha256: str, decisions: list) -> dict:
    if digest(text) != sha256:
        raise ImportError_("The file changed since the preview; preview it again")
    items = analyse(text)
    by_index = {}
    for decision in decisions:
        index = decision.get("index")
        if not isinstance(index, int) or not 0 <= index < len(items) or index in by_index:
            raise ImportError_("Every contact needs exactly one decision")
        if decision.get("action") not in ("create", "merge", "skip"):
            raise ImportError_("Unknown import action")
        by_index[index] = decision
    if len(by_index) != len(items):
        raise ImportError_("Every contact needs exactly one decision")
    now = iso_now()
    source_id, import_id = uuid7(), uuid7()
    conn.execute(
        "INSERT INTO sources(id,kind,label,detail,created_at) VALUES(?,?,?,?,?)",
        (
            source_id,
            "vcard-import",
            filename,
            json.dumps({"import": import_id, "sha256": sha256}),
            now,
        ),
    )
    conn.execute(
        "INSERT INTO imports(id,source_id,filename,sha256,created_at,total,created,merged,skipped) "
        "VALUES(?,?,?,?,?,?,0,0,0)",
        (import_id, source_id, filename, sha256, now, len(items)),
    )
    counts = {"create": 0, "merge": 0, "skip": 0}
    results = []
    for index, mapped in enumerate(items):
        decision = by_index[index]
        action = decision["action"]
        name = card_name(mapped["doc"])
        entity_id = None
        if action != "skip" and not name:
            raise ImportError_(
                f"Contact {index + 1} has nothing that identifies it and can only be skipped"
            )
        if action == "create":
            entity_id = store.save_person(conn, mapped["doc"], source_id=source_id)
            add_extras(conn, entity_id, mapped, source_id, now)
        elif action == "merge":
            target = decision.get("target")
            existing = store.load_person(conn, target) if isinstance(target, str) else None
            if not existing:
                raise ImportError_(f"The person chosen for contact {index + 1} no longer exists")
            entity_id = store.save_person(conn, merge_additions(existing, mapped["doc"]),
                                          entity_id=target, source_id=source_id, keep=True)  # fmt: skip
            add_extras(conn, entity_id, mapped, source_id, now)
        counts[action] += 1
        conn.execute(
            "INSERT INTO import_items(import_id,position,action,entity_id,label) VALUES(?,?,?,?,?)",
            (import_id, index, action, entity_id, name[:300]),
        )
        results.append({"index": index, "action": action, "id": entity_id, "display_name": name})
    unsupported: dict = {}
    for mapped in items:
        for item in mapped["raw"] + mapped["media"]:
            unsupported[item["name"]] = unsupported.get(item["name"], 0) + 1
    conn.execute(
        "UPDATE imports SET created=?, merged=?, skipped=?, summary=? WHERE id=?",
        (counts["create"], counts["merge"], counts["skip"], json.dumps({"unsupported": unsupported}),
         import_id),
    )  # fmt: skip
    return {"id": import_id, "filename": filename, "total": len(items), "created": counts["create"],
            "merged": counts["merge"], "skipped": counts["skip"], "results": results,
            "unsupported": unsupported}  # fmt: skip
