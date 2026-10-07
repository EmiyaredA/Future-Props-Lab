from __future__ import annotations

import subprocess
from dataclasses import replace

import httpx
import pytest
from fastapi import Request

from app.apps.video_editor.runner import VideoEditorRunner
from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_workspace


@pytest.fixture(scope="module")
def video_bytes() -> bytes:
    return subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=32x32:r=5",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "frag_keyframe+empty_moov",
            "-f",
            "mp4",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout


async def upload_video(client: httpx.AsyncClient, payload: bytes) -> tuple[str, dict]:
    project = await client.post("/v1/video-editor/projects", json={"title": "素材改名"})
    assert project.status_code == 200
    base = f"/v1/video-editor/projects/{project.json()['id']}"
    response = await client.post(
        f"{base}/assets", files={"upload": ("original.mp4", payload, "video/mp4")}
    )
    assert response.status_code == 200
    return base, response.json()


@pytest.mark.asyncio
async def test_video_rename_persists_preserves_effects_media_and_timeline(
    video_bytes: bytes,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base, asset = await upload_video(client, video_bytes)
        await VideoEditorRunner(lane="media").process_once()
        asset = next(
            item
            for item in (await client.get(f"{base}/assets")).json()["items"]
            if item["id"] == asset["id"]
        )
        path = f"{base}/assets/{asset['id']}"
        effects = {
            "chromaKey": {
                "enabled": True,
                "color": "#00ff00",
                "similarity": 42,
                "softness": 18,
                "despill": 30,
            }
        }
        with_effects = await client.patch(
            path, json={"expectedRevision": asset["revision"], "defaultEffects": effects}
        )
        assert with_effects.status_code == 200
        asset = with_effects.json()
        timeline = (await client.get(f"{base}/timeline")).json()
        clip = {
            "id": "clip-rename",
            "trackId": "visual-1",
            "kind": "video",
            "name": "片段独立名称",
            "assetId": asset["id"],
            "timelineStartUs": 0,
            "durationUs": 500_000,
            "sourceInUs": 0,
        }
        added = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": timeline["revision"],
                "requestId": "rename-timeline-clip",
                "operations": [{"type": "addClip", "clip": clip}],
            },
        )
        assert added.status_code == 200, added.text
        before = added.json()

        renamed = await client.patch(
            path, json={"expectedRevision": asset["revision"], "displayName": "  镜头一  "}
        )
        assert renamed.status_code == 200, renamed.text
        saved = renamed.json()
        assert saved["displayName"] == "镜头一"
        assert saved["revision"] == asset["revision"] + 1
        for key in (
            "id",
            "originalFilename",
            "defaultEffects",
            "probe",
            "proxyUrl",
            "thumbnailUrl",
            "byteSize",
        ):
            assert saved[key] == asset[key]
        persisted = next(
            item
            for item in (await client.get(f"{base}/assets")).json()["items"]
            if item["id"] == asset["id"]
        )
        assert persisted == saved
        assert (await client.get(f"{base}/timeline")).json() == before
        content = await client.get(f"/v1/files/{asset['id']}/content")
        assert content.status_code == 200
        assert content.content == video_bytes

        stale = await client.patch(
            path,
            json={
                "expectedRevision": asset["revision"],
                "displayName": "旧版本覆盖",
                "defaultEffects": {"chromaKey": None},
            },
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["display_name"] == "镜头一"
        persisted = next(
            item
            for item in (await client.get(f"{base}/assets")).json()["items"]
            if item["id"] == asset["id"]
        )
        assert persisted == saved
        combined = await client.patch(
            path,
            json={
                "expectedRevision": saved["revision"],
                "displayName": "镜头二",
                "defaultEffects": {"chromaKey": None},
            },
        )
        assert combined.status_code == 200
        assert combined.json()["displayName"] == "镜头二"
        assert combined.json()["defaultEffects"] == {"chromaKey": None}


@pytest.mark.asyncio
async def test_rename_validation_and_access_boundaries(video_bytes: bytes, monkeypatch) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base, asset = await upload_video(client, video_bytes)
        path = f"{base}/assets/{asset['id']}"
        for changes in (
            {},
            {"displayName": ""},
            {"displayName": "   "},
            {"displayName": "a" * 256},
            {"displayName": None},
            {"defaultEffects": None},
        ):
            response = await client.patch(
                path, json={"expectedRevision": asset["revision"], **changes}
            )
            assert response.status_code == 422, response.text
        missing_revision = await client.patch(path, json={"displayName": "缺少版本"})
        assert missing_revision.status_code == 422
        other = (await client.post("/v1/video-editor/projects", json={"title": "其他工程"})).json()
        wrong_project = await client.patch(
            f"/v1/video-editor/projects/{other['id']}/assets/{asset['id']}",
            json={"expectedRevision": asset["revision"], "displayName": "跨工程"},
        )
        assert wrong_project.status_code == 404

        original_principal = app.dependency_overrides[require_studio_auth]

        async def other_workspace(session: SessionDep):
            principal = await original_principal(session)
            bind_workspace(session, "rename-other-workspace")
            return replace(principal, workspace_id="rename-other-workspace")

        async def authenticate_viewer(_request, session, **_kwargs):
            principal = await original_principal(session)
            return replace(
                principal,
                workspace_access="member",
                member_role="viewer",
                scopes=frozenset({"studio:read"}),
                is_platform_admin=False,
                platform_role="",
                platform_permissions=frozenset(),
            )

        async def viewer(request: Request, session: SessionDep):
            return await require_studio_auth(request, session)

        try:
            app.dependency_overrides[require_studio_auth] = other_workspace
            crossed = await client.patch(
                path, json={"expectedRevision": asset["revision"], "displayName": "跨空间"}
            )
            assert crossed.status_code == 404
            monkeypatch.setattr("app.deps.authenticate_studio_request", authenticate_viewer)
            app.dependency_overrides[require_studio_auth] = viewer
            denied = await client.patch(
                path, json={"expectedRevision": asset["revision"], "displayName": "只读修改"}
            )
            assert denied.status_code == 403
        finally:
            app.dependency_overrides[require_studio_auth] = original_principal
        persisted = next(
            item
            for item in (await client.get(f"{base}/assets")).json()["items"]
            if item["id"] == asset["id"]
        )
        assert persisted["displayName"] == asset["displayName"]
        assert persisted["revision"] == asset["revision"]
