import base64
import json
import os
import re
import secrets
import sqlite3
import threading
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from . import (
    VERSION,
    dates,
    images,
    importer,
    interactions,
    relations,
    shared,
    store,
    timeline,
    vcard,
)
from .db import MIGRATIONS, Database
from .models import (
    EDUCATION_KINDS,
    EDUCATION_STATUS,
    INTERACTION_TYPES,
    INTEREST_CATEGORIES,
    SENTIMENTS,
    EntityDoc,
    EventIn,
    InteractionIn,
    MembershipIn,
    PersonDoc,
    RelationshipIn,
    SettingsIn,
    SiblingsIn,
    Strict,
    TypeIn,
)
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
# "name" follows the owner's sorting preference (store.name_order), with Slovak collation.
SORTS = {
    "name": None,
    "updated": "e.updated_at DESC, e.sort_key",
    "created": "e.created_at DESC, e.sort_key",
}
# Typing these in any person search means the user's own profile (@me), not a name.
SELF_ALIASES = ("@", "@m", "@me")


class CropIn(Strict):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class ImageIn(Strict):
    photo_id: str = Field(pattern=UUID.pattern)
    crop: CropIn


class AvatarsIn(Strict):
    ids: list[str] = Field(max_length=120)
    size: int = 128


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
             "employments": "Work", "accounts": "Account", "facts": "Detail", "sources": "Source",
             "education": "Education", "interests": "Interest", "links": "Linked item"}  # fmt: skip
    if len(path) >= 2 and path[0] in names and path[1].isdigit():
        return f"{names[path[0]]} {int(path[1]) + 1}: {message}"
    fields = {"valid_from": "Start", "valid_until": "End", "context": "Context", "role": "Role",
              "label": "Name", "inverse": "Reverse name", "type": "Relationship type",
              "title": "Title", "starts": "Date", "ends": "End", "category": "Kind of event",
              "participants": "Involved", "description": "Description", "summary": "Summary",
              "occurred": "Date", "notes": "Notes", "group_id": "Group"}  # fmt: skip
    if path and path[0] in fields:
        return f"{fields[path[0]]}: {message}"
    return message


def check_contact_revision(conn, entity_id, expected):
    if expected is not None and expected != store.edit_revision(conn, entity_id):
        raise HTTPException(
            409,
            "This contact changed in another session. Your edits are still here. "
            "Reopen the contact to review the latest information before saving.",
        )


