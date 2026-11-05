import base64
import json
import os
import re
import secrets
import sqlite3
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from . import VERSION, dates, importer, relations, store, timeline, vcard
from .db import MIGRATIONS, Database
from .models import EntityDoc, EventIn, MembershipIn, PersonDoc, RelationshipIn, Strict, TypeIn
from .util import REF, UUID, fold, iso_now, uuid7

ROOT = Path(__file__).resolve().parents[2]
BACKUP_HEADER = "X-Empyrean-Backup-"
BACKUP_FORMAT = "meridian-sqlite"
BACKUP_FORMAT_VERSION = 1
MAX_ARTIFACT = 256 * 1024 * 1024
UPCOMING_DAYS = 60
FILTERS = {
    "phone": "EXISTS(SELECT 1 FROM contact_points c WHERE c.entity_id=e.id AND c.channel='phone')",
    "email": "EXISTS(SELECT 1 FROM contact_points c WHERE c.entity_id=e.id AND c.channel='email')",
    "birthday": "EXISTS(SELECT 1 FROM personal_dates d WHERE d.entity_id=e.id AND d.kind='birth')",
    "work": "EXISTS(SELECT 1 FROM employments w WHERE w.person_id=e.id)",
    "imported": "EXISTS(SELECT 1 FROM names n JOIN sources s ON s.id=n.source_id WHERE n.entity_id=e.id)",
}
SORTS = {
    "name": "e.sort_key, e.display_name",
    "updated": "e.updated_at DESC, e.sort_key",
    "created": "e.created_at DESC, e.sort_key",
}


class SelfBody(Strict):
    person_id: str | None = Field(default=None, max_length=64)


class PreviewBody(Strict):
    filename: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=vcard.MAX_BYTES)


class CommitBody(PreviewBody):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    decisions: list[dict] = Field(max_length=vcard.MAX_CARDS)


def styles():
    """Shared tokens, the shared foundation, the bundled Roboto face (inline: the sandbox
    has no network), then Meridian's own styles."""
    font = base64.b64encode((ROOT / "frontend/fonts/Roboto.woff2").read_bytes()).decode()
    face = (
        '@font-face{font-family:"Roboto";src:url(data:font/woff2;base64,'
        + font
        + ') format("woff2");font-weight:100 900;font-stretch:75% 100%;font-display:swap}'
    )
    return "\n".join(
        [
            (ROOT / "frontend/aureate-tokens.css").read_text(encoding="utf-8"),
            (ROOT / "frontend/aureate-foundation.css").read_text(encoding="utf-8"),
            face,
            (ROOT / "frontend/style.css").read_text(encoding="utf-8"),
        ]
    )


def readable(error: dict) -> str:
    """One sentence for a validation error, naming the section and row it concerns."""
    message = re.sub(r"^(Value error|Assertion failed), ", "", error.get("msg", "Invalid value"))
    path = [str(p) for p in error.get("loc", ()) if p not in ("body",)]
    names = {"names": "Name", "contacts": "Contact", "addresses": "Address", "dates": "Date",
             "employments": "Work", "accounts": "Account", "facts": "Detail", "sources": "Source"}  # fmt: skip
    if len(path) >= 2 and path[0] in names and path[1].isdigit():
        return f"{names[path[0]]} {int(path[1]) + 1}: {message}"
    fields = {"valid_from": "Start", "valid_until": "End", "context": "Context", "role": "Role",
              "label": "Name", "inverse": "Reverse name", "type": "Relationship type",
              "title": "Title", "starts": "Date", "ends": "End", "category": "Kind of event",
              "participants": "Involved", "description": "Description"}  # fmt: skip
    if path and path[0] in fields:
        return f"{fields[path[0]]}: {message}"
    return message


