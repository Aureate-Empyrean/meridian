"""Representative images for People, Organizations and Groups.

Argus owns the photo. Meridian stores only which photo represents an entity and the square
crop the owner chose (normalised 0–1 to the picture as viewed), never image files or EXIF.
Pictures reach the page through Argus's `photo-renditions` projection; rendered images are
derived data and are cached in memory only. Choosing a profile picture is not a statement
that the photo depicts anyone, so the Nexus edge is `meridian.representative-image`, shared
with `argus` so Argus can warn before a photo in use is deleted.
"""

import logging
import threading
import time
from collections import OrderedDict

from . import nexus
from .util import UUID, iso_now

log = logging.getLogger("meridian.images")
RELATION = "meridian.representative-image"
SIZES = (64, 128, 256, 512)
PREVIEW_SIZES = (1024, 1600)
BATCH = 40  # photo-renditions accepts at most 40 items
CACHE_SIZE = 600
CACHE_TTL = 2 * 60  # bounds how long a photo trashed in Argus can still show
MISS_TTL = 60


def photo_ref(photo_id):
    return f"nexus:v1:argus:photo:{photo_id}"


def entity_ref(kind, entity_id):
    return f"nexus:v1:meridian:{kind}:{entity_id}"


def valid_crop(crop):
    """A normalised crop inside the picture, or ValueError. Argus checks squareness in pixels
    (it knows the oriented size); Meridian checks bounds and keeps six decimals."""
    try:
        x, y, w, h = (round(float(crop[k]), 6) for k in ("x", "y", "w", "h"))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("A crop needs x, y, w and h") from exc
    if not (0 <= x < 1 and 0 <= y < 1 and 0.005 <= w <= 1 and 0.005 <= h <= 1):
        raise ValueError("Crop values must be between 0 and 1")
    if x + w > 1.000001 or y + h > 1.000001:
        raise ValueError("The crop must stay inside the picture")
    return {"x": x, "y": y, "w": min(w, 1 - x), "h": min(h, 1 - y)}


def row_view(row):
    if not row:
        return None
    return {"photo_id": row["photo_id"], "reference": photo_ref(row["photo_id"]),
            "crop": {"x": row["crop_x"], "y": row["crop_y"], "w": row["crop_w"], "h": row["crop_h"]},
            "updated_at": row["updated_at"], "nexus_state": row["nexus_state"]}  # fmt: skip


def get(conn, entity_id):
    return row_view(
        conn.execute(
            "SELECT * FROM representative_images WHERE entity_id=?", (entity_id,)
        ).fetchone()
    )


def put(conn, entity_id, photo_id, crop):
    if not UUID.fullmatch(photo_id or ""):
        raise ValueError("Unknown photo")
    crop = valid_crop(crop)
    old = conn.execute(
        "SELECT * FROM representative_images WHERE entity_id=?", (entity_id,)
    ).fetchone()
    if old and old["photo_id"] != photo_id and old["nexus_reference_id"]:
        queue_cleanup(conn, old["nexus_reference_id"])
    conn.execute(
        "INSERT INTO representative_images(entity_id,photo_id,crop_x,crop_y,crop_w,crop_h,"
        "updated_at,nexus_reference_id,nexus_state) VALUES(?,?,?,?,?,?,?,NULL,'pending') "
        "ON CONFLICT(entity_id) DO UPDATE SET photo_id=excluded.photo_id, crop_x=excluded.crop_x,"
        " crop_y=excluded.crop_y, crop_w=excluded.crop_w, crop_h=excluded.crop_h,"
        " updated_at=excluded.updated_at,"
        " nexus_reference_id=CASE WHEN representative_images.photo_id=excluded.photo_id"
        "   THEN representative_images.nexus_reference_id END,"
        " nexus_state=CASE WHEN representative_images.photo_id=excluded.photo_id"
        "   THEN representative_images.nexus_state ELSE 'pending' END",
        (entity_id, photo_id, crop["x"], crop["y"], crop["w"], crop["h"], iso_now()),
    )
    return get(conn, entity_id)