def create_app(data_dir=None):
    db = Database(Path(data_dir or os.getenv("MERIDIAN_DATA", "/data")) / "meridian.sqlite3")
    style = styles()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db = db
    # Edges that could not be registered earlier (Argus missing, Nexus restarting).
    threading.Thread(target=images.sync_references, args=(db,), daemon=True).start()
    threading.Thread(target=interactions.sync_references, args=(db,), daemon=True).start()

    # Writes that can change birthdays or anniversaries: tell Chronos (through a Nexus event)
    # to reconcile Meridian's dated items soon. Best effort; it reconciles every 15 minutes anyway.
    date_writes = re.compile(r"^/api/(people(/|$)|trash/|import/commit$)")

    @app.middleware("http")
    async def announce_date_changes(request: Request, call_next):
        response = await call_next(request)
        if (
            request.method != "GET"
            and response.status_code < 300
            and date_writes.match(request.url.path)
        ):
            threading.Thread(target=shared.announce_dates_changed, daemon=True).start()
        return response

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
            return {"version": VERSION, "self": self_summary(conn), "counts": counts(conn),
                    "settings": settings_doc(conn)}  # fmt: skip

    def settings_doc(conn):
        prefs = store.preferences(conn)
        return {"people_sort": prefs["people.sort"], "people_display": prefs["people.display"]}

    @app.get("/api/settings")
    def get_settings():
        with db.connect() as conn:
            return settings_doc(conn)

    @app.put("/api/settings")
    def put_settings(body: SettingsIn):
        """People sorting and name display: independent, stored in Meridian's settings."""
        values = {"people.sort": body.people_sort, "people.display": body.people_display}
        with db.connect() as conn:
            store.set_preferences(conn, {k: v for k, v in values.items() if v})
            return settings_doc(conn)

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

    def is_self_alias(q: str) -> bool:
        return fold(q) in SELF_ALIASES

    @app.get("/api/people")
    def people(q: str = "", has: str = "", sort: str = "name", limit: int = 100, offset: int = 0):
        if sort not in SORTS:
            raise HTTPException(422, "Unknown sort")
        where, params = ("AND e.is_self=1", ()) if is_self_alias(q) else search_clause(q[:200])
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
        """Search for pickers. `@me` (and its beginnings `@`, `@m`) finds the person marked as
        the user, through the existing self designation; "me" puts them first among matches.
        The kinds asked for still apply: @me never returns anything but a Person."""
        wanted = tuple(k for k in kinds.split(",") if k in KINDS) or ("person",)
        if not fold(q):
            return {"people": [], "entities": []}
        with db.connect() as conn:
            me = self_summary(conn) if "person" in wanted else None
            if is_self_alias(q):
                found = [me] if me else []
                return {"people": found, "entities": found, "alias": "me",
                        "self_missing": "person" in wanted and not me}  # fmt: skip
            where, params = search_clause(q[:200])
            found = store.summaries(
                conn, "AND e.deleted_at IS NULL " + where, params, limit=12, kinds=wanted
            )
            if me and fold(q) == "me":
                found = [me] + [x for x in found if x["id"] != me["id"]][:11]
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
            conn.execute("BEGIN IMMEDIATE")
            person_or_404(conn, pid)
            check_contact_revision(conn, pid, body.expected_revision)
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
            images.forget(conn, pid)
            conn.execute("DELETE FROM entities WHERE id=?", (pid,))
            conn.execute(
                "INSERT OR REPLACE INTO tombstones(id,kind,deleted_at) VALUES(?,?,?)",
                (pid, entity["kind"], iso_now()),
            )
            return {"deleted": True}

    # ── Representative images (Argus photos) ─────────────────────────

    def sync_later(entity_id=None):
        return BackgroundTask(images.sync_references, db, entity_id)

    @app.get("/api/photo-library")
    def photo_library(cursor: str | None = None, limit: int = 24):
        if cursor is not None and len(cursor) > 200:
            raise HTTPException(422, "Invalid cursor")
        return images.library(cursor, limit)

    @app.get("/api/photo-preview/{photo_id}")
    def photo_preview(photo_id: str, size: int = 1024):
        try:
            return images.preview(photo_id, size)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.put("/api/entities/{eid}/image")
    def set_image(eid: str, body: ImageIn):
        with db.connect() as conn:
            entity_or_404(conn, eid)
            try:
                image = images.put(conn, eid, body.photo_id, body.crop.model_dump())
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        return JSONResponse(image, background=sync_later(eid))

    @app.delete("/api/entities/{eid}/image")
    def clear_image(eid: str):
        with db.connect() as conn:
            entity_or_404(conn, eid, include_deleted=True)
            images.forget(conn, eid)
        return JSONResponse({"image": None}, background=sync_later())

    @app.post("/api/avatars")
    def avatars(body: AvatarsIn):
        images.retry_pending(db)
        with db.connect() as conn:
            try:
                return images.avatars(conn, body.ids, body.size)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc

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
            conn.execute("BEGIN IMMEDIATE")
            current = entity_or_404(conn, eid, kinds=("organization", "group"))
            check_contact_revision(conn, eid, body.expected_revision)
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

    def kinship_param(type_key, kinship):
        try:
            return relations.check_kinship(type_key, kinship or None)
        except relations.Invalid as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get("/api/similar-relationships")
    def similar_relationships(
        subject_id: str, object_id: str, type: str, exclude: str = "", kinship: str = ""
    ):
        """Existing relationships a new one may duplicate, asked before saving (the Nexus
        bridge passes only an error's message, so the check is its own request)."""
        if not (UUID.fullmatch(subject_id) and UUID.fullmatch(object_id)):
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            t = relations.types(conn).get(type)
            if not t:
                raise HTTPException(422, "Choose a relationship type")
            rows = relations.similar(
                conn, subject_id, object_id, type, exclude or None, t["symmetric"],
                kinship_param(type, kinship),
            )  # fmt: skip
            return {"similar": [relations.relationship_record(conn, r, subject_id) for r in rows]}

    @app.get("/api/active-relationships")
    def active_relationships(subject_id: str, object_id: str, type: str, exclude: str = ""):
        """Relationships between the two that may still be going on and that a new one of
        `type` could take over from: shown to the user before saving, never ended unasked."""
        if not (UUID.fullmatch(subject_id) and UUID.fullmatch(object_id)):
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            return {
                "active": relations.active_between(
                    conn, subject_id, object_id, type, exclude or None
                )
            }

    @app.get("/api/relationship-suggestion")
    def relationship_suggestion(subject_id: str, object_id: str, type: str, kinship: str = ""):
        """A start date to offer for a new relationship (a child's birth date for a parent
        relationship). The form shows it as an editable suggestion."""
        if not (UUID.fullmatch(subject_id) and UUID.fullmatch(object_id)):
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            return relations.date_suggestion(
                conn, subject_id, object_id, type, kinship_param(type, kinship)
            )

    @app.get("/api/sibling-suggestions")
    def sibling_suggestions(relationship: str):
        """Possible siblings after a parent relationship is saved; nothing is created."""
        if not UUID.fullmatch(relationship):
            raise HTTPException(404, "Relationship not found")
        with db.connect() as conn:
            try:
                return relations.sibling_suggestions(conn, relationship)
            except LookupError as exc:
                raise HTTPException(404, "Relationship not found") from exc

    @app.post("/api/sibling-suggestions/apply")
    def apply_sibling_suggestions(body: SiblingsIn):
        """The sibling records the user confirmed, in one transaction."""
        with db.connect() as conn:
            for item in body.items:
                for eid in (item.a, item.b):
                    row = conn.execute(
                        "SELECT kind, deleted_at FROM entities WHERE id=?", (eid,)
                    ).fetchone()
                    if not row or row["kind"] != "person" or row["deleted_at"]:
                        raise HTTPException(422, "Siblings are people in Meridian")
            try:
                return relation_errors(
                    lambda: relations.apply_siblings(conn, [i.model_dump() for i in body.items])
                )
            except relations.Conflict as exc:
                raise HTTPException(409, str(exc)) from exc

    def one_relationship(conn, rid, perspective=None):
        row = conn.execute("SELECT * FROM relationships WHERE id=?", (rid,)).fetchone()
        if not row:
            raise HTTPException(404, "Relationship not found")
        return relations.relationship_record(conn, row, perspective)

    def save_relationship(body: RelationshipIn, rid=None):
        """Create or update one relationship. On creation, `end_relationships` ends the chosen
        ongoing relationships in the same transaction: either the new record and every ending
        are saved, or none of them."""
        data = body.model_dump()
        data["sources"] = [x.model_dump() for x in body.sources]
        ends = [x.model_dump() for x in body.end_relationships]
        if rid and ends:
            raise HTTPException(422, "Ending other relationships happens when creating one")
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
            if ends:
                try:
                    relation_errors(
                        lambda: relations.end_for_transition(
                            conn, body.subject_id, body.object_id, ends
                        )
                    )
                except relations.Conflict as exc:
                    raise HTTPException(409, str(exc)) from exc
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

    # ── Interactions (0.7.0, owner decision D8) ──────────────────────

    def interaction_or_404(conn, iid, resolve=False):
        if not UUID.fullmatch(iid or ""):
            raise HTTPException(404, "Not found")
        found = interactions.get(conn, iid, resolve=resolve)
        if not found:
            raise HTTPException(404, "Not found")
        return found

    def sync_links():
        # New edges, then removed ones (the shared cleanup queue).
        interactions.sync_references(db)
        images.sync_references(db)

    def save_interaction(body: InteractionIn, iid=None):
        data = body.model_dump()
        with db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                new = relation_errors(lambda: interactions.save(conn, data, iid))
            except interactions.Conflict as exc:
                raise HTTPException(
                    409,
                    "This interaction changed in another session. Reopen it to see the latest "
                    "version before saving.",
                ) from exc
            out = interactions.get(conn, new)
        threading.Thread(target=sync_links, daemon=True).start()
        return out

    @app.get("/api/interactions")
    def list_interactions(entity: str):
        with db.connect() as conn:
            entity_or_404(conn, entity, include_deleted=True)
            interactions.retry_pending(db)
            return {
                "items": interactions.for_entity(conn, entity),
                "types": list(INTERACTION_TYPES),
            }

    @app.post("/api/interactions", status_code=201)
    def create_interaction(body: InteractionIn):
        return save_interaction(body)

    @app.get("/api/interactions/{iid}")
    def get_interaction(iid: str):
        with db.connect() as conn:
            return interaction_or_404(conn, iid, resolve=True)

    @app.put("/api/interactions/{iid}")
    def update_interaction(iid: str, body: InteractionIn):
        with db.connect() as conn:
            interaction_or_404(conn, iid)
        return save_interaction(body, iid)

    @app.delete("/api/interactions/{iid}")
    def delete_interaction(iid: str):
        with db.connect() as conn:
            interaction_or_404(conn, iid)
            interactions.delete(conn, iid)
        threading.Thread(target=sync_links, daemon=True).start()
        return {"deleted": True}

    @app.get("/api/interaction-link-candidates")
    def interaction_link_candidates(entity: list[str] = Query(default=[])):
        """Chronos events and Mnemosyne items already linked to these participants."""
        ids = [e for e in entity if UUID.fullmatch(e)][:20]
        with db.connect() as conn:
            return interactions.candidates(conn, ids)

    @app.get("/api/interaction-search")
    def interaction_search(q: str = ""):
        """Events, notes, tasks and places to link, from their owners' search projections."""
        return interactions.search(q)

    @app.get("/api/vocabularies")
    def vocabularies():
        return {"education_kinds": list(EDUCATION_KINDS), "education_status": list(EDUCATION_STATUS),
                "interest_categories": list(INTEREST_CATEGORIES), "sentiments": list(SENTIMENTS),
                "interaction_types": list(INTERACTION_TYPES)}  # fmt: skip

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

    @app.post("/empyrean/v1/projections/dated-items")
    def provide_dated_items(body: dict, request: Request):
        """Birthdays and anniversaries as yearly dated items (meridian.shared), for requesters
        the owner granted this scope (Chronos, opt-in there)."""
        require_resolver(request)
        query = body.get("query") if isinstance(body.get("query"), dict) else {}
        with db.connect() as conn:
            try:
                return shared.dated_items(conn, query, body.get("cursor"))
            except shared.BadQuery as exc:
                raise HTTPException(422, str(exc)) from exc

    @app.post("/empyrean/v1/projections/people-directory")
    def provide_people_directory(body: dict, request: Request):
        """Name search over live People for pickers in other modules: names only."""
        require_resolver(request)
        query = body.get("query") if isinstance(body.get("query"), dict) else {}
        with db.connect() as conn:
            try:
                return shared.people_directory(conn, query, body.get("cursor"))
            except shared.BadQuery as exc:
                raise HTTPException(422, str(exc)) from exc

    @app.post("/empyrean/v1/projections/contact-addresses")
    def provide_contact_addresses(body: dict, request: Request):
        """Contact addresses for Atlas's map. Meridian keeps owning them; Atlas reads them live."""
        require_resolver(request)
        if body.get("requester") not in shared.ADDRESS_READERS:
            raise HTTPException(403, "This projection is not available to that module")
        query = body.get("query") if isinstance(body.get("query"), dict) else {}
        with db.connect() as conn:
            try:
                return shared.contact_addresses(conn, query, body.get("cursor"))
            except shared.BadQuery as exc:
                raise HTTPException(422, str(exc)) from exc

    @app.get("/api/entities/{eid}/linked-from")
    def linked_from(eid: str):
        """Chronos events, Mnemosyne notes and other resources that link here and share the
        link with Meridian, with their current labels from their owners."""
        with db.connect() as conn:
            entity = entity_or_404(conn, eid, include_deleted=True)
        return shared.linked_from(entity["kind"], eid)

    @app.post("/empyrean/v1/resources/resolve")
    def protocol_resolve(body: dict, request: Request):
        """A Person's label for modules Nexus has granted a resolve scope; nothing more."""
        require_resolver(request)
        match = REF.fullmatch(str(body.get("resource", "")))
        if match and match[1] == "meridian" and match[2] == "interaction":
            with db.connect() as conn:
                out, status = interactions.resolve(conn, match[3], body.get("requester"))
            if not out:
                raise HTTPException(status, "Unavailable")
            return out
        if not match or match[1] != "meridian" or match[2] not in KINDS:
            raise HTTPException(404, "Not found")
        with db.connect() as conn:
            row = conn.execute(
                "SELECT display_name, deleted_at FROM entities WHERE id=? AND kind=?",
                (match[3], match[2]),
            ).fetchone()
            if not row:
                gone = conn.execute("SELECT 1 FROM tombstones WHERE id=?", (match[3],)).fetchone()
                raise HTTPException(410 if gone else 404, "Unavailable")
            if row["deleted_at"]:
                raise HTTPException(404, "Unavailable")
            section = {"person": "people", "organization": "organizations", "group": "groups"}
            return {"resource": body["resource"], "label": row["display_name"][:200],
                    "open_path": f"/{section[match[2]]}/{match[3]}"}  # fmt: skip

    @app.get("/empyrean/v1/references/outgoing")
    def protocol_outgoing(request: Request, limit: int = 100, cursor: str | None = None):
        """Entity References v2: every edge Meridian owns, so Nexus can rebuild its index
        (after a restore, for example) from Meridian's own records: representative-image edges
        first (cursor = entity id), then Interaction links (cursor = "x:" + link id)."""
        require_resolver(request)
        links = cursor is not None and cursor.startswith("x:")
        raw = cursor[2:] if links else cursor
        if raw is not None and raw != "" and not UUID.fullmatch(raw):
            raise HTTPException(422, "Invalid cursor")
        limit = max(1, min(limit, 200))
        with db.connect() as conn:
            if not links:
                page = images.outgoing(conn, limit, raw)
                if page["next_cursor"]:
                    return page
                # Images done: continue with links in the same response when there is room.
                rest = (
                    interactions.outgoing(conn, limit - len(page["references"]), None)
                    if len(page["references"]) < limit
                    else {"references": [], "next_cursor": ""}
                )
                nxt = rest["next_cursor"]
                return {
                    "references": page["references"] + rest["references"],
                    "next_cursor": None if nxt is None else "x:" + nxt,
                }
            page = interactions.outgoing(conn, limit, raw)
            if page["next_cursor"]:
                page["next_cursor"] = "x:" + page["next_cursor"]
            return page

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
                # Nexus navigation contract: the shared SDK, then Meridian's adapter.
                (ROOT / "frontend/vendor/nexus-navigation.js").read_text(encoding="utf-8"),
                (ROOT / "frontend/navigation.js").read_text(encoding="utf-8"),
                (ROOT / "frontend/graph.js").read_text(encoding="utf-8"),
                (ROOT / "frontend/ux.js").read_text(encoding="utf-8"),
                app_js,
                (ROOT / "frontend/timeline.js").read_text(encoding="utf-8"),
            ]
        )
        html = (ROOT / "frontend/index.html").read_text(encoding="utf-8")
        return html.replace("/*STYLE*/", style).replace("/*SCRIPT*/", script)

    return app
