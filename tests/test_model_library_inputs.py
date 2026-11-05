"""Models consume bounded library streams without importing or querying Assets ORM."""

import asyncio
import io
import os
import subprocess
import sys
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import httpx
import pytest
from sqlalchemy import select, text

from studio.apps.model_service.inference.assets import InferenceAssets
from studio.apps.model_service.library.inputs import library_inputs
from studio.apps.model_service.library_inputs import HttpLibraryInputs
from studio.apps.model_service.playground.transcription import ModelTestTranscription
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_inference import ModelInferenceAsset
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.model_test import ModelTestTranscriptionTask
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.delegation import RequestGrant, permitted, target_permission_path
from studio.contracts.model_service.schemas.model_test import ModelTestTranscriptionCreateIn
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def audio():
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\x00\x00" * 800)
    return output.getvalue()


class Chunks(httpx.AsyncByteStream):
    def __init__(self, body, *, failure=None):
        self.body, self.failure, self.reads = body, failure, 0

    async def __aiter__(self):
        for position in range(0, len(self.body), 701):
            self.reads += 1
            yield self.body[position : position + 701]
            if self.failure:
                raise self.failure("synthetic stream interruption")


class LibraryServer:
    def __init__(self, database, *, body=None, declared_size=None, headers=None, failure=None):
        body = audio() if body is None else body
        self.database, self.body = database, body
        self.stream = Chunks(body, failure=failure)
        self.headers = {
            "Content-Type": "audio/wav",
            "Content-Length": str(len(body) if declared_size is None else declared_size),
            "Content-Disposition": "inline; filename*=utf-8''" + quote("听写 样例.wav"),
            "X-Fpl-File-Kind": "audio",
            "X-Fpl-File-Revision": "2",
            **(headers or {}),
        }

    @asynccontextmanager
    async def model_library_source(self, **source):
        assert source["asset_id"] == "library-input"
        # Network waits must not retain a Models write transaction.
        async with self.database.sessions(info={"owner_user_id": "beta"}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            await session.rollback()
        response = httpx.Response(
            200,
            headers=self.headers,
            stream=self.stream,
            request=httpx.Request(
                "GET", "http://assets/_internal/v1/model-library-inputs/library-input"
            ),
        )
        try:
            yield response
        finally:
            await response.aclose()


@pytest.fixture
async def case(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    settings = SimpleNamespace(
        runtime_path=tmp_path,
        fpl_visual_asset_max_bytes=1024 * 1024,
        account_model_test_path=lambda owner, kind: (
            tmp_path / "accounts" / owner / "model-test" / kind
        ),
    )
    try:
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            session.add(
                ModelProvider(
                    id="provider",
                    owner_user_id="alpha",
                    name="Fixture",
                    kind="openai",
                    base_url="https://provider.invalid/v1",
                    api_key_ciphertext="synthetic",
                )
            )
            await session.flush()
            session.add(
                ModelEntry(
                    id="model",
                    owner_user_id="alpha",
                    provider_id="provider",
                    slug="whisper-1",
                    capabilities=["speech_recognition"],
                )
            )
            await session.commit()
        yield SimpleNamespace(database=database, settings=settings, root=tmp_path)
    finally:
        await database.close()


def inputs(server, *, max_bytes=1024 * 1024, path="/v1/model-inference/assets/import"):
    return HttpLibraryInputs(
        server,
        assertion="synthetic-source-assertion",
        method="POST",
        path=path,
        max_bytes=max_bytes,
    )


async def test_library_input_is_copied_into_only_owned_storage_with_unicode_name(case):
    server = LibraryServer(case.database)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        result = await InferenceAssets(
            session, "alpha", settings=case.settings, library=inputs(server)
        ).import_library("library-input")
    assert result.filename == "听写 样例.wav" and result.media_kind == "audio"
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceAsset, result.id)
        path = case.root / "accounts/alpha/model-inference/inputs" / row.storage_key
        assert path.read_bytes() == audio() and row.byte_size == len(audio())
    async with case.database.sessions(info={"owner_user_id": "beta"}) as session:
        assert not list(await session.scalars(select(ModelInferenceAsset)))


async def test_http_incoming_file_supports_zero_and_full_reads_with_checked_length(case):
    server = LibraryServer(case.database)
    async with inputs(server).open("library-input") as source:
        assert await source.incoming.read(0) == b""
        assert await source.incoming.read() == audio()
        assert await source.incoming.read() == b""


@pytest.mark.parametrize("declared_size", [1, 9000])
async def test_truncated_or_longer_stream_never_commits_an_input(case, declared_size):
    server = LibraryServer(case.database, declared_size=declared_size)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(AssetError) as error:
            await InferenceAssets(
                session, "alpha", settings=case.settings, library=inputs(server)
            ).import_library("library-input")
        assert error.value.code == "source_changed"
        assert not list(await session.scalars(select(ModelInferenceAsset)))
    directory = case.root / "accounts/alpha/model-inference/inputs"
    assert not directory.exists() or not list(directory.iterdir())


@pytest.mark.parametrize(
    "headers",
    [
        {"Content-Encoding": "gzip"},
        {"X-Fpl-File-Revision": "-1"},
        {"X-Fpl-File-Kind": "document"},
        {"X-Fpl-File-Kind": "image"},
        {"Content-Length": "invalid"},
        {"Content-Disposition": "inline"},
    ],
)
async def test_invalid_source_description_is_rejected_before_body_reads(case, headers):
    server = LibraryServer(case.database, headers=headers)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(AssetError):
            await InferenceAssets(
                session, "alpha", settings=case.settings, library=inputs(server)
            ).import_library("library-input")
        assert not list(await session.scalars(select(ModelInferenceAsset)))
    assert server.stream.reads == 0


async def test_oversize_source_is_rejected_before_copying(case):
    server = LibraryServer(case.database)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(AssetError) as error:
            await InferenceAssets(
                session, "alpha", settings=case.settings, library=inputs(server, max_bytes=100)
            ).import_library("library-input")
        assert error.value.status == 413
    assert server.stream.reads == 0


@pytest.mark.parametrize("failure", [asyncio.CancelledError, httpx.ReadError])
async def test_interrupted_copy_removes_uncommitted_input_and_preserves_account(case, failure):
    server = LibraryServer(case.database, failure=failure)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises((asyncio.CancelledError, httpx.ReadError)):
            await InferenceAssets(
                session, "alpha", settings=case.settings, library=inputs(server)
            ).import_library("library-input")
        assert session.info["owner_user_id"] == "alpha"
        assert not list(await session.scalars(select(ModelInferenceAsset)))
    directory = case.root / "accounts/alpha/model-inference/inputs"
    assert not directory.exists() or not list(directory.iterdir())


async def test_owned_transcription_copies_library_audio_without_asset_tables(case):
    server = LibraryServer(case.database)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        result = await ModelTestTranscription(
            session,
            "alpha",
            case.settings,
            library=inputs(server, path="/v1/model-test/transcription-tasks"),
        ).create_from_library(
            ModelTestTranscriptionCreateIn(model_id="model", source_asset_id="library-input")
        )
    assert result.source.kind == "library" and result.source.source_asset_id == "library-input"
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelTestTranscriptionTask, result.id)
        path = case.settings.account_model_test_path("alpha", "references") / row.input_storage_key
        assert path.read_bytes() == audio()


