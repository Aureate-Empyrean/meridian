"""0.12.0: real-world address search, stored positions, and reusing existing entities."""

import pytest
from fastapi.testclient import TestClient
from meridian import addresses, nexus
from meridian.app import create_app
from meridian.store import geo_key

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}
RES = {"x-nexus-resolver-key": KEY}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as c:
        c.headers.update(GW)
        yield c


class Atlas:
    """Atlas as Meridian sees it, through nexus.call."""

    def __init__(self, items=None, status=None, raises=None):
        self.calls = []
        self.items = items or []
        self.status = {
            "kind": "status",
            "online": True,
            "provider": "Photon",
            "attribution": "Photon · OSM",
            "outcome": "ok",
            **(status or {}),
        }
        self.raises = raises

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.raises:
            raise self.raises
        return {
            "availability": "available",
            "items": [self.status, *self.items],
            "next_cursor": None,
        }


SUGGESTION = {
    "kind": "suggestion",
    "street": "Dlhá 5",
    "postal_code": "811 01",
    "locality": "Testovo",
    "region": "",
    "country": "Slovakia",
    "label": "Dlhá 5",
    "detail": "811 01 Testovo, Slovakia",
    "latitude": 48.1,
    "longitude": 17.1,
    "precision": "house",
}


def consent(client, enabled=True):
    assert client.put("/api/address-search/consent", json={"enabled": enabled}).status_code == 200


def search(client, q="Dlhá 5"):
    return client.post("/api/address-search", json={"q": q}).json()


def test_nothing_is_sent_before_consent(client, monkeypatch):
    atlas = Atlas([SUGGESTION])
    monkeypatch.setattr(nexus, "call", atlas)
    assert search(client) == {"availability": "consent_required", "items": []}
    assert atlas.calls == []


def test_only_the_typed_text_is_sent(client, monkeypatch):
    client.post("/api/people", json={"names": [{"kind": "full", "given": "Synthetic Person"}]})
    atlas = Atlas([SUGGESTION])
    monkeypatch.setattr(nexus, "call", atlas)
    consent(client)
    out = search(client, "  Dlhá   5 ")
    assert out["availability"] == "available" and out["items"][0]["locality"] == "Testovo"
    assert atlas.calls == [
        (
            "POST",
            "/projections/query",
            {
                "module": "atlas",
                "projection": "address-suggest",
                "query": {"q": "Dlhá 5"},
                "cursor": None,
            },
        )
    ]


def test_withdrawing_consent_stops_requests(client, monkeypatch):
    atlas = Atlas([SUGGESTION])
    monkeypatch.setattr(nexus, "call", atlas)
    consent(client)
    consent(client, False)
    assert search(client)["availability"] == "consent_required" and atlas.calls == []


def test_a_short_query_is_not_sent(client, monkeypatch):
    atlas = Atlas()
    monkeypatch.setattr(nexus, "call", atlas)
    consent(client)
    assert search(client, "Dl") == {"availability": "available", "items": []} and atlas.calls == []


@pytest.mark.parametrize("outcome", ["offline", "busy", "atlas_offline"])
def test_provider_outcomes_are_reported_without_results(client, monkeypatch, outcome):
    monkeypatch.setattr(nexus, "call", Atlas(status={"outcome": outcome}))
    consent(client)
    assert search(client) == {"availability": outcome, "items": []}


@pytest.mark.parametrize(
    ("error", "expected"),
    [(nexus.NexusUnavailable("x"), "unavailable"), (nexus.NexusRefused(403, "x"), "not_granted")],
)
def test_failures_never_raise(client, monkeypatch, error, expected):
    monkeypatch.setattr(nexus, "call", Atlas(raises=error))
    consent(client)
    assert search(client) == {"availability": expected, "items": []}


def test_status_reports_consent_and_atlas_state(client, monkeypatch):
    monkeypatch.setattr(nexus, "call", Atlas(status={"online": False}))
    assert client.get("/api/address-search/status").json()["availability"] == "atlas_offline"
    monkeypatch.setattr(nexus, "call", Atlas())
    consent(client)
    out = client.get("/api/address-search/status").json()
    assert (
        out["consent"] is True
        and out["availability"] == "available"
        and out["provider"] == "Photon"
    )


def test_the_query_length_is_limited(client, monkeypatch):
    atlas = Atlas()
    monkeypatch.setattr(nexus, "call", atlas)
    consent(client)
    search(client, "a" * 200)
    assert len(atlas.calls[0][2]["query"]["q"]) == addresses.MAX_QUERY
    assert client.post("/api/address-search", json={"q": "a" * 201}).status_code == 422


