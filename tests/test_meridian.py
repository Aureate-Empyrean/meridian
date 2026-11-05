import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from meridian import vcard
from meridian.app import create_app

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}
RES = {"x-nexus-resolver-key": KEY}
FIXTURES = Path(__file__).parent / "fixtures"
MIXED = (FIXTURES / "mixed.vcf").read_text(encoding="utf-8")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as client:
        client.headers.update(GW)
        yield client, tmp_path


def person(**extra):
    doc = {"names": [{"kind": "full", "given": "Jana", "family": "Nováková"}]}
    doc.update(extra)
    return doc


def create(client, **extra):
    response = client.post("/api/people", json=person(**extra))
    assert response.status_code == 201, response.text
    return response.json()


def count(client):
    return client.get("/api/state").json()["counts"]["people"]


# ── Access ─────────────────────────────────────────────────────────────


def test_personal_data_needs_the_nexus_gateway(env, tmp_path, monkeypatch):
    client, _ = env
    create(client)
    anonymous = TestClient(client.app)
    assert anonymous.get("/api/people").status_code == 403
    assert anonymous.get("/api/people", headers={"x-nexus-gateway-key": "wrong"}).status_code == 403
    assert anonymous.post("/empyrean/v1/backup/export").status_code == 403
    assert anonymous.post("/empyrean/v1/resources/resolve", json={}).status_code == 403
    # Without a configured key nothing is reachable at all.
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", "")
    assert client.get("/api/people").status_code == 403
    # The page and the health check carry no personal data.
    assert anonymous.get("/health").json()["status"] == "ok"


# ── People CRUD ────────────────────────────────────────────────────────


def test_create_view_edit_search_and_delete(env):
    client, _ = env
    created = create(
        client,
        contacts=[
            {
                "channel": "phone",
                "value": "+421 905 111 222",
                "label": "Mobile",
                "is_primary": True,
            },
            {"channel": "phone", "value": "02 1234 5678", "label": "work"},
            {"channel": "email", "value": "jana@example.org", "label": "home"},
            {"channel": "email", "value": "jana@example.com", "label": "work", "is_primary": True},
            {"channel": "website", "value": "example.org/jana"},
        ],
        dates=[{"kind": "birth", "date": "1988-05-17"}, {"kind": "name_day", "date": "--05-24"}],
        employments=[{"organization": "Example Labs", "title": "Designer"}],
        accounts=[{"service": "mastodon", "handle": "@jana@example.social"}],
        facts=[{"key": "favourite tea", "value": "jasmine"}],
        notes="Synthetic person.",
    )
    pid = created["id"]
    assert created["display_name"] == "Jana Nováková"
    assert [c["value"] for c in created["contacts"] if c["channel"] == "phone"] == [
        "+421 905 111 222",
        "02 1234 5678",
    ]
    assert created["contacts"][0]["label"] == "mobile"
    assert created["contacts"][4]["value"] == "https://example.org/jana"
    assert created["employments"][0]["organization"] == "Example Labs"
    assert created["created_at"] and created["updated_at"]

    # Edit: keep record ids, change one value, remove one, add one.
    doc = {
        k: created[k]
        for k in (
            "names",
            "contacts",
            "addresses",
            "dates",
            "employments",
            "accounts",
            "facts",
            "notes",
        )
    }
    read_only = (
        "source",
        "created_at",
        "updated_at",
        "organization_id",
        "position",
        "hermes_ref",
        "place_ref",
    )

    def strip(items):
        return [{k: v for k, v in i.items() if k not in read_only} for i in items]

    doc = {k: strip(v) if isinstance(v, list) else v for k, v in doc.items()}
    doc["names"].append({"kind": "preferred", "value": "Janka"})
    doc["contacts"][1]["value"] = "02 9999 0000"
    del doc["contacts"][2]
    response = client.put(f"/api/people/{pid}", json=doc)
    assert response.status_code == 200, response.text
    updated = response.json()
    phones = [c for c in updated["contacts"] if c["channel"] == "phone"]
    assert phones[1]["value"] == "02 9999 0000" and phones[1]["id"] == created["contacts"][1]["id"]
    assert [c["value"] for c in updated["contacts"] if c["channel"] == "email"] == [
        "jana@example.com"
    ]
    assert any(n["kind"] == "preferred" for n in updated["names"])

    # Search: accents, phone digits, organization, nickname; filters.
    for q in ("novakova", "NOVÁKOVÁ", "905111222", "example labs", "janka", "jasmine"):
        assert [p["id"] for p in client.get("/api/people", params={"q": q}).json()["items"]] == [
            pid
        ], q
    assert client.get("/api/people", params={"q": "nobody"}).json()["total"] == 0
    assert client.get("/api/people", params={"has": "birthday,work"}).json()["total"] == 1
    assert client.get("/api/people", params={"has": "nonsense"}).status_code == 422
    assert client.get("/api/search", params={"q": "jan"}).json()["people"][0]["id"] == pid

    # Delete: to Trash (recoverable), then permanently.
    assert client.delete(f"/api/people/{pid}").json() == {"trashed": True}
    assert count(client) == 0
    assert client.get("/api/people").json()["total"] == 0
    assert client.get("/api/trash").json()["items"][0]["id"] == pid
    assert client.post(f"/api/people/{pid}/restore").status_code == 200
    assert count(client) == 1
    assert client.delete(f"/api/trash/{pid}").status_code == 409  # not in Trash
    client.delete(f"/api/people/{pid}")
    assert client.delete(f"/api/trash/{pid}").json() == {"deleted": True}
    assert client.get(f"/api/people/{pid}").status_code == 404
    gone = client.post("/empyrean/v1/resources/resolve", headers=RES,
                       json={"resource": f"nexus:v1:meridian:person:{pid}"})  # fmt: skip
    assert gone.status_code == 410


