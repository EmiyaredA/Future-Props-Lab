"""Run the same editing contract against memory and the production SQLite adapter."""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from tests.test_audio_annotation import upload_audio

from studio.apps.audio_annotation.rules.editing import transform
from studio.apps.audio_annotation.schemas.document import AudioAnnotationDocumentOut
from studio.apps.audio_annotation.schemas.operations import AnnotationOperationsIn
from studio.apps.audio_annotation.storage.document_edits import SqlDocumentEdits
from studio.apps.audio_annotation.use_cases.edit_document import EditDocument
from studio.assembly.website.models import bind_owner
from studio.runtime.operation_errors import OperationError
from studio.runtime.revisions import RevisionConflictError
from website_test_support import SessionLocal, app


class MemoryDocumentEdits:
    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.receipts = {}

    async def load(self, project_id):
        assert project_id == self.snapshot.project_id
        return self.snapshot.model_copy(deep=True)

    async def replay(self, project_id, command):
        saved = self.receipts.get((project_id, command.request_id))
        if saved is None:
            return None
        payload, snapshot = saved
        if payload != command.model_dump():
            raise OperationError("request ID reused", "idempotency_conflict", 409)
        return snapshot.model_copy(deep=True)

    async def commit(self, project_id, command, candidate):
        saved = await self.replay(project_id, command)
        if saved is not None:
            return saved
        if self.snapshot.revision != candidate.expected_revision:
            raise RevisionConflictError(
                candidate.expected_revision, self.snapshot.revision, self.snapshot.model_dump()
            )
        values = candidate.model_dump(exclude={"expected_revision"})
        values.update(project_id=project_id, revision=self.snapshot.revision + 1)
        self.snapshot = AudioAnnotationDocumentOut.model_validate(
            {**self.snapshot.model_dump(), **values}
        )
        self.receipts[project_id, command.request_id] = (
            command.model_dump(),
            self.snapshot.model_copy(deep=True),
        )
        return self.snapshot.model_copy(deep=True)


@asynccontextmanager
async def editor(kind):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        asset = await upload_audio(client)
        response = await client.post(
            "/v1/audio-annotation/projects",
            json={"title": "Port contract", "asset_id": asset["id"]},
        )
        assert response.status_code == 200, response.text
        project_id = response.json()["id"]
        async with SessionLocal() as session:
            bind_owner(session, "test-user")
            projects = app.state.annotation_projects(None, session)
            current = await projects.get_document(project_id)
            store = (
                MemoryDocumentEdits(current)
                if kind == "memory"
                else SqlDocumentEdits(session, "test-user", projects)
            )
            yield EditDocument(store), current


@pytest.mark.parametrize("kind", ["memory", "sqlite"])
async def test_editing_port_replay_conflicts_and_pure_snapshot(kind):
    async with editor(kind) as (use_case, current):
        before = current.model_dump()
        command = AnnotationOperationsIn.model_validate(
            {
                "expected_revision": current.revision,
                "request_id": "edit-once",
                "operations": [
                    {
                        "action": "update",
                        "entity": "segment",
                        "id": current.segments[0].id,
                        "value": {"text": "edited"},
                    }
                ],
            }
        )
        saved = await use_case.execute(current.project_id, command)
        assert saved.revision == current.revision + 1
        assert saved.segments[0].text == "edited"
        assert current.model_dump() == before
        assert (await use_case.execute(current.project_id, command)) == saved
        # Simulate a lost commit acknowledgement, bypassing the early replay check.
        assert (
            await use_case.store.commit(current.project_id, command, transform(current, command))
        ) == saved

        changed = command.model_copy(deep=True)
        changed.operations[0].value["text"] = "different"
        with pytest.raises(OperationError) as reused:
            await use_case.execute(current.project_id, changed)
        assert reused.value.code == "idempotency_conflict"

        stale = command.model_copy(update={"request_id": "stale"})
        with pytest.raises(RevisionConflictError) as conflict:
            await use_case.execute(current.project_id, stale)
        assert conflict.value.current == saved.revision
        assert (await use_case.store.load(current.project_id)).segments[0].text == "edited"


async def test_sql_adapter_rolls_back_cancelled_document_write():
    class Session:
        rolled_back = False

        async def rollback(self):
            self.rolled_back = True

    class Projects:
        async def put_document(self, *_args, **_kwargs):
            raise asyncio.CancelledError

    session = Session()
    store = SqlDocumentEdits(session, "owner", Projects())
    with pytest.raises(asyncio.CancelledError):
        await store.commit("project", None, None)
    assert session.rolled_back


async def test_sql_cancellation_between_document_update_and_receipt_rolls_back(monkeypatch):
    from studio.apps.audio_annotation.storage import document_edits

    async with editor("sqlite") as (use_case, current):
        command = AnnotationOperationsIn.model_validate(
            {
                "expected_revision": current.revision,
                "request_id": "cancel-before-receipt",
                "operations": [
                    {
                        "action": "update",
                        "entity": "segment",
                        "id": current.segments[0].id,
                        "value": {"text": "must roll back"},
                    }
                ],
            }
        )

        def cancelled_receipt(*_args, **_kwargs):
            raise asyncio.CancelledError

        monkeypatch.setattr(document_edits, "record", cancelled_receipt)
        with pytest.raises(asyncio.CancelledError):
            await use_case.execute(current.project_id, command)
        restored = await use_case.store.load(current.project_id)
        assert restored == current
        assert await use_case.store.replay(current.project_id, command) is None
