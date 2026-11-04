"""Standalone Motion keeps revisions, edit replay and file scope across restarts."""

from io import BytesIO
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from PIL import Image
from starlette.datastructures import Headers, UploadFile
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from fpl_motion import file_routes
from fpl_motion.application import PROJECTS, create_app
from fpl_motion.migrations.registry import MIGRATIONS
from fpl_motion.resources import ProjectResources
from fpl_rendering.application import create_app as rendering_app
from fpl_rendering.migrations.registry import MIGRATIONS as RENDERING_MIGRATIONS
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityClient, CapabilityUnavailable
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "motion-identity-fixture-secret-unique"
RENDERING_TOKEN = "motion-fixture-rendering-identity-secret"


async def test_motion_project_metadata_checks_exact_project_and_owner(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    state = tmp_path / "motion"
    apply(state / "service.db", "motion", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["motion"] = TOKEN

    case.identity.state.identity_options["service_credentials"]["rendering"] = RENDERING_TOKEN
    rendering_root = tmp_path / "rendering"
    render_db = rendering_root / "service.db"
    apply(render_db, "rendering", RENDERING_MIGRATIONS)
    rendering_identity = LiveAuthorization(
        service="rendering", credential=RENDERING_TOKEN, transport=case.mesh
    )
    renderer = rendering_app(
        settings=RenderingSettings(render_db),
        public_key=case.key.public_key(),
        catalog=CATALOG,
        identity=rendering_identity,
        capabilities=CapabilityClient(
            service="rendering", credential=RENDERING_TOKEN, catalog=CATALOG, transport=case.mesh
        ),
    )
    case.mesh.apps["rendering"] = renderer

    def assets_authority():
        live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
        case.assets.state.identity = live
        return live.client

    def app():
        return create_app(
            state_root=state,
            catalog=CATALOG,
            public_key=case.key.public_key(),
            credential=TOKEN,
            schema_path=ROOT / "web/src/generated/openapi.json",
            transport=case.mesh,
            run_worker=False,
        )

    async def call(client, method, path, **kwargs):
        headers = await authorize(case, "motion", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    async def upload(project_id):
        body = BytesIO()
        Image.new("RGB", (4, 4), "green").save(body, format="PNG")
        raw = body.getvalue()
        body.seek(0)
        async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            row = await AssetLibrary(db, case.assets.state.settings).store_upload(
                UploadFile(
                    body, filename="shape.png", headers=Headers({"Content-Type": "image/png"})
                ),
                owner_user_id=case.viewer,
                motion_compositor_project_id=project_id,
            )
            return row.id, raw

    first = app()
    async with (
        assets_authority(),
        renderer.router.lifespan_context(renderer),
        first.router.lifespan_context(first),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first), base_url="http://motion"
        ) as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(api, "POST", PROJECTS, json={"title": "Owned motion"})
        assert created.status_code == 200, created.text
        row = created.json()
        project_id = row["id"]
        project = f"{PROJECTS}/{project_id}"
        assert (await call(api, "GET", PROJECTS)).json()["items"] == [row]
        document = project + "/document"
        assert (await call(api, "GET", document)).json()["revision"] == 0
        foreign, raw = await upload(None)
        upload_body = {"file": ("owned.png", raw, "image/png")}
        with monkeypatch.context() as fault:
            fault.setattr(
                file_routes, "uuid4", lambda: UUID("e3cb6549-c686-4ab1-a4b2-e39442544cb1")
            )
            attached = await call(api, "POST", project + "/assets", files=upload_body)
            assert attached.status_code == 200, attached.text
            replayed = await call(api, "POST", project + "/assets", files=upload_body)
            assert replayed.json() == attached.json()
            conflicting = await call(
                api, "POST", project + "/assets", files={"file": ("changed.png", raw, "image/png")}
            )
            assert conflicting.status_code == 409
        owned = attached.json()["id"]
        copied = await call(api, "POST", project + "/assets/import", json={"assetIds": [foreign]})
        assert copied.status_code == 200, copied.text
        copy_id = copied.json()["items"][0]["id"]
        assert copy_id != foreign
        assert (
            await call(api, "POST", project + "/assets/import", json={"assetIds": ["unknown"]})
        ).status_code == 422
        files = await call(api, "GET", project + "/assets")
        assert files.status_code == 200, files.text
        assert {item["id"] for item in files.json()["items"]} == {owned, copy_id}
        candidates = await call(api, "GET", "/v1/motion-compositor/import-sources")
        sources = {item["id"]: item["sourceApplication"] for item in candidates.json()["items"]}
        assert sources == {
            owned: "motion-compositor",
            copy_id: "motion-compositor",
            foreign: "file-library",
        }
        stored_path = f"{project}/assets/{owned}/file"
        full = await call(api, "GET", stored_path)
        assert full.status_code == 200 and full.content == raw
        proof = await authorize(case, "motion", "GET", stored_path)
        chunk = await api.get(stored_path, headers={**proof, "Range": "bytes=0-7"})
        assert chunk.status_code == 206 and chunk.content == raw[:8]
        assert chunk.headers["content-range"] == f"bytes 0-7/{len(raw)}"
        foreign_read = await call(api, "GET", f"{project}/assets/{foreign}/file")
        assert foreign_read.status_code == 404
        layer = {
            "id": "owned-layer",
            "kind": "image",
            "name": "Owned media",
            "assetId": foreign,
            "width": 80,
            "height": 80,
            "endFrame": 180,
        }
        edit = {
            "expectedRevision": 0,
            "requestId": "retained-motion-edit",
            "operations": [{"type": "addLayer", "layer": layer}],
        }
        rejected = await call(api, "POST", document + "/operations", json=edit)
        assert rejected.status_code == 422, rejected.text
        layer["assetId"] = owned
        applied = await call(api, "POST", document + "/operations", json=edit)
        assert applied.status_code == 200, applied.text
        assert applied.json()["revision"] == 1
        frame = project + "/preview/frame"
        preview = await call(api, "GET", frame, params={"frame": 0, "revision": 1})
        assert preview.status_code == 200, preview.text
        assert preview.headers["cache-control"] == "no-store"
        with Image.open(BytesIO(preview.content)) as rendered:
            assert rendered.size == (1920, 1080)
            assert rendered.getpixel((0, 0))[:3] == (0, 128, 0)
        assert (
            await call(api, "GET", frame, params={"frame": 0, "revision": 0})
        ).status_code == 409
        assert (
            await call(api, "GET", frame, params={"frame": 180, "revision": 1})
        ).status_code == 422
        checked = rendering_identity.status
        checked_once = False

        async def revoke_during_render(**request):
            nonlocal checked_once
            if checked_once:
                return False
            checked_once = True
            return await checked(**request)

        with monkeypatch.context() as fault:
            fault.setattr(rendering_identity, "status", revoke_during_render)
            revoked = await call(api, "GET", frame, params={"frame": 0, "revision": 1})
        assert revoked.status_code == 401
        rename = await call(
            api, "PATCH", project, json={"title": "Renamed motion", "expectedRevision": 0}
        )
        assert rename.status_code == 200, rename.text
        assert rename.json()["revision"] == 1
        await first.state.reference_delivery.process_once()

    restarted = app()
    async with (
        assets_authority(),
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://motion"
        ) as api,
    ):
        assert (await call(api, "GET", project)).json() == rename.json()
        assert (await call(api, "GET", document)).json() == applied.json()
        replay = await call(api, "POST", document + "/operations", json=edit)
        assert replay.json() == applied.json()
        stale = await call(api, "PATCH", project, json={"title": "Stale", "expectedRevision": 0})
        assert stale.status_code == 409
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        case.csrf = case.browser.cookies["fpl_csrf"]
        assert (await call(api, "GET", project)).status_code == 404
        assert (await call(api, "GET", PROJECTS)).json()["items"] == []
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "viewing-user", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        stale_delete = await call(api, "DELETE", project, params={"expectedRevision": 0})
        assert stale_delete.status_code == 409
        prepare = ProjectResources.prepare_layout

        async def attempt_late_upload(resources, identity, revision):
            result = await prepare(resources, identity, revision)
            blocked = await call(api, "POST", project + "/assets", files=upload_body)
            assert blocked.status_code == 409, blocked.text
            assert blocked.json()["code"] == "motion_project_deletion_pending"
            return result

        with monkeypatch.context() as fault:
            fault.setattr(ProjectResources, "prepare_layout", attempt_late_upload)
            removed = await call(api, "DELETE", project, params={"expectedRevision": 1})
        assert removed.status_code == 200, removed.text
        assert (await call(api, "GET", project)).status_code == 404

        settle = restarted.state.retention_client.commit

        async def lost_reply(**outcome):
            await settle(**outcome)
            raise CapabilityUnavailable("simulated Motion deletion settlement loss")

        with monkeypatch.context() as fault:
            fault.setattr(restarted.state.retention_client, "commit", lost_reply)
            with pytest.raises(CapabilityUnavailable, match="settlement loss"):
                await restarted.state.reference_delivery.process_once()

    recovered = app()
    async with (
        assets_authority(),
        recovered.router.lifespan_context(recovered),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=recovered), base_url="http://motion"
        ) as api,
    ):
        await recovered.state.reference_delivery.process_once()
        candidates = await call(api, "GET", "/v1/motion-compositor/import-sources")
        assert [item["id"] for item in candidates.json()["items"]] == [foreign]
        assert await case.assets.state.file_cleanup.run_once() == 2
        assert (await call(api, "GET", project)).status_code == 404