def test_only_one_primary_per_channel(env):
    client, _ = env
    p = create(client, contacts=[
        {"channel": "email", "value": "a@example.org", "is_primary": True},
        {"channel": "email", "value": "b@example.org", "is_primary": True},
        {"channel": "phone", "value": "0900 000 000", "is_primary": True},
    ])  # fmt: skip
    assert [c["is_primary"] for c in p["contacts"]] == [True, False, True]


@pytest.mark.parametrize(
    "doc, message",
    [
        ({"names": []}, "needs a name"),
        ({"names": [{"kind": "full"}]}, "Name 1"),
        (
            person(contacts=[{"channel": "email", "value": "not-an-address"}]),
            "Contact 1: Enter an email",
        ),
        (person(contacts=[{"channel": "phone", "value": "call me"}]), "Contact 1: Enter a phone"),
        (person(contacts=[{"channel": "website", "value": "javascript:alert(1)"}]), "web address"),
        (
            person(dates=[{"kind": "birth", "date": "2023-02-30"}]),
            "Date 1: Not a real calendar day",
        ),
        (person(dates=[{"kind": "birth", "date": "17.5.1990"}]), "Use YYYY"),
        (person(dates=[{"kind": "birth"}]), "needs a value"),
        (person(accounts=[{"service": "github", "url": "data:text/html,x"}]), "web address"),
        (person(unknown_field=1), "Extra inputs"),
        (person(names=[{"kind": "full", "value": "x" * 301}]), "Name 1"),
    ],
)
def test_validation_is_readable_and_writes_nothing(env, doc, message):
    client, _ = env
    response = client.post("/api/people", json=doc)
    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert count(client) == 0


def test_failed_update_leaves_the_person_unchanged(env):
    client, _ = env
    p = create(client, contacts=[{"channel": "email", "value": "keep@example.org"}])
    bad = person(contacts=[{"channel": "email", "value": "broken"}])
    assert client.put(f"/api/people/{p['id']}", json=bad).status_code == 422
    assert client.get(f"/api/people/{p['id']}").json()["contacts"][0]["value"] == "keep@example.org"
    assert (
        client.put("/api/people/00000000-0000-7000-8000-000000000000", json=person()).status_code
        == 404
    )
    assert client.get("/api/people/not-a-uuid").status_code == 404


