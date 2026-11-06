"""Exercise exact owned voice input and ambiguous Models outcomes through Galgame."""

import asyncio

import httpx
import pytest

from studio.apps.galgame_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.model_service.galgame_transcription import (
    GalgameTranscription,
    recover_transcription_attempts,
)
from studio.apps.model_service.providers.transcription import TranscriptionResult, TranscriptSegment
from studio.apps.model_service.transport.galgame_asr_http import router as catalog_router
from studio.apps.model_service.transport.galgame_transcription_http import router as attempts_router
from studio.assembly.independent.galgame_workshop.application import create_app
from studio.config.settings import get_settings
from studio.contracts.galgame_workshop.galgame_asr_execution import EXECUTION
from studio.runtime.database.migrations import apply
from studio.runtime.secrets import SecretCipher
from tests.apps.audio_annotation.test_annotation_transcription_protocol import owned_models
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.galgame_workshop.test_galgame_annotation_import import _audio_bytes
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

PROJECTS = "/v1/galgame-workshop/projects"


async def test_voice_jobs_resume_receipts_and_keep_newer_manual_edits(
    scenario,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    case = scenario
    live_assets = LiveAuthorization(service="assets", credential=ASSETS_SECRET, transport=case.mesh)
    case.assets.state.identity = live_assets
    case.identity.state.identity_options["service_credentials"]["galgame"] = CREDENTIALS["galgame"]
    root = tmp_path / "galgame"
    apply(root / "service.db", "galgame", MIGRATIONS)
    galgame = create_app(
        state_root=root,
        public_key=case.key.public_key(),
        credential=CREDENTIALS["galgame"],
        catalog=CATALOG,
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["galgame"] = galgame
    audio = _audio_bytes()
    attempts = []
    interrupt_provider = False
    drop = False
    shared = case.mesh.handle_async_request

    async def mesh(request):
        nonlocal drop
        response = await shared(request)
        if (
            drop
            and request.method == "POST"
            and request.url.path.startswith(EXECUTION)
            and response.status_code == 200
        ):
            drop = False
            await response.aclose()
            raise httpx.ReadError("synthetic lost ASR provider acknowledgement", request=request)
        return response

    async def provider(**kwargs):
        assert kwargs["source"].read() == audio
        assert kwargs["api_key"] == "fixture-provider-credential"
        attempts.append(kwargs["model"])
        if interrupt_provider:
            raise asyncio.CancelledError()
        return TranscriptionResult(
            text="供应商文本", segments=(TranscriptSegment("speaker", 0, 500, "供应商文本"),)
        )

    monkeypatch.setattr(case.mesh, "handle_async_request", mesh)
    monkeypatch.setattr(
        "studio.apps.model_service.galgame_transcription.transcribe_model_audio", provider
    )
    async with (
        owned_models(case, tmp_path / "models") as (models, database, model),
        live_assets.client,
        galgame.router.lifespan_context(galgame),
        httpx.AsyncClient(transport=case.mesh, base_url="http://galgame") as client,
    ):
        models.state.galgame_asr_staging = tmp_path
        models.state.galgame_transcription = GalgameTranscription(
            database.sessions, decrypt=SecretCipher(get_settings().fpl_secrets_key).decrypt
        )
        models.include_router(catalog_router)
        models.include_router(attempts_router)

        async def request(method, path, **kwargs):
            return await client.request(
                method, path, headers=await authorize(case, "galgame", method, path), **kwargs
            )

        project = await request("POST", PROJECTS, json={"title": "Owned ASR"})
        assert project.status_code == 200, project.text
        path = f"{PROJECTS}/{project.json()['id']}"
        file = await request(
            "POST",
            path + "/assets",
            files={"upload": ("voice.wav", audio, "audio/wav")},
            data={"category": "voice"},
        )
        assert file.status_code == 200, file.text
        identity = file.json()["id"]
        settings = await request(
            "PATCH",
            path + "/assets/asr/settings",
            json={"expectedRevision": 0, "modelId": model},
        )
        assert settings.status_code == 200, settings.text
        jobs = path + "/assets/asr/transcriptions"
        body = {"assetIds": [identity], "language": "zh"}
        added = await request("POST", jobs, json=body)
        assert added.status_code == 200 and len(added.json()["items"]) == 1, added.text
        task = added.json()["items"][0]
        assert task["status"] == "queued" and task["modelSlug"] == "whisper-fixture"
        assert (await request("POST", jobs, json=body)).json() == added.json()
        busy = await request("POST", jobs, json={**body, "language": "ja"})
        assert busy.status_code == 409 and busy.json()["code"] == "asr_asset_busy"
        runner = galgame.state.asr_runner
        await runner.recover()
        drop = True
        await runner.process_once()
        pending = (await request("GET", jobs)).json()["items"][0]
        assert not drop and pending["status"] == "running"
        manual = await request(
            "PATCH",
            f"{path}/assets/{identity}/transcript",
            json={"expectedRevision": 0, "language": "zh", "text": "较新的手工文本"},
        )
        assert manual.status_code == 200, manual.text
        await runner.recover()
        await runner.process_once()
        finished = (await request("GET", jobs)).json()["items"][0]
        assert finished["status"] == "completed", finished
        assert finished["resultText"] == "供应商文本"
        assert finished["resultSegments"] == [
            {"speaker": "speaker", "startMs": 0, "endMs": 500, "text": "供应商文本"}
        ]
        assert attempts == ["whisper-fixture"]
        assets = (await request("GET", path + "/assets")).json()["items"]
        assert assets[0]["transcript"] == "较新的手工文本"
        assert (await request("POST", jobs, json=body)).json() == {"items": []}

        second = await request("POST", jobs, json={**body, "force": True})
        assert second.status_code == 200, second.text
        interrupted = second.json()["items"][0]["id"]
        interrupt_provider = True
        with pytest.raises(asyncio.CancelledError):
            await runner.run_task((case.viewer, interrupted))
        await recover_transcription_attempts(database.sessions)
        await runner.recover()
        await runner.process_once()
        failed = next(
            item
            for item in (await request("GET", jobs)).json()["items"]
            if item["id"] == interrupted
        )
        assert failed["status"] == "failed" and "结果未知" in failed["error"], failed
        assert attempts == ["whisper-fixture", "whisper-fixture"]
        assets = (await request("GET", path + "/assets")).json()["items"]
        assert assets[0]["transcript"] == "较新的手工文本"
