"""The page carries the Nexus navigation SDK and Meridian's adapter, in order, inline."""

from fastapi.testclient import TestClient
from meridian.app import create_app

KEY = "k" * 40


def test_page_inlines_navigation_sdk_before_the_adapter_and_app(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_RESOLVER_KEY", KEY)
    with TestClient(create_app(tmp_path)) as client:
        for path in ("/", "/people", "/people/0192f0c4-1111-7aaa-8bbb-000000000001"):
            page = client.get(path).text
            sdk = page.index("empyrean-navigation-v1")
            adapter = page.index("const MeridianRoutes")
            app = page.index("async function go(view")
            assert sdk < adapter < app, path
            assert "<script src" not in page  # still self-contained: nothing loaded from outside