def create_app(data_dir=None):
    db = Database(Path(data_dir or os.getenv("MERIDIAN_DATA", "/data")) / "meridian.sqlite3")
    style = styles()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db = db

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        return JSONResponse({"detail": readable(errors[0]) if errors else "Invalid request"}, 422)

    @app.middleware("http")
    async def trusted_gateway(request: Request, call_next):
        # Personal records are reachable only through the owner-authenticated Nexus gateway.
        if request.url.path.startswith("/api/"):
            key = os.getenv("NEXUS_RESOLVER_KEY", "")
            if not key or not secrets.compare_digest(
                request.headers.get("x-nexus-gateway-key", ""), key
            ):
                return JSONResponse({"detail": "Nexus gateway required"}, status_code=403)
        return await call_next(request)

    def person_or_404(conn, pid, include_deleted=False):
        if not UUID.fullmatch(pid or ""):
            raise HTTPException(404, "Person not found")
        person = store.load_person(conn, pid, include_deleted)
        if not person:
            raise HTTPException(404, "Person not found")
        return person

    KINDS = ("person", "organization", "group")
    NOUN = {"person": "Person", "organization": "Organization", "group": "Group"}

    def entity_or_404(conn, eid, include_deleted=False, kinds=KINDS):
        if not UUID.fullmatch(eid or ""):
            raise HTTPException(404, "Not found")
        entity = store.load_person(conn, eid, include_deleted, kinds)
        if not entity:
            raise HTTPException(404, f"{NOUN[kinds[0]] if len(kinds) == 1 else 'Entity'} not found")
        return entity

    def relation_errors(fn):
        try:
            return fn()
        except relations.Invalid as exc:
            raise HTTPException(422, str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(404, "Not found") from exc

    def self_summary(conn):
        rows = store.summaries(conn, "AND e.is_self=1 AND e.deleted_at IS NULL", limit=1)
        return rows[0] if rows else None

    # ── State and Dashboard ──────────────────────────────────────────

    @app.get("/health")
    def health():
        with db.connect() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "version": VERSION}

    def counts(conn):
        one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
        live = "SELECT count(*) FROM entities WHERE kind='{}' AND deleted_at IS NULL"
        return {
            "people": one(live.format("person")),
            "organizations": one(live.format("organization")),
            "groups": one(live.format("group")),
            "relationships": one("SELECT count(*) FROM relationships"),
            "trash": one("SELECT count(*) FROM entities WHERE deleted_at IS NOT NULL"),
            "imports": one("SELECT count(*) FROM imports"),
        }

    @app.get("/api/state")
    def state():
        with db.connect() as conn:
            return {"version": VERSION, "self": self_summary(conn), "counts": counts(conn)}

    @app.get("/api/dashboard")
    def dashboard(today: str = ""):
        try:
            day = date.fromisoformat(today) if today else date.today()
        except ValueError as exc:
            raise HTTPException(422, "today must be YYYY-MM-DD") from exc
        with db.connect() as conn:
            recent = store.summaries(
                conn, "AND e.deleted_at IS NULL", order="e.updated_at DESC", limit=6
            )
            upcoming = []
            for r in conn.execute(
                "SELECT d.*, e.display_name FROM personal_dates d JOIN entities e ON e.id=d.entity_id "
                "WHERE e.kind='person' AND e.deleted_at IS NULL AND d.date IS NOT NULL "
                "AND d.valid_until IS NULL"
            ):
                when = dates.next_occurrence(r["date"], day)
                if not when or (when - day).days > UPCOMING_DAYS:
                    continue
                year = dates.year_of(r["date"])
                upcoming.append({
                    "person_id": r["entity_id"], "display_name": r["display_name"], "kind": r["kind"],
                    "label": r["label"], "date": r["date"], "on": when.isoformat(),
                    "in_days": (when - day).days, "approximate": bool(r["approximate"]),
                    "years": when.year - year if year and not r["approximate"] else None,
                })  # fmt: skip
            upcoming.sort(key=lambda u: (u["on"], fold(u["display_name"])))
            last_import = conn.execute(
                "SELECT * FROM imports ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            return {
                "counts": counts(conn), "self": self_summary(conn), "recent": recent,
                "upcoming": upcoming[:12], "upcoming_days": UPCOMING_DAYS,
                "last_import": dict(last_import) if last_import else None,
            }  # fmt: skip

    # ── People ───────────────────────────────────────────────────────

    def search_clause(q: str):
        tokens = [t for t in fold(q).split(" ") if t][:8]
        return " ".join("AND e.search_text LIKE ? ESCAPE '\\'" for _ in tokens), tuple(
            "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            for t in tokens
        )

    @app.get("/api/people")
    def people(q: str = "", has: str = "", sort: str = "name", limit: int = 100, offset: int = 0):
        if sort not in SORTS:
            raise HTTPException(422, "Unknown sort")
        where, params = search_clause(q[:200])
        for name in [h for h in has.split(",") if h]:
            if name not in FILTERS:
                raise HTTPException(422, "Unknown filter")
            where += " AND " + FILTERS[name]
        where = "AND e.deleted_at IS NULL " + where
        limit, offset = max(1, min(limit, 500)), max(0, offset)
        with db.connect() as conn:
            total = conn.execute(
                f"SELECT count(*) FROM entities e WHERE e.kind='person' {where}", params
            ).fetchone()[0]
            items = store.summaries(conn, where, params, SORTS[sort], limit, offset)
        return {"items": items, "total": total}

    @app.get("/api/search")
    def search(q: str = "", kinds: str = "person"):
        wanted = tuple(k for k in kinds.split(",") if k in KINDS) or ("person",)
        if not fold(q):
            return {"people": [], "entities": []}
        where, params = search_clause(q[:200])
        with db.connect() as conn:
            found = store.summaries(
                conn, "AND e.deleted_at IS NULL " + where, params, limit=12, kinds=wanted
            )
        return {"people": [x for x in found if x["kind"] == "person"][:8], "entities": found}

    @app.post("/api/people", status_code=201)
    def create_person(body: PersonDoc):
        with db.connect() as conn:
            pid = store.save_person(conn, body.model_dump())
            return store.load_person(conn, pid)

    @app.get("/api/people/{pid}")
    def get_person(pid: str):
        with db.connect() as conn:
            return person_or_404(conn, pid, include_deleted=True)

    @app.put("/api/people/{pid}")
    def update_person(pid: str, body: PersonDoc):
        with db.connect() as conn:
            person_or_404(conn, pid)
            store.save_person(conn, body.model_dump(), entity_id=pid)
            return store.load_person(conn, pid)

    @app.delete("/api/people/{pid}")
    def trash_person(pid: str):
        """Move to Trash: recoverable. Being @me ends with it."""
        with db.connect() as conn:
            person_or_404(conn, pid)
            conn.execute("UPDATE entities SET deleted_at=?, is_self=0 WHERE id=?", (iso_now(), pid))
            return {"trashed": True}

    @app.post("/api/people/{pid}/restore")
    def restore_person(pid: str):
        with db.connect() as conn:
            person = person_or_404(conn, pid, include_deleted=True)
            if not person["deleted_at"]:
                raise HTTPException(409, "This person is not in Trash")
            conn.execute("UPDATE entities SET deleted_at=NULL WHERE id=?", (pid,))
            return store.load_person(conn, pid)

    @app.get("/api/trash")
    def trash():
        with db.connect() as conn:
            items = store.summaries(
                conn,
                "AND e.deleted_at IS NOT NULL",
                order="e.deleted_at DESC",
                limit=500,
                kinds=KINDS,
            )
            return {"items": items}

    @app.delete("/api/trash/{pid}")
    def purge_person(pid: str):
        """Delete permanently. A tombstone keeps references from other modules honest; the
        entity's relationships and memberships go with it."""
        with db.connect() as conn:
            entity = entity_or_404(conn, pid, include_deleted=True)
            if not entity["deleted_at"]:
                raise HTTPException(409, "Move it to Trash first")
            conn.execute("DELETE FROM entities WHERE id=?", (pid,))
            conn.execute(
                "INSERT OR REPLACE INTO tombstones(id,kind,deleted_at) VALUES(?,?,?)",
                (pid, entity["kind"], iso_now()),
            )
            return {"deleted": True}

    # ── Organizations and Groups ─────────────────────────────────────

    @app.get("/api/entities")
    def entities(kind: str, q: str = "", sort: str = "name", limit: int = 100, offset: int = 0):
        if kind not in ("organization", "group") or sort not in SORTS:
            raise HTTPException(422, "Unknown kind or sort")
        where, params = search_clause(q[:200])
        where = "AND e.deleted_at IS NULL " + where
        limit, offset = max(1, min(limit, 500)), max(0, offset)
        with db.connect() as conn:
            total = conn.execute(
                f"SELECT count(*) FROM entities e WHERE e.kind=? {where}", (kind, *params)
            ).fetchone()[0]
            items = store.summaries(conn, where, params, SORTS[sort], limit, offset, kinds=(kind,))
        return {"items": items, "total": total}

    @app.post("/api/entities", status_code=201)
    def create_entity(body: EntityDoc):
        doc = body.model_dump()
        with db.connect() as conn:
            eid = store.save_person(conn, doc, kind=doc.pop("kind"))
            return store.load_person(conn, eid, kinds=KINDS)

    @app.get("/api/entities/{eid}")
    def get_entity(eid: str):
        with db.connect() as conn:
            return entity_or_404(conn, eid, include_deleted=True)

    @app.put("/api/entities/{eid}")
    def update_entity(eid: str, body: EntityDoc):
        doc = body.model_dump()
        with db.connect() as conn:
            current = entity_or_404(conn, eid, kinds=("organization", "group"))
            if doc.pop("kind") != current["kind"]:
                raise HTTPException(422, "An entity keeps its kind")
            store.save_person(conn, doc, entity_id=eid)
            return store.load_person(conn, eid, kinds=KINDS)

    @app.delete("/api/entities/{eid}")
    def trash_entity(eid: str):
        with db.connect() as conn:
            entity_or_404(conn, eid, kinds=("organization", "group"))
            conn.execute("UPDATE entities SET deleted_at=? WHERE id=?", (iso_now(), eid))
            return {"trashed": True}

    @app.post("/api/entities/{eid}/restore")
    def restore_entity(eid: str):
        with db.connect() as conn:
            entity = entity_or_404(conn, eid, include_deleted=True)
            if not entity["deleted_at"]:
                raise HTTPException(409, "This is not in Trash")
            conn.execute("UPDATE entities SET deleted_at=NULL WHERE id=?", (eid,))
            return store.load_person(conn, eid, kinds=KINDS)

    # ── Relationships and memberships ────────────────────────────────

    @app.get("/api/relationship-types")
    def relationship_types():
        with db.connect() as conn:
            return {
                "types": list(relations.types(conn).values()),
                "categories": relations.CATEGORIES,
            }

    @app.post("/api/relationship-types", status_code=201)
    def create_relationship_type(body: TypeIn):
        with db.connect() as conn:
            return relations.create_type(
                conn, body.label, body.inverse, body.symmetric, body.category
            )

    @app.get("/api/similar-relationships")
    def similar_relationships(subject_id: str, object_id: str, type: str, exclude: str = ""):
        """Existing relationships a new one may duplicate, asked before saving (the Nexus
        bridge passes only an error's message, so the check is its own request)."""
        if not (UUID.fullmatch(subject_id) and UUID.fullmatch(object_id)):
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            t = relations.types(conn).get(type)
            if not t:
                raise HTTPException(422, "Choose a relationship type")
            rows = relations.similar(
                conn, subject_id, object_id, type, exclude or None, t["symmetric"]
            )
            return {"similar": [relations.relationship_record(conn, r, subject_id) for r in rows]}

    def one_relationship(conn, rid, perspective=None):
        row = conn.execute("SELECT * FROM relationships WHERE id=?", (rid,)).fetchone()
        if not row:
            raise HTTPException(404, "Relationship not found")
        return relations.relationship_record(conn, row, perspective)

    def save_relationship(body: RelationshipIn, rid=None):
        data = body.model_dump()
        data["sources"] = [x.model_dump() for x in body.sources]
        with db.connect() as conn:
            try:
                new = relation_errors(
                    lambda: relations.save_relationship(conn, data, rid, body.allow_similar)
                )
            except relations.Similar as exc:
                return JSONResponse(
                    {"detail": "A similar relationship already exists",
                     "similar": [relations.relationship_record(conn, r, body.subject_id) for r in exc.records]},
                    409,
                )  # fmt: skip
            return one_relationship(conn, new, body.subject_id)

    @app.post("/api/relationships", status_code=201)
    def create_relationship(body: RelationshipIn):
        return save_relationship(body)

    @app.get("/api/relationships/{rid}")
    def get_relationship(rid: str):
        with db.connect() as conn:
            return one_relationship(conn, rid)

    @app.put("/api/relationships/{rid}")
    def update_relationship(rid: str, body: RelationshipIn):
        with db.connect() as conn:
            one_relationship(conn, rid)
        return save_relationship(body, rid)

    @app.delete("/api/relationships/{rid}")
    def delete_relationship(rid: str):
        """Remove a relationship recorded by mistake. Ending a real one is an update."""
        with db.connect() as conn:
            if not conn.execute("DELETE FROM relationships WHERE id=?", (rid,)).rowcount:
                raise HTTPException(404, "Relationship not found")
            return {"deleted": True}

    def one_membership(conn, mid, perspective=None):
        row = conn.execute("SELECT * FROM memberships WHERE id=?", (mid,)).fetchone()
        if not row:
            raise HTTPException(404, "Membership not found")
        return relations.membership_record(conn, row, perspective)

    def save_membership(body: MembershipIn, mid=None):
        data = body.model_dump()
        data["sources"] = [x.model_dump() for x in body.sources]
        with db.connect() as conn:
            new = relation_errors(lambda: relations.save_membership(conn, data, mid))
            return one_membership(conn, new, body.member_id)

    @app.post("/api/memberships", status_code=201)
    def create_membership(body: MembershipIn):
        return save_membership(body)

    @app.get("/api/memberships/{mid}")
    def get_membership(mid: str):
        with db.connect() as conn:
            return one_membership(conn, mid)

    @app.put("/api/memberships/{mid}")
    def update_membership(mid: str, body: MembershipIn):
        with db.connect() as conn:
            one_membership(conn, mid)
        return save_membership(body, mid)

    @app.delete("/api/memberships/{mid}")
    def delete_membership(mid: str):
        with db.connect() as conn:
            if not conn.execute("DELETE FROM memberships WHERE id=?", (mid,)).rowcount:
                raise HTTPException(404, "Membership not found")
            return {"deleted": True}

    @app.get("/api/connections")
    def connections(a: str, b: str):
        """The stored records behind one edge of the graph."""
        if not (UUID.fullmatch(a) and UUID.fullmatch(b)):
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            return relations.between(conn, a, b)

    @app.get("/api/graph")
    def graph():
        """Nodes and edges derived from the authoritative records; nothing is inferred."""
        with db.connect() as conn:
            return relations.graph(conn)

    # ── Timeline and events ──────────────────────────────────────────

    @app.get("/api/timeline")
    def timeline_view(entity: str = "", records: str = "", year_from: int = 0, year_to: int = 0):
        """Entries projected from the authoritative records, plus native events, in
        chronological order; undated entries separately. Nothing here is stored twice."""
        if entity and not UUID.fullmatch(entity):
            raise HTTPException(404, "Not found")
        kinds = (
            tuple(k for k in records.split(",") if k in timeline.RECORDS)
            if records
            else timeline.RECORDS
        )
        with db.connect() as conn:
            return timeline.project(conn, entity or None, kinds, year_from or None, year_to or None)

    @app.get("/api/timeline/entry")
    def timeline_entry(id: str):
        with db.connect() as conn:
            found = timeline.entry(conn, id)
            if not found:
                raise HTTPException(404, "This is no longer on the Timeline")
            return found

    @app.get("/api/event-categories")
    def event_categories():
        return {"categories": timeline.EVENT_CATEGORIES}

    @app.get("/api/similar-events")
    def similar_events(starts: str = "", entities: str = "", exclude: str = ""):
        """Timeline entries a new event may repeat, asked before saving."""
        ids = [x for x in entities.split(",") if UUID.fullmatch(x)]
        try:
            value = dates.normalize(starts) if starts else None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        with db.connect() as conn:
            return {"similar": timeline.similar(conn, value, ids, exclude or None)}

    def one_event(conn, eid):
        found = timeline.event_record(conn, eid) if UUID.fullmatch(eid or "") else None
        if not found:
            raise HTTPException(404, "Event not found")
        return found

    def save_event(body: EventIn, eid=None):
        data = body.model_dump()
        data["participants"] = [x.model_dump() for x in body.participants]
        data["sources"] = [x.model_dump() for x in body.sources]
        with db.connect() as conn:
            before = timeline.event_record(conn, eid) if eid else None
            unchanged = (
                before
                and before["starts"] == body.starts
                and {p["entity"]["id"] for p in before["participants"]}
                == {p.entity_id for p in body.participants}
            )
            if not body.allow_similar and not unchanged:
                twins = timeline.similar(
                    conn, body.starts, [p.entity_id for p in body.participants], eid
                )
                if twins:
                    return JSONResponse(
                        {
                            "detail": "Something similar is already on the Timeline",
                            "similar": twins,
                        },
                        409,
                    )
            new = relation_errors(lambda: timeline.save_event(conn, data, eid))
            return one_event(conn, new)

    @app.post("/api/events", status_code=201)
    def create_event(body: EventIn):
        return save_event(body)

    @app.get("/api/events/{eid}")
    def get_event(eid: str):
        with db.connect() as conn:
            return one_event(conn, eid)

    @app.put("/api/events/{eid}")
    def update_event(eid: str, body: EventIn):
        with db.connect() as conn:
            one_event(conn, eid)
        return save_event(body, eid)

    @app.delete("/api/events/{eid}")
    def delete_event(eid: str):
        with db.connect() as conn:
            one_event(conn, eid)
            conn.execute("DELETE FROM events WHERE id=?", (eid,))
            return {"deleted": True}

    @app.delete("/api/people/{pid}/imported/{rid}")
    def drop_imported(pid: str, rid: str):
        with db.connect() as conn:
            person_or_404(conn, pid)
            gone = conn.execute(
                "DELETE FROM raw_properties WHERE id=? AND entity_id=?", (rid, pid)
            ).rowcount
            if not gone:
                raise HTTPException(404, "Not found")
            return store.load_person(conn, pid)

    @app.put("/api/self")
    def set_self(body: SelfBody):
        """Mark one ordinary Person as the user's own profile (@me), or clear it."""
        with db.connect() as conn:
            if body.person_id:
                person_or_404(conn, body.person_id)
            conn.execute("UPDATE entities SET is_self=0 WHERE is_self=1")
            if body.person_id:
                conn.execute("UPDATE entities SET is_self=1 WHERE id=?", (body.person_id,))
            return {"self": self_summary(conn)}

    # ── Import ───────────────────────────────────────────────────────

    @app.post("/api/import/preview")
    def import_preview(body: PreviewBody):
        try:
            with db.connect() as conn:
                return importer.preview(conn, body.content, body.filename)
        except vcard.VCardError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post("/api/import/commit", status_code=201)
    def import_commit(body: CommitBody):
        try:
            with db.connect() as conn:
                return importer.commit(
                    conn, body.content, body.filename, body.sha256, body.decisions
                )
        except (vcard.VCardError, importer.ImportError_) as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/imports")
    def imports():
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM imports ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
            return {"items": [{**dict(r), "summary": json.loads(r["summary"])} for r in rows]}

    @app.get("/api/imports/{iid}")
    def import_detail(iid: str):
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM imports WHERE id=?", (iid,)).fetchone()
            if not row:
                raise HTTPException(404, "Import not found")
            items = conn.execute(
                "SELECT i.position, i.action, i.entity_id, i.label, e.deleted_at, e.id AS present "
                "FROM import_items i LEFT JOIN entities e ON e.id=i.entity_id "
                "WHERE i.import_id=? ORDER BY i.position",
                (iid,),
            ).fetchall()
            return {**dict(row), "summary": json.loads(row["summary"]),
                    "items": [dict(i) for i in items]}  # fmt: skip

    # ── Module protocol (Nexus private network) ──────────────────────

    def require_resolver(request):
        key = os.getenv("NEXUS_RESOLVER_KEY", "")
        if not key or not secrets.compare_digest(
            request.headers.get("x-nexus-resolver-key", ""), key
        ):
            raise HTTPException(403, "Resolver authentication required")

    @app.post("/empyrean/v1/resources/resolve")
    def protocol_resolve(body: dict, request: Request):
        """A Person's label for modules Nexus has granted a resolve scope; nothing more."""
        require_resolver(request)
        match = REF.fullmatch(str(body.get("resource", "")))
        if not match or match[1] != "meridian" or match[2] != "person":
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            row = conn.execute(
                "SELECT display_name, deleted_at FROM entities WHERE id=? AND kind='person'",
                (match[3],),
            ).fetchone()
            if not row:
                gone = conn.execute("SELECT 1 FROM tombstones WHERE id=?", (match[3],)).fetchone()
                raise HTTPException(410 if gone else 404, "Unavailable")
            if row["deleted_at"]:
                raise HTTPException(404, "Unavailable")
            return {"resource": body["resource"], "label": row["display_name"][:200],
                    "open_path": f"/people/{match[3]}"}  # fmt: skip

    async def receive_artifact(request):
        path = db.path.parent / f"restore-{uuid7()}.part"
        size = 0
        try:
            with open(path, "wb") as out:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_ARTIFACT:
                        raise HTTPException(413, "Backup artifact exceeds 256 MiB")
                    out.write(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return path

    def check_artifact(request, path):
        headers = {
            k[len(BACKUP_HEADER) :].lower(): v
            for k, v in request.headers.items()
            if k.lower().startswith(BACKUP_HEADER.lower())
        }
        if headers.get("module") != "meridian" or headers.get("format") != BACKUP_FORMAT:
            raise ValueError("Not a Meridian backup")
        if headers.get("format-version") != str(BACKUP_FORMAT_VERSION):
            raise ValueError("Unsupported backup format version")
        try:
            snapshot = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        except sqlite3.Error as exc:
            raise ValueError("Backup is not a readable database") from exc
        try:
            if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Backup database is damaged")
            schema = snapshot.execute("PRAGMA user_version").fetchone()[0]
            if not 1 <= schema <= len(MIGRATIONS):
                raise ValueError("Backup schema is not supported by this version")
            tables = {
                r[0] for r in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if not {"entities", "names", "contact_points"} <= tables:
                raise ValueError("Backup is missing Meridian data")
        except sqlite3.Error as exc:
            raise ValueError("Backup is not a readable database") from exc
        finally:
            snapshot.close()

    @app.post("/empyrean/v1/backup/export")
    def backup_export(request: Request):
        require_resolver(request)
        path = db.path.parent / f"export-{uuid7()}.part"
        try:
            target = sqlite3.connect(path)
            with db.connect() as conn:
                conn.backup(target)
            target.execute("PRAGMA journal_mode=DELETE")
            target.close()
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return FileResponse(
            path,
            media_type="application/octet-stream",
            background=BackgroundTask(path.unlink, missing_ok=True),
            headers={
                BACKUP_HEADER + "Module": "meridian",
                BACKUP_HEADER + "Module-Version": VERSION,
                BACKUP_HEADER + "Format": BACKUP_FORMAT,
                BACKUP_HEADER + "Format-Version": str(BACKUP_FORMAT_VERSION),
                BACKUP_HEADER + "Created-At": iso_now(),
                BACKUP_HEADER + "Restorable-By": f">={VERSION},<1",
            },
        )

    @app.post("/empyrean/v1/backup/validate")
    async def backup_validate(request: Request):
        require_resolver(request)
        path = await receive_artifact(request)
        try:
            await run_in_threadpool(check_artifact, request, path)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            path.unlink(missing_ok=True)
        return {"valid": True}

    def replace_data(path):
        snapshot = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            with db.connect() as conn:
                snapshot.backup(conn)
        finally:
            snapshot.close()
        db.migrate()

    @app.post("/empyrean/v1/backup/restore")
    async def backup_restore(request: Request):
        require_resolver(request)
        path = await receive_artifact(request)
        try:
            try:
                await run_in_threadpool(check_artifact, request, path)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            await run_in_threadpool(replace_data, path)
        finally:
            path.unlink(missing_ok=True)
        return {"restored": True}

    @app.post("/empyrean/v1/backup/finalize")
    def backup_finalize(request: Request):
        require_resolver(request)
        return {"finalized": True}

    # ── Interface ────────────────────────────────────────────────────

    def catalogs():
        result = {}
        for directory in (ROOT / "frontend/locales", db.path.parent / "locales"):
            if not directory.exists():
                continue
            for file in directory.glob("*.json"):
                if not re.fullmatch(r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})?", file.stem):
                    continue
                try:
                    messages = json.loads(file.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    continue
                if isinstance(messages, dict) and all(
                    isinstance(v, str) for v in messages.values()
                ):
                    result[file.stem] = {**result.get(file.stem, {}), **messages}
        return result

    @app.get("/icon.svg", include_in_schema=False)
    def app_icon():
        """The application icon Nexus shows in its switcher and module list (manifest `icon`)."""
        return FileResponse(ROOT / "frontend/icon.svg", media_type="image/svg+xml")

    @app.get("/{path:path}", response_class=HTMLResponse)
    def ui(path: str):
        app_js = (
            (ROOT / "frontend/app.js")
            .read_text(encoding="utf-8")
            .replace("/*CATALOGS*/ {}", json.dumps(catalogs()).replace("<", "\\u003c"))
        )
        script = "\n;\n".join(
            [
                (ROOT / "frontend/vendor/d3-force.bundle.js").read_text(encoding="utf-8"),
                (ROOT / "frontend/graph.js").read_text(encoding="utf-8"),
                app_js,
                (ROOT / "frontend/timeline.js").read_text(encoding="utf-8"),
            ]
        )
        html = (ROOT / "frontend/index.html").read_text(encoding="utf-8")
        return html.replace("/*STYLE*/", style).replace("/*SCRIPT*/", script)

    return app