BASE = {
    "street": "Dlhá 5",
    "postal_code": "811 01",
    "locality": "Testovo",
    "region": "",
    "country": "Slovakia",
    "label": "home",
    "is_primary": True,
}
PLACED = {
    **BASE,
    "latitude": 48.1,
    "longitude": 17.1,
    "geo_precision": "house",
    "geo_key": geo_key(BASE),
}
NAMES = [{"kind": "full", "given": "Synthetic Person"}]


def create(client, *rows):
    r = client.post("/api/people", json={"names": NAMES, "addresses": list(rows)})
    assert r.status_code == 201, r.text
    return r.json()


def addresses_of(client):
    return client.post(
        "/empyrean/v1/projections/contact-addresses",
        headers=RES,
        json={"requester": "atlas", "query": {}, "cursor": None},
    ).json()["items"]


def test_a_chosen_position_is_stored_and_shared_with_atlas(client):
    person = create(client, PLACED)
    stored = person["addresses"][0]
    assert stored["latitude"] == 48.1 and stored["geo_precision"] == "house"
    item = addresses_of(client)[0]
    assert item["position"] == {"latitude": 48.1, "longitude": 17.1, "precision": "house"}
    assert item["open_path"] == f"/people/{person['id']}/addresses/{stored['id']}"


def test_an_address_entered_by_hand_has_no_position(client):
    create(client, BASE)
    assert "position" not in addresses_of(client)[0]


@pytest.mark.parametrize("field", ["street", "postal_code", "locality", "region", "country"])
def test_a_changed_address_cannot_keep_its_position(client, field):
    person = create(client, PLACED)
    row = {**PLACED, "id": person["addresses"][0]["id"], field: "Changed"}
    saved = client.put(
        f"/api/people/{person['id']}", json={"names": NAMES, "addresses": [row]}
    ).json()
    stored = saved["addresses"][0]
    assert (
        stored["latitude"] is None
        and stored["longitude"] is None
        and stored["geo_precision"] == ""
        and stored["geo_key"] == ""
    )
    assert "position" not in addresses_of(client)[0]


def test_a_position_survives_changes_that_do_not_move_the_address(client):
    person = create(client, PLACED)
    row = {**PLACED, "id": person["addresses"][0]["id"], "label": "work", "extended": "2nd floor"}
    stored = client.put(
        f"/api/people/{person['id']}", json={"names": NAMES, "addresses": [row]}
    ).json()["addresses"][0]
    assert stored["latitude"] == 48.1


def test_a_half_position_is_refused(client):
    person = create(client, {**PLACED, "longitude": None})
    assert person["addresses"][0]["latitude"] is None


def test_coordinates_are_validated(client):
    r = client.post("/api/people", json={"names": NAMES, "addresses": [{**PLACED, "latitude": 95}]})
    assert r.status_code == 422


def test_several_addresses_keep_their_own_identity(client):
    other = {**BASE, "street": "Krátka 2", "is_primary": False, "valid_until": "2001"}
    person = create(client, PLACED, other)
    items = {i["parts"]["street"]: i for i in addresses_of(client)}
    assert {i["id"] for i in items.values()} == {a["id"] for a in person["addresses"]}
    assert items["Dlhá 5"]["primary"] is True and items["Krátka 2"]["primary"] is False
    assert items["Dlhá 5"]["current"] is True and items["Krátka 2"]["current"] is False


def test_trash_hides_addresses_and_restore_brings_them_back(client):
    person = create(client, PLACED)
    assert client.delete(f"/api/people/{person['id']}").status_code == 200
    assert addresses_of(client) == []
    assert client.post(f"/api/people/{person['id']}/restore").status_code == 200
    assert addresses_of(client)[0]["position"]["latitude"] == 48.1


def test_a_removed_address_is_gone(client):
    person = create(client, PLACED)
    client.put(f"/api/people/{person['id']}", json={"names": NAMES, "addresses": []})
    assert addresses_of(client) == []


# ── Existing Organizations ──


def organizations(client):
    return client.get("/api/search", params={"q": "synth", "kinds": "organization"}).json()[
        "entities"
    ]


def person_with(client, section, **row):
    r = client.post("/api/people", json={"names": NAMES, section: [row]})
    assert r.status_code == 201, r.text
    return r.json()[section][0]