def forget(conn, entity_id):
    """Remove an entity's image (also before a purge); its Nexus edge is removed later."""
    old = conn.execute(
        "SELECT nexus_reference_id FROM representative_images WHERE entity_id=?", (entity_id,)
    ).fetchone()
    if old and old["nexus_reference_id"]:
        queue_cleanup(conn, old["nexus_reference_id"])
    conn.execute("DELETE FROM representative_images WHERE entity_id=?", (entity_id,))


def queue_cleanup(conn, reference_id):
    conn.execute(
        "INSERT OR IGNORE INTO reference_cleanup(reference_id, queued_at) VALUES(?,?)",
        (reference_id, iso_now()),
    )


def sync_references(db, entity_id=None):
    """Best effort: register pending edges with Nexus and remove obsolete ones. Failures leave
    the state `pending` for the next attempt; Nexus can also rebuild its index from
    `GET /empyrean/v1/references/outgoing` at any time."""
    with db.connect() as conn:
        cleanup = [r[0] for r in conn.execute("SELECT reference_id FROM reference_cleanup")]
        sql = (
            "SELECT r.*, e.kind FROM representative_images r JOIN entities e ON e.id=r.entity_id"
            " WHERE r.nexus_state<>'registered'"
        )
        rows = conn.execute(
            sql + (" AND r.entity_id=?" if entity_id else ""), (entity_id,) if entity_id else ()
        ).fetchall()
    for ref_id in cleanup:
        try:
            nexus.delete_reference(ref_id)
        except (nexus.NexusUnavailable, nexus.NexusRefused) as exc:
            log.warning("Reference cleanup deferred: %s", exc)
            continue
        with db.connect() as conn:
            conn.execute("DELETE FROM reference_cleanup WHERE reference_id=?", (ref_id,))
    for row in rows:
        try:
            ref_id = nexus.create_reference(
                entity_ref(row["kind"], row["entity_id"]),
                photo_ref(row["photo_id"]),
                RELATION,
                ["argus"],
            )
            state = ("registered", ref_id)
        except nexus.NexusRefused as exc:
            # 422: Argus is not installed (the photo type is undeclared) or similar.
            state = ("pending", None)
            log.warning("Reference not registered (%s): %s", exc.status, exc.detail)
        except nexus.NexusUnavailable as exc:
            state = ("pending", None)
            log.warning("Reference not registered: %s", exc)
        with db.connect() as conn:
            conn.execute(
                "UPDATE representative_images SET nexus_state=?, nexus_reference_id=? "
                "WHERE entity_id=? AND photo_id=?",
                (state[0], state[1], row["entity_id"], row["photo_id"]),
            )


_retry_lock = threading.Lock()
_last_retry = [0.0]


def retry_pending(db, every=60):
    """Re-attempt pending edges at most once a minute, off the request path."""
    with _retry_lock:
        if time.monotonic() - _last_retry[0] < every:
            return
        _last_retry[0] = time.monotonic()
    with db.connect() as conn:
        pending = conn.execute(
            "SELECT 1 FROM representative_images WHERE nexus_state<>'registered' "
            "UNION ALL SELECT 1 FROM reference_cleanup LIMIT 1"
        ).fetchone()
    if pending:
        threading.Thread(target=sync_references, args=(db,), daemon=True).start()


def outgoing(conn, limit, cursor):
    """Entity References v2 enumeration: every edge Meridian wants in the Nexus index."""
    rows = conn.execute(
        "SELECT r.entity_id, r.photo_id, e.kind FROM representative_images r "
        "JOIN entities e ON e.id=r.entity_id WHERE r.entity_id > ? ORDER BY r.entity_id LIMIT ?",
        (cursor or "", limit + 1),
    ).fetchall()
    page = rows[:limit]
    return {
        "references": [
            {
                "source": entity_ref(r["kind"], r["entity_id"]),
                "target": photo_ref(r["photo_id"]),
                "relation": RELATION,
                "metadata": {},
                "readers": ["argus"],
            }
            for r in page
        ],  # fmt: skip
        "next_cursor": page[-1]["entity_id"] if len(rows) > limit else None,
    }