def test_partial_dates_and_upcoming_personal_dates(env):
    client, _ = env
    a = create(client, dates=[{"kind": "birth", "date": "1990-05-17"}])
    create(
        client,
        names=[{"kind": "full", "value": "Year Only"}],
        dates=[{"kind": "birth", "date": "1975"}],
    )
    create(
        client,
        names=[{"kind": "full", "value": "Month Only"}],
        dates=[{"kind": "birth", "date": "1980-06"}],
    )
    create(
        client,
        names=[{"kind": "full", "value": "No Year"}],
        dates=[{"kind": "name_day", "date": "--05-20"}],
    )
    create(
        client,
        names=[{"kind": "full", "value": "Leap"}],
        dates=[{"kind": "birth", "date": "2000-02-29"}],
    )
    create(client, names=[{"kind": "full", "value": "Vague"}],
           dates=[{"kind": "birth", "description": "summer, late 1960s", "approximate": True}])  # fmt: skip
    board = client.get("/api/dashboard", params={"today": "2026-05-15"}).json()
    upcoming = [(u["display_name"], u["on"], u["years"]) for u in board["upcoming"]]
    assert upcoming[:2] == [("Jana Nováková", "2026-05-17", 36), ("No Year", "2026-05-20", None)]
    assert all(
        name not in [u[0] for u in upcoming] for name in ("Year Only", "Month Only", "Vague")
    )
    leap = client.get("/api/dashboard", params={"today": "2027-02-20"}).json()["upcoming"]
    assert ("Leap", "2027-02-28") in [(u["display_name"], u["on"]) for u in leap]
    assert client.get("/api/dashboard", params={"today": "tomorrow"}).status_code == 422
    stored = client.get(f"/api/people/{a['id']}").json()["dates"][0]
    assert stored["date"] == "1990-05-17"


def test_self_profile_is_one_ordinary_person(env):
    client, _ = env
    a, b = create(client), create(client, names=[{"kind": "full", "value": "Other Person"}])
    assert client.put("/api/self", json={"person_id": a["id"]}).json()["self"]["id"] == a["id"]
    assert client.put("/api/self", json={"person_id": b["id"]}).json()["self"]["id"] == b["id"]
    assert client.get(f"/api/people/{a['id']}").json()["is_self"] is False
    assert (
        client.put(
            "/api/self", json={"person_id": "00000000-0000-7000-8000-000000000000"}
        ).status_code
        == 404
    )
    client.delete(f"/api/people/{b['id']}")
    assert client.get("/api/state").json()["self"] is None
    assert client.put("/api/self", json={"person_id": b["id"]}).status_code == 404  # in Trash
    assert client.put("/api/self", json={"person_id": None}).json()["self"] is None


def test_data_survives_a_restart(env, tmp_path):
    client, _ = env
    p = create(client, contacts=[{"channel": "phone", "value": "0900 123 456"}])
    with TestClient(create_app(tmp_path)) as again:
        again.headers.update(GW)
        assert again.get(f"/api/people/{p['id']}").json()["contacts"][0]["value"] == "0900 123 456"


# ── vCard import ───────────────────────────────────────────────────────


def preview(client, content=MIXED, filename="contacts.vcf"):
    response = client.post("/api/import/preview", json={"filename": filename, "content": content})
    assert response.status_code == 200, response.text
    return response.json()


def commit(client, data, decisions, content=MIXED):
    return client.post("/api/import/commit", json={
        "filename": data["filename"], "content": content, "sha256": data["sha256"], "decisions": decisions,
    })  # fmt: skip


def defaults(data):
    return [{"index": c["index"], "action": c["default_action"]} for c in data["contacts"]]


def test_preview_reads_every_format_and_writes_nothing(env):
    client, _ = env
    data = preview(client)
    assert count(client) == 0 and client.get("/api/imports").json()["items"] == []
    assert data["total"] == 6
    by_name = {}
    for c in data["contacts"]:
        by_name.setdefault(c["display_name"], c)
    alzbeta = by_name["Ing. Alžbeta Testová PhD."]["summary"]
    assert alzbeta["phones"] == ["+421 905 000 111", "+421 2 0000 0000", "02/0000 0001"]
    assert alzbeta["emails"] == ["alzbeta.testova@example.org", "a.testova@example.com"]
    assert alzbeta["work"] == ["Research Engineer · Example Fabrikát s.r.o."]
    assert alzbeta["nicknames"] == ["Betka", "Ala"]
    assert "Bratislava" in alzbeta["addresses"][0]
    assert "Ján Malý" in by_name  # vCard 2.1 quoted-printable UTF-8
    assert by_name["Peter Example"]["summary"]["dates"][0]["date"] == "--04-03"
    apple = by_name["Anna Apple"]
    assert apple["summary"]["dates"][-1]["date"] == "--12-24"  # Apple's year-omitted birthday
    assert {"name": "URL", "params": {"type": "pref"}, "value": "javascript:alert(1)"} in apple[
        "unmapped"
    ]
    company = by_name["Example Industries"]
    assert company["kind"] == "organization" and company["default_action"] == "skip"
    # Unsupported properties are reported, not silently dropped.
    assert data["unsupported"] == {
        "CATEGORIES": 1,
        "GENDER": 1,
        "PHOTO": 1,
        "X-CUSTOM-THING": 1,
        "URL": 1,
    }
    assert "PRODID" in data["technical"]
    # The second Peter card shares an email with the first one in the same file.
    peters = [c for c in data["contacts"] if c["display_name"] == "Peter Example"]
    assert peters[1]["in_file"] == [peters[0]["index"]]


