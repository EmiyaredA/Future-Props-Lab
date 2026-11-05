"""Creation rules use the same contract with memory and both SQLite stores."""

from contextlib import asynccontextmanager
from itertools import count
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from db.migrations import apply_migrations
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.audio_annotation.models import AudioAnnotationProject
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationImportIn,
    AudioAnnotationProjectCreateIn,
    AudioAnnotationProjectOut,
    AudioAnnotationTranscriptionTaskImportIn,
)
from studio.apps.audio_annotation.sources import AnnotationAudio, AudioAnnotationError
from studio.apps.audio_annotation.storage.migrations.registry import MIGRATIONS
from studio.apps.audio_annotation.storage.projects import ProjectRecords
from studio.apps.audio_annotation.storage.service_models import MODELS
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.apps.identity.storage.models.accounts import User
from studio.assembly.website.models import WebsiteSession
from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.database.website import WebsiteDatabase


def audio(owner="alice"):
    return AnnotationAudio(
        LibraryAssetDescription(
            id="source-audio",
            original_filename="source.wav",
            mime_type="audio/wav",
            media_kind="audio",
            byte_size=128,
            revision=0,
        ),
        owner,
        "source",
    )


class Inputs:
    def __init__(self):
        self.asset = audio()
        self.duration_ms = 1500
        self.published = 0
        self.closed = 0

    async def describe(self, asset_id):
        return self.asset if asset_id == self.asset.id else None

    async def duration(self, _audio):
        return self.duration_ms

    @asynccontextmanager
    async def transcription(self, _task_id):
        async def duration():
            return self.duration_ms

        async def publish():
            self.published += 1
            return self.asset

        try:
            yield SimpleNamespace(
                filename_stem="recording",
                text="transcript",
                segments=[],
                duration=duration,
                publish=publish,
            )
        finally:
            self.closed += 1


class MemoryProjects:
    def __init__(self):
        self.records = []

    async def commit_creation(self, **values):
        asset = values["asset"]
        result = AudioAnnotationProjectOut(
            id=values["project_id"],
            title=values["title"],
            asset_id=asset.id,
            asset_display_name=asset.display_name,
            original_filename=asset.original_filename,
            mime_type=asset.mime_type,
            byte_size=asset.byte_size,
            duration_ms=values["duration_ms"],
            segment_count=len(values["segments"]),
            reviewed_segment_count=0,
            waveform_ready=False,
            document_revision=0,
            revision=0,
            created_at="2026-11-05",
            updated_at="2026-11-05",
        )
        self.records.append(result.model_copy(deep=True))
        return result


@pytest.fixture(params=["memory", "website", "independent"])
async def case(request, tmp_path):
    inputs = Inputs()
    ids = count(1)
    database = None
    session = None
    if request.param == "memory":
        store = MemoryProjects()
    else:
        if request.param == "website":
            path = tmp_path / "website.db"
            apply_migrations(path)
            database = WebsiteDatabase(f"sqlite+aiosqlite:///{path}", session_class=WebsiteSession)
            async with database.sessions(info={"owner_user_id": "alice"}) as seed:
                seed.add(
                    User(
                        id="alice",
                        username="alice",
                        username_normalized="alice",
                        password_hash="test",
                    )
                )
                await seed.flush()
                seed.add(
                    VisualAsset(
                        id=inputs.asset.id,
                        owner_user_id="alice",
                        original_filename="source.wav",
                        display_name="source",
                        storage_key="fixture",
                        media_kind="audio",
                        mime_type="audio/wav",
                        byte_size=128,
                    )
                )
                await seed.commit()
        else:
            database = Database("annotation", tmp_path, models=MODELS)
            apply(database.path, "annotation", MIGRATIONS)
        session = database.sessions(info={"owner_user_id": "alice"})
        store = ProjectRecords(session, sources=inputs)
    creator = CreateProject(
        owner="alice", inputs=inputs, store=store, ids=lambda: f"id-{next(ids)}"
    )
    try:
        yield SimpleNamespace(creator=creator, inputs=inputs, store=store, database=database)
    finally:
        if session:
            await session.close()
        if database:
            await database.close()


async def records(case):
    if not case.database:
        return case.store.records
    async with case.database.sessions(info={"owner_user_id": "alice"}) as db:
        return list(await db.scalars(select(AudioAnnotationProject)))


async def test_creation_contract_creates_imports_and_borrows_transcription(case):
    created = await case.creator.create(
        AudioAnnotationProjectCreateIn(title="Created", asset_id="source-audio")
    )
    assert created.duration_ms == 1500 and created.segment_count == 1
    assert created.revision == created.document_revision == 0
    imported = await case.creator.import_project(
        AudioAnnotationImportIn(title="Imported", asset_id="source-audio", speakers=[], segments=[])
    )
    assert imported.id != created.id and imported.segment_count == 0
    transcript = await case.creator.import_transcription(
        AudioAnnotationTranscriptionTaskImportIn(source_kind="task", task_id="task")
    )
    assert transcript.title == "recording" and transcript.segment_count == 1
    assert case.inputs.published == case.inputs.closed == 1
    assert len(await records(case)) == 3


async def test_creation_contract_rejects_foreign_or_invalid_sources_without_writes(case):
    body = AudioAnnotationProjectCreateIn(title="Denied", asset_id="source-audio")
    case.inputs.asset = audio("bob")
    with pytest.raises(AudioAnnotationError) as error:
        await case.creator.create(body)
    assert error.value.status == 404
    case.inputs.asset = audio()
    case.inputs.duration_ms = 60 * 60 * 1000 + 1
    with pytest.raises(AudioAnnotationError) as error:
        await case.creator.create(body)
    assert error.value.code == "audio_too_long"
    with pytest.raises(AudioAnnotationError):
        await case.creator.import_transcription(
            AudioAnnotationTranscriptionTaskImportIn(source_kind="task", task_id="task")
        )
    assert case.inputs.closed == 1 and case.inputs.published == 0
    assert not await records(case)


async def test_creation_lease_is_closed_when_atomic_store_fails(case, monkeypatch):
    async def fail(**_kwargs):
        raise OSError("isolated commit failure")

    monkeypatch.setattr(case.store, "commit_creation", fail)
    with pytest.raises(OSError):
        await case.creator.import_transcription(
            AudioAnnotationTranscriptionTaskImportIn(source_kind="task", task_id="task")
        )
    assert case.inputs.published == case.inputs.closed == 1
    assert not await records(case)
