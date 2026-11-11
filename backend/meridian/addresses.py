"""Real-world address search for the contact editor.

Meridian has no network access of its own. Atlas owns the geographic provider, the owner's
consent to use the network, the rate limit and the attribution, and answers through its
`address-suggest` projection. Only the text typed into the search box leaves Meridian, and only
after the owner has turned this on; it is never combined with a contact and never logged.
"""

from . import nexus

CONSENT_KEY = "address_search.enabled"
MAX_QUERY = 120
MIN_QUERY = 3


def enabled(conn):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (CONSENT_KEY,)).fetchone()
    return bool(row and row["value"] == "1")


def set_enabled(conn, value):
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (CONSENT_KEY, "1" if value else "0"),
    )


def _ask(query):
    """(availability, status item, suggestions). Never raises and never echoes the query."""
    try:
        page = nexus.call(
            "POST",
            "/projections/query",
            {"module": "atlas", "projection": "address-suggest", "query": query, "cursor": None},
        )
    except nexus.NexusRefused as exc:
        return ("not_granted" if exc.status == 403 else "unavailable"), None, []
    except nexus.NexusUnavailable:
        return "unavailable", None, []
    if page.get("availability") != "available":
        return "atlas_unavailable", None, []
    items = [i for i in page.get("items") or [] if isinstance(i, dict)]
    status = next((i for i in items if i.get("kind") == "status"), None)
    return "available", status, [i for i in items if i.get("kind") == "suggestion"]


def status(consent):
    availability, info, _ = _ask({"status": True})
    if availability != "available" or not info:
        return {
            "consent": consent,
            "availability": availability if availability != "available" else "atlas_unavailable",
        }
    return {
        "consent": consent,
        "availability": "available" if info.get("online") else "atlas_offline",
        "provider": str(info.get("provider") or ""),
        "attribution": str(info.get("attribution") or ""),
    }


def search(q):
    q = " ".join(str(q).split())[:MAX_QUERY]
    if len(q) < MIN_QUERY:
        return {"availability": "available", "items": []}
    availability, info, items = _ask({"q": q})
    if availability != "available" or not info:
        return {
            "availability": availability if availability != "available" else "atlas_unavailable",
            "items": [],
        }
    outcome = str(info.get("outcome") or "ok")
    if outcome != "ok":
        return {"availability": outcome, "items": []}
    return {
        "availability": "available",
        "attribution": str(info.get("attribution") or ""),
        "items": items,
    }
