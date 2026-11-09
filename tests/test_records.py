"""0.7.0 (roadmap Phase 3): Education, Interests/Preferences and Interactions.

Owner decisions: D7 = dedicated records (not generic Facts); D8 = manual Interactions with
optional links to Chronos events and Mnemosyne items; preferences hold free text now (a Lyra
target is reserved, not built). architecture/modules/meridian.md holds the concepts."""

import sqlite3

import pytest
from fastapi.testclient import TestClient
from meridian import db as dbmod
from meridian import interactions, nexus
from meridian.app import create_app

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}
RES = {"x-nexus-resolver-key": KEY}
EVENT = "nexus:v1:chronos:event:0190f0e4-0000-7000-8000-000000000001"
NOTE = "nexus:v1:mnemosyne:note:0190f0e4-0000-7000-8000-000000000002"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    # Background Nexus syncs fail fast and leave edges pending unless a test fakes Nexus.
    monkeypatch.setattr(interactions, "retry_pending", lambda db, every=60: None)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        yield c


def person(client, given, family="", **extra):
    doc = {"names": [{"kind": "full", "given": given, "family": family}], **extra}
    r = client.post("/api/people", json=doc)
    assert r.status_code == 201, r.text
    return r.json()


def entity(client, kind, name):
    r = client.post(
        "/api/entities", json={"kind": kind, "names": [{"kind": "full", "value": name}]}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def save(client, doc):
    body = {k: v for k, v in doc.items() if k in {
        "names", "contacts", "addresses", "dates", "employments", "accounts", "facts",
        "education", "interests", "notes"}}  # fmt: skip
    for section in (
        "names",
        "contacts",
        "addresses",
        "dates",
        "employments",
        "accounts",
        "facts",
        "education",
        "interests",
    ):
        body[section] = [{k: v for k, v in item.items()
                          if k not in ("source", "created_at", "updated_at", "position")}
                         for item in body.get(section, [])]  # fmt: skip
    body["expected_revision"] = doc["edit_revision"]
    r = client.put(f"/api/people/{doc['id']}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def timeline(client, entity_id):
    r = client.get("/api/timeline", params={"entity": entity_id})
    assert r.status_code == 200, r.text
    return r.json()


# ── Education ──────────────────────────────────────────────────────────


def test_education_links_one_organization_and_projects_onto_the_timeline(client):
    jana = person(client, "Jana", "Nováková", education=[
        {"organization": "Comenius University", "kind": "University", "program": "Computer Science",
         "field": "Informatics", "degree": "MSc", "status": "Graduated",
         "valid_from": "2005-09", "valid_until": "2010-06", "confidence": "high", "note": "Thesis on graphs"},
    ])  # fmt: skip
    peter = person(client, "Peter", "Novák", education=[
        {"organization": "comenius university", "kind": "university", "status": "studying", "valid_from": "2021"},
    ])  # fmt: skip
    a, b = jana["education"][0], peter["education"][0]
    assert a["organization_id"] == b["organization_id"]  # found by name, never duplicated
    assert (a["kind"], a["status"], a["degree"]) == ("university", "graduated", "MSc")
    orgs = client.get("/api/entities", params={"kind": "organization", "q": "comenius"}).json()
    assert len(orgs["items"]) == 1
    school = client.get(f"/api/entities/{a['organization_id']}").json()
    assert {s["person_name"] for s in school["studied_here"]} == {"Jana Nováková", "Peter Novák"}

    entries = timeline(client, jana["id"])["entries"]
    mine = [e for e in entries if e["category"] == "education"]
    assert [(e["moment"], e["date"]) for e in mine] == [("start", "2005-09"), ("end", "2010-06")]
    one = client.get("/api/timeline/entry", params={"id": mine[0]["id"]}).json()
    assert one["phrase"] == "studied at" and one["period"] == ["2005-09", "2010-06"]
    assert one["note"] == "Thesis on graphs"
    ongoing = [e for e in timeline(client, peter["id"])["entries"] if e["category"] == "education"]
    assert ongoing[0]["ongoing"] is True
    # The school's own Timeline shows both, without stored copies.
    assert (
        len(
            [
                e
                for e in timeline(client, a["organization_id"])["entries"]
                if e["category"] == "education"
            ]
        )
        == 3
    )
    # Searching finds people by their school.
    assert client.get("/api/people", params={"q": "comenius"}).json()["total"] == 2


def test_education_edit_end_and_remove(client):
    jana = person(
        client, "Jana", education=[{"organization": "Gymnázium", "kind": "secondary school"}]
    )
    item = jana["education"][0]
    assert item["kind"] == "secondary_school" and item["valid_until"] is None
    jana["education"][0] = {**item, "status": "graduated", "valid_until": "2004"}
    ended = save(client, jana)
    assert ended["education"][0]["id"] == item["id"]
    assert (ended["education"][0]["status"], ended["education"][0]["valid_until"]) == (
        "graduated",
        "2004",
    )
    ended["education"] = []
    removed = save(client, ended)
    assert removed["education"] == []
    # The Organization stays: it is its own record.
    assert client.get(f"/api/entities/{item['organization_id']}").status_code == 200


@pytest.mark.parametrize(
    "record, message",
    [
        ({"kind": "university"}, "Education needs a school"),
        ({"organization": "X", "status": "drop<out"}, "Use letters"),
        ({"organization": "X", "valid_from": "2020-13"}, ""),
    ],
)
def test_education_validation(client, record, message):
    r = client.post("/api/people", json={"names": [{"value": "A"}], "education": [record]})
    assert r.status_code == 422 and message in r.text


def test_education_and_interests_belong_to_people(client):
    r = client.post("/api/entities", json={"kind": "group", "names": [{"value": "Climbing"}],
                                           "interests": [{"subject": "Bouldering"}]})  # fmt: skip
    assert r.status_code == 422 and "belong to people" in r.text


# ── Interests and preferences ──────────────────────────────────────────


def test_interests_are_records_with_sentiment_context_and_history(client):
    jana = person(client, "Jana", interests=[
        {"category": "Music", "subject": "Radiohead", "sentiment": "favorite",
         "valid_from": "2019", "valid_until": "2021"},
        {"category": "music", "subject": "Portishead", "sentiment": "Favorite", "valid_from": "2022"},
        {"category": "food", "subject": "Wine", "sentiment": "likes", "context": "with dinner"},
        {"category": "food", "subject": "Alcohol", "sentiment": "avoids", "context": "at parties"},
        {"category": "Films TV", "subject": "Twin Peaks", "sentiment": "loves", "confidence": "medium"},
    ])  # fmt: skip
    got = [(i["category"], i["subject"], i["sentiment"], i["context"]) for i in jana["interests"]]
    assert got == [
        ("music", "Radiohead", "favorite", ""),
        ("music", "Portishead", "favorite", ""),  # several favorites are fine
        ("food", "Wine", "likes", "with dinner"),
        ("food", "Alcohol", "avoids", "at parties"),
        ("films_tv", "Twin Peaks", "loves", ""),
    ]
    entries = [e for e in timeline(client, jana["id"])["entries"] if e["category"] == "interest"]
    # Only dated interests reach the Timeline: the former favorite's period and the current one.
    assert [(e["moment"], e["date"], e["detail"]) for e in entries] == [
        ("start", "2019", "Radiohead"), ("end", "2021", "Radiohead"), ("start", "2022", "Portishead"),
    ]  # fmt: skip
    one = client.get("/api/timeline/entry", params={"id": entries[0]["id"]}).json()
    assert one["phrase"] == "favorite"
    assert client.get("/api/people", params={"q": "portishead"}).json()["total"] == 1


def test_interest_target_is_reserved_and_validated(client):
    lyra = "nexus:v1:lyra:title:0190f0e4-0000-7000-8000-00000000000a"
    jana = person(client, "Jana", interests=[
        {"category": "films_tv", "subject": "Arrival", "sentiment": "favorite", "target_kind": "film",
         "target_ref": lyra},
    ])  # fmt: skip
    assert (jana["interests"][0]["target_ref"], jana["interests"][0]["target_kind"]) == (
        lyra,
        "film",
    )
    bad = client.post("/api/people", json={"names": [{"value": "B"}], "interests": [
        {"subject": "X", "target_ref": "javascript:alert(1)"}]})  # fmt: skip
    assert bad.status_code == 422 and "Unknown reference" in bad.text


# ── Interactions ───────────────────────────────────────────────────────


def interaction(client, **body):
    r = client.post("/api/interactions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_interaction_is_stored_once_and_shown_for_every_participant(client):
    jana = person(client, "Jana", "Nováková")["id"]
    peter = person(client, "Peter", "Novák")["id"]
    group = entity(client, "group", "FI group")
    x = interaction(
        client,
        type="Meeting",
        summary="  Drinks after   the exam ",
        notes="Peter paid.",
        occurred="2024-06",
        approximate=True,
        group_id=group,
        confidence="medium",
        participants=[{"entity_id": jana, "role": "host"}, {"entity_id": peter}],
        sources=[{"kind": "told_by", "entity_id": peter}],
    )
    assert x["summary"] == "Drinks after the exam" and x["type"] == "meeting"
    assert [p["role"] for p in x["participants"]] == ["host", ""] and x["group"]["id"] == group
    assert x["sources"][0]["entity_name"] == "Peter Novák"
    for who in (jana, peter, group):
        items = client.get("/api/interactions", params={"entity": who}).json()["items"]
        assert [i["id"] for i in items] == [x["id"]]
        entries = [e for e in timeline(client, who)["entries"] if e["category"] == "interaction"]
        assert [(e["date"], e["title"], e.get("approximate")) for e in entries] == [
            ("2024-06", "Drinks after the exam", True)
        ]
    one = client.get("/api/timeline/entry", params={"id": f"interaction:{x['id']}"}).json()
    assert one["notes"] == "Peter paid." and len(one["entities"]) == 3


def test_interaction_validation_and_conflicts(client):
    jana = person(client, "Jana")["id"]
    org = entity(client, "organization", "Acme")
    bad = client.post("/api/interactions", json={"summary": "x", "participants": [
        {"entity_id": jana}, {"entity_id": jana}]})  # fmt: skip
    assert bad.status_code == 422 and "once" in bad.text
    bad = client.post("/api/interactions", json={"summary": "x", "group_id": org,
                                                 "participants": [{"entity_id": jana}]})  # fmt: skip
    assert bad.status_code == 422 and "Group" in bad.text
    bad = client.post("/api/interactions", json={"summary": "x", "occurred": "--05-01",
                                                 "participants": [{"entity_id": jana}]})  # fmt: skip
    assert bad.status_code == 422
    x = interaction(client, summary="Call", type="call", participants=[{"entity_id": jana}])
    first = client.put(f"/api/interactions/{x['id']}", json={
        "summary": "Long call", "type": "call", "participants": [{"entity_id": jana}],
        "expected_revision": x["revision"]})  # fmt: skip
    assert first.status_code == 200
    stale = client.put(f"/api/interactions/{x['id']}", json={
        "summary": "Short call", "participants": [{"entity_id": jana}],
        "expected_revision": x["revision"]})  # fmt: skip
    assert stale.status_code == 409 and "changed in another session" in stale.text
    assert client.get(f"/api/interactions/{x['id']}").json()["summary"] == "Long call"


def test_purging_a_participant_keeps_the_interaction_for_the_others(client):
    jana = person(client, "Jana")["id"]
    peter = person(client, "Peter")["id"]
    group = entity(client, "group", "Climbing")
    x = interaction(client, summary="Climbing day", type="activity", group_id=group,
                    participants=[{"entity_id": jana}, {"entity_id": peter}])  # fmt: skip
    client.delete(f"/api/people/{peter}")
    # In Trash: still listed with a deleted marker, hidden from the Timeline entry's people.
    shown = client.get(f"/api/interactions/{x['id']}").json()
    assert [p["entity"]["deleted"] for p in shown["participants"]] == [False, True]
    # Editing still works while someone it involves is in Trash, but nobody new can be a trashed one.
    edit = {"summary": "Climbing weekend", "type": "activity", "group_id": group,
            "participants": [{"entity_id": jana}, {"entity_id": peter}]}  # fmt: skip
    assert client.put(f"/api/interactions/{x['id']}", json=edit).status_code == 200
    other = interaction(client, summary="Later", participants=[{"entity_id": jana}])
    refused = client.put(f"/api/interactions/{other['id']}", json={
        "summary": "Later", "participants": [{"entity_id": jana}, {"entity_id": peter}]})  # fmt: skip
    assert refused.status_code == 422
    assert client.get(f"/api/people/{jana}").json()["interaction_count"] == 2
    assert client.delete(f"/api/trash/{peter}").status_code == 200
    client.delete(f"/api/entities/{group}")
    client.delete(f"/api/trash/{group}")
    left = client.get(f"/api/interactions/{x['id']}").json()
    assert [p["entity"]["id"] for p in left["participants"]] == [jana] and left["group"] is None


def test_links_to_chronos_and_mnemosyne_stay_readable_when_unresolved(client, monkeypatch):
    jana = person(client, "Jana")["id"]
    bad = client.post("/api/interactions", json={"summary": "x", "participants": [{"entity_id": jana}],
                                                 "links": [{"resource": "nexus:v1:lyra:title:0190f0e4-0000-7000-8000-000000000009"}]})  # fmt: skip
    assert bad.status_code == 422 and "can be linked" in bad.text
    x = interaction(client, summary="Lunch", participants=[{"entity_id": jana}],
                    links=[{"resource": EVENT, "label": "Lunch at Bistro"}, {"resource": NOTE, "label": "Lunch notes"}])  # fmt: skip
    assert [(link["module"], link["type"], link["label"]) for link in x["links"]] == [
        ("chronos", "event", "Lunch at Bistro"), ("mnemosyne", "note", "Lunch notes")]  # fmt: skip

    def fake(method, path, body=None):
        if body["resource"] == EVENT:
            return {"availability": "deleted"}
        return {"availability": "available", "label": "Lunch notes (edited)"}

    monkeypatch.setattr(nexus, "call", fake)
    got = client.get(f"/api/interactions/{x['id']}").json()["links"]
    assert [(link["label"], link["availability"]) for link in got] == [
        ("Lunch at Bistro", "deleted"),  # the deleted event stays readable
        ("Lunch notes (edited)", "available"),
    ]


def test_link_candidates_are_items_other_modules_link_to_the_participants(client, monkeypatch):
    jana = person(client, "Jana")["id"]
    target = f"nexus:v1:meridian:person:{jana}"

    def fake(method, path, body=None):
        if path.startswith("/references?"):
            assert f"resource={target}" in path
            return {"references": [
                {"source": EVENT, "target": target, "relation": "chronos.involves"},
                {"source": NOTE, "target": target, "relation": "mnemosyne.related"},
                {"source": "nexus:v1:argus:photo:0190f0e4-0000-7000-8000-000000000005", "target": target},
            ]}  # fmt: skip
        return {"availability": "available", "label": "Item " + body["resource"][-1]}

    monkeypatch.setattr(nexus, "call", fake)
    got = client.get("/api/interaction-link-candidates", params={"entity": [jana]}).json()
    assert [(i["module"], i["type"], i["label"]) for i in got["items"]] == [
        ("chronos", "event", "Item 1"), ("mnemosyne", "note", "Item 2")]  # fmt: skip


def test_links_are_registered_enumerated_and_cleaned_up(client, monkeypatch):
    jana = person(client, "Jana")["id"]
    created, deleted = [], []
    monkeypatch.setattr(nexus, "create_reference",
                        lambda s, t, rel, readers: created.append((s, t, rel, readers)) or f"ref{len(created)}")  # fmt: skip
    monkeypatch.setattr(nexus, "delete_reference", lambda ref: deleted.append(ref))
    x = interaction(client, summary="Lunch", participants=[{"entity_id": jana}],
                    links=[{"resource": EVENT}, {"resource": NOTE}])  # fmt: skip
    db = client.app.state.db
    interactions.sync_references(db)
    src = f"nexus:v1:meridian:interaction:{x['id']}"
    # (The save's own background sync may register them too; registration is idempotent.)
    assert {(a, b, c, tuple(d)) for a, b, c, d in created} == {
        (src, EVENT, "meridian.interaction-about", ("chronos",)), (src, NOTE, "meridian.interaction-about", ("mnemosyne",))}  # fmt: skip
    with db.connect() as conn:
        assert {r[0] for r in conn.execute("SELECT nexus_state FROM interaction_links")} == {
            "registered"
        }
    # Enumeration: images (none) then links, paged with an "x:" cursor.
    page = client.get("/empyrean/v1/references/outgoing", params={"limit": 1}, headers=RES).json()
    assert len(page["references"]) == 1 and page["next_cursor"].startswith("x:")
    rest = client.get("/empyrean/v1/references/outgoing",
                      params={"limit": 1, "cursor": page["next_cursor"]}, headers=RES).json()  # fmt: skip
    assert {page["references"][0]["target"], rest["references"][0]["target"]} == {EVENT, NOTE}
    assert rest["references"][0]["readers"] in (["chronos"], ["mnemosyne"]) and rest["next_cursor"] is None
    # Removing one link, then the interaction, queues both edges for removal.
    client.put(f"/api/interactions/{x['id']}", json={"summary": "Lunch", "participants": [{"entity_id": jana}],
                                                    "links": [{"resource": NOTE}]})  # fmt: skip
    client.delete(f"/api/interactions/{x['id']}")
    from meridian import images

    images.sync_references(db)
    with db.connect() as conn:
        refs = {r[0] for r in conn.execute("SELECT reference_id FROM reference_cleanup")}
    assert refs == set() and len(set(deleted)) == 2
    assert client.get("/empyrean/v1/references/outgoing", headers=RES).json()["references"] == []


# ── Migration ──────────────────────────────────────────────────────────


def test_schema_7_is_additive_and_reversible(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    path = tmp_path / "meridian.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.create_collation("meridian_name", lambda a, b: (a > b) - (a < b))
        for i, step in enumerate(dbmod.MIGRATIONS[:6]):
            if callable(step):
                step(conn)
            else:
                conn.executescript(step)
            conn.execute(f"PRAGMA user_version={i + 1}")
        conn.execute(
            "INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) "
            "VALUES('p1','person','Jana','jana','2026','2026')"
        )
        conn.execute(
            "INSERT INTO facts(id,entity_id,key,value,created_at,updated_at) "
            "VALUES('f1','p1','favorite food','pasta','2026','2026')"
        )
        conn.commit()
        before = {t: conn.execute(f"SELECT * FROM {t}").fetchall() for t in ("entities", "facts")}
        before = {t: [tuple(r) for r in rows] for t, rows in before.items()}
    with TestClient(create_app(tmp_path)):
        pass
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 7
        after = {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t}")] for t in before}
        assert after == before  # nothing reinterpreted: a favorite stays a Fact
        assert conn.execute("SELECT count(*) FROM interests").fetchone()[0] == 0
        conn.executescript(dbmod.SCHEMA_7_REVERSAL)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 6
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert not tables & {"educations", "interests", "interactions", "interaction_links"}
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_backup_round_trip_keeps_the_new_records(client):
    jana = person(
        client, "Jana", education=[{"organization": "Uni"}], interests=[{"subject": "Chess"}]
    )
    interaction(client, summary="Chess game", participants=[{"entity_id": jana["id"]}])
    exported = client.post("/empyrean/v1/backup/export", headers=RES)
    assert exported.status_code == 200, exported.text
    with sqlite3.connect(":memory:") as mem:
        mem.deserialize(exported.content)
        assert mem.execute("SELECT count(*) FROM interactions").fetchone()[0] == 1
        assert mem.execute("SELECT count(*) FROM educations").fetchone()[0] == 1


def test_an_interaction_is_labelled_only_for_a_module_it_links_to(client):
    jana = person(client, "Jana")["id"]
    x = interaction(client, summary="Lunch at Bistro", participants=[{"entity_id": jana}], links=[{"resource": EVENT}])
    ref = f"nexus:v1:meridian:interaction:{x['id']}"
    ask = lambda requester: client.post(  # noqa: E731
        "/empyrean/v1/resources/resolve", headers=RES, json={"resource": ref, "requester": requester})  # fmt: skip
    allowed = ask("chronos")
    assert allowed.status_code == 200 and allowed.json()["label"] == "Lunch at Bistro"
    assert allowed.json()["open_path"] == f"/interactions/{x['id']}"
    assert ask("lyra").status_code == 403
    client.delete(f"/api/interactions/{x['id']}")
    assert ask("chronos").status_code == 404


def test_search_asks_each_owner_and_links_any_item(client, monkeypatch):
    place = "nexus:v1:atlas:place:0190f0e4-0000-7000-8000-00000000000c"
    event = "nexus:v1:chronos:event:0190f0e4-0000-7000-8000-00000000000d"

    def fake(method, path, body=None):
        assert path == "/projections/query"
        if body["module"] == "atlas":
            assert body["projection"] == "place-directory"
            return {"availability": "available", "items": [{"id": "x", "resource": place, "label": "Bistro"}]}
        if body["module"] == "chronos":
            assert body["projection"] == "link-search"
            return {"availability": "available", "items": [{"resource": event, "label": "Lunch"}, {"resource": "nexus:v1:lyra:movie:x", "label": "No"}]}
        raise nexus.NexusRefused(403, "Not granted")

    monkeypatch.setattr(nexus, "call", fake)
    got = client.get("/api/interaction-search", params={"q": "b"}).json()
    assert [(i["module_name"], i["label"]) for i in got["items"]] == [("Atlas", "Bistro"), ("Chronos", "Lunch")]
    jana = person(client, "Jana")["id"]
    x = interaction(client, summary="Lunch", participants=[{"entity_id": jana}], links=[{"resource": event, "label": "Lunch"}])
    assert x["links"][0]["module"] == "chronos"


def test_search_when_nothing_can_answer(client):
    assert client.get("/api/interaction-search", params={"q": "x"}).json() == {"availability": "nexus_unreachable", "items": []}
