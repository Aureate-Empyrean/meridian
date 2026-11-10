"""0.5.0: the seven approved UX improvements (architecture/modules/meridian.md, "Approved UX
improvements"): parent/child dates and adoption, sibling suggestions, @me in pickers, People
sorting and display preferences with Slovak collation, ongoing relationships when another
begins, and the data the Timeline groups by date."""

import sqlite3

import pytest
from fastapi.testclient import TestClient
from meridian import collation, relations
from meridian import db as dbmod
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


def person(client, given, family="", born=None, **name):
    doc = {"names": [{"kind": "full", "given": given, "family": family, **name}]}
    if born:
        doc["dates"] = [{"kind": "birth", "date": born}]
    r = client.post("/api/people", json=doc)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def relate(client, a, type_, b, expect=201, **extra):
    r = client.post(
        "/api/relationships", json={"subject_id": a, "object_id": b, "type": type_, **extra}
    )
    assert r.status_code == expect, r.text
    return r.json()


def suggestions(client, rid):
    r = client.get("/api/sibling-suggestions", params={"relationship": rid})
    assert r.status_code == 200, r.text
    return r.json()["suggestions"]


def count(client, sql, *args):
    with sqlite3.connect(client.app.state.db.path) as conn:
        return conn.execute(sql, args).fetchone()[0]


# ── 1. Parent/child: date suggestion and adoption ─────────────────────


def test_child_birth_date_is_suggested_as_the_start_only(client):
    ukazka = person(client, "Ukážka", "Kvázimenná")
    vzorko = person(client, "Vzorko", "Kvázimenný", born="1987-08-23")
    ask = lambda a, b, kinship="": client.get(  # noqa: E731
        "/api/relationship-suggestion",
        params={"subject_id": a, "object_id": b, "type": "parent", "kinship": kinship},
    ).json()
    got = ask(ukazka, vzorko)
    assert got["valid_from"] == "1987-08-23" and got["child"]["id"] == vzorko
    assert "valid_until" not in got  # an end date is never suggested
    # The child is the object of "parent of": the reverse direction suggests Ukážka's birth.
    assert ask(vzorko, ukazka) == {}
    # Adoption does not begin at birth.
    assert ask(ukazka, vzorko, "adoptive") == {} and ask(ukazka, vzorko, "step") == {}
    assert ask(ukazka, vzorko, "biological")["valid_from"] == "1987-08-23"
    # Other types get nothing.
    r = client.get(
        "/api/relationship-suggestion",
        params={"subject_id": ukazka, "object_id": vzorko, "type": "friend"},
    )
    assert r.json() == {}


def test_partial_and_unknown_birth_dates(client):
    mother = person(client, "Eva", "Nová")
    year_only = person(client, "Ján", "Nový", born="1990")
    no_year = person(client, "Jana", "Nová", born="--05-17")
    unknown = person(client, "Juraj", "Nový")
    ask = lambda child: client.get(  # noqa: E731
        "/api/relationship-suggestion",
        params={"subject_id": mother, "object_id": child, "type": "parent"},
    ).json()
    assert ask(year_only)["valid_from"] == "1990"  # precision kept, nothing invented
    assert ask(no_year) == {}  # a birthday without a year cannot start a relationship
    assert ask(unknown) == {}


def test_suggestion_is_not_forced_and_until_stays_empty(client):
    ukazka = person(client, "Ukážka", "Kvázimenná")
    vzorko = person(client, "Vzorko", "Kvázimenný", born="1987-08-23")
    # The user typed another date: it is stored exactly; death never fills Until.
    client.put(
        f"/api/people/{ukazka}",
        json={
            "names": [{"kind": "full", "given": "Ukážka", "family": "Kvázimenná"}],
            "dates": [{"kind": "death", "date": "2020-01-01"}],
        },
    )
    r = relate(client, ukazka, "parent", vzorko, valid_from="1988", kinship="biological")
    assert r["valid_from"] == "1988" and r["valid_until"] is None and r["state"] == "current"


