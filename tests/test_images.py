"""Representative images: Meridian keeps a photo reference and crop, Argus renders it."""

import pytest
from fastapi.testclient import TestClient
from meridian import images, nexus
from meridian.app import create_app

KEY = "k" * 40
GW = {"x-nexus-gateway-key": KEY}
RES = {"x-nexus-resolver-key": KEY}
PHOTO = "0192f0c4-1111-7aaa-8bbb-000000000001"
OTHER = "0192f0c4-1111-7aaa-8bbb-000000000002"
CROP = {"x": 0.25, "y": 0.1, "w": 0.5, "h": 0.75}


class FakeArgus:
    """Stands in for Nexus + Argus: records calls, answers like the projection contracts."""

    def __init__(self):
        self.calls, self.refs, self.available, self.statuses = [], {}, True, {}
        self.argus_installed = True

    def projection(self, name, query, cursor=None):
        self.calls.append((name, query))
        if not self.available:
            return {"availability": "module_disabled", "items": [], "next_cursor": None}
        if name == "photo-library":
            return {
                "availability": "available",
                "next_cursor": None,
                "items": [
                    {
                        "id": PHOTO,
                        "reference": f"nexus:v1:argus:photo:{PHOTO}",
                        "title": "Portrait",
                        "width": 3000,
                        "height": 2000,
                        "taken_at": None,
                        "created_at": "2026-11-05T18:00:00Z",
                        "thumbnail": "data:image/webp;base64,AAA",
                    },
                    {"id": "not-a-uuid", "thumbnail": "x"},
                ],
            }
        items = []
        for it in query["items"]:
            status = self.statuses.get(it["id"], "available")
            items.append(
                {
                    "status": status,
                    **(
                        {"src": f"data:image/webp;base64,{it['size']}", "size": it["size"]}
                        if status == "available"
                        else {}
                    ),
                }
            )
        return {"availability": "available", "items": items, "next_cursor": None}

    def create_reference(self, source, target, relation, readers):
        if not self.argus_installed:
            raise nexus.NexusRefused(422, "Resource type is not declared by its owner")
        assert relation == "meridian.representative-image" and readers == ["argus"]
        ref = f"ref-{len(self.refs) + 1}"
        self.refs[ref] = (source, target)
        return ref

    def delete_reference(self, ref):
        self.refs.pop(ref, None)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    fake = FakeArgus()
    for name in ("projection", "create_reference", "delete_reference"):
        monkeypatch.setattr(nexus, name, getattr(fake, name))
    images.CACHE.clear()
    with TestClient(create_app(tmp_path)) as client:
        client.headers.update(GW)
        yield client, fake


