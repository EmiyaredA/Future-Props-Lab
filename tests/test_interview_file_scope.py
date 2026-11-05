"""Explicit Interview file roots and uncertain commits preserve private source material."""

import asyncio
import io
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.interview_assistant.rooms import Rooms
from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.interview_assistant.application import MODELS
from studio.contracts.interview_assistant.documents import InterviewCreateIn
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


class Material:
    filename, content_type = "candidate.md", "text/markdown"

    def __init__(self):
        self.content = io.BytesIO(b"A fictional candidate.")

    async def read(self, size=-1):
        return self.content.read(size)

    async def close(self):
        self.content.close()


@pytest.mark.parametrize("committed", [False, True])
@pytest.mark.parametrize("failure", [OSError, asyncio.CancelledError])
async def test_unknown_upload_preserves_file_in_explicit_root(
    tmp_path, monkeypatch, committed, failure
):
    database_root, files_root = tmp_path / "database", tmp_path / "files"
    poisoned_root = tmp_path / "wrong-root"
    apply(database_root / "service.db", "interview", MIGRATIONS)
    database = Database("interview", database_root, models=MODELS)
    owner = str(uuid4())
    principal = SimpleNamespace(owner_user_id=owner, user_id=owner)
    try:
        # A historical service locator must not override the explicit file capability.
        async with database.sessions(
            info={"owner_user_id": owner, "interview_files_root": poisoned_root}
        ) as session:
            rooms = Rooms(session, principal, state_root=files_root)
            room = await rooms.create(InterviewCreateIn(title="Private", request_id=str(uuid4())))
            original = AsyncSession.commit

            async def uncertain_commit(current):
                if current is not session:
                    return await original(current)
                if committed:
                    await original(current)
                raise failure("synthetic commit acknowledgement lost")

            monkeypatch.setattr(AsyncSession, "commit", uncertain_commit)
            incoming = Material()
            with pytest.raises(failure):
                await rooms.upload(room.id, room.revision, incoming)
            assert incoming.content.closed
            monkeypatch.setattr(AsyncSession, "commit", original)
            await session.rollback()

        assert not poisoned_root.exists()
        assert not (database_root / "accounts").exists()
        files = list(files_root.glob("accounts/*/interview-assistant/*/materials/*.md"))
        assert len(files) == 1 and files[0].read_bytes() == b"A fictional candidate."
        async with database.sessions(info={"owner_user_id": owner}) as session:
            rooms = Rooms(session, principal, state_root=files_root)
            snapshot = await rooms.get(room.id)
            assert len(snapshot.materials) == int(committed)
            assert snapshot.revision == room.revision + int(committed)
            if committed:
                path, _name = await rooms.material(room.id, snapshot.materials[0].id)
                assert path == files[0]
            await rooms.delete(room.id, snapshot.revision)
        assert not files[0].exists()
    finally:
        await database.close()
