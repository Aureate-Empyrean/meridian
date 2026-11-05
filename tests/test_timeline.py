"""Milestone 3: the Timeline projection, partial dates, native events and their provenance."""

import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient
from meridian import timeline
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


def person(client, name, **extra):
    given, family = name.split(" ")
    r = client.post(
        "/api/people", json={"names": [{"kind": "full", "given": given, "family": family}], **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def entity(client, kind, name, **extra):
    r = client.post(
        "/api/entities", json={"kind": kind, "names": [{"kind": "full", "value": name}], **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def relate(client, a, type_, b, **extra):
    r = client.post(
        "/api/relationships", json={"subject_id": a, "object_id": b, "type": type_, **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def event(client, title, who, expect=201, **extra):
    body = {"title": title, "participants": [{"entity_id": w} for w in who], **extra}
    r = client.post("/api/events", json=body)
    assert r.status_code == expect, r.text
    return r.json()


def tl(client, **params):
    r = client.get("/api/timeline", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def ids(view):
    return [e["id"] for e in view["entries"]]


def by_id(view, entry_id):
    return next(e for e in view["entries"] + view["undated"] if e["id"] == entry_id)


def names(view, e):
    return [view["entities"][i][2] for i in e["entities"]]


# ── Projection from relationships ─────────────────────────────────────


def test_relationship_start_and_end_are_projected_not_stored(client):
    jana, peter = person(client, "Jana Example"), person(client, "Peter Novák")
    rid = relate(
        client,
        jana,
        "partner",
        peter,
        valid_from="2012-06",
        valid_until="2019-03-14",
        state="former",
    )
    view = tl(client)
    start, end = by_id(view, f"relationship:{rid}:start"), by_id(view, f"relationship:{rid}:end")
    assert start["moment"] == "start" and start["date"] == "2012-06"
    # The wording lives once per type, not on every entry.
    assert view["types"][start["type"]]["label"] == "partner of"
    assert end["moment"] == "end" and end["date"] == "2019-03-14" and end["state"] == "former"
    assert names(view, start) == ["Jana Example", "Peter Novák"]
    assert start["until"] == "2019-03-14" and end["since"] == "2012-06" and "editable" not in start
    detail = client.get("/api/timeline/entry", params={"id": start["id"]}).json()
    assert detail["record"] == "relationship" and detail["record_id"] == rid
    assert detail["phrase"] == "partner of" and detail["period"] == ["2012-06", "2019-03-14"]
    # Nothing was copied into the events table: the relationship is the only authority.
    with sqlite3.connect(client.app.state.db.path) as db:
        assert db.execute("SELECT count(*) FROM events").fetchone()[0] == 0


def test_ongoing_relationship_never_looks_ended(client):
    a, b = person(client, "Eva Zelená"), person(client, "Adam Fábry")
    rid = relate(client, a, "friend", b, valid_from="1998")
    view = tl(client)
    start = by_id(view, f"relationship:{rid}:start")
    assert start["ongoing"] is True and start["state"] == "current"
    assert f"relationship:{rid}:end" not in ids(view) + [e["id"] for e in view["undated"]]


def test_ended_without_a_date_says_so_without_inventing_one(client):
    a, b = person(client, "Ivan Kráľ"), person(client, "Oto Kráľ")
    rid = relate(client, a, "roommate", b, valid_from="2005", state="former")
    view = tl(client)
    assert by_id(view, f"relationship:{rid}:start")["date"] == "2005"
    end = by_id(view, f"relationship:{rid}:end")
    assert end in view["undated"] and "date" not in end and end["state"] == "former"


def test_records_without_dates_are_listed_as_undated(client):
    a, b = person(client, "Lea Biela"), person(client, "Rita Biela")
    rid = relate(client, a, "sibling", b)
    view = tl(client)
    assert view["entries"] == [] and by_id(view, f"relationship:{rid}:record")["moment"] == "record"


def test_unknown_state_and_confidence_are_kept(client):
    a, b = person(client, "Ema Malá"), person(client, "Ota Malý")
    rid = relate(
        client, a, "acquaintance", b, valid_from="2010-02", state="unknown", confidence="low"
    )
    start = by_id(tl(client), f"relationship:{rid}:start")
    assert start["state"] == "unknown" and start["confidence"] == "low" and "ongoing" not in start


# ── Memberships and work ─────────────────────────────────────────────


def test_group_membership_history(client):
    p = person(client, "Mia Horná")
    choir = entity(client, "group", "Choir")
    r = client.post("/api/memberships", json={"group_id": choir, "member_id": p, "role": "alto",
                                               "valid_from": "2001-09", "valid_until": "2008", "state": "former"})  # fmt: skip
    mid = r.json()["id"]
    view = tl(client, entity=choir)
    start, end = by_id(view, f"membership:{mid}:start"), by_id(view, f"membership:{mid}:end")
    assert start["detail"] == "alto" and start["category"] == "membership"
    assert names(view, end) == ["Mia Horná", "Choir"]
    # A year-only end sorts by its year; it is never read as 1 January 2008.
    assert end["date"] == "2008"


def test_several_employment_periods(client):
    acme = entity(client, "organization", "Acme")
    p = person(client, "Ján Novák", employments=[
        {"organization": "Acme", "organization_id": acme, "title": "Engineer", "valid_from": "2010-03", "valid_until": "2014-06"},
        {"organization": "Acme", "organization_id": acme, "title": "Lead", "valid_from": "2017"},
        {"title": "Freelancer", "valid_from": "2014-07", "valid_until": "2016"},
    ])  # fmt: skip
    view = tl(client, entity=p)
    work = [e for e in view["entries"] if e["category"] == "employment"]
    assert [(e["moment"], e["date"]) for e in work] == [
        ("start", "2010-03"), ("end", "2014-06"), ("start", "2014-07"), ("end", "2016"), ("start", "2017")]  # fmt: skip
    assert work[-1]["ongoing"] is True and work[-1]["detail"] == "Lead"
    # Work without a known organization involves only the person.
    assert names(view, work[2]) == ["Ján Novák"]
    assert len(tl(client, entity=acme)["entries"]) == 3


def test_personal_dates_become_life_events(client):
    p = person(client, "Ola Krátka", dates=[
        {"kind": "birth", "date": "1990-05-17"}, {"kind": "anniversary", "label": "Wedding", "date": "2015", "approximate": True},
        {"kind": "name_day", "date": "--06-21"}, {"kind": "custom", "label": "Moved abroad", "description": "summer 2022"}])  # fmt: skip
    org = entity(client, "organization", "Orbis", dates=[{"kind": "birth", "date": "1951"}])
    view = tl(client)
    phrases = {e["phrase"]: e for e in view["entries"] + view["undated"]}
    assert phrases["born"]["date"] == "1990-05-17" and phrases["founded"]["date"] == "1951"
    assert phrases["Wedding"]["approximate"] is True
    # Name days recur every year; they are not history.
    assert not any(e.get("type") == "name_day" for e in view["entries"] + view["undated"])
    undated = [e for e in view["undated"] if e["id"].startswith("date:")]
    assert undated[0]["detail"] == "summer 2022" and "date" not in undated[0]
    assert {names(view, e)[0] for e in view["entries"]} == {"Ola Krátka", "Orbis"} and p and org


def test_birthday_without_a_year_is_undated_but_kept(client):
    person(client, "Uma Nová", dates=[{"kind": "birth", "date": "--03-14"}])
    view = tl(client)
    assert view["entries"] == [] and view["undated"][0]["date"] == "--03-14"


# ── Sorting and precision ────────────────────────────────────────────


def test_partial_dates_sort_before_the_known_parts_of_their_period(client):
    a = person(client, "Ari Malý")
    for title, when in [("Day", "1990-05-17"), ("Year", "1990"), ("Month", "1990-05"), ("Later", "1991"),
                        ("Earlier", "1989-12-31"), ("Other month", "1990-02")]:  # fmt: skip
        event(client, title, [a], starts=when, allow_similar=True)
    titles = [e["title"] for e in tl(client)["entries"]]
    assert titles == ["Earlier", "Year", "Other month", "Month", "Day", "Later"]
    assert timeline.sort_key("1990") == "19900000" and timeline.sort_key("--05-17") is None


def test_dates_are_returned_as_entered(client):
    a = person(client, "Bea Hore")
    created = event(
        client, "Graduation", [a], starts="2008", approximate=True, category="education"
    )
    assert created["starts"] == "2008" and created["approximate"] is True
    entry = by_id(tl(client), f"event:{created['id']}")
    assert entry["date"] == "2008" and entry["approximate"] is True and entry["moment"] == "at"


def test_event_dates_must_make_sense(client):
    a = person(client, "Cyril Nízky")
    cases = [({"starts": "--05-01"}, "Add a year"), ({"ends": "2001"}, "An end needs a start"),
             ({"starts": "2002", "ends": "2001"}, "before the start"), ({"starts": "2002", "ends": "2003", "ongoing": True}, "no end yet"),
             ({"starts": "2002-02-30"}, "real calendar day")]  # fmt: skip
    for extra, message in cases:
        r = client.post(
            "/api/events", json={"title": "x", "participants": [{"entity_id": a}], **extra}
        )
        assert r.status_code == 422 and message in r.json()["detail"], (extra, r.text)
    assert client.post("/api/events", json={"title": "x", "participants": []}).status_code == 422


# ── Native events ────────────────────────────────────────────────────


def test_event_crud_with_several_entities_and_provenance(client):
    a, b = person(client, "Dana Mladá"), person(client, "Erik Starý")
    club = entity(client, "group", "Book club")
    created = event(client, "First met at the book club", [a, b, club], starts="2016-10-02", category="meeting",
                    description="Rainy evening", confidence="medium",
                    sources=[{"kind": "told", "entity_id": b, "label": "Erik", "learned": "2017"}])  # fmt: skip
    assert [p["entity"]["display_name"] for p in created["participants"]] == [
        "Dana Mladá",
        "Erik Starý",
        "Book club",
    ]
    assert (
        created["sources"][0]["entity_name"] == "Erik Starý" and created["confidence"] == "medium"
    )
    for who in (a, b, club):
        assert f"event:{created['id']}" in ids(tl(client, entity=who))
    detail = client.get("/api/timeline/entry", params={"id": f"event:{created['id']}"}).json()
    assert detail["editable"] is True and detail["description"] == "Rainy evening"
    assert [e["display_name"] for e in detail["entities"]] == [
        "Dana Mladá",
        "Erik Starý",
        "Book club",
    ]
    assert detail["sources"][0]["label"] == "Erik"
    # Edit: a span with one participant fewer.
    body = {"title": "Book club season", "participants": [{"entity_id": a, "role": "host"}, {"entity_id": club}],
            "starts": "2016-10", "ends": "2017-05", "category": "gathering"}  # fmt: skip
    updated = client.put(f"/api/events/{created['id']}", json=body).json()
    assert (
        updated["ends"] == "2017-05"
        and updated["participants"][0]["role"] == "host"
        and updated["sources"] == []
    )
    assert f"event:{created['id']}" not in ids(tl(client, entity=b))
    entry = by_id(tl(client), f"event:{created['id']}")
    assert entry["moment"] == "span" and entry["end"] == "2017-05"
    # Delete removes it and its provenance.
    assert client.delete(f"/api/events/{created['id']}").json() == {"deleted": True}
    assert client.get(f"/api/events/{created['id']}").status_code == 404
    with sqlite3.connect(client.app.state.db.path) as db:
        assert (
            db.execute("SELECT count(*) FROM provenance WHERE record_kind='event'").fetchone()[0]
            == 0
        )
        assert db.execute("SELECT count(*) FROM event_participants").fetchone()[0] == 0


def test_ongoing_event(client):
    a = person(client, "Fero Lesný")
    e = event(client, "Living in Vienna", [a], starts="2019-09", ongoing=True, category="move")
    entry = by_id(tl(client), f"event:{e['id']}")
    assert entry["moment"] == "span" and entry["ongoing"] is True and "end" not in entry


def test_events_must_involve_entities_in_meridian(client):
    a = person(client, "Gita Hlas")
    r = client.post(
        "/api/events",
        json={
            "title": "x",
            "participants": [{"entity_id": "0190fa00-0000-7000-8000-000000000999"}],
        },
    )
    assert r.status_code == 422
    r = client.post(
        "/api/events", json={"title": "x", "participants": [{"entity_id": a}, {"entity_id": a}]}
    )
    assert r.status_code == 422 and "once" in r.json()["detail"]


def test_similar_entries_are_noticed_before_duplicating_a_record(client):
    acme = entity(client, "organization", "Acme")
    p = person(
        client,
        "Hana Rýchla",
        employments=[
            {
                "organization": "Acme",
                "organization_id": acme,
                "title": "Analyst",
                "valid_from": "2015-06",
            }
        ],
    )
    # "Started at Acme" in June 2015 repeats the work record: the user is told first.
    r = client.post("/api/events", json={"title": "Started at Acme", "starts": "2015-06-01",
                                          "participants": [{"entity_id": p}, {"entity_id": acme}]})  # fmt: skip
    assert r.status_code == 409 and r.json()["similar"][0]["record"] == "employment"
    asked = client.get(
        "/api/similar-events", params={"starts": "2015-06", "entities": f"{p},{acme}"}
    ).json()
    assert asked["similar"][0]["id"].startswith("employment:")
    # A different month is not similar; and the user may still record it knowingly.
    assert (
        client.get("/api/similar-events", params={"starts": "2015-07", "entities": p}).json()[
            "similar"
        ]
        == []
    )
    created = event(client, "Started at Acme", [p, acme], starts="2015-06-01", allow_similar=True)
    # Editing it without changing its date or people does not ask again.
    again = client.put(f"/api/events/{created['id']}", json={"title": "First day at Acme", "starts": "2015-06-01",
                                                               "participants": [{"entity_id": p}, {"entity_id": acme}]})  # fmt: skip
    assert again.status_code == 200, again.text


# ── Authoritative records stay authoritative ─────────────────────────


def test_editing_a_relationship_updates_the_timeline_without_stale_entries(client):
    a, b = person(client, "Ida Krásna"), person(client, "Jozef Krásny")
    rid = relate(client, a, "dating", b, valid_from="2010")
    assert ids(tl(client)) == [f"relationship:{rid}:start"]
    body = {"subject_id": a, "object_id": b, "type": "spouse", "valid_from": "2011-07-02"}
    assert client.put(f"/api/relationships/{rid}", json=body).status_code == 200
    view = tl(client)
    assert ids(view) == [f"relationship:{rid}:start"]
    assert view["types"][view["entries"][0]["type"]]["label"] == "married to"
    assert view["entries"][0]["date"] == "2011-07-02"
    body.update(valid_until="2020-01", state="former")
    client.put(f"/api/relationships/{rid}", json=body)
    assert ids(tl(client)) == [f"relationship:{rid}:start", f"relationship:{rid}:end"]
    client.delete(f"/api/relationships/{rid}")
    assert tl(client)["entries"] == []
    assert (
        client.get("/api/timeline/entry", params={"id": f"relationship:{rid}:start"}).status_code
        == 404
    )


def test_editing_work_on_a_profile_updates_the_timeline(client):
    p = person(
        client,
        "Karol Tichý",
        employments=[{"organization": "Delta", "title": "Clerk", "valid_from": "2001"}],
    )
    doc = client.get(f"/api/people/{p}").json()
    work = doc["employments"][0]
    first = ids(tl(client))
    work.update(valid_until="2004", title="Senior clerk")
    keep = {
        k: work[k]
        for k in ("id", "organization", "organization_id", "title", "valid_from", "valid_until")
    }
    r = client.put(f"/api/people/{p}", json={"names": [{"id": n["id"], "kind": n["kind"], "given": n["given"], "family": n["family"]} for n in doc["names"]],
                                            "employments": [keep]})  # fmt: skip
    assert r.status_code == 200, r.text
    view = tl(client)
    assert ids(view)[0] == first[0] and len(view["entries"]) == 2
    assert view["entries"][1]["moment"] == "end" and view["entries"][1]["detail"] == "Senior clerk"


def test_entries_involving_trashed_entities_are_hidden_and_return_on_restore(client):
    a, b = person(client, "Lucia Svetlá"), person(client, "Marek Tmavý")
    rid = relate(client, a, "friend", b, valid_from="2000")
    e = event(client, "Trip", [a, b], starts="2003")
    client.delete(f"/api/people/{b}")
    view = tl(client)
    assert f"relationship:{rid}:start" not in ids(view)
    # The event still involves Lucia, so it stays, without Marek.
    assert names(view, by_id(view, f"event:{e['id']}")) == ["Lucia Svetlá"]
    client.post(f"/api/people/{b}/restore")
    assert f"relationship:{rid}:start" in ids(tl(client))
    # Purging removes Marek from the event; the event itself is kept.
    client.delete(f"/api/people/{b}")
    client.delete(f"/api/trash/{b}")
    assert client.get(f"/api/events/{e['id']}").json()["participants"][0]["entity"]["id"] == a


# ── Filtering ────────────────────────────────────────────────────────


def test_filters_by_entity_record_kind_and_years(client):
    a, b, c = person(client, "Nina Prvá"), person(client, "Oto Druhý"), person(client, "Pia Tretia")
    relate(client, a, "friend", b, valid_from="2001")
    relate(client, b, "friend", c, valid_from="2010")
    event(client, "Met", [a, c], starts="2005")
    assert len(tl(client)["entries"]) == 3
    assert len(tl(client, entity=a)["entries"]) == 2
    only = tl(client, records="event")
    assert [e["category"] for e in only["entries"]] == ["event"]
    years = tl(client, year_from=2004, year_to=2011)
    assert [e["date"] for e in years["entries"]] == ["2005", "2010"]
    # The entity table lists only those the kept entries refer to.
    assert {x[2] for x in tl(client, entity=a)["entities"]} == {
        "Nina Prvá",
        "Oto Druhý",
        "Pia Tretia",
    }
    assert client.get("/api/timeline", params={"entity": "nope"}).status_code == 404


def test_no_duplicate_entries(client):
    a, b = person(client, "Rado Biely"), person(client, "Sára Biela")
    rid = relate(client, a, "colleague", b, valid_from="2003", valid_until="2006", state="former")
    for view in (tl(client), tl(client, entity=a), tl(client, entity=b)):
        all_ids = ids(view) + [e["id"] for e in view["undated"]]
        assert len(all_ids) == len(set(all_ids)) and f"relationship:{rid}:start" in all_ids


# ── Scale, migration, access ─────────────────────────────────────────


def test_timeline_scales_within_the_gateway_limit(client):
    db = sqlite3.connect(client.app.state.db.path)
    now = "2026-01-01T00:00:00Z"
    people = [f"0190fa00-0000-7000-8000-{i:012d}" for i in range(1500)]
    db.executemany("INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                   [(p, "person", f"Person {i}", f"person {i}", now, now) for i, p in enumerate(people)])  # fmt: skip
    rows = [(f"0190fb00-0000-7000-8000-{i:012d}", people[i % 1500], people[(i * 7 + 1) % 1500], "friend",
             f"{1950 + i % 70}-{1 + i % 12:02d}", f"{1990 + i % 30}" if i % 3 == 0 else None,
             "former" if i % 3 == 0 else "current", now, now) for i in range(7000)]  # fmt: skip
    db.executemany("INSERT INTO relationships(id,subject_id,object_id,type,valid_from,valid_until,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", rows)  # fmt: skip
    db.commit()
    db.close()
    r = client.get("/api/timeline")
    view = r.json()
    # 9,333 entries are recorded; the first 8,000 are sent, flagged, within the 2 MiB limit.
    assert len(view["entries"]) == timeline.MAX_ENTRIES and view["truncated"] is True
    assert len(r.content) < 2 * 1024 * 1024
    # Smaller pieces (one entity, or a span of years) still come complete.
    assert tl(client, year_from=1950, year_to=1955)["truncated"] is False
    keys = [timeline.sort_key(e["date"]) for e in view["entries"]]
    assert keys == sorted(keys)


def test_upgrading_a_milestone_2_database_keeps_its_data(tmp_path, monkeypatch):
    path = tmp_path / "meridian.sqlite3"
    db = sqlite3.connect(path)
    db.executescript("BEGIN;" + MIGRATIONS[0] + MIGRATIONS[1] + "PRAGMA user_version=3; COMMIT;")
    now = "2026-01-01T00:00:00Z"
    for i, name in enumerate(["Ada Stará", "Bob Starý"]):
        db.execute("INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                   (f"01900000-0000-7000-8000-00000000000{i}", "person", name, name.lower(), now, now))  # fmt: skip
    db.execute("INSERT INTO relationships(id,subject_id,object_id,type,valid_from,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
               ("01900000-0000-7000-8000-0000000000aa", "01900000-0000-7000-8000-000000000000", "01900000-0000-7000-8000-000000000001", "friend", "1999", "current", now, now))  # fmt: skip
    db.commit()
    db.close()
    before = path.read_bytes()
    shutil.copy(path, tmp_path / "before.sqlite3")
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        view = c.get("/api/timeline").json()
        assert [e["id"] for e in view["entries"]] == [
            "relationship:01900000-0000-7000-8000-0000000000aa:start"
        ]
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        assert db.execute("SELECT count(*) FROM relationships").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM events").fetchone()[0] == 0
    assert before  # the pre-upgrade copy is untouched
    with sqlite3.connect(tmp_path / "before.sqlite3") as old:
        assert old.execute("PRAGMA user_version").fetchone()[0] == 3


def test_timeline_needs_the_nexus_gateway(client):
    anonymous = TestClient(client.app)
    for path in (
        "/api/timeline",
        "/api/timeline/entry?id=event:x",
        "/api/similar-events",
        "/api/event-categories",
    ):
        assert anonymous.get(path).status_code == 403, path
    assert anonymous.post("/api/events", json={}).status_code == 403