def person(client, given="Jana"):
    r = client.post(
        "/api/people", json={"names": [{"kind": "full", "given": given, "family": "Nováková"}]}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def group(client):
    r = client.post(
        "/api/entities", json={"kind": "group", "names": [{"kind": "full", "value": "Book club"}]}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_library_comes_from_argus_without_files_or_paths(env):
    client, fake = env
    lib = client.get("/api/photo-library").json()
    assert lib["availability"] == "available"
    assert [i["id"] for i in lib["items"]] == [PHOTO]  # malformed items are dropped
    assert set(lib["items"][0]) == {
        "id",
        "title",
        "width",
        "height",
        "taken_at",
        "created_at",
        "thumbnail",
    }
    preview = client.get(f"/api/photo-preview/{PHOTO}").json()
    assert preview["status"] == "available" and preview["src"].startswith("data:image/")
    assert client.get("/api/photo-preview/nope").status_code == 422


def test_set_show_and_replace_a_profile_picture(env):
    client, fake = env
    pid = person(client)
    r = client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    assert r.status_code == 200, r.text
    assert r.json()["crop"] == CROP
    profile = client.get(f"/api/people/{pid}").json()
    assert profile["image"]["photo_id"] == PHOTO
    # The Nexus edge was registered after the response, shared only with Argus.
    assert profile["image"]["nexus_state"] == "registered"
    assert list(fake.refs.values()) == [
        (f"nexus:v1:meridian:person:{pid}", f"nexus:v1:argus:photo:{PHOTO}")
    ]
    avatars = client.post("/api/avatars", json={"ids": [pid], "size": 128}).json()
    assert avatars["items"][pid] == {"status": "available", "src": "data:image/webp;base64,128"}
    # Rendered images are cached in memory: a second page view costs no Argus call.
    before = len(fake.calls)
    client.post("/api/avatars", json={"ids": [pid], "size": 128})
    assert len(fake.calls) == before
    # Replacing the photo moves the edge; recropping the same photo keeps it.
    client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": {**CROP, "x": 0.3}})
    assert len(fake.refs) == 1
    client.put(f"/api/entities/{pid}/image", json={"photo_id": OTHER, "crop": CROP})
    assert list(fake.refs.values()) == [
        (f"nexus:v1:meridian:person:{pid}", f"nexus:v1:argus:photo:{OTHER}")
    ]


def test_groups_and_organizations_have_pictures_too(env):
    client, _ = env
    gid = group(client)
    assert (
        client.put(f"/api/entities/{gid}/image", json={"photo_id": PHOTO, "crop": CROP}).status_code
        == 200
    )
    assert client.get(f"/api/entities/{gid}").json()["image"]["photo_id"] == PHOTO
    label = (
        TestClient(client.app)
        .post(
            "/empyrean/v1/resources/resolve",
            headers=RES,
            json={"resource": f"nexus:v1:meridian:group:{gid}"},
        )
        .json()
    )
    assert label["label"] == "Book club" and label["open_path"] == f"/groups/{gid}"


def test_invalid_crops_and_unknown_entities_are_refused(env):
    client, _ = env
    pid = person(client)
    for crop in (
        {"x": 0.8, "y": 0, "w": 0.5, "h": 0.5},
        {"x": -0.1, "y": 0, "w": 0.5, "h": 0.5},
        {"x": 0, "y": 0, "w": 0, "h": 0.5},
        {"x": 0, "y": 0, "w": 0.5},
    ):
        r = client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": crop})
        assert r.status_code == 422, crop
    assert (
        client.put(
            f"/api/entities/{pid}/image", json={"photo_id": "../x", "crop": CROP}
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/entities/0192f0c4-1111-7aaa-8bbb-00000000ffff/image",
            json={"photo_id": PHOTO, "crop": CROP},
        ).status_code
        == 404
    )


def test_missing_trashed_or_unavailable_photos_fall_back(env):
    client, fake = env
    a, b = person(client, "A"), person(client, "B")
    client.put(f"/api/entities/{a}/image", json={"photo_id": PHOTO, "crop": CROP})
    client.put(f"/api/entities/{b}/image", json={"photo_id": OTHER, "crop": CROP})
    fake.statuses[OTHER] = "trashed"
    out = client.post("/api/avatars", json={"ids": [a, b], "size": 64}).json()["items"]
    assert out[a]["status"] == "available" and out[b] == {"status": "trashed"}
    # Argus switched off: every picture falls back, Meridian's data is untouched.
    images.CACHE.clear()
    fake.available = False
    res = client.post("/api/avatars", json={"ids": [a, b], "size": 64}).json()
    assert res["availability"] == "module_disabled"
    assert {v["status"] for v in res["items"].values()} == {"unavailable"}
    assert client.get(f"/api/people/{a}").json()["image"]["photo_id"] == PHOTO
    assert client.get("/api/photo-library").json()["availability"] == "module_disabled"


def test_without_argus_the_choice_is_kept_and_registered_later(env):
    client, fake = env
    fake.argus_installed = False
    pid = person(client)
    client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    assert client.get(f"/api/people/{pid}").json()["image"]["nexus_state"] == "pending"
    fake.argus_installed = True
    images.sync_references(client.app.state.db)
    assert client.get(f"/api/people/{pid}").json()["image"]["nexus_state"] == "registered"


def test_remove_and_purge_clean_up_the_edge(env):
    client, fake = env
    pid = person(client)
    client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    assert client.delete(f"/api/entities/{pid}/image").json() == {"image": None}
    assert fake.refs == {} and client.get(f"/api/people/{pid}").json()["image"] is None
    client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    client.delete(f"/api/people/{pid}")
    assert len(fake.refs) == 1  # Trash keeps the picture: the entity can be restored
    assert client.delete(f"/api/trash/{pid}").status_code == 200
    images.sync_references(client.app.state.db)
    assert fake.refs == {}


def test_outgoing_enumeration_lists_every_edge_with_paging(env):
    client, _ = env
    ids = [person(client, f"P{i}") for i in range(3)]
    for pid in ids:
        client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    anonymous = TestClient(client.app)
    assert anonymous.get("/empyrean/v1/references/outgoing").status_code == 403
    first = anonymous.get("/empyrean/v1/references/outgoing?limit=2", headers=RES).json()
    assert len(first["references"]) == 2 and first["next_cursor"]
    rest = anonymous.get(
        f"/empyrean/v1/references/outgoing?limit=2&cursor={first['next_cursor']}", headers=RES
    ).json()
    assert len(rest["references"]) == 1 and rest["next_cursor"] is None
    edge = rest["references"][0]
    assert edge["relation"] == "meridian.representative-image" and edge["readers"] == ["argus"]
    assert {e["source"].split(":")[-1] for e in first["references"] + rest["references"]} == set(
        ids
    )


def test_backup_round_trip_keeps_pictures(env):
    client, _ = env
    pid = person(client)
    client.put(f"/api/entities/{pid}/image", json={"photo_id": PHOTO, "crop": CROP})
    anonymous = TestClient(client.app)
    artifact = anonymous.post("/empyrean/v1/backup/export", headers=RES)
    assert artifact.status_code == 200
    assert b"representative_images" in artifact.content