def test_adoptive_and_biological_parents_are_kept_apart(client):
    bio = person(client, "Mária", "Biela")
    adoptive = person(client, "Zuzana", "Čierna")
    child = person(client, "Tomáš", "Čierny", born="2001-03-04")
    b = relate(client, bio, "parent", child, kinship="biological", valid_from="2001-03-04")
    a = relate(
        client,
        adoptive,
        "parent",
        child,
        kinship="adoptive",
        valid_from="2004-06",
        valid_until="2019",
    )
    assert b["kinship"] == "biological" and a["kinship"] == "adoptive"
    assert a["valid_from"] == "2004-06" and a["valid_until"] == "2019" and a["state"] == "former"
    # The same person as both biological and adoptive parent is not a duplicate warning...
    relate(client, bio, "parent", child, kinship="adoptive", valid_from="2003")
    # ...but the same kinship again is, and an unrecorded kinship may be either.
    assert relate(client, bio, "parent", child, expect=409, kinship="biological")["similar"]
    assert relate(client, bio, "parent", child, expect=409)["similar"]
    rows = client.get(f"/api/people/{child}").json()["relationships"]
    assert sorted(r["kinship"] for r in rows) == ["adoptive", "adoptive", "biological"]
    assert all(r["phrase"] == "child of" for r in rows)  # the ordinary wording is unchanged


def test_kinship_only_fits_parent_and_sibling(client):
    a, b = person(client, "Ann", "A"), person(client, "Bob", "B")
    assert (
        "parent and sibling"
        in relate(client, a, "friend", b, expect=422, kinship="adoptive")["detail"]
    )
    relate(client, a, "parent", b, expect=422, kinship="biological_half")
    relate(client, a, "sibling", b, expect=422, kinship="cousinly")


def test_existing_parent_records_stay_unrecorded(tmp_path, monkeypatch):
    """A schema 5 database keeps its parent records with no kinship: nothing is reinterpreted
    as biological or adoptive."""
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    path = tmp_path / "meridian.sqlite3"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    for step in MIGRATIONS[:5]:
        step(conn) if callable(step) else conn.executescript(step)
    conn.execute("PRAGMA user_version=5")
    now = "2026-01-01T00:00:00Z"
    for eid, given, family in (("p1", "Old", "Parent"), ("c1", "Old", "Child")):
        conn.execute(
            "INSERT INTO entities(id,kind,display_name,sort_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            (eid, "person", f"{given} {family}", f"{family} {given}".lower(), now, now),
        )
        conn.execute(
            "INSERT INTO names(id,entity_id,kind,given,family,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            ("n" + eid, eid, "full", given, family, now, now),
        )
    conn.execute(
        "INSERT INTO relationships(id,subject_id,object_id,type,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        ("r1", "p1", "c1", "parent", now, now),
    )
    conn.commit()
    conn.close()
    with TestClient(create_app(tmp_path)):
        with sqlite3.connect(path) as raw:
            assert raw.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
            assert raw.execute("SELECT kinship FROM relationships").fetchone()[0] is None
            names = raw.execute(
                "SELECT name_given_first, name_family_first, display_family_first FROM entities WHERE id='c1'"
            ).fetchone()
            assert names == ("Old Child", "Child Old", "Child, Old")
            # Existing installations keep family-first ordering until the owner changes it.
            assert (
                raw.execute("SELECT value FROM settings WHERE key='people.sort'").fetchone()[0]
                == "family"
            )


# ── 2. Siblings from shared parents ────────────────────────────────────


def family(client):
    mother = person(client, "Ukážka", "Kvázimenná")
    father = person(client, "Pokusko", "Kvázimenný")
    a = person(client, "Vzorko", "Kvázimenný")
    b = person(client, "Náhradka", "Kvázimenná")
    return mother, father, a, b


def test_two_shared_biological_parents_suggest_full_siblings(client):
    mother, father, a, b = family(client)
    for p in (mother, father):
        relate(client, p, "parent", b, kinship="biological")
    relate(client, mother, "parent", a, kinship="biological")
    last = relate(client, father, "parent", a, kinship="biological")
    found = suggestions(client, last["id"])
    assert len(found) == 1
    s = found[0]
    assert s["action"] == "create" and s["kinship"] == "biological_full"
    assert {s["a"]["id"], s["b"]["id"]} == {a, b} and s["reason"] == "two_biological"
    assert {p["id"] for p in s["shared_parents"]} == {mother, father}
    # Nothing was written by asking.
    assert count(client, "SELECT count(*) FROM relationships WHERE type='sibling'") == 0