async def test_transcription_commit_response_loss_preserves_committed_input(case):
    server = LibraryServer(case.database)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        commit = session.commit

        async def lost_response():
            await commit()
            raise RuntimeError("synthetic lost commit response")

        session.commit = lost_response
        with pytest.raises(RuntimeError, match="lost commit response"):
            await ModelTestTranscription(
                session, "alpha", case.settings, library=inputs(server)
            ).create_from_library(
                ModelTestTranscriptionCreateIn(model_id="model", source_asset_id="library-input")
            )
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        rows = list(await session.scalars(select(ModelTestTranscriptionTask)))
        assert len(rows) == 1
        path = (
            case.settings.account_model_test_path("alpha", "references") / rows[0].input_storage_key
        )
        assert path.read_bytes() == audio()


async def test_transcription_cancellation_does_not_leave_a_task_or_file(case):
    server = LibraryServer(case.database, failure=asyncio.CancelledError)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(asyncio.CancelledError):
            await ModelTestTranscription(
                session, "alpha", case.settings, library=inputs(server)
            ).create_from_library(
                ModelTestTranscriptionCreateIn(model_id="model", source_asset_id="library-input")
            )
        assert not list(await session.scalars(select(ModelTestTranscriptionTask)))
    reference = case.settings.account_model_test_path("alpha", "references")
    assert not [entry for entry in reference.rglob("*") if entry.is_file()]


def test_library_input_provider_never_falls_back_to_legacy_storage():
    from fastapi import HTTPException

    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    with pytest.raises(HTTPException) as error:
        library_inputs(request, SimpleNamespace(info={"owner_user_id": "alpha"}), "alpha")
    assert error.value.status_code == 503
    with pytest.raises(HTTPException) as error:
        library_inputs(request, SimpleNamespace(info={"owner_user_id": "beta"}), "alpha")
    assert error.value.status_code == 403


def test_input_delegation_binds_service_operation_and_private_target():
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    grant = RequestGrant(
        "models",
        "models.library-input.read",
        "POST",
        "/v1/model-inference/assets/import",
        "assets",
        "GET",
        "/_internal/v1/model-library-inputs/owned",
    )
    assert permitted(grant, catalog)
    assert target_permission_path(grant) == "/v1/files/owned/content"
    from dataclasses import replace

    for changes in (
        {"caller": "rendering"},
        {"purpose": "rendering.source.read"},
        {"source_method": "GET"},
        {"source_path": "/v1/model-inference/options"},
        {"target_service": "identity"},
        {"target_method": "POST"},
        {"target_path": "/v1/files/owned/content"},
        {"target_path": "/_internal/v1/model-library-inputs/a/b"},
    ):
        assert not permitted(replace(grant, **changes), catalog)


def test_fresh_input_consumers_do_not_load_foreign_orm_or_global_database():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
import studio.apps.model_service.inference.assets
import studio.apps.model_service.playground.transcription
import studio.apps.model_service.library_inputs
assert 'studio.runtime.database.website' not in sys.modules
assert 'studio.assembly.website.models' not in sys.modules
assert not any(name.startswith(('app.console.models', 'app.apps.',
    'app.capabilities.asset_store.models')) for name in sys.modules)
""",
        ],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
