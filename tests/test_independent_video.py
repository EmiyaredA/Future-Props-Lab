"""The Video Editor owns project and timeline records in a dedicated database."""

from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from fpl_deployment.images import source_closure
from fpl_runtime.claims import HEADER, Actor, issue_context
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_video.application import PROJECTS, create_app
from fpl_video.migrations.registry import MIGRATIONS

ROOT = Path(__file__).resolve().parents[1]


def test_video_image_excludes_compatibility_layout_and_foreign_orm():
    closure = source_closure(ROOT, "video")
    assert "fpl_video.application" in closure
    assert "app.apps.video_editor.timeline_read" in closure
    assert "app.apps.video_editor.legacy_project_layouts" not in closure
    assert "app.capabilities.asset_store.models" not in closure
    assert "app.runtime.db" not in closure


async def test_video_owned_projects_and_timeline_survive_restart(tmp_path):
    key = Ed25519PrivateKey.generate()
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")
    apply(tmp_path / "service.db", "video", MIGRATIONS)

    def app():
        return create_app(
            state_root=tmp_path,
            catalog=catalog,
            public_key=key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
        )

    async def call(api, method, path, *, owner="alpha", **kwargs):
        token = issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id=owner,
            ),
            service="video",
            method=method,
            path=path,
            private_key=key,
            key_id="isolated-video",
        )
        return await api.request(method, path, headers={HEADER: token}, **kwargs)

    first = app()
    async with (
        first.router.lifespan_context(first),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url="http://video") as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(api, "POST", PROJECTS, json={"title": "Owned Video"})
        assert created.status_code == 200, created.text
        project = PROJECTS + "/" + created.json()["id"]
        original = (await call(api, "GET", project + "/timeline")).json()
        assert original["revision"] == 0 and len(original["document"]["tracks"]) == 3
        assert (await call(api, "GET", project, owner="beta")).status_code == 404
        assert (await call(api, "GET", project + "/timeline", owner="beta")).status_code == 404
        assert (await call(api, "GET", PROJECTS, owner="beta")).json()["items"] == []
        body = {"title": "New Name", "expectedRevision": 0}
        assert (await call(api, "PATCH", project, owner="beta", json=body)).status_code == 404
        patched = await call(api, "PATCH", project, json=body)
        assert patched.status_code == 200, patched.text
        assert (await call(api, "PATCH", project, json=body)).status_code == 409

    second = app()
    async with (
        second.router.lifespan_context(second),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second), base_url="http://video"
        ) as api,
    ):
        assert (await call(api, "GET", PROJECTS)).json()["items"] == [patched.json()]
        assert (await call(api, "GET", project + "/timeline")).json() == original
