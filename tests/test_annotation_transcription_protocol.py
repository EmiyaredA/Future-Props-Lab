"""Model provider invocation and logs remain in Models for both Annotation entry points."""

import io
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile
from starlette.exceptions import HTTPException
from tests.test_annotation_asset_protocol import TOKEN, audio
from tests.test_community_asset_protocol import ASSETS_SECRET, CATALOG, scenario  # noqa: F401
from tests.test_independent_annotation import PROJECTS, ROOT
from tests.test_independent_project_catalog import authorize

from app.capabilities.asset_store.library import AssetLibrary
from app.llm.models import LlmCallLog, ModelEntry, ModelProvider, ModelTestTranscriptionTask
from app.llm.providers.transcription import TranscriptionResult
from app.llm.routes.models.model_test_transcription import router as task_router
from app.runtime.credentials import encrypt_secret
from studio.apps.audio_annotation.storage.migrations.registry import (
    MIGRATIONS as ANNOTATION_MIGRATIONS,
)
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.model_service.annotation_transcription import router
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.assembly.independent.audio_annotation.application import create_app
from studio.contracts.model_service.annotation import PREFIX
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.http.problem_details import http_exception_handler

MODELS_TOKEN = "annotation-models-service-test-" * 2


@asynccontextmanager
async def owned_models(case, path):
    apply(path / "service.db", "models", MODELS_MIGRATIONS)
    database = Database("models", path, models=MODELS, account_models=ACCOUNT_MODELS)
    live = LiveAuthorization(service="models", credential=MODELS_TOKEN, transport=case.mesh)
    case.identity.state.identity_options["service_credentials"]["models"] = MODELS_TOKEN
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.state.database = database
    app.state.identity_public_key = case.key.public_key()
    app.state.identity = live
    app.include_router(router)
    app.include_router(task_router, prefix="/v1")
    app.add_middleware(
        SignedIdentity, service="models", public_key=case.key.public_key(), catalog=CATALOG
    )
    case.mesh.apps["models"] = app
    try:
        async with live.client, database.sessions(info={"owner_user_id": case.viewer}) as db:
            provider = ModelProvider(
                owner_user_id=case.viewer,
                name="Synthetic speech",
                kind="openai",
                base_url="https://models.example.test/v1",
                api_key_ciphertext=encrypt_secret("fixture-provider-credential"),
            )
            db.add(provider)
            await db.flush()
            model = ModelEntry(
                owner_user_id=case.viewer,
                provider_id=provider.id,
                slug="whisper-fixture",
                capabilities=["speech_recognition"],
            )
            db.add(model)
            await db.commit()
            yield app, database, model.id
    finally:
        await database.close()


async def test_models_verify_exact_wav_and_replay_a_finished_attempt(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    received = []
    private_requests = []
    shared = case.mesh.handle_async_request

    async def capture(request):
        if request.url.host == "models" and request.url.path.startswith(PREFIX):
            body = await request.aread()
            private_requests.append((request.url, dict(request.headers), body))
        return await shared(request)

    monkeypatch.setattr(case.mesh, "handle_async_request", capture)

    async def provider(**kwargs):
        assert kwargs["api_key"] == "fixture-provider-credential"
        assert kwargs["source"].read(4) == b"RIFF"
        received.append(kwargs["byte_size"])
        return TranscriptionResult(text="retained provider result")

    monkeypatch.setattr("app.llm.annotation_transcription.transcribe_model_audio", provider)
    payload = audio()
    async with case.assets.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
        asset = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(
                io.BytesIO(payload),
                filename="voice.wav",
                headers=Headers({"Content-Type": "audio/wav"}),
            ),
            owner_user_id=case.viewer,
        )
        asset_id = asset.id
    case.identity.state.identity_options["service_credentials"]["annotation"] = TOKEN
    assets_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets_live
    root = tmp_path / "annotation"
    apply(root / "service.db", "annotation", ANNOTATION_MIGRATIONS)
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=TOKEN,
        schema_path=ROOT / "web/src/generated/openapi.json",
        transport=case.mesh,
        run_worker=False,
    )

    async def call(api, method, path, **kwargs):
        headers = await authorize(case, "annotation", method, path)
        return await api.request(method, path, headers=headers, **kwargs)

    async with (
        assets_live.client,
        owned_models(case, tmp_path / "models") as (model_app, database, model),
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            base_url="http://annotation", transport=httpx.ASGITransport(app=app)
        ) as api,
    ):
        project = await call(api, "POST", PROJECTS, json={"title": "Fixture", "asset_id": asset_id})
        assert project.status_code == 200, project.text
        item = PROJECTS + "/" + project.json()["id"]
        document = (await call(api, "GET", item + "/document")).json()
        segment = document["segments"][0]["id"]
        direct = await call(
            api,
            "POST",
            item + "/segment-transcriptions",
            files={"upload": ("voice.wav", payload, "audio/wav")},
            data={"model_id": model, "segment_id": segment, "start_ms": "0", "end_ms": "1000"},
        )
        assert direct.status_code == 200, direct.text
        saved = await call(
            api,
            "POST",
            f"{item}/segments/{segment}/transcribe-saved",
            json={"model_id": model, "expected_revision": 0},
        )
        assert saved.status_code == 200, saved.text
        assert direct.json()["text"] == saved.json()["text"] == "retained provider result"
        assert len(received) == 2
        url, headers, original = private_requests[0]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=model_app)) as mesh:
            tampered = await mesh.post(url, headers=headers, content=original[:-1] + b"\x01")
            assert tampered.status_code == 422
            replay = await mesh.post(url, headers=headers, content=original)
            assert replay.status_code == 200 and replay.json() == direct.json()
        assert len(received) == 2
        async with database.sessions(info={"owner_user_id": case.viewer}) as db:
            logs = list(
                await db.scalars(
                    select(LlmCallLog).where(LlmCallLog.call_source == "audio_annotation")
                )
            )
            assert {row.id for row in logs} == {direct.json()["log_id"], saved.json()["log_id"]}
            assert all(row.auth_kind == "session" for row in logs)


