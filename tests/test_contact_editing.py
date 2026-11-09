"""Atomic unified-contact saves and optimistic concurrency through the existing API."""

import pytest
from fastapi.testclient import TestClient
from meridian import store
from meridian.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", "k" * 40)
    with TestClient(create_app(tmp_path), raise_server_exceptions=False) as c:
        c.headers.update({"x-nexus-gateway-key": "k" * 40})
        yield c


def document(person):
    keys = ["names", "contacts", "addresses", "dates", "employments", "accounts", "facts", "notes"]
    # Use input models to remove response-only provenance and derived fields.
    from meridian.models import PersonDoc
    from meridian.store import COMMON, SECTIONS

    doc = {"notes": person["notes"], "expected_revision": person["edit_revision"]}
    for key in keys[:-1]:
        fields = (*SECTIONS[key][2], *COMMON, "id")
        if key == "employments":
            fields += ("organization",)
        doc[key] = [{k: v for k, v in row.items() if k in fields} for row in person[key]]
    PersonDoc(**doc)
    return doc


@pytest.mark.parametrize("kind", ["person", "organization", "group"])
def test_unified_save_revision_and_relationships(client, kind):
    path = "/api/people" if kind == "person" else "/api/entities"
    seed = {"names": [{"value": "Draft test"}], **({"kind": kind} if kind != "person" else {})}
    first = client.post(path, json=seed).json()
    url = f"{path}/{first['id']}"
    doc = document(first)
    if kind != "person":
        doc["kind"] = kind
    doc.update(notes="Saved together", facts=[{"key": "Favourite", "value": "Blue"}])
    saved = client.put(url, json=doc)
    assert saved.status_code == 200, saved.text
    saved = saved.json()
    assert saved["notes"] == "Saved together" and len(saved["facts"]) == 1
    assert saved["names"][0]["id"] == first["names"][0]["id"]
    assert saved["edit_revision"] != first["edit_revision"]
    # A second writer, even within the same second, cannot overwrite the new baseline.
    doc["notes"] = "Stale writer"
    assert client.put(url, json=doc).status_code == 409
    assert client.get(url).json()["notes"] == "Saved together"
    # Using the new baseline updates existing records instead of duplicating them.
    doc = document(saved)
    if kind != "person":
        doc["kind"] = kind
    doc["notes"] = "Second save"
    again = client.put(url, json=doc).json()
    assert again["facts"][0]["id"] == saved["facts"][0]["id"]


def test_validation_and_storage_failure_roll_back_every_section(client, monkeypatch):
    first = client.post("/api/people", json={"names": [{"value": "Atomic test"}]}).json()
    url = f"/api/people/{first['id']}"
    doc = document(first)
    doc.update(notes="Must roll back", contacts=[{"channel": "email", "value": "invalid"}])
    assert client.put(url, json=doc).status_code == 422
    assert client.get(url).json() == first
    doc["contacts"] = [{"channel": "email", "value": "valid@example.com"}]
    original = store.refresh

    def fail_after_writes(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("Injected storage failure")

    monkeypatch.setattr(store, "refresh", fail_after_writes)
    assert client.put(url, json=doc).status_code == 500
    assert client.get(url).json() == first
    monkeypatch.setattr(store, "refresh", original)
    assert client.put(url, json=doc).status_code == 200


def test_relationship_changes_are_preserved(client):
    a = client.post("/api/people", json={"names": [{"value": "A"}]}).json()
    b = client.post("/api/people", json={"names": [{"value": "B"}]}).json()
    doc = document(a)
    relation = client.post(
        "/api/relationships", json={"subject_id": a["id"], "object_id": b["id"], "type": "friend"}
    )
    assert relation.status_code == 201
    doc["notes"] = "After relationship"
    saved = client.put(f"/api/people/{a['id']}", json=doc)
    assert saved.status_code == 200
    assert len(saved.json()["relationships"]) == 1


def test_simultaneous_saves_have_exactly_one_winner(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    first = client.post("/api/people", json={"names": [{"value": "Concurrent test"}]}).json()
    url = f"/api/people/{first['id']}"
    gate = Barrier(2)

    def save(note):
        doc = document(first)
        doc["notes"] = note
        gate.wait(timeout=5)
        return client.put(url, json=doc).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["Writer A", "Writer B"]))
    assert sorted(results) == [200, 409]
    assert client.get(url).json()["notes"] in ("Writer A", "Writer B")