def test_one_known_parent_is_uncertain_not_half(client):
    mother, _, a, b = family(client)
    relate(client, mother, "parent", b, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="biological")
    (s,) = suggestions(client, last["id"])
    assert s["kinship"] == "biological" and s["reason"] == "one_biological_other_unknown"


def test_confirmed_different_second_parents_suggest_half_siblings(client):
    mother, father, a, b = family(client)
    other_father = person(client, "Karol", "Iný")
    relate(client, mother, "parent", b, kinship="biological")
    relate(client, other_father, "parent", b, kinship="biological")
    relate(client, father, "parent", a, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="biological")
    (s,) = suggestions(client, last["id"])
    assert s["kinship"] == "biological_half" and s["reason"] == "one_biological_other_different"


def test_shared_adoptive_parent_means_siblings_through_adoption(client):
    mother, father, a, b = family(client)
    relate(client, mother, "parent", b, kinship="biological")
    relate(client, father, "parent", b, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="adoptive")
    (s,) = suggestions(client, last["id"])
    # Not biological, never step-siblings, never half-siblings from an adoptive parent.
    assert s["kinship"] == "adoptive" and s["reason"] == "adoptive"


def test_unrecorded_parenthood_is_only_a_candidate(client):
    mother, _, a, b = family(client)
    relate(client, mother, "parent", b)
    last = relate(client, mother, "parent", a)
    (s,) = suggestions(client, last["id"])
    assert s["kinship"] is None and s["reason"] == "unspecified"


def test_step_parents_and_non_parent_types_suggest_nothing(client):
    mother, father, a, b = family(client)
    relate(client, mother, "parent", b, kinship="step")
    step = relate(client, mother, "parent", a, kinship="step")
    assert suggestions(client, step["id"]) == []
    friend = relate(client, a, "friend", b)
    assert suggestions(client, friend["id"]) == []
    assert client.get("/api/sibling-suggestions", params={"relationship": "x"}).status_code == 404


def test_confirming_creates_once_and_never_duplicates(client):
    mother, father, a, b = family(client)
    for p in (mother, father):
        relate(client, p, "parent", b, kinship="biological")
        last = relate(client, p, "parent", a, kinship="biological")
    (s,) = suggestions(client, last["id"])
    item = {"a": s["a"]["id"], "b": s["b"]["id"], "kinship": s["kinship"]}
    r = client.post("/api/sibling-suggestions/apply", json={"items": [item]})
    assert r.json() == {"created": 1, "updated": 0, "skipped": 0}
    # Applying again, or from the other side, does not duplicate.
    again = {"a": item["b"], "b": item["a"], "kinship": item["kinship"]}
    r = client.post("/api/sibling-suggestions/apply", json={"items": [again]})
    assert r.json() == {"created": 0, "updated": 0, "skipped": 1}
    assert count(client, "SELECT count(*) FROM relationships WHERE type='sibling'") == 1
    assert suggestions(client, last["id"]) == []
    rel = client.get(f"/api/people/{a}").json()["relationships"]
    sib = next(r for r in rel if r["type"] == "sibling")
    assert sib["phrase"] == "sibling of" and sib["kinship"] == "biological_full"
    assert sib["sources"][0]["label"].startswith("Confirmed by you")


def test_declining_or_cancelling_changes_nothing(client):
    mother, _, a, b = family(client)
    relate(client, mother, "parent", b, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="biological")
    assert len(suggestions(client, last["id"])) == 1
    # "No" for every candidate means the client sends nothing; an empty request is refused.
    assert client.post("/api/sibling-suggestions/apply", json={"items": []}).status_code == 422
    assert count(client, "SELECT count(*) FROM relationships WHERE type='sibling'") == 0
    assert len(suggestions(client, last["id"])) == 1  # still offered next time