def test_import_creates_people_with_provenance_and_unmapped_data(env):
    client, _ = env
    data = preview(client)
    result = commit(client, data, defaults(data)).json()
    assert (result["created"], result["skipped"], result["merged"]) == (5, 1, 0)
    assert count(client) == 5
    alzbeta = next(p for p in client.get("/api/people", params={"q": "alzbeta"}).json()["items"])
    full = client.get(f"/api/people/{alzbeta['id']}").json()
    assert full["names"][0]["family"] == "Testová" and full["names"][0]["prefix"] == "Ing."
    assert full["contacts"][0]["source"] == {"kind": "vcard-import", "label": "contacts.vcf"}
    assert full["dates"][0]["date"] == "1990-05-17"
    assert (
        full["employments"][0] | {"organization": "Example Fabrikát s.r.o."}
        == full["employments"][0]
    )
    assert full["identifiers"] == [
        {"id": full["identifiers"][0]["id"], "system": "vcard-uid", "value": "synthetic-uid-0001"}
    ]
    imported = {i["name"]: i for i in full["imported"]}
    assert imported["GENDER"]["value"] == "F" and imported["CATEGORIES"]["value"] == "friends,work"
    # The photo itself is not stored in Meridian.
    assert "not imported" in imported["PHOTO"]["value"] and "/9j/" not in imported["PHOTO"]["value"]
    history = client.get("/api/imports").json()["items"][0]
    assert (history["total"], history["created"], history["skipped"]) == (6, 5, 1)
    detail = client.get(f"/api/imports/{history['id']}").json()
    assert [i["action"] for i in detail["items"]].count("skip") == 1
    # Unmapped data can be reviewed and removed.
    after = client.delete(f"/api/people/{alzbeta['id']}/imported/{imported['GENDER']['id']}").json()
    assert "GENDER" not in {i["name"] for i in after["imported"]}
    # An edited imported value becomes the user's own.
    doc = {k: [{kk: vv for kk, vv in i.items() if kk not in ("source", "created_at", "updated_at", "organization_id", "position", "hermes_ref", "place_ref")}
               for i in full[k]] for k in ("names", "contacts", "addresses", "dates", "employments", "accounts", "facts")}  # fmt: skip
    doc["notes"] = full["notes"]
    doc["contacts"][0]["value"] = "+421 905 000 112"
    edited = client.put(f"/api/people/{alzbeta['id']}", json=doc).json()
    assert edited["contacts"][0]["source"] is None
    assert edited["contacts"][1]["source"]["kind"] == "vcard-import"


def test_reimport_finds_duplicates_and_never_overwrites(env):
    client, _ = env
    data = preview(client)
    commit(client, data, defaults(data))
    again = preview(client)
    strong = [
        c
        for c in again["contacts"]
        if c["candidates"] and c["candidates"][0]["strength"] == "strong"
    ]
    assert len(strong) == 5 and all(c["default_action"] == "skip" for c in strong)
    reasons = " ".join(r for c in again["contacts"] for m in c["candidates"] for r in m["reasons"])
    assert (
        "same contact ID" in reasons
        and "same email address" in reasons
        and "same phone number" in reasons
    )
    result = commit(client, again, defaults(again)).json()
    assert (result["created"], result["skipped"]) == (0, 6)
    assert count(client) == 5


