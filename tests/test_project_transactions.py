from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from app.concurrency.revisions import RevisionConflictError, require_revision_write
from app.core.config import Settings
from app.files.project_transactions import creating_project_layout, deleting_project_layout
from app.files.storage import AssetStorage


class FakeSession:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self.commit_error = commit_error
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self) -> None:
        self.rollbacks += 1


@dataclass
class FakeWriteResult:
    rowcount: int


@dataclass
class FakeSnapshot:
    revision: int
    title: str

    def model_dump(self, *, mode: str) -> dict:
        assert mode == "json"
        return {"revision": self.revision, "title": self.title}


def storage_for(tmp_path: Path) -> AssetStorage:
    settings = Settings(fpl_database_path=str(tmp_path / "future-props.db"))
    return AssetStorage(settings)


@pytest.mark.asyncio
async def test_create_compensates_only_a_new_project_root_on_commit_failure(
    tmp_path: Path,
) -> None:
    storage = storage_for(tmp_path)
    session = FakeSession(commit_error=RuntimeError("commit failed"))

    with pytest.raises(RuntimeError, match="commit failed"):
        async with creating_project_layout(session, storage, "visual-workshop", "new-project"):
            assert storage.project_root("visual-workshop", "new-project").is_dir()

    assert session.rollbacks == 1
    assert not storage.project_root("visual-workshop", "new-project").exists()

    existing = storage.project_root("visual-workshop", "existing-project")
    existing.mkdir(parents=True)
    marker = existing / "keep.txt"
    marker.write_text("keep", encoding="utf-8")
    with pytest.raises(RuntimeError, match="commit failed"):
        async with creating_project_layout(session, storage, "visual-workshop", "existing-project"):
            pass
    assert marker.read_text(encoding="utf-8") == "keep"


@pytest.mark.asyncio
async def test_delete_restores_staged_root_when_commit_fails(tmp_path: Path) -> None:
    storage = storage_for(tmp_path)
    root = storage.project_root("galgame-workshop", "project-1")
    root.mkdir(parents=True)
    marker = root / "story.json"
    marker.write_text("story", encoding="utf-8")
    session = FakeSession(commit_error=RuntimeError("commit failed"))

    with pytest.raises(RuntimeError, match="commit failed"):
        async with deleting_project_layout(session, storage, "galgame-workshop", "project-1"):
            assert not root.exists()

    assert marker.read_text(encoding="utf-8") == "story"
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_delete_restores_after_cas_conflict_and_reports_snapshot(
    tmp_path: Path,
) -> None:
    storage = storage_for(tmp_path)
    root = storage.project_root("video-editor", "project-2")
    root.mkdir(parents=True)
    session = FakeSession()

    async def load_current() -> FakeSnapshot:
        return FakeSnapshot(revision=4, title="current")

    with pytest.raises(RevisionConflictError) as caught:
        async with deleting_project_layout(session, storage, "video-editor", "project-2"):
            await require_revision_write(
                session,
                FakeWriteResult(rowcount=0),
                expected=3,
                load_current=load_current,
            )

    assert root.is_dir()
    assert session.commits == 0
    assert session.rollbacks == 2
    assert caught.value.expected == 3
    assert caught.value.current == 4
    assert caught.value.snapshot == {"revision": 4, "title": "current"}


@pytest.mark.asyncio
async def test_delete_accepts_missing_directory_and_cleans_legacy_asset(
    tmp_path: Path,
) -> None:
    storage = storage_for(tmp_path)
    legacy = tmp_path / "legacy" / "asset.png"
    legacy.parent.mkdir()
    legacy.write_bytes(b"old")
    session = FakeSession()

    async with deleting_project_layout(
        session,
        storage,
        "visual-workshop",
        "missing-project",
        legacy_paths=[legacy],
    ):
        pass

    assert session.commits == 1
    assert session.rollbacks == 0
    assert not legacy.exists()


@pytest.mark.asyncio
async def test_delete_retries_a_transient_restore_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = storage_for(tmp_path)
    root = storage.project_root("visual-workshop", "retry-project")
    root.mkdir(parents=True)
    original_restore = storage.restore_staged_root
    attempts = 0

    def flaky_restore(staged) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("temporary rename failure")
        original_restore(staged)

    monkeypatch.setattr(storage, "restore_staged_root", flaky_restore)
    session = FakeSession(commit_error=RuntimeError("commit failed"))
    with pytest.raises(RuntimeError, match="commit failed"):
        async with deleting_project_layout(session, storage, "visual-workshop", "retry-project"):
            pass

    assert attempts == 2
    assert root.is_dir()


@pytest.mark.asyncio
async def test_revision_validator_accepts_exactly_one_updated_row() -> None:
    session = FakeSession()

    async def should_not_load() -> FakeSnapshot:
        raise AssertionError("successful CAS must not reload the resource")

    await require_revision_write(
        session,
        FakeWriteResult(rowcount=1),
        expected=7,
        load_current=should_not_load,
    )
    assert session.rollbacks == 0