def test_later_parent_information_proposes_an_update(client):
    mother, father, a, b = family(client)
    relate(client, mother, "parent", b, kinship="biological")
    first = relate(client, mother, "parent", a, kinship="biological")
    (s,) = suggestions(client, first["id"])
    client.post(
        "/api/sibling-suggestions/apply",
        json={"items": [{"a": a, "b": b, "kinship": "biological_half"}]},
    )
    sibling = next(
        r for r in client.get(f"/api/people/{a}").json()["relationships"] if r["type"] == "sibling"
    )
    client.put(
        f"/api/relationships/{sibling['id']}",
        json={"subject_id": sibling["subject"]["id"], "object_id": sibling["object"]["id"],
              "type": "sibling", "kinship": "biological_half", "note": "met at school",
              "valid_from": "1990"},
    )  # fmt: skip
    relate(client, father, "parent", b, kinship="biological")
    last = relate(client, father, "parent", a, kinship="biological")
    (s,) = suggestions(client, last["id"])
    assert s["action"] == "update" and s["record_id"] == sibling["id"]
    assert s["current_kinship"] == "biological_half" and s["kinship"] == "biological_full"
    r = client.post(
        "/api/sibling-suggestions/apply",
        json={
            "items": [{"a": a, "b": b, "kinship": "biological_full", "record_id": s["record_id"]}]
        },
    )
    assert r.json()["updated"] == 1
    kept = client.get(f"/api/relationships/{sibling['id']}").json()
    # The user's note, dates and record identity are preserved; only kinship changed.
    assert kept["kinship"] == "biological_full" and kept["note"] == "met at school"
    assert kept["valid_from"] == "1990"
    assert count(client, "SELECT count(*) FROM relationships WHERE type='sibling'") == 1


def test_vaguer_evidence_never_downgrades_a_recorded_classification(client):
    mother, _, a, b = family(client)
    relate(client, a, "sibling", b, kinship="biological_full")
    relate(client, mother, "parent", b, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="biological")
    assert suggestions(client, last["id"]) == []


def test_biological_and_adoptive_siblinghood_can_coexist(client):
    mother, _, a, b = family(client)
    relate(client, a, "sibling", b, kinship="adoptive")
    relate(client, mother, "parent", b, kinship="biological")
    last = relate(client, mother, "parent", a, kinship="biological")
    (s,) = suggestions(client, last["id"])
    assert s["action"] == "create" and s["kinship"] == "biological"
    client.post(
        "/api/sibling-suggestions/apply",
        json={"items": [{"a": a, "b": b, "kinship": "biological"}]},
    )
    kinds = sorted(
        r["kinship"]
        for r in client.get(f"/api/people/{a}").json()["relationships"]
        if r["type"] == "sibling"
    )
    assert kinds == ["adoptive", "biological"]


def test_apply_is_all_or_nothing(client):
    mother, _, a, b = family(client)
    c = person(client, "Iné", "Dieťa")
    good = {"a": a, "b": b, "kinship": "biological"}
    stale = {
        "a": a,
        "b": c,
        "kinship": "biological_full",
        "record_id": "0192f0c4-1111-7aaa-8bbb-000000000001",
    }
    r = client.post("/api/sibling-suggestions/apply", json={"items": [good, stale]})
    assert r.status_code == 409
    assert count(client, "SELECT count(*) FROM relationships WHERE type='sibling'") == 0
    org = client.post(
        "/api/entities", json={"kind": "organization", "names": [{"value": "ACME"}]}
    ).json()
    r = client.post("/api/sibling-suggestions/apply", json={"items": [{"a": a, "b": org["id"]}]})
    assert r.status_code == 422


def test_more_children_give_one_consolidated_list(client):
    mother = person(client, "Matka", "Veľká")
    kids = [person(client, f"Dieťa{i}", "Veľké") for i in range(4)]
    for k in kids[1:]:
        relate(client, mother, "parent", k, kinship="biological")
    last = relate(client, mother, "parent", kids[0], kinship="biological")
    found = suggestions(client, last["id"])
    assert sorted(s["b"]["id"] for s in found) == sorted(kids[1:])
    assert all(s["a"]["id"] == kids[0] for s in found)


def test_classification_rules():
    bio, adp = {"biological"}, {"adoptive"}
    assert relations.classify({"m": bio, "f": bio}, {"m": bio, "f": bio})[0] == "biological_full"
    assert relations.classify({"m": bio}, {"m": bio})[0] == "biological"
    assert relations.classify({"m": bio, "f": bio}, {"m": bio, "g": bio})[0] == "biological_half"
    # The other parent is linked to the second child without a kinship: still uncertain.
    assert relations.classify({"m": bio, "f": bio}, {"m": bio, "f": {None}})[0] == "biological"
    # ...but an adoptive link proves it is not their biological parent.
    assert relations.classify({"m": bio, "f": bio}, {"m": bio, "f": adp})[0] == "biological_half"
    assert relations.classify({"m": adp}, {"m": bio})[0] == "adoptive"
    assert relations.classify({"m": {None}}, {"m": {None}}) == (None, "unspecified")
    assert relations.classify({"m": bio}, {"f": bio}) is None


