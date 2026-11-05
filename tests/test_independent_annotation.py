"""Owned annotation creates, clips and releases Assets audio through scoped APIs."""

import io
import wave
from pathlib import Path

import httpx
from starlette.datastructures import Headers, UploadFile
from tests.test_annotation_asset_protocol import TOKEN, audio
from tests.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    PASSWORD,
    scenario,
)
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from studio.apps.audio_annotation.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.assembly.independent.audio_annotation.application import create_app
from studio.contracts.asset_library.annotation import SOURCE
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = f"{SOURCE}/projects"


async def test_independent_annotation_owns_project_receipts_and_reuses_audio(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "annotation"
    apply(state / "service.db", "annotation", MIGRATIONS)
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        source = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(
                io.BytesIO(audio()),
                filename="fixture.wav",
                headers=Headers({"Content-Type": "audio/wav"}),
            ),
            owner_user_id=case.viewer,
        )
        asset = source.id
    case.identity.state.identity_options["service_credentials"]["annotation"] = TOKEN
    live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live

    def application():
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
        headers = await authorize(case, "annotation", method, path)
        return await client.request(method, path, headers=headers, **kwargs)

    app = application()
    async with (
        live.client,
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            base_url="http://annotation", transport=httpx.ASGITransport(app=app)
        ) as api,
    ):
        assert (await api.get(PROJECTS)).status_code == 401
        created = await call(
            api, "POST", PROJECTS, json={"title": "Owned annotation", "asset_id": asset}
        )
        assert created.status_code == 200, created.text
        row = created.json()
        project = f"{PROJECTS}/{row['id']}"
        assert row["duration_ms"] == 1000 and row["asset_id"] == asset
        assert (await call(api, "GET", PROJECTS)).json()["items"] == [row]
        document = (await call(api, "GET", project + "/document")).json()
        segment = document["segments"][0]["id"]
        clip = await call(
            api, "GET", f"{project}/segments/{segment}/audio", params={"expected_revision": 0}
        )
        assert clip.status_code == 200, clip.text
        with wave.open(io.BytesIO(clip.content)) as stream:
            assert stream.getframerate() == 16000 and stream.getnframes() == 16000
        assert list((state / ".staging").iterdir()) == []
        export = await call(api, "GET", project + "/export", params={"expected_revision": 0})
        assert export.json()["project"]["source"]["asset_id"] == asset
        await app.state.reference_delivery.process_once()
        before_delete = await call(
            api, "PATCH", project, json={"title": "Retained revision", "expected_revision": 0}
        )
        assert before_delete.status_code == 200, before_delete.text
        current = before_delete.json()
        assert current["revision"] == 1

    restarted = application()
    # The Assets authorization client is independent from either Annotation process.
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    async with (
        case.assets.state.identity.client,
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            base_url="http://annotation", transport=httpx.ASGITransport(app=restarted)
        ) as api,
    ):
        assert (await call(api, "GET", project)).json() == current
        stale = await call(api, "DELETE", project, params={"expected_revision": 0})
        assert stale.status_code == 409
        removed = await call(api, "DELETE", project, params={"expected_revision": 1})
        assert removed.status_code == 200, removed.text
        await restarted.state.reference_delivery.process_once()
        assert (await call(api, "GET", project)).status_code == 404
        login = await case.browser.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        rejected = await call(api, "POST", PROJECTS, json={"title": "Other", "asset_id": asset})
        assert rejected.status_code == 404
