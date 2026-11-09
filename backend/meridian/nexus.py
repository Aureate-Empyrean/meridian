"""The few Nexus module APIs Meridian uses, with its own bearer token (never a browser
credential): Argus photo projections, and registering the representative-image reference.

Every call is optional for Meridian: when Nexus or Argus is unavailable, profiles fall back to
initials and nothing in Meridian's own data changes.
"""

import json
import os
import urllib.error
import urllib.request

TIMEOUT = 6  # Nexus gives a projection call 5 s


class NexusUnavailable(Exception):
    pass


class NexusRefused(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _call(method, path, body=None):
    base = os.getenv("NEXUS_URL", "").rstrip("/")
    token = os.getenv("NEXUS_TOKEN", "")
    if not base or not token:
        raise NexusUnavailable("Not running under Nexus")
    req = urllib.request.Request(
        base + "/api/v1/module" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )  # fmt: skip
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read(2 * 1024 * 1024) or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read(4096)).get("detail", "")
        except (ValueError, OSError):
            detail = ""
        raise NexusRefused(exc.code, str(detail)[:300]) from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise NexusUnavailable(str(exc)) from exc


def call(method, path, body=None):
    """Any module API call (references, resolution, events); raises NexusUnavailable or
    NexusRefused like the helpers below."""
    return _call(method, path, body)


def projection(name, query, cursor=None):
    """An Argus projection page: {availability, items, next_cursor}. Never raises for an
    unavailable provider; `availability` says why there is nothing."""
    try:
        page = _call(
            "POST",
            "/projections/query",
            {"module": "argus", "projection": name, "query": query, "cursor": cursor},
        )
    except NexusRefused as exc:
        return {
            "availability": "not_granted" if exc.status == 403 else "nexus_error",
            "items": [],
            "next_cursor": None,
        }
    except NexusUnavailable:
        return {"availability": "nexus_unreachable", "items": [], "next_cursor": None}
    if page.get("availability") != "available":
        return {
            "availability": page.get("availability") or "temporarily_unavailable",
            "items": [],
            "next_cursor": None,
        }
    return {
        "availability": "available",
        "items": page.get("items") or [],
        "next_cursor": page.get("next_cursor"),
    }


def create_reference(source, target, relation, readers):
    """Register (or update) an owned edge; returns the Nexus reference ID."""
    out = _call(
        "POST",
        "/references",
        {"source": source, "target": target, "relation": relation, "readers": readers},
    )
    return out["reference"]["id"]


def delete_reference(reference_id):
    try:
        _call("DELETE", f"/references/{reference_id}")
    except NexusRefused as exc:
        if exc.status != 404:
            raise