class RenditionCache:
    """Rendered images are derived data: kept in memory only, bounded, and short-lived."""

    def __init__(self):
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._items.get(key)
            if not hit or hit[0] < time.monotonic():
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return hit[1]

    def put(self, key, value, ttl):
        with self._lock:
            self._items[key] = (time.monotonic() + ttl, value)
            self._items.move_to_end(key)
            while len(self._items) > CACHE_SIZE:
                self._items.popitem(last=False)

    def clear(self):
        with self._lock:
            self._items.clear()


CACHE = RenditionCache()


def _key(photo_id, crop, size):
    c = crop or {}
    return (photo_id, size, c.get("x"), c.get("y"), c.get("w"), c.get("h"))


def renditions(requests):
    """[(photo_id, crop|None, size)] → ({key: {status, src?}}, availability). Asks Argus only
    for what the cache does not hold, in batches of 40. Statuses other than `available` are
    remembered briefly so a missing photo does not cost a call per page view."""
    out, missing = {}, []
    for photo_id, crop, size in requests:
        key = _key(photo_id, crop, size)
        hit = CACHE.get(key)
        if hit:
            out[key] = hit
        elif key not in out:
            out[key] = None
            missing.append((key, photo_id, crop, size))
    availability = "available"
    for i in range(0, len(missing), BATCH):
        chunk = missing[i : i + BATCH]
        items = [{"id": p, "size": s, **({"crop": c} if c else {})} for _, p, c, s in chunk]
        page = nexus.projection("photo-renditions", {"items": items})
        if page["availability"] != "available":
            availability = page["availability"]
            for key, *_ in chunk:
                out[key] = {"status": "unavailable"}
            continue
        answers = page["items"]
        for n, (key, *_) in enumerate(chunk):
            item = answers[n] if n < len(answers) and isinstance(answers[n], dict) else {}
            status = item.get("status") or "unavailable"
            if (
                status == "available"
                and isinstance(item.get("src"), str)
                and item["src"].startswith("data:image/")
            ):
                value = {"status": "available", "src": item["src"]}
                CACHE.put(key, value, CACHE_TTL)
            else:
                value = {"status": status if status != "available" else "unavailable"}
                if status != "deferred":
                    CACHE.put(key, value, MISS_TTL)
            out[key] = value
    return out, availability


def avatars(conn, entity_ids, size):
    """Cropped pictures for the given entities, keyed by entity ID. Entities without an image
    are simply absent: the page shows initials."""
    if size not in SIZES:
        raise ValueError("Unsupported size")
    ids = [i for i in dict.fromkeys(entity_ids) if UUID.fullmatch(i)][:120]
    if not ids:
        return {"items": {}, "availability": "available"}
    rows = conn.execute(
        f"SELECT * FROM representative_images WHERE entity_id IN ({','.join('?' * len(ids))})",
        ids,
    ).fetchall()
    wanted = [(r["photo_id"], row_view(r)["crop"], size) for r in rows]
    result, availability = renditions(wanted)
    items = {}
    for r in rows:
        value = result.get(_key(r["photo_id"], row_view(r)["crop"], size)) or {
            "status": "unavailable"
        }
        items[r["entity_id"]] = value
    return {"items": items, "availability": availability}


def library(cursor=None, limit=24):
    page = nexus.projection("photo-library", {"limit": max(1, min(int(limit), 40))}, cursor)
    items = []
    for it in page["items"]:
        if not isinstance(it, dict) or not UUID.fullmatch(str(it.get("id", ""))):
            continue
        thumb = it.get("thumbnail")
        items.append({"id": it["id"], "title": str(it.get("title") or "")[:200],
                      "width": int(it.get("width") or 0), "height": int(it.get("height") or 0),
                      "taken_at": it.get("taken_at"), "created_at": it.get("created_at"),
                      "thumbnail": thumb if isinstance(thumb, str) and thumb.startswith("data:image/") else None})  # fmt: skip
    return {
        "availability": page["availability"],
        "items": items,
        "next_cursor": page["next_cursor"],
    }


def preview(photo_id, size=1024):
    if not UUID.fullmatch(photo_id or "") or size not in PREVIEW_SIZES:
        raise ValueError("Unknown photo or size")
    result, availability = renditions([(photo_id, None, size)])
    return {
        **(result.get(_key(photo_id, None, size)) or {"status": "unavailable"}),
        "availability": availability,
    }