# ── 4. @me in person pickers ───────────────────────────────────────────


def test_at_me_finds_the_self_person_in_pickers(client):
    me = person(client, "Alfáš", "Kvázimenný")
    other = person(client, "Mena", "Iná")
    empty = client.get(
        "/api/search", params={"q": "@me", "kinds": "person,organization,group"}
    ).json()
    assert empty["entities"] == [] and empty["self_missing"] is True
    client.put("/api/self", json={"person_id": me})
    for q in ("@me", "@ME", " @m", "@"):
        got = client.get(
            "/api/search", params={"q": q, "kinds": "person,organization,group"}
        ).json()
        assert [x["id"] for x in got["entities"]] == [me] and got["entities"][0]["is_self"]
        assert got["self_missing"] is False
    # The kinds the picker asks for still apply: a Group picker never offers @me.
    got = client.get("/api/search", params={"q": "@me", "kinds": "group"}).json()
    assert got["entities"] == [] and got["self_missing"] is False
    # "me" puts the self person first among ordinary matches; no second record exists.
    got = client.get("/api/search", params={"q": "me", "kinds": "person"}).json()
    assert [x["id"] for x in got["entities"]][:2] == [me, other]
    assert count(client, "SELECT count(*) FROM entities WHERE kind='person'") == 2
    # The People list understands it too, and a normal search still works.
    assert [x["id"] for x in client.get("/api/people", params={"q": "@me"}).json()["items"]] == [me]
    assert client.get("/api/search", params={"q": "@example.com"}).json()["entities"] == []
    # A trashed self person is not offered.
    client.delete(f"/api/people/{me}")
    assert client.get("/api/search", params={"q": "@me"}).json()["self_missing"] is True


# ── 5. Sorting and display preferences ─────────────────────────────────


def test_slovak_collation():
    names = ["Čapek", "Cyril", "Dana", "Chovan", "Hudák", "Ivan", "Šimon", "Sára", "Tibor",
             "Žofia", "Zuzana", "Ábel", "Adam", "Ďuro", "Dušan", "Ľubo", "Lukáš", "Ottó", "Ôrol",
             "Oto", "Peter"]  # fmt: skip
    ordered = collation.sorted_names(names)
    assert ordered.index("Cyril") < ordered.index("Čapek") < ordered.index("Dana")
    assert ordered.index("Hudák") < ordered.index("Chovan") < ordered.index("Ivan")
    assert ordered.index("Sára") < ordered.index("Šimon") < ordered.index("Tibor")
    assert ordered.index("Zuzana") < ordered.index("Žofia")
    assert (
        ordered.index("Oto")
        < ordered.index("Ottó")
        < ordered.index("Ôrol")
        < ordered.index("Peter")
    )
    # Acute accents and the soft ď/ľ only break ties: "Ábel" sorts among the a's (b < d).
    assert ordered[:2] == ["Ábel", "Adam"]
    assert ordered.index("Dana") < ordered.index("Ďuro") < ordered.index("Dušan")  # r < š
    assert ordered.index("Ľubo") < ordered.index("Lukáš")
    assert collation.compare("Lukac", "Lukáč") < 0 and collation.compare("Kráľ", "Kráľová") < 0
    assert collation.compare("Lukacs", "Lukáč") < 0  # č is a letter of its own, after c
    assert collation.compare("anna", "Anna") < 0 and collation.compare("", "Adam") > 0
    assert collation.compare("Nováková-Kráľ", "NovákováKráľ") == 0  # hyphens are ignored
    assert collation.compare("Ann Marie", "Anna") < 0  # a space sorts before letters


