"""Deletion contracts using task/file state in the isolated test database."""

from uuid import uuid4

import httpx
import pytest

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.identity.storage.models.accounts import User
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.config.settings import get_settings
from tests.account_fixtures import account_record
from website_test_support import SessionLocal, app


async def seed(*, status="completed", kind="render", workspace="test-user", reference=None):
    project_id, asset_id, task_id = (str(uuid4()) for _ in range(3))
    storage = AssetStorage(get_settings())
    async with SessionLocal() as session:
        if await session.get(User, workspace) is None:
            session.add(account_record(id=workspace, name="隔离空间"))
            await session.flush()
        session.add(VideoEditorProject(id=project_id, title="删除测试", owner_user_id=workspace))
        await session.flush()
        asset = VisualAsset(
            id=asset_id,
            owner_user_id=workspace,
            video_editor_project_id=project_id,
            original_filename="export.mp4",
            display_name="export.mp4",
            storage_key=uuid4().hex,
            storage_version=2,
            media_kind="video",
            mime_type="video/mp4",
            byte_size=6,
        )
        session.add(asset)
        await session.flush()
        session.add(
            VideoEditorAssetMetadata(
                asset_id=asset_id,
                project_id=project_id,
                processing_status="ready",
                proxy_filename="proxy.mp4",
                thumbnail_filename="thumb.png",
            )
        )
        document = {"tracks": [], "assetOrganization": {"rootAssetIds": [asset_id], "folders": []}}
        snapshot = {"tracks": [{"clips": [{"assetId": asset_id}]}]}
        if reference == "timeline":
            document.update(snapshot)
        session.add(VideoEditorTimeline(project_id=project_id, document=document))
        session.add(
            VideoEditorTask(
                id=task_id,
                owner_user_id=workspace,
                project_id=project_id,
                request_id=uuid4().hex,
                kind=kind,
                status=status,
                revision=3,
                output_asset_id=asset_id,
            )
        )
        if reference == "task":
            session.add(
                VideoEditorTask(
                    owner_user_id=workspace,
                    project_id=project_id,
                    request_id=uuid4().hex,
                    kind="render",
                    status="queued",
                    snapshot_document=snapshot,
                )
            )
        await session.commit()
        output = storage.path_for(asset)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"output")
        derived = (
            storage.project_root("video-editor", project_id, owner_user_id=workspace) / "derived"
        )
        derived.mkdir(parents=True, exist_ok=True)
        (derived / "proxy.mp4").write_bytes(b"proxy")
        (derived / "thumb.png").write_bytes(b"thumb")
        source = output.parent / "source-preserved"
        source.write_bytes(b"source")
    return project_id, task_id, asset_id, output, derived, source


def url(project_id: str, task_id: str) -> str:
    return f"/v1/video-editor/projects/{project_id}/renders/{task_id}"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
async def test_delete_terminal_render_cleans_files_and_preserves_project(status: str):
    project, task, asset, output, derived, source = await seed(status=status)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.delete(url(project, task), params={"expected_revision": 3})
        assert response.status_code == 200, response.text
        assert response.json() == {"deleted": True}
        assert (await client.get(url(project, task))).status_code == 404
        assert (await client.get(f"/v1/files/{asset}/download")).status_code == 404
        assert (await client.get(f"/v1/video-editor/projects/{project}/renders")).json()[
            "items"
        ] == []
        assert (
            await client.delete(url(project, task), params={"expected_revision": 3})
        ).status_code == 404
    assert not output.exists()
    assert list(derived.iterdir()) == []
    assert source.read_bytes() == b"source"
    async with SessionLocal() as session:
        assert await session.get(VideoEditorProject, project) is not None
        assert await session.get(VisualAsset, asset) is None
        assert await session.get(VideoEditorAssetMetadata, asset) is None
        timeline = await session.get(VideoEditorTimeline, project)
        assert timeline.document["assetOrganization"]["rootAssetIds"] == []
        assert timeline.revision == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("reference", ["timeline", "task"])
async def test_referenced_output_rolls_back_task_and_file_deletion(reference: str):
    project, task, asset, output, derived, _ = await seed(reference=reference)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.delete(url(project, task), params={"expected_revision": 3})
        assert response.status_code == 422
        assert response.json()["code"] == "asset_in_use"
        assert (await client.get(url(project, task))).status_code == 200
    assert output.exists() and len(list(derived.iterdir())) == 2
    async with SessionLocal() as session:
        assert await session.get(VisualAsset, asset) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,kind,workspace,revision,expected",
    [
        ("running", "render", "test-user", 3, 409),
        ("queued", "render", "test-user", 3, 409),
        ("completed", "render", "test-user", 2, 409),
        ("completed", "render", "test-user", None, 422),
        ("completed", "segment_export", "test-user", 3, 404),
        ("completed", "render", "another-workspace", 3, 404),
    ],
)
async def test_delete_guards(status, kind, workspace, revision, expected):
    project, task, _asset, output, _derived, _ = await seed(
        status=status, kind=kind, workspace=workspace
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.delete(
            url(project, task), params={} if revision is None else {"expected_revision": revision}
        )
        assert response.status_code == expected, response.text
        if revision == 2:
            assert response.json()["current_revision"] == 3
    assert output.exists()
    async with SessionLocal() as session:
        assert await session.get(VideoEditorTask, task) is not None


@pytest.mark.asyncio
async def test_delete_with_missing_file_or_previously_deleted_asset():
    for missing_asset in (False, True):
        project, task, asset, output, _derived, _ = await seed()
        output.unlink()
        if missing_asset:
            async with SessionLocal() as session:
                await session.delete(await session.get(VisualAsset, asset))
                await session.commit()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.delete(url(project, task), params={"expected_revision": 3})
            assert response.status_code == 200, response.text
