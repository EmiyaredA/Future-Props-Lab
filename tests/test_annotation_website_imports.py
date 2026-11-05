"""Website import stages bytes before SQL and reconciles uncertain commits."""

import asyncio
from types import SimpleNamespace

import pytest
from tests.test_audio_annotation import seed_transcription_task

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.audio_annotation.schemas.document import AudioAnnotationTranscriptionTaskImportIn
from studio.apps.audio_annotation.storage.projects import ProjectRecords
from studio.apps.audio_annotation.use_cases.create_project import CreateProject
from studio.assembly.website.annotation_imports import WebsiteCreationInputs, WebsiteTranscript
from studio.assembly.website.annotation_sources import WebsiteAnnotationSources
from studio.assembly.website.models import bind_owner
from studio.config.settings import get_settings
from studio.runtime.ids import new_id
from website_test_support import SessionLocal


async def test_private_import_probes_before_writes_and_keeps_committed_bytes_on_lost_ack(
    monkeypatch,
):
    task_id = await seed_transcription_task(filename="lost-ack.wav")
    settings = get_settings()
    events = []
    original_duration = WebsiteTranscript.duration
    original_stage = AssetLibrary.stage_local_copy

    async def duration(self):
        assert not self.inputs.session.in_transaction()
        assert self.staged is None
        events.append("probe")
        return await original_duration(self)

    monkeypatch.setattr(WebsiteTranscript, "duration", duration)

    async def stage(self, *args, **kwargs):
        assert not self.session.in_transaction()
        result = await original_stage(self, *args, **kwargs)
        assert not self.session.in_transaction()
        events.append("copy")
        return result

    monkeypatch.setattr(AssetLibrary, "stage_local_copy", stage)
    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        sources = WebsiteAnnotationSources(session, settings)
        inputs = WebsiteCreationInputs(sources=sources, session=session, settings=settings)
        records = ProjectRecords(session, sources=sources)
        original_commit = records.commit_creation
        committed = []

        async def lost_ack(**kwargs):
            assert events == ["probe", "copy"]
            result = await original_commit(**kwargs)
            committed.append(result)
            raise OSError("commit acknowledgement lost")

        monkeypatch.setattr(records, "commit_creation", lost_ack)
        use_case = CreateProject(owner="test-user", inputs=inputs, store=records, ids=new_id)
        with pytest.raises(OSError, match="acknowledgement"):
            await use_case.import_transcription(
                AudioAnnotationTranscriptionTaskImportIn(source_kind="task", task_id=task_id)
            )
        assert len(committed) == 1
        asset = await session.get(VisualAsset, committed[0].asset_id)
        assert asset is not None
        assert sources.storage.path_for(asset).is_file()
        assert (await records.get(committed[0].id)).id == committed[0].id


async def test_cancellation_waits_for_staged_copy_before_removing_bytes(tmp_path, monkeypatch):
    entered, complete = asyncio.Event(), asyncio.Event()
    target = tmp_path / "copied.wav"

    async def stage(*_args, **kwargs):
        assert kwargs["defer_persistence"]
        entered.set()
        await complete.wait()
        target.write_bytes(b"copied")
        return object(), target

    class Session:
        async def rollback(self):
            pass

    monkeypatch.setattr(
        "studio.assembly.website.annotation_imports.AssetLibrary",
        lambda *_args: SimpleNamespace(stage_local_copy=stage),
    )
    source = WebsiteTranscript(
        inputs=SimpleNamespace(session=Session(), settings=object()),
        filename="test.wav",
        text="text",
        segments=[],
        asset=None,
        path=tmp_path / "original.wav",
        owner="alice",
        mime_type="audio/wav",
    )
    publishing = asyncio.create_task(source.publish())
    await entered.wait()
    publishing.cancel()
    await asyncio.sleep(0)
    assert not publishing.done()
    complete.set()
    with pytest.raises(asyncio.CancelledError):
        await publishing
    assert not target.exists()