def test_people_sorting_and_display_preferences(client):
    for given, family in (("Vzorko", "Kvázimenný"), ("Adam", "Čech"), ("Zuzana", "Cibuľová"),
                          ("Šimon", "Bača"), ("Chris", "Hraško")):  # fmt: skip
        person(client, given, family)
    single = client.post(
        "/api/people", json={"names": [{"kind": "full", "value": "Madonna"}]}
    ).json()
    only_family = person(client, "", "Ondrejka")

    def names(**p):
        return [x["display_name"] for x in client.get("/api/people", params=p).json()["items"]]

    # A new installation sorts by first name.
    assert client.get("/api/settings").json() == {"people_sort": "given", "people_display": "given"}
    assert names() == ["Adam Čech", "Chris Hraško", "Madonna", "Ondrejka", "Šimon Bača",
                       "Vzorko Kvázimenný", "Zuzana Cibuľová"]  # fmt: skip
    r = client.put("/api/settings", json={"people_sort": "family"})
    assert r.json() == {"people_sort": "family", "people_display": "given"}
    # Family first, Slovak order: B, C, Č, H, K, (Madonna has no family name), O.
    assert names() == ["Šimon Bača", "Zuzana Cibuľová", "Adam Čech", "Chris Hraško",
                       "Vzorko Kvázimenný", "Madonna", "Ondrejka"]  # fmt: skip
    # Sorting happens before pagination.
    page = client.get("/api/people", params={"limit": 2, "offset": 2}).json()["items"]
    assert [x["display_name"] for x in page] == ["Adam Čech", "Chris Hraško"]
    # Display order is independent and does not rewrite stored names.
    client.put("/api/settings", json={"people_display": "family"})
    assert client.get("/api/state").json()["settings"] == {
        "people_sort": "family",
        "people_display": "family",
    }
    item = client.get("/api/people", params={"q": "Vzorko"}).json()["items"][0]
    assert (
        item["display_name"] == "Vzorko Kvázimenný"
        and item["display_family_first"] == "Kvázimenný, Vzorko"
    )
    lone = client.get(f"/api/people/{single['id']}").json()
    assert lone["display_name"] == "Madonna" and lone["names"][0]["value"] == "Madonna"
    summary = client.get("/api/people", params={"q": "Ondrejka"}).json()["items"][0]
    assert summary["display_family_first"] == "Ondrejka" and only_family
    # Pickers use the same order.
    found = client.get("/api/search", params={"q": "a", "kinds": "person"}).json()["entities"]
    assert [x["display_name"] for x in found][:2] == ["Šimon Bača", "Zuzana Cibuľová"]
    # Last updated / Date added keep working, and unknown values are refused.
    assert len(names(sort="updated")) == 7 and len(names(sort="created")) == 7
    assert client.put("/api/settings", json={"people_sort": "middle"}).status_code == 422


def test_prefix_and_suffix_do_not_sort(client):
    person(client, "Bohuslav", "Adamec", prefix="Ing.", suffix="PhD.")
    person(client, "Anton", "Zeman")
    client.put("/api/settings", json={"people_display": "family"})
    items = client.get("/api/people").json()["items"]
    assert [x["display_name"] for x in items] == ["Anton Zeman", "Ing. Bohuslav Adamec PhD."]
    assert items[1]["display_family_first"] == "Adamec, Ing. Bohuslav, PhD."


def test_organizations_sort_with_collation(client):
    for name in ("Čokoláda s.r.o.", "Cukráreň", "Dom"):
        client.post("/api/entities", json={"kind": "organization", "names": [{"value": name}]})
    items = client.get("/api/entities", params={"kind": "organization"}).json()["items"]
    assert [x["display_name"] for x in items] == ["Cukráreň", "Čokoláda s.r.o.", "Dom"]


def test_new_installation_has_no_stored_preference(client):
    assert count(client, "SELECT count(*) FROM settings") == 0


# ── 6. Ongoing relationships when another begins ──────────────────────


def couple(client):
    return person(client, "Jana", "Nová"), person(client, "Peter", "Starý")


def active(client, a, b, type_):
    r = client.get(
        "/api/active-relationships", params={"subject_id": a, "object_id": b, "type": type_}
    )
    assert r.status_code == 200, r.text
    return r.json()["active"]


def test_ongoing_relationships_are_detected_both_ways(client):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022")
    friend = relate(client, jana, "friend", peter, valid_from="2015")
    found = {r["id"]: r for r in active(client, jana, peter, "engaged")}
    assert set(found) == {dating["id"], friend["id"]}
    # Only the partner relationship is proposed for ending; the friendship is not.
    assert (
        found[dating["id"]]["suggest_end"] is True and found[friend["id"]]["suggest_end"] is False
    )
    # Same type is the duplicate check's job, not this one.
    assert [r["id"] for r in active(client, jana, peter, "dating")] == [friend["id"]]