def test_name_alone_is_only_a_weak_hint(env):
    client, _ = env
    create(
        client,
        names=[{"kind": "full", "value": "Peter Example"}],
        contacts=[{"channel": "email", "value": "other@example.org"}],
    )
    data = preview(
        client, "BEGIN:VCARD\nVERSION:3.0\nFN:Peter Example\nTEL:0911 222 333\nEND:VCARD\n"
    )
    card = data["contacts"][0]
    assert card["candidates"][0]["strength"] == "weak" and card["default_action"] == "create"


def test_merge_adds_without_duplicating_or_overwriting(env):
    client, _ = env
    existing = create(
        client,
        names=[{"kind": "full", "value": "Peter Example"}],
        contacts=[
            {"channel": "email", "value": "PETER@example.net"},
            {"channel": "phone", "value": "0905 000 222"},
        ],
        dates=[{"kind": "birth", "date": "1985-04-03"}],
        notes="Known from work.",
    )
    content = ("BEGIN:VCARD\nVERSION:3.0\nFN:Pete Example\nEMAIL:peter@example.net\nTEL:+421 905 000 222\n"
               "TEL;TYPE=HOME:02 5555 0000\nBDAY:--04-04\nNOTE:Plays chess.\nEND:VCARD\n")  # fmt: skip
    data = preview(client, content)
    card = data["contacts"][0]
    assert card["candidates"][0]["id"] == existing["id"] and card["default_action"] == "skip"
    result = commit(
        client, data, [{"index": 0, "action": "merge", "target": existing["id"]}], content
    ).json()
    assert result["merged"] == 1 and count(client) == 1
    merged = client.get(f"/api/people/{existing['id']}").json()
    assert merged["display_name"] == "Peter Example"  # not overwritten
    assert [n["value"] for n in merged["names"]] == ["Peter Example", "Pete Example"]
    assert merged["names"][1]["kind"] == "alias"
    assert [c["value"] for c in merged["contacts"]] == [
        "PETER@example.net",
        "0905 000 222",
        "02 5555 0000",
    ]
    # Conflicting birthdays are both kept, each with its source.
    assert [(d["date"], (d["source"] or {}).get("kind")) for d in merged["dates"]] == [
        ("1985-04-03", None),
        ("--04-04", "vcard-import"),
    ]
    assert merged["notes"] == "Known from work.\n\nPlays chess."


def test_commit_is_all_or_nothing(env):
    client, _ = env
    data = preview(client)
    decisions = defaults(data)
    decisions[1] = {"index": 1, "action": "merge", "target": "00000000-0000-7000-8000-000000000000"}
    response = commit(client, data, decisions)
    assert response.status_code == 422 and "no longer exists" in response.json()["detail"]
    assert count(client) == 0 and client.get("/api/imports").json()["items"] == []
    # Every contact needs exactly one decision; the file must be the previewed one.
    assert commit(client, data, decisions[:-1]).status_code == 422
    assert (
        commit(client, data, defaults(data) + [{"index": 0, "action": "skip"}]).status_code == 422
    )
    assert (
        commit(client, data, [{**d, "action": "overwrite"} for d in defaults(data)]).status_code
        == 422
    )
    changed = commit(client, data, defaults(data), MIXED.replace("Peter", "Petra"))
    assert changed.status_code == 422 and "changed since the preview" in changed.json()["detail"]
    assert count(client) == 0


@pytest.mark.parametrize(
    "content, message",
    [
        ((FIXTURES / "broken.vcf").read_text(), "ends inside a contact"),
        ("hello world", "No contacts"),
        ("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD\n", None),
    ],
)
def test_malformed_files_are_reported_safely(env, content, message):
    client, _ = env
    response = client.post("/api/import/preview", json={"filename": "x.vcf", "content": content})
    if message:
        assert response.status_code == 422 and message in response.json()["detail"]
    else:
        card = response.json()["contacts"][0]
        assert card["importable"] is False and card["default_action"] == "skip"
        data = response.json()
        bad = commit(client, data, [{"index": 0, "action": "create"}], content)
        assert bad.status_code == 422
    assert count(client) == 0