@pytest.mark.parametrize("section", ["employments", "education"])
def test_choosing_an_organization_reuses_it(client, section):
    first = person_with(client, section, organization="Synthetic Works")
    second = person_with(
        client, section, organization="Synthetic Works", organization_id=first["organization_id"]
    )
    assert second["organization_id"] == first["organization_id"]
    assert len(organizations(client)) == 1


def test_the_same_name_in_other_case_or_accents_is_the_same_organization(client):
    first = person_with(client, "employments", organization="Synthetická Škola")
    second = person_with(client, "education", organization="syntheticka skola")
    assert second["organization_id"] == first["organization_id"]


def test_similar_names_are_never_merged(client):
    first = person_with(client, "employments", organization="Synthetic Works")
    second = person_with(client, "employments", organization="Synthetic Works Ltd")
    assert second["organization_id"] != first["organization_id"]
    assert len(organizations(client)) == 2


def test_a_job_keeps_its_own_details_when_the_organization_is_reused(client):
    first = person_with(client, "employments", organization="Synthetic Works", title="Engineer")
    second = person_with(
        client,
        "employments",
        organization="Synthetic Works",
        organization_id=first["organization_id"],
        title="Designer",
        department="Studio",
    )
    assert second["title"] == "Designer" and second["department"] == "Studio"


def test_changing_the_name_detaches_the_old_organization(client):
    first = person_with(client, "employments", organization="Synthetic Works")
    second = person_with(
        client,
        "employments",
        organization="Synthetic Other",
        organization_id=first["organization_id"],
    )
    assert second["organization_id"] != first["organization_id"]


def test_search_tolerates_case_and_accents(client):
    person_with(client, "education", organization="Synthetická Škola")
    found = client.get("/api/search", params={"q": "SYNTHETICKA", "kinds": "organization"}).json()[
        "entities"
    ]
    assert [e["display_name"] for e in found] == ["Synthetická Škola"]


def test_a_trashed_organization_is_not_offered(client):
    org = person_with(client, "employments", organization="Synthetic Works")["organization_id"]
    assert client.delete(f"/api/entities/{org}").status_code == 200
    assert organizations(client) == []
    assert client.post(f"/api/entities/{org}/restore").status_code == 200
    assert len(organizations(client)) == 1


# ── Groups ──


def group(client, name):
    r = client.post(
        "/api/entities", json={"kind": "group", "names": [{"kind": "full", "value": name}]}
    )
    assert r.status_code == 201, r.text
    return r.json()


def join(client, group_id, member_id):
    return client.post("/api/memberships", json={"group_id": group_id, "member_id": member_id})


def groups_of(client, person_id):
    return [m["group"]["id"] for m in client.get(f"/api/people/{person_id}").json()["memberships"]]


def test_a_contact_can_be_in_several_existing_groups(client):
    person = create(client, BASE)
    a, b = group(client, "Synthetic Club"), group(client, "Synthetic Choir")
    assert join(client, a["id"], person["id"]).status_code == 201
    assert join(client, b["id"], person["id"]).status_code == 201
    assert set(groups_of(client, person["id"])) == {a["id"], b["id"]}


def test_groups_and_organizations_stay_apart(client):
    group(client, "Synthetic Club")
    person_with(client, "employments", organization="Synthetic Works")
    found = client.get("/api/search", params={"q": "synthetic", "kinds": "group"}).json()[
        "entities"
    ]
    assert [e["kind"] for e in found] == ["group"]


def test_removing_a_membership_keeps_the_group(client):
    person = create(client, BASE)
    g = group(client, "Synthetic Club")
    membership = join(client, g["id"], person["id"]).json()
    assert client.delete(f"/api/memberships/{membership['id']}").status_code in (200, 204)
    assert groups_of(client, person["id"]) == []
    assert client.get(f"/api/entities/{g['id']}").status_code == 200


def test_a_renamed_group_keeps_its_members(client):
    person = create(client, BASE)
    g = group(client, "Synthetic Club")
    join(client, g["id"], person["id"])
    client.put(
        f"/api/entities/{g['id']}",
        json={"kind": "group", "names": [{"kind": "full", "value": "Synthetic Society"}]},
    )
    assert groups_of(client, person["id"]) == [g["id"]]
    assert (
        client.get("/api/search", params={"q": "society", "kinds": "group"}).json()["entities"][0][
            "id"
        ]
        == g["id"]
    )
