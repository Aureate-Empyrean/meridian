"""Milestone 2: relationships, Organizations and Groups, memberships, provenance and the graph."""

import sqlite3
import time

import pytest
from fastapi.testclient import TestClient
from meridian import relations
from meridian.app import create_app
from meridian.db import MIGRATIONS

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        yield c


def person(client, name):
    given, family = name.split(" ")
    r = client.post(
        "/api/people", json={"names": [{"kind": "full", "given": given, "family": family}]}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def entity(client, kind, name, **extra):
    r = client.post(
        "/api/entities", json={"kind": kind, "names": [{"kind": "full", "value": name}], **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()


def relate(client, a, type_, b, expect=201, **extra):
    r = client.post(
        "/api/relationships", json={"subject_id": a, "object_id": b, "type": type_, **extra}
    )
    assert r.status_code == expect, r.text
    return r.json()


def rels_of(client, eid, kind="people"):
    path = f"/api/people/{eid}" if kind == "people" else f"/api/entities/{eid}"
    return client.get(path).json()["relationships"]


# ── Direction and inverse ──────────────────────────────────────────────


def test_one_record_reads_both_ways(client):
    peter, jana = person(client, "Peter Novák"), person(client, "Jana Nováková")
    created = relate(client, peter, "parent", jana)
    assert created["phrase"] == "parent of" and created["direction"] == "out"
    from_peter, from_jana = rels_of(client, peter), rels_of(client, jana)
    assert len(from_peter) == len(from_jana) == 1
    # The same record, read from each side: no second, diverging fact.
    assert from_peter[0]["id"] == from_jana[0]["id"] == created["id"]
    assert from_peter[0]["phrase"] == "parent of" and from_peter[0]["other"]["id"] == jana
    assert from_jana[0]["phrase"] == "child of" and from_jana[0]["other"]["id"] == peter
    assert from_jana[0]["direction"] == "in"
    with sqlite3.connect(client.app.state.db.path) as db:
        assert db.execute("SELECT count(*) FROM relationships").fetchone()[0] == 1


def test_symmetric_types_read_the_same_and_reverse_duplicates_are_noticed(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    rel = relate(client, a, "friend", b)
    assert rel["symmetric"] and rel["direction"] == "mutual"
    assert rels_of(client, b)[0]["phrase"] == "friend of"
    # Recording the same friendship from the other side is caught, not silently duplicated.
    clash = client.post(
        "/api/relationships", json={"subject_id": b, "object_id": a, "type": "friend"}
    )
    assert clash.status_code == 409
    assert clash.json()["similar"][0]["id"] == rel["id"]
    # The editor asks first; the check reads the same both ways for a symmetric type.
    asked = client.get(
        "/api/similar-relationships", params={"subject_id": b, "object_id": a, "type": "friend"}
    )
    assert [r["id"] for r in asked.json()["similar"]] == [rel["id"]]
    none = client.get(
        "/api/similar-relationships", params={"subject_id": b, "object_id": a, "type": "colleague"}
    )
    assert none.json() == {"similar": []}
    # After seeing it, the user may still record a second one (e.g. a different period).
    again = relate(client, b, "friend", a, allow_similar=True, valid_from="2025", context="again")
    assert again["id"] != rel["id"]
    assert len(rels_of(client, a)) == 2


def test_several_relationships_between_the_same_pair(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    relate(client, a, "sibling", b)
    relate(client, a, "colleague", b)
    relate(client, a, "classmate", b, state="former", valid_from="2019", valid_until="2020")
    phrases = sorted(r["phrase"] for r in rels_of(client, b))
    assert phrases == ["classmate of", "colleague of", "sibling of"]
    between = client.get("/api/connections", params={"a": a, "b": b}).json()
    assert len(between["relationships"]) == 3


def test_custom_types_need_no_migration(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    made = client.post(
        "/api/relationship-types",
        json={"label": "Godparent of", "inverse": "godchild of", "category": "family"},
    )
    assert made.status_code == 201
    t = made.json()
    assert t["key"].startswith("c-") and t["label"] == "godparent of" and not t["symmetric"]
    rel = relate(client, a, t["key"], b)
    assert rels_of(client, b)[0]["phrase"] == "godchild of" and rel["category"] == "family"
    # Asking for the same type again returns it rather than a duplicate vocabulary entry.
    assert (
        client.post(
            "/api/relationship-types", json={"label": "godparent of", "inverse": "Godchild of"}
        ).json()["key"]
        == t["key"]
    )
    sym = client.post(
        "/api/relationship-types", json={"label": "chess partner of", "symmetric": True}
    ).json()
    assert sym["symmetric"] and sym["inverse"] == sym["label"]
    listed = {x["key"] for x in client.get("/api/relationship-types").json()["types"]}
    assert {"parent", "friend", t["key"], sym["key"]} <= listed


def test_context_labels_stay_on_the_record(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    rel = relate(client, a, "friend", b, context="best friend")
    assert rel["context"] == "best friend" and rel["type"] == "friend"
    assert "best friend" not in {
        x["label"] for x in client.get("/api/relationship-types").json()["types"]
    }


# ── Validation ─────────────────────────────────────────────────────────


def test_invalid_relationships_are_refused(client):
    a = person(client, "Alice Kováčová")
    acme = entity(client, "organization", "Acme")["id"]
    assert (
        relate(client, a, "friend", a, expect=422)["detail"]
        == "A relationship needs two different entities"
    )
    assert "does not fit" in relate(client, a, "friend", acme, expect=422)["detail"]
    assert "does not fit" in relate(client, acme, "subsidiary", a, expect=422)["detail"]
    assert (
        relate(client, a, "no-such-type", acme, expect=422)["detail"]
        == "Choose a relationship type"
    )
    missing = "01900000-0000-7000-8000-000000000000"
    assert relate(client, a, "friend", missing, expect=422)
    assert (
        "before the start"
        in relate(client, a, "founder", acme, valid_from="2020", valid_until="2019-05", expect=422)[
            "detail"
        ]
    )
    # Trashed entities cannot gain relationships.
    b = person(client, "Bob Kováč")
    client.delete(f"/api/people/{b}")
    relate(client, a, "friend", b, expect=422)


def test_editing_ending_and_removing(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    rel = relate(client, a, "partner", b, valid_from="2022-03")
    body = {
        "subject_id": a,
        "object_id": b,
        "type": "partner",
        "valid_from": "2022-03",
        "valid_until": "2024",
    }
    ended = client.put(f"/api/relationships/{rel['id']}", json=body).json()
    # An end date makes it former; the relationship is kept as history, not deleted.
    assert (
        ended["state"] == "former" and ended["valid_until"] == "2024" and ended["id"] == rel["id"]
    )
    assert rels_of(client, a)[0]["state"] == "former"
    assert client.delete(f"/api/relationships/{rel['id']}").json() == {"deleted": True}
    assert (
        rels_of(client, a) == []
        and client.get(f"/api/relationships/{rel['id']}").status_code == 404
    )


def test_unknown_state_and_partial_dates_are_preserved(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    rel = relate(client, a, "acquaintance", b, state="unknown", valid_from="2019-08")
    assert (
        rel["state"] == "unknown" and rel["valid_from"] == "2019-08" and rel["valid_until"] is None
    )


# ── Provenance and confidence ─────────────────────────────────────────


def test_sources_and_confidence(client):
    a, b, c = (
        person(client, "Alice Kováčová"),
        person(client, "Bob Kováč"),
        person(client, "Cyril Malý"),
    )
    rel = relate(client, a, "sibling", b, confidence="low", sources=[
        {"kind": "Told", "entity_id": c, "label": "at the wedding", "learned": "2024-08"},
        {"kind": "document", "label": "family tree"},
    ])  # fmt: skip
    assert rel["confidence"] == "low"
    told, doc = rel["sources"]
    assert (
        told["kind"] == "told"
        and told["entity_name"] == "Cyril Malý"
        and told["learned"] == "2024-08"
    )
    assert doc == {
        "kind": "document",
        "entity_id": None,
        "entity_name": None,
        "label": "family tree",
        "learned": None,
    }
    # Contradictory claims are both kept: nothing is deduplicated automatically.
    other = relate(client, a, "cousin", b, sources=[{"kind": "told", "label": "Dana says cousins"}])
    assert {r["id"] for r in rels_of(client, a)} == {rel["id"], other["id"]}
    # Removing the relationship removes its provenance rows too.
    client.delete(f"/api/relationships/{rel['id']}")
    with sqlite3.connect(client.app.state.db.path) as db:
        assert (
            db.execute(
                "SELECT count(*) FROM provenance WHERE record_id=?", (rel["id"],)
            ).fetchone()[0]
            == 0
        )


# ── Organizations and Groups ───────────────────────────────────────────


def test_organizations_with_aliases_contacts_and_structure(client):
    uni = entity(client, "organization", "Example University",
                 contacts=[{"channel": "website", "value": "university.example.org"}])  # fmt: skip
    faculty = entity(client, "organization", "Faculty of Arts")
    assert (
        uni["kind"] == "organization"
        and uni["contacts"][0]["value"] == "https://university.example.org"
    )
    renamed = client.put(f"/api/entities/{uni['id']}", json={
        "kind": "organization", "notes": "Public university.",
        "names": [{"kind": "full", "value": "Example University"}, {"kind": "abbreviation", "value": "EU"}],
    }).json()  # fmt: skip
    assert [n["kind"] for n in renamed["names"]] == ["full", "abbreviation"]
    relate(client, faculty["id"], "part_of", uni["id"])
    assert rels_of(client, uni["id"], "entities")[0]["phrase"] == "includes"
    found = client.get("/api/entities", params={"kind": "organization", "q": "univ"}).json()
    assert [x["display_name"] for x in found["items"]] == ["Example University"]
    # Work records belong to people, and an entity keeps its kind.
    bad = client.post("/api/entities", json={"kind": "organization", "names": [{"value": "X"}],
                                             "employments": [{"title": "CEO"}]})  # fmt: skip
    assert bad.status_code == 422
    assert (
        client.put(
            f"/api/entities/{uni['id']}", json={"kind": "group", "names": [{"value": "X"}]}
        ).status_code
        == 422
    )


def test_people_at_an_organization_come_from_work_records(client):
    jana = client.post("/api/people", json={
        "names": [{"kind": "full", "value": "Jana Malá"}],
        "employments": [{"organization": "Acme", "title": "Engineer"}],
    }).json()  # fmt: skip
    acme_id = jana["employments"][0]["organization_id"]
    acme = client.get(f"/api/entities/{acme_id}").json()
    assert acme["names"][0]["value"] == "Acme"
    assert [(w["person_name"], w["title"]) for w in acme["work_here"]] == [
        ("Jana Malá", "Engineer")
    ]
    # Renaming the Organization keeps the person's work linked to it.
    client.put(
        f"/api/entities/{acme_id}", json={"kind": "organization", "names": [{"value": "Acme Labs"}]}
    )
    work = client.get(f"/api/people/{jana['id']}").json()["employments"][0]
    assert work["organization"] == "Acme Labs" and work["organization_id"] == acme_id
    doc = {
        "names": jana["names"],
        "employments": [
            {**{k: work[k] for k in ("id", "organization", "organization_id", "title")}}
        ],
    }
    for n in doc["names"]:
        for k in ("position", "source", "created_at", "updated_at"):
            n.pop(k, None)
    again = client.put(f"/api/people/{jana['id']}", json=doc)
    assert again.status_code == 200, again.text
    assert again.json()["employments"][0]["organization_id"] == acme_id


def test_group_membership_is_not_a_relationship(client):
    a, b = person(client, "Alice Kováčová"), person(client, "Bob Kováč")
    gym = entity(client, "group", "Gym group", notes="Tuesday evenings")["id"]
    m1 = client.post(
        "/api/memberships", json={"group_id": gym, "member_id": a, "role": "organizer"}
    )
    m2 = client.post(
        "/api/memberships",
        json={"group_id": gym, "member_id": b, "valid_from": "2021", "valid_until": "2023"},
    )
    assert m1.status_code == m2.status_code == 201
    assert m2.json()["state"] == "former" and m1.json()["role"] == "organizer"
    # Co-membership never creates or implies a relationship between Alice and Bob.
    assert rels_of(client, a) == [] and rels_of(client, b) == []
    assert client.get("/api/connections", params={"a": a, "b": b}).json() == {
        "relationships": [],
        "memberships": [],
        "employments": [],
    }
    group = client.get(f"/api/entities/{gym}").json()
    assert sorted(m["other"]["display_name"] for m in group["memberships"]) == [
        "Alice Kováčová",
        "Bob Kováč",
    ]
    assert client.get(f"/api/people/{a}").json()["memberships"][0]["phrase"] == "member of"
    # A Group cannot be a member, and members belong to groups only.
    other = entity(client, "group", "Book club")["id"]
    assert (
        client.post("/api/memberships", json={"group_id": gym, "member_id": other}).status_code
        == 422
    )
    assert client.post("/api/memberships", json={"group_id": a, "member_id": b}).status_code == 422
    # Many-to-many: one person in several groups.
    assert (
        client.post("/api/memberships", json={"group_id": other, "member_id": a}).status_code == 201
    )
    assert len(client.get(f"/api/people/{a}").json()["memberships"]) == 2


def test_trash_and_purge_cover_organizations_and_groups(client):
    a = person(client, "Alice Kováčová")
    club = entity(client, "group", "Chess club")["id"]
    client.post("/api/memberships", json={"group_id": club, "member_id": a})
    assert client.delete(f"/api/entities/{club}").json() == {"trashed": True}
    trash = client.get("/api/trash").json()["items"]
    assert [(x["kind"], x["display_name"]) for x in trash] == [("group", "Chess club")]
    # A trashed group leaves the graph but its membership is kept for a restore.
    assert all(n[0] != club for n in client.get("/api/graph").json()["nodes"])
    client.post(f"/api/entities/{club}/restore")
    assert len(client.get(f"/api/people/{a}").json()["memberships"]) == 1
    client.delete(f"/api/entities/{club}")
    assert client.delete(f"/api/trash/{club}").json() == {"deleted": True}
    assert client.get(f"/api/people/{a}").json()["memberships"] == []


# ── Graph projection ───────────────────────────────────────────────────


def test_graph_is_derived_from_records_only(client):
    a, b, c = (
        person(client, "Alice Kováčová"),
        person(client, "Bob Kováč"),
        person(client, "Cyril Malý"),
    )
    jana = client.post(
        "/api/people",
        json={
            "names": [{"value": "Jana Malá"}],
            "employments": [{"organization": "Acme", "title": "CEO"}],
        },
    ).json()
    acme = jana["employments"][0]["organization_id"]
    gym = entity(client, "group", "Gym")["id"]
    relate(client, a, "parent", b)
    relate(client, b, "friend", c, state="former", valid_until="2020", confidence="low")
    client.post("/api/memberships", json={"group_id": gym, "member_id": a})
    client.post("/api/memberships", json={"group_id": gym, "member_id": c})
    g = client.get("/api/graph").json()
    ids = [n[0] for n in g["nodes"]]
    assert set(ids) == {a, b, c, jana["id"], acme, gym}
    kinds = {n[0]: n[1] for n in g["nodes"]}
    assert kinds[acme] == "o" and kinds[gym] == "g" and kinds[a] == "p"
    edges = {(ids[e[0]], ids[e[1]], e[2], g["types"][e[3]]["key"], e[4], e[5]) for e in g["edges"]}
    assert edges == {
        (a, b, "r", "parent", 0, 0),
        (b, c, "r", "friend", 1, 2),
        (a, gym, "m", "membership", 0, 0),
        (c, gym, "m", "membership", 0, 0),
        (jana["id"], acme, "e", "employment", 0, 0),
    }
    # Shared membership in Gym gives no a–c edge; nothing is inferred.
    assert not any({ids[e[0]], ids[e[1]]} == {a, c} and e[2] == "r" for e in g["edges"])
    assert g["truncated"] is False
    parent = next(t for t in g["types"] if t["key"] == "parent")
    assert parent == {
        "key": "parent",
        "category": "family",
        "label": "parent of",
        "inverse": "child of",
        "symmetric": False,
    }


def test_graph_projection_scales(client, tmp_path):
    """A synthetic network of 2,000 entities and 6,000 connections, written directly so the
    test measures the projection rather than the API."""
    db = client.app.state.db
    now = "2026-01-01T00:00:00Z"
    with db.connect() as conn:
        ids = []
        for i in range(2000):
            eid = f"01900000-0000-7000-8000-{i:012d}"
            kind = "person" if i % 10 else ("organization" if i % 20 else "group")
            ids.append((eid, kind))
            conn.execute("INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                         (eid, kind, f"Synthetic {i}", f"synthetic {i:05d}", now, now))  # fmt: skip
        people = [e for e, k in ids if k == "person"]
        groups = [e for e, k in ids if k == "group"]
        for i in range(5000):
            a, b = people[(i * 7) % len(people)], people[(i * 13 + 1) % len(people)]
            if a != b:
                conn.execute("INSERT INTO relationships(id,subject_id,object_id,type,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                             (f"r-{i}", a, b, ("friend", "colleague", "parent")[i % 3], now, now))  # fmt: skip
        for i in range(1000):
            conn.execute("INSERT INTO memberships(id,group_id,member_id,created_at,updated_at) VALUES(?,?,?,?,?)",
                         (f"m-{i}", groups[i % len(groups)], people[i % len(people)], now, now))  # fmt: skip
    started = time.perf_counter()
    response = client.get("/api/graph")
    elapsed = time.perf_counter() - started
    g = response.json()
    assert len(g["nodes"]) == 2000 and len(g["edges"]) == 6000
    assert len(response.content) < 2 * 1024 * 1024 / 4, (
        "well inside the gateway's 2 MiB response limit"
    )
    assert elapsed < 2.0, f"projection took {elapsed:.2f}s"
    print(
        f"\ngraph projection: 2000 nodes, 6000 edges, {len(response.content)} bytes, {elapsed * 1000:.0f} ms"
    )


# ── Upgrade ────────────────────────────────────────────────────────────


def test_upgrading_a_milestone_1_database(tmp_path, monkeypatch):
    path = tmp_path / "meridian.sqlite3"
    db = sqlite3.connect(path)
    db.executescript("BEGIN;" + MIGRATIONS[0] + "PRAGMA user_version=1; COMMIT;")
    now = "2026-01-01T00:00:00Z"
    db.execute("INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
               ("01900000-0000-7000-8000-000000000001", "organization", "Old Org", "old org", now, now))  # fmt: skip
    db.commit()
    db.close()
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        org = c.get("/api/entities/01900000-0000-7000-8000-000000000001").json()
        assert org["names"][0]["value"] == "Old Org" and org["relationships"] == []
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)


def test_builtin_types_are_well_formed():
    for key, t in relations.BUILTIN.items():
        assert t["key"] == key and t["category"] in relations.CATEGORIES
        assert t["label"] and t["inverse"] and (t["symmetric"] == (t["label"] == t["inverse"]))
    # Work is a Work record, not a relationship type, so it has a single authority.
    assert "employee" not in relations.BUILTIN and "works_at" not in relations.BUILTIN


def test_relationship_data_needs_the_nexus_gateway(client):
    anonymous = TestClient(client.app)
    for path in ("/api/graph", "/api/relationship-types", "/api/connections?a=x&b=y",
                 "/api/entities?kind=group", "/api/similar-relationships?subject_id=x&object_id=y&type=friend"):  # fmt: skip
        assert anonymous.get(path).status_code == 403, path
    assert anonymous.post("/api/relationships", json={}).status_code == 403
    assert anonymous.post("/api/memberships", json={}).status_code == 403