def test_limits_bound_resource_use(env, monkeypatch):
    client, _ = env
    big = "BEGIN:VCARD\nFN:x\nNOTE:" + "a" * (vcard.MAX_BYTES) + "\nEND:VCARD\n"
    assert (
        client.post("/api/import/preview", json={"filename": "x.vcf", "content": big}).status_code
        == 422
    )
    monkeypatch.setattr(vcard, "MAX_CARDS", 3)
    many = "".join(f"BEGIN:VCARD\nFN:P{i}\nEND:VCARD\n" for i in range(5))
    response = client.post("/api/import/preview", json={"filename": "x.vcf", "content": many})
    assert response.status_code == 422 and "more than 3" in response.json()["detail"]
    long_value = "BEGIN:VCARD\nFN:Long\nX-BLOB:" + "b" * (vcard.MAX_VALUE + 1) + "\nEND:VCARD\n"
    card = preview(client, long_value)["contacts"][0]
    assert card["warnings"] and card["display_name"] == "Long"


def test_imported_markup_is_data_not_html(env):
    client, _ = env
    content = "BEGIN:VCARD\nVERSION:3.0\nFN:<img src=x onerror=alert(1)>\nNOTE:<script>alert(1)</script>\nEND:VCARD\n"
    data = preview(client, content)
    commit(client, data, defaults(data), content)
    stored = client.get("/api/people").json()["items"][0]
    assert (
        stored["display_name"] == "<img src=x onerror=alert(1)>"
    )  # stored verbatim; escaped when rendered


# ── Module protocol ────────────────────────────────────────────────────


def test_resolve_gives_a_label_only(env):
    client, _ = env
    p = create(client, contacts=[{"channel": "email", "value": "secret@example.org"}])
    ref = f"nexus:v1:meridian:person:{p['id']}"
    resolved = client.post(
        "/empyrean/v1/resources/resolve", headers=RES, json={"resource": ref}
    ).json()
    assert resolved == {
        "resource": ref,
        "label": "Jana Nováková",
        "open_path": f"/people/{p['id']}",
    }
    assert client.post("/empyrean/v1/resources/resolve", headers=RES,
                       json={"resource": "nexus:v1:chronos:event:x"}).status_code == 404  # fmt: skip
    client.delete(f"/api/people/{p['id']}")
    assert (
        client.post(
            "/empyrean/v1/resources/resolve", headers=RES, json={"resource": ref}
        ).status_code
        == 404
    )


def test_backup_round_trip(env):
    client, _ = env
    p = create(client)
    exported = client.post("/empyrean/v1/backup/export", headers=RES)
    headers = {
        k: v for k, v in exported.headers.items() if k.lower().startswith("x-empyrean-backup-")
    }
    assert headers["x-empyrean-backup-module"] == "meridian"
    client.delete(f"/api/people/{p['id']}")
    client.delete(f"/api/trash/{p['id']}")
    assert client.post(
        "/empyrean/v1/backup/validate", headers={**RES, **headers}, content=exported.content
    ).json() == {"valid": True}
    assert (
        client.post(
            "/empyrean/v1/backup/validate", headers={**RES, **headers}, content=b"not sqlite"
        ).status_code
        == 422
    )
    wrong = {**headers, "x-empyrean-backup-module": "chronos"}
    assert (
        client.post(
            "/empyrean/v1/backup/validate", headers={**RES, **wrong}, content=exported.content
        ).status_code
        == 422
    )
    assert client.post(
        "/empyrean/v1/backup/restore", headers={**RES, **headers}, content=exported.content
    ).json() == {"restored": True}
    assert client.get(f"/api/people/{p['id']}").json()["display_name"] == "Jana Nováková"


def test_page_is_self_contained(env):
    client, _ = env
    page = TestClient(client.app).get("/people/anything").text
    assert len(page.encode()) < 2 * 1024 * 1024
    assert "Aureate Empyrean shared design tokens" in page and "data:font/woff2;base64," in page
    assert "--accent: #c48663" in page.lower()
    assert not re.search(r"""(src|href)=["']https?://""", page)
    defined = set(re.findall(r"(--[a-z0-9-]+)\s*:", page))
    used = set(re.findall(r"var\((--[a-z0-9-]+)", page))
    assert used <= defined, sorted(used - defined)
    icon = TestClient(client.app).get("/icon.svg")
    assert icon.headers["content-type"].startswith("image/svg+xml") and "<script" not in icon.text