def test_ended_kinship_and_non_candidates(client):
    jana, peter = couple(client)
    relate(client, peter, "dating", jana, valid_from="2018", valid_until="2019")
    relate(client, peter, "partner", jana, state="former")  # ended, date unknown
    relate(client, peter, "sibling", jana)
    relate(client, peter, "parent", jana)
    unknown = relate(client, peter, "roommate", jana, state="unknown")
    assert [r["id"] for r in active(client, jana, peter, "engaged")] == [unknown["id"]]
    # Starting kinship never asks about other relationships.
    relate(client, peter, "friend", jana)
    assert active(client, jana, peter, "cousin") == []


def test_ending_and_creating_is_one_transition(client):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022", note="met at a concert")
    engaged = relate(
        client, jana, "engaged", peter, valid_from="2024-05",
        end_relationships=[{"id": dating["id"], "valid_until": "2024-05"}],
    )  # fmt: skip
    assert engaged["valid_from"] == "2024-05" and engaged["state"] == "current"
    old = client.get(f"/api/relationships/{dating['id']}").json()
    # The previous record is kept with its history; only its end was set.
    assert old["valid_until"] == "2024-05" and old["state"] == "former"
    assert old["valid_from"] == "2022" and old["note"] == "met at a concert"
    entries = client.get("/api/timeline", params={"entity": jana}).json()["entries"]
    ids = [e["id"] for e in entries]
    assert ids.index(f"relationship:{dating['id']}:start") < ids.index(
        f"relationship:{dating['id']}:end"
    )
    assert f"relationship:{engaged['id']}:start" in ids


def test_unknown_transition_date_is_not_invented(client):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022")
    relate(client, jana, "engaged", peter, end_relationships=[{"id": dating["id"]}])
    old = client.get(f"/api/relationships/{dating['id']}").json()
    assert old["valid_until"] is None and old["state"] == "former"
    tl = client.get("/api/timeline", params={"entity": jana}).json()
    end = f"relationship:{dating['id']}:end"
    # Ended without a date: listed as undated, never placed on a guessed day.
    assert end not in [e["id"] for e in tl["entries"]]
    assert end in [e["id"] for e in tl["undated"]]


def test_keeping_both_active_is_allowed(client):
    jana, peter = couple(client)
    friend = relate(client, peter, "friend", jana)
    relate(client, peter, "colleague", jana)
    assert client.get(f"/api/relationships/{friend['id']}").json()["state"] == "current"
    assert count(client, "SELECT count(*) FROM relationships WHERE state='current'") == 2


def test_failed_transition_changes_nothing(client):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022")
    sibling = relate(client, peter, "sibling", jana)
    before = count(client, "SELECT count(*) FROM relationships")
    # An end before the start is refused: neither the ending nor the new record is saved.
    r = relate(client, jana, "engaged", peter, expect=422,
               end_relationships=[{"id": dating["id"], "valid_until": "2021"}])  # fmt: skip
    assert "before the start" in r["detail"]
    # Kinship cannot be ended this way.
    relate(client, jana, "engaged", peter, expect=422, end_relationships=[{"id": sibling["id"]}])
    # A record that is not between these two is refused.
    other = person(client, "Iná", "Osoba")
    stray = relate(client, other, "dating", jana)
    relate(client, jana, "engaged", peter, expect=422, end_relationships=[{"id": stray["id"]}])
    # A record that ended meanwhile is a conflict.
    client.put(
        f"/api/relationships/{dating['id']}",
        json={"subject_id": peter, "object_id": jana, "type": "dating", "state": "former"},
    )
    relate(client, jana, "engaged", peter, expect=409, end_relationships=[{"id": dating["id"]}])
    assert count(client, "SELECT count(*) FROM relationships") == before + 1  # only the stray
    assert count(client, "SELECT count(*) FROM relationships WHERE type='engaged'") == 0
    assert client.get(f"/api/relationships/{sibling['id']}").json()["state"] == "current"
    # Editing never ends other relationships.
    r = client.put(
        f"/api/relationships/{stray['id']}",
        json={"subject_id": other, "object_id": jana, "type": "dating",
              "end_relationships": [{"id": dating["id"]}]},
    )  # fmt: skip
    assert r.status_code == 422