async def test_completed_task_original_import_replays_assets_receipt(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    inputs = tmp_path / "model-originals"
    inputs.mkdir()
    data = audio()
    source = inputs / "model-task.wav"
    source.write_bytes(data)
    monkeypatch.setattr(
        "app.llm.playground.transcription.get_settings",
        lambda: SimpleNamespace(account_model_test_path=lambda *_parts: inputs),
    )
    case.identity.state.identity_options["service_credentials"]["annotation"] = TOKEN
    assets_live = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = assets_live
    state = tmp_path / "annotation"
    apply(state / "service.db", "annotation", ANNOTATION_MIGRATIONS)
    app = create_app(
        state_root=state,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=TOKEN,
        schema_path=ROOT / "web/src/generated/openapi.json",
        transport=case.mesh,
        run_worker=False,
    )
    path = "/v1/audio-annotation/transcription-imports"
    task_id = str(uuid4())

    async with (
        assets_live.client,
        owned_models(case, tmp_path / "models") as (_model_app, models, _model),
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            base_url="http://annotation", transport=httpx.ASGITransport(app=app)
        ) as api,
    ):
        async with models.sessions(info={"owner_user_id": case.viewer}) as db:
            db.add(
                ModelTestTranscriptionTask(
                    id=task_id,
                    owner_user_id=case.viewer,
                    provider_kind="openai",
                    provider_name="Fixture",
                    model_slug="whisper-fixture",
                    source_kind="upload",
                    input_storage_key=source.name,
                    input_filename="model-task.wav",
                    input_mime_type="audio/wav",
                    input_byte_size=len(data),
                    status="completed",
                    result_text="Imported transcript",
                    result_segments=[],
                )
            )
            await db.commit()
        headers = await authorize(case, "annotation", "POST", path)
        body = {"source_kind": "task", "task_id": task_id}
        first = await api.post(path, headers=headers, json=body)
        assert first.status_code == 200, first.text
        second = await api.post(path, headers=headers, json=body)
        assert second.status_code == 200, second.text
        assert second.json()["id"] != first.json()["id"]
        asset_id = first.json()["asset_id"]
        assert second.json()["asset_id"] == asset_id
        assert first.json()["duration_ms"] == 1000
        assert first.json()["title"] == "model-task"
        docs = f"{PROJECTS}/{first.json()['id']}/document"
        document = await api.get(docs, headers=await authorize(case, "annotation", "GET", docs))
        assert document.json()["segments"][0]["text"] == "Imported transcript"
        asset = f"/v1/files/{asset_id}/content"
        async with httpx.AsyncClient(
            base_url="http://assets", transport=httpx.ASGITransport(app=case.assets)
        ) as client:
            read = await client.get(asset, headers=await authorize(case, "assets", "GET", asset))
            assert read.status_code == 200 and read.content == data
        assert list((state / ".staging").iterdir()) == []
        source.unlink()
        missing = await api.post(path, headers=headers, json=body)
        assert missing.status_code == 404 and missing.json()["code"] == "source_not_found"
