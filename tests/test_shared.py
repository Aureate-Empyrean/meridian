"""0.6.0 (roadmap Phase 2): what Meridian shares with other modules through Nexus.

`dated-items` (birthdays, anniversaries; owner decision D4), `people-directory` (names only;
D5/D6), the "Linked from other modules" list read back from the reference index, and the change
announcement for Chronos. architecture/concepts/projections.md holds the contracts."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from meridian import nexus, shared
from meridian.app import create_app

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}
RES = {"x-nexus-resolver-key": KEY}
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        yield c


def person(client, given, family="", dates=(), **extra):
    doc = {"names": [{"kind": "full", "given": given, "family": family}], **extra}
    doc["dates"] = [{"kind": k, "date": d, **x} for k, d, x in dates]
    r = client.post("/api/people", json=doc)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def dated(client, start, end, cursor=None, headers=RES):
    return client.post(
        "/empyrean/v1/projections/dated-items",
        headers=headers,
        json={"requester": "chronos", "query": {"from": start, "to": end}, "cursor": cursor},
    )


def directory(client, q="", limit=None, cursor=None):
    query = {"q": q} | ({"limit": limit} if limit else {})
    r = client.post(
        "/empyrean/v1/projections/people-directory",
        headers=RES,
        json={"requester": "chronos", "query": query, "cursor": cursor},
    )
    assert r.status_code == 200, r.text
    return r.json()


# ── dated-items ────────────────────────────────────────────────────────


def test_birthdays_and_anniversaries_are_yearly_dated_items(client):
    vzorko = person(
        client,
        "Vzorko",
        "Kvázimenný",
        dates=[
            ("birth", "1987-08-23", {}),
            ("anniversary", "2015-09-12", {"label": "Wedding anniversary"}),
        ],
    )
    items = dated(client, "2026-01-01", "2028-01-01").json()["items"]
    assert [(i["kind"], i["start"]) for i in items] == [
        ("meridian.birthday", "2026-08-23"),
        ("meridian.anniversary", "2026-09-12"),
        ("meridian.birthday", "2027-08-23"),
        ("meridian.anniversary", "2027-09-12"),
    ]
    first = items[0]
    assert first["resource"] == f"nexus:v1:meridian:person:{vzorko}"
    assert first["title"] == "Birthday · Vzorko Kvázimenný" and first["summary"] == "Turns 39"
    assert first["all_day"] is True and first["certainty"] == "confirmed"
    assert first["status"] == "scheduled" and first["id"].endswith(":2026")
    assert items[1]["title"] == "Wedding anniversary · Vzorko Kvázimenný"
    assert items[1]["summary"] == "11 years"
    # Stable identity per occurrence: the same item keeps its id when asked again.
    again = dated(client, "2026-08-22", "2026-08-24").json()["items"]
    assert [i["id"] for i in again] == [first["id"]]


def test_partial_unknown_and_approximate_dates(client):
    person(client, "No", "Year", dates=[("birth", "--05-17", {})])
    person(client, "Only", "Month", dates=[("birth", "1990-05", {})])
    person(client, "Only", "Year", dates=[("birth", "1990", {})])
    person(client, "About", "Born", dates=[("birth", "1980-03-03", {"approximate": True})])
    person(client, "Name", "Day", dates=[("name_day", "--05-17", {})])
    items = dated(client, "2026-01-01", "2027-01-01").json()["items"]
    by_title = {i["title"]: i for i in items}
    assert set(by_title) == {"Birthday · No Year", "Birthday · About Born"}
    # A birthday without a year never gains one: no age is given.
    assert "summary" not in by_title["Birthday · No Year"]
    approx = by_title["Birthday · About Born"]
    assert approx["certainty"] == "estimated" and "summary" not in approx


def test_leap_day_death_and_trash(client):
    leap = person(client, "Leap", "Day", dates=[("birth", "2000-02-29", {})])
    gone = person(
        client, "Gone", "Person", dates=[("birth", "1950-04-10", {}), ("death", "2026-06", {})]
    )
    trashed = person(client, "In", "Trash", dates=[("birth", "1970-08-08", {})])
    client.delete(f"/api/people/{trashed}")
    items = dated(client, "2026-01-01", "2028-03-01").json()["items"]
    leap_items = [i for i in items if i["resource"].endswith(leap)]
    assert [i["start"] for i in leap_items] == ["2026-02-28", "2027-02-28", "2028-02-29"]
    assert "29 February in leap years" in leap_items[0]["summary"]
    assert "29 February" not in leap_items[2].get("summary", "")
    # Nothing after a recorded death; the birthday before it stays.
    assert [i["start"] for i in items if i["resource"].endswith(gone)] == ["2026-04-10"]
    assert not [i for i in items if i["resource"].endswith(trashed)]


def test_dated_items_paging_validation_and_authentication(client, monkeypatch):
    monkeypatch.setattr(shared, "PAGE", 2)
    for n in range(5):
        person(client, f"P{n}", "Page", dates=[("birth", f"1990-01-0{n + 1}", {})])
    first = dated(client, "2026-01-01", "2026-02-01").json()
    assert len(first["items"]) == 2 and first["next_cursor"] == "2"
    rest = []
    cursor = first["next_cursor"]
    while cursor:
        page = dated(client, "2026-01-01", "2026-02-01", cursor).json()
        rest += page["items"]
        cursor = page["next_cursor"]
    assert [i["start"] for i in first["items"] + rest] == [f"2026-01-0{n + 1}" for n in range(5)]
    assert dated(client, "2026-02-01", "2026-01-01").status_code == 422
    assert dated(client, "2026-01-01", "2029-01-01").status_code == 422  # over 800 days
    assert dated(client, "yesterday", "2026-01-01").status_code == 422
    assert dated(client, "2026-01-01", "2026-02-01", headers={}).status_code == 403


# ── people-directory ───────────────────────────────────────────────────


def test_directory_returns_names_only(client):
    vzorko = person(
        client,
        "Vzorko",
        "Kvázimenný",
        notes="secret plan with Anna",
        contacts=[{"channel": "email", "value": "vzorko@example.com"}],
        dates=[("birth", "1987-08-23", {})],
    )
    person(client, "Anna", "Nová")
    found = directory(client, "kvazimenny")
    assert found["items"] == [
        {
            "id": vzorko,
            "resource": f"nexus:v1:meridian:person:{vzorko}",
            "label": "Vzorko Kvázimenný",
            "self": False,
        }
    ]
    # Search covers names only: notes and contact details never match or leak.
    assert directory(client, "secret")["items"] == []
    assert directory(client, "example.com")["items"] == []
    assert set(found["items"][0]) == {"id", "resource", "label", "self"}


def test_directory_order_aliases_trash_and_paging(client):
    me = person(client, "Adrián", "Čech")
    zuzana = person(client, "Zuzana", "Cibuľová")
    trashed = person(client, "Tomáš", "Starý")
    client.delete(f"/api/people/{trashed}")
    org = client.post(
        "/api/entities", json={"kind": "organization", "names": [{"value": "Adrián s.r.o."}]}
    )
    assert org.status_code == 201
    client.put("/api/self", json={"person_id": me})
    assert [x["id"] for x in directory(client, "@me")["items"]] == [me]
    assert directory(client, "@me")["items"][0]["self"] is True
    # People only, live only, in the owner's name order (new installation: first name).
    everyone = directory(client)["items"]
    assert [x["label"] for x in everyone] == ["Adrián Čech", "Zuzana Cibuľová"]
    client.put("/api/settings", json={"people_sort": "family"})
    assert [x["id"] for x in directory(client)["items"]] == [zuzana, me]
    page = directory(client, limit=1)
    assert len(page["items"]) == 1 and page["next_cursor"] == "1"
    assert directory(client, limit=1, cursor="1")["items"][0]["id"] == me
    assert directory(client, "adrian")["items"][0]["id"] == me  # accents ignored
    r = client.post(
        "/empyrean/v1/projections/people-directory",
        headers=RES,
        json={"query": {"limit": "many"}},
    )
    assert r.status_code == 422


# ── Linked from other modules ──────────────────────────────────────────


def test_linked_from_lists_other_modules_with_live_labels(client, monkeypatch):
    vzorko = person(client, "Vzorko", "Kvázimenný")
    target = f"nexus:v1:meridian:person:{vzorko}"
    event = "nexus:v1:chronos:event:0190f0e4-0000-7000-8000-000000000001"
    note = "nexus:v1:mnemosyne:note:0190f0e4-0000-7000-8000-000000000002"
    gone = "nexus:v1:mnemosyne:task:0190f0e4-0000-7000-8000-000000000003"
    own = "nexus:v1:meridian:person:0190f0e4-0000-7000-8000-000000000004"
    calls = []

    def fake(method, path, body=None):
        calls.append((method, path, body))
        if path.startswith("/references?"):
            assert f"resource={target}" in path and "direction=incoming" in path
            return {"references": [
                {"source": event, "target": target, "relation": "chronos.involves"},
                {"source": note, "target": target, "relation": "mnemosyne.related"},
                {"source": gone, "target": target, "relation": "mnemosyne.related"},
                {"source": own, "target": target, "relation": "meridian.something"},
            ]}  # fmt: skip
        if body["resource"] == gone:
            return {"availability": "deleted"}
        return {
            "availability": "available",
            "label": {event: "Lunch", note: "Coffee notes"}[body["resource"]],
        }

    monkeypatch.setattr(nexus, "call", fake)
    result = client.get(f"/api/entities/{vzorko}/linked-from").json()
    assert result["availability"] == "available"
    assert [(x["module"], x["type"], x["label"], x["availability"]) for x in result["items"]] == [
        ("chronos", "event", "Lunch", "available"),
        ("mnemosyne", "note", "Coffee notes", "available"),
        ("mnemosyne", "task", "", "deleted"),
    ]


def test_linked_from_without_nexus(client, monkeypatch):
    vzorko = person(client, "Vzorko", "Kvázimenný")
    assert client.get(f"/api/entities/{vzorko}/linked-from").json() == {
        "availability": "nexus_unreachable",
        "items": [],
    }

    def refused(method, path, body=None):
        raise nexus.NexusRefused(403, "Capability was not granted")

    monkeypatch.setattr(nexus, "call", refused)
    assert client.get(f"/api/entities/{vzorko}/linked-from").json()["availability"] == "not_granted"
    assert client.get("/api/entities/not-an-id/linked-from").status_code == 404


# ── Change announcement and manifest ───────────────────────────────────


def test_person_writes_announce_date_changes(client, monkeypatch):
    seen = []
    monkeypatch.setattr(shared, "announce_dates_changed", lambda: seen.append(1))

    def settle(n):
        deadline = time.time() + 2
        while len(seen) < n and time.time() < deadline:
            time.sleep(0.01)
        return len(seen)

    pid = person(client, "Eva", "Pekná", dates=[("birth", "1960-01-01", {})])
    assert settle(1) == 1
    client.delete(f"/api/people/{pid}")
    assert settle(2) == 2
    client.get(f"/api/people/{pid}")
    client.get("/api/people")
    time.sleep(0.05)
    assert len(seen) == 2  # reads announce nothing
    client.put("/api/people/" + pid, json={"names": [{"value": "x"}]})  # refused: in Trash
    time.sleep(0.05)
    assert len(seen) == 2


def test_announcement_is_best_effort(monkeypatch):
    def down(method, path, body=None):
        raise nexus.NexusUnavailable("down")

    monkeypatch.setattr(nexus, "call", down)
    shared.announce_dates_changed()  # never raises


def test_manifest_declares_the_contracts():
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert m["projections"]["provides"] == ["dated-items", "people-directory", "contact-addresses"]
    assert m["events"]["produces"] == ["meridian.dated-items.changed"]
    assert {"events.publish", "references.read", "references.resolve"} <= set(m["capabilities"])
    assert {"module": "chronos", "type": "event"} in m["references"]["resolve"]
    assert {"module": "mnemosyne", "type": "note"} in m["references"]["resolve"]


# ── contact-addresses (ADR 0030) ──


def addresses_of(client, requester="atlas", query=None, cursor=None):
    return client.post(
        "/empyrean/v1/projections/contact-addresses",
        json={"requester": requester, "query": query or {}, "cursor": cursor},
        headers={"x-nexus-resolver-key": KEY},
    )


def with_address(client, name="Eva Malá", **extra):
    doc = {"street": "Dlhá 5", "locality": "Bratislava", "postal_code": "811 01", "country": "Slovakia", "label": "Home", "is_primary": True, **extra}
    created = client.post("/api/people", json={"names": [{"kind": "full", "given": name}], "addresses": [doc]})
    assert created.status_code in (200, 201), created.text
    return created.json()


def test_contact_addresses_share_geography_and_identity_only(client):
    person = with_address(client)
    out = addresses_of(client).json()
    assert out["next_cursor"] is None and len(out["items"]) == 1
    item = out["items"][0]
    assert set(item) == {"id", "resource", "label", "address_label", "text", "parts", "current", "primary", "open_path", "place_ref", "updated_at"}
    assert item["resource"] == f"nexus:v1:meridian:person:{person['id']}" and item["open_path"] == f"/people/{person['id']}/addresses/{item['id']}"
    assert item["parts"] == {"street": "Dlhá 5", "postal_code": "811 01", "locality": "Bratislava", "region": "", "country": "Slovakia"}
    assert item["current"] is True and item["primary"] is True and item["label"] == "Eva Malá"


def test_contact_addresses_are_for_atlas_only(client):
    with_address(client)
    assert addresses_of(client, requester="chronos").status_code == 403
    assert addresses_of(client, requester=None).status_code == 403
    no_key = client.post("/empyrean/v1/projections/contact-addresses", json={"requester": "atlas", "query": {}})
    assert no_key.status_code == 403


def test_a_past_valid_until_marks_a_former_address(client):
    with_address(client, valid_until="2001-05")
    assert addresses_of(client).json()["items"][0]["current"] is False
    with_address(client, name="Future Person", street="Nová 1", valid_until="2999")
    by_street = {i["parts"]["street"]: i["current"] for i in addresses_of(client).json()["items"]}
    assert by_street == {"Dlhá 5": False, "Nová 1": True}


def test_a_trashed_contact_is_absent_and_ids_stay_stable_on_edit(client):
    person = with_address(client)
    first = addresses_of(client).json()["items"][0]
    doc = client.get(f"/api/people/{person['id']}").json()
    row = doc["addresses"][0]
    saved = client.put(f"/api/people/{person['id']}", json={
        "names": [{"id": doc["names"][0]["id"], "kind": "full", "given": "Eva Malá"}],
        "addresses": [{"id": row["id"], "street": "Krátka 7", "locality": "Bratislava", "label": "Home", "is_primary": True}],
        "expected_revision": doc["edit_revision"],
    })
    assert saved.status_code == 200, saved.text
    after = addresses_of(client).json()["items"][0]
    assert after["id"] == first["id"] and after["parts"]["street"] == "Krátka 7"
    assert client.delete(f"/api/people/{person['id']}").status_code in (200, 204)
    assert addresses_of(client).json()["items"] == []


def test_contact_addresses_page(client):
    for i in range(3):
        with_address(client, name=f"Person {i}", street=f"Ulica {i}")
    first = addresses_of(client, query={"limit": 2}).json()
    assert len(first["items"]) == 2 and first["next_cursor"] == "2"
    second = addresses_of(client, query={"limit": 2}, cursor=first["next_cursor"]).json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert addresses_of(client, query={"limit": "many"}).status_code == 422