def test_duplicate_check_still_applies_with_a_transition(client):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022")
    relate(client, peter, "engaged", jana, valid_from="2023")
    r = relate(client, jana, "engaged", peter, expect=409, end_relationships=[{"id": dating["id"]}])
    assert r["similar"]
    # The refusal left the ongoing relationship untouched.
    assert client.get(f"/api/relationships/{dating['id']}").json()["state"] == "current"


def test_transition_rolls_back_on_a_database_failure(client, monkeypatch):
    jana, peter = couple(client)
    dating = relate(client, peter, "dating", jana, valid_from="2022")

    def broken(conn, subject, object_, items):
        conn.execute("UPDATE relationships SET state='former' WHERE id=?", (items[0]["id"],))
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(relations, "end_for_transition", broken)
    with pytest.raises(sqlite3.OperationalError):
        client.post(
            "/api/relationships",
            json={"subject_id": jana, "object_id": peter, "type": "engaged",
                  "end_relationships": [{"id": dating["id"]}]},
        )  # fmt: skip
    assert client.get(f"/api/relationships/{dating['id']}").json()["state"] == "current"
    assert count(client, "SELECT count(*) FROM relationships WHERE type='engaged'") == 0


# ── 7. Timeline data for same-date grouping ────────────────────────────


def test_timeline_keeps_same_day_entries_distinct_and_adjacent(client):
    ukazka = person(client, "Ukážka", "Kvázimenná")
    vzorko = person(client, "Vzorko", "Kvázimenný", born="1987-08-23")
    rel = relate(client, ukazka, "parent", vzorko, valid_from="1987-08-23", kinship="biological")
    month = person(client, "Mesiac", "Iba", born="1987-08")
    tl = client.get("/api/timeline").json()
    dated = tl["entries"]
    same = [e for e in dated if e.get("date") == "1987-08-23"]
    assert {e["id"] for e in same} == {
        f"date:{_birth(client, vzorko)}",
        f"relationship:{rel['id']}:start",
    }
    first = dated.index(same[0])
    assert dated[first + 1] is not None and dated[first + 1]["date"] == "1987-08-23"
    # The month-only date stays a month: it is ordered before the exact day, never merged.
    august = next(e for e in dated if e.get("date") == "1987-08")
    assert dated.index(august) < first and month
    rel_entry = next(e for e in same if e["category"] == "relationship")
    assert rel_entry["kinship"] == "biological"
    # Nothing is stored for the Timeline.
    assert count(client, "SELECT count(*) FROM events") == 0


def _birth(client, pid):
    return client.get(f"/api/people/{pid}").json()["dates"][0]["id"]


# ── Schema 6 is additive and reversible ────────────────────────────────


def test_schema_6_reversal_leaves_a_schema_5_database(client):
    """docs/RELATIONSHIPS.md § 11: the manual reversal for going back to 0.4.x."""
    a, b = couple(client)
    relate(client, a, "parent", b, kinship="adoptive")
    path = client.app.state.db.path
    with sqlite3.connect(path) as conn:
        conn.executescript(dbmod.SCHEMA_8_REVERSAL)
        conn.executescript(dbmod.SCHEMA_7_REVERSAL)
        conn.executescript(dbmod.SCHEMA_6_REVERSAL)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
        cols = {r[1] for r in conn.execute("PRAGMA table_info(relationships)")}
        assert "kinship" not in cols
        cols = {r[1] for r in conn.execute("PRAGMA table_info(entities)")}
        assert not cols & {"name_given_first", "name_family_first", "display_family_first"}
        assert conn.execute("SELECT count(*) FROM relationships").fetchone()[0] == 1
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    # And upgrading again recomputes everything.
    dbmod.Database(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(dbmod.MIGRATIONS)
        assert (
            conn.execute("SELECT name_given_first FROM entities WHERE id=?", (a,)).fetchone()[0]
            == "Jana Nová"
        )


def test_page_inlines_the_ux_helpers(client):
    page = client.get("/").text
    assert "const MeridianUX" in page and page.index("const MeridianUX") < page.index(
        "function relKinship"
    )
