from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, update

from app.apps.galgame_workshop.story.story import default_story_document
from app.apps.galgame_workshop.story.story_migrations import (
    GalgameStoryMigrations,
    inspect_story_migration,
)
from app.main import app
from app.apps.galgame_workshop.models import GalgameStoryDocument, GalgameWorkshopProject
from app.models import Workspace
from app.orm import bind_workspace
from app.runtime.db import SessionLocal


def story_document(version: str = "1.4") -> dict:
    document = default_story_document().model_dump(mode="json", by_alias=True)
    document["schemaVersion"] = version
    return document


@pytest.mark.parametrize("version", ["1.0", "1.1", "1.2", "1.3"])
def test_story_migration_inspection_accepts_supported_legacy_versions(version: str) -> None:
    state, normalized = inspect_story_migration(story_document(version))
    assert state == "pending"
    assert normalized is not None
    assert normalized.schema_version == "1.4"


def test_story_migration_inspection_rejects_unknown_and_invalid_documents() -> None:
    assert inspect_story_migration({"schemaVersion": "2.0"}) == ("invalid", None)
    invalid = story_document("1.3")
    invalid["entryChapterId"] = "missing"
    assert inspect_story_migration(invalid) == ("invalid", None)


@pytest.mark.asyncio
async def test_story_migration_status_run_and_idempotency() -> None:
    workspace_id = str(uuid4())
    project_ids = [str(uuid4()) for _ in range(3)]
    async with SessionLocal() as session:
        session.add(Workspace(id=workspace_id, name="Story 迁移测试"))
        await session.flush()
        bind_workspace(session.sync_session, workspace_id)
        documents: list[tuple[str, dict]] = []
        for project_id, document in zip(
            project_ids,
            (story_document("1.0"), story_document("1.4"), {"schemaVersion": "2.0"}),
            strict=True,
        ):
            session.add(
                GalgameWorkshopProject(
                    id=project_id,
                    workspace_id=workspace_id,
                    title=project_id,
                )
            )
            documents.append((project_id, document))
        await session.flush()
        for project_id, document in documents:
            session.add(GalgameStoryDocument(project_id=project_id, document=document))
        await session.commit()

        migrations = GalgameStoryMigrations(session, workspace_id)
        assert (await migrations.status()).model_dump() == {
            "pending": 1,
            "invalid": 1,
            "current": 1,
            "total": 3,
        }
        result = await migrations.run(1)
        assert result.model_dump() == {
            "migrated": 1,
            "conflicts": 0,
            "invalid": 1,
            "remaining": 0,
            "current": 2,
            "total": 3,
        }
        assert (await migrations.run(100)).migrated == 0

        migrated = await session.get(GalgameStoryDocument, project_ids[0])
        assert migrated is not None
        assert migrated.document["schemaVersion"] == "1.4"
        assert migrated.revision == 1


@pytest.mark.asyncio
async def test_story_migration_only_scans_and_updates_current_workspace() -> None:
    workspace_ids = [str(uuid4()), str(uuid4())]
    project_ids = [str(uuid4()), str(uuid4())]
    for index, (workspace_id, project_id) in enumerate(
        zip(workspace_ids, project_ids, strict=True)
    ):
        async with SessionLocal() as session:
            session.add(Workspace(id=workspace_id, name=f"Story 空间 {index + 1}"))
            await session.flush()
            bind_workspace(session.sync_session, workspace_id)
            session.add(
                GalgameWorkshopProject(
                    id=project_id,
                    workspace_id=workspace_id,
                    title=f"空间 {index + 1} 工程",
                )
            )
            await session.flush()
            session.add(
                GalgameStoryDocument(
                    project_id=project_id,
                    document=story_document("1.1" if index == 0 else "1.2"),
                )
            )
            await session.commit()

    async with SessionLocal() as first_workspace:
        bind_workspace(first_workspace.sync_session, workspace_ids[0])
        migrations = GalgameStoryMigrations(first_workspace, workspace_ids[0])
        assert (await migrations.status()).model_dump() == {
            "pending": 1,
            "invalid": 0,
            "current": 0,
            "total": 1,
        }
        assert (await migrations.run(100)).migrated == 1

    async with SessionLocal() as second_workspace:
        bind_workspace(second_workspace.sync_session, workspace_ids[1])
        migrations = GalgameStoryMigrations(second_workspace, workspace_ids[1])
        assert (await migrations.status()).model_dump() == {
            "pending": 1,
            "invalid": 0,
            "current": 0,
            "total": 1,
        }
        untouched = await second_workspace.get(GalgameStoryDocument, project_ids[1])
        assert untouched is not None
        assert untouched.document["schemaVersion"] == "1.2"
        assert untouched.revision == 0


@pytest.mark.asyncio
async def test_story_migration_reports_cas_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_id = str(uuid4())
    project_id = str(uuid4())
    async with SessionLocal() as session:
        session.add(Workspace(id=workspace_id, name="Story CAS 测试"))
        await session.flush()
        bind_workspace(session.sync_session, workspace_id)
        session.add(
            GalgameWorkshopProject(
                id=project_id,
                workspace_id=workspace_id,
                title="冲突工程",
            )
        )
        await session.flush()
        session.add(GalgameStoryDocument(project_id=project_id, document=story_document("1.2")))
        await session.commit()
        migrations = GalgameStoryMigrations(session, workspace_id)
        stale = await migrations._candidates()
        original_candidates = migrations._candidates

        async with SessionLocal() as concurrent:
            bind_workspace(concurrent.sync_session, workspace_id)
            await concurrent.execute(
                update(GalgameStoryDocument)
                .where(GalgameStoryDocument.project_id == project_id)
                .values(revision=1)
            )
            await concurrent.commit()

        calls = 0

        async def candidates_with_stale_first():
            nonlocal calls
            calls += 1
            return stale if calls == 1 else await original_candidates()

        monkeypatch.setattr(migrations, "_candidates", candidates_with_stale_first)
        result = await migrations.run(100)
        assert result.migrated == 0
        assert result.conflicts == 1
        assert result.remaining == 1

        row = await session.scalar(
            select(GalgameStoryDocument).where(GalgameStoryDocument.project_id == project_id)
        )
        assert row is not None
        assert row.document["schemaVersion"] == "1.2"


@pytest.mark.asyncio
async def test_legacy_story_import_converts_once_and_uses_revision_cas() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "旧 Story 导入"})
        ).json()
        legacy = story_document("1.3")
        response = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/story/import",
            data={"expectedRevision": "0"},
            files={
                "file": (
                    "story-1.3.json",
                    json.dumps(legacy, ensure_ascii=False).encode(),
                    "application/json",
                )
            },
        )
        assert response.status_code == 200, response.text
        imported = response.json()
        assert imported["revision"] == 1
        assert imported["document"]["schemaVersion"] == "1.4"

        conflict = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/story/import",
            data={"expectedRevision": "0"},
            files={
                "file": (
                    "story-1.3.json",
                    json.dumps(legacy).encode(),
                    "application/json",
                )
            },
        )
        assert conflict.status_code == 409

        current = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/story/import",
            data={"expectedRevision": "1"},
            files={
                "file": (
                    "story-1.4.json",
                    json.dumps(story_document()).encode(),
                    "application/json",
                )
            },
        )
        assert current.status_code == 422
        assert "Story 1.4" in current.text
