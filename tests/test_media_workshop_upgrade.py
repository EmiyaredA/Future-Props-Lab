from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.accounts.principal import StudioPrincipal
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.deps import SessionDep, require_studio_auth
from app.llm.generation_runtime.media import generated_type
from app.llm.providers.senseaudio_audio import (
    create_music_task,
    create_sound_effect,
    get_music_task,
)
from app.main import app
from app.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VisualAsset,
    VisualWorkshopProject,
)


async def _reset_projects() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        await session.execute(delete(VisualWorkshopProject))
        await session.commit()


def _media_clip(
    clip_id: str,
    *,
    track_id: str,
    kind: str,
    asset_id: str,
    link_group_id: str,
) -> dict:
    return {
        "id": clip_id,
        "trackId": track_id,
        "kind": kind,
        "name": clip_id,
        "timelineStartUs": 1_000_000,
        "durationUs": 4_000_000,
        "sourceInUs": 2_000_000,
        "assetId": asset_id,
        "linkGroupId": link_group_id,
    }


async def _ready_video_asset(project_id: str) -> str:
    asset = VisualAsset(
        video_editor_project_id=project_id,
        original_filename="source.mp4",
        display_name="source.mp4",
        storage_key=uuid4().hex,
        media_kind="video",
        mime_type="video/mp4",
        byte_size=1024,
    )
    async with SessionLocal() as session:
        session.add(asset)
        await session.flush()
        session.add(
            VideoEditorAssetMetadata(
                asset_id=asset.id,
                project_id=project_id,
                processing_status="ready",
                probe={
                    "durationUs": 10_000_000,
                    "streams": [
                        {"codec_type": "video", "width": 1920, "height": 1080},
                        {"codec_type": "audio", "codec_name": "aac"},
                    ],
                },
                fingerprint="a" * 64,
            )
        )
        await session.commit()
    return asset.id


@pytest.mark.asyncio
async def test_canvas_edges_persist_and_reject_cycles_and_invalid_types() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "连线画布", "kind": "canvas"},
            )
        ).json()
        nodes = [
            {
                "id": node_id,
                "kind": kind,
                "title": node_id,
                "position": {"x": index * 360, "y": 0},
                "asset_id": None,
            }
            for index, (node_id, kind) in enumerate(
                [("video-a", "video"), ("video-b", "video"), ("image-a", "image")]
            )
        ]
        saved = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 0,
                "nodes": nodes,
                "edges": [
                    {
                        "id": "edge-a-b",
                        "source_node_id": "video-a",
                        "target_node_id": "video-b",
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["edges"][0]["id"] == "edge-a-b"

        cycle = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 1,
                "nodes": nodes,
                "edges": [
                    saved.json()["edges"][0],
                    {
                        "id": "edge-b-a",
                        "source_node_id": "video-b",
                        "target_node_id": "video-a",
                    },
                ],
            },
        )
        assert cycle.status_code == 422

        invalid_kind = await client.put(
            f"/v1/visual-workshop/projects/{project['id']}/canvas",
            json={
                "expected_revision": 1,
                "nodes": nodes,
                "edges": [
                    {
                        "id": "edge-video-image",
                        "source_node_id": "video-a",
                        "target_node_id": "image-a",
                    }
                ],
            },
        )
        assert invalid_kind.status_code == 422
        current = (await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")).json()
        assert current["revision"] == 1
        assert current["edges"] == saved.json()["edges"]


@pytest.mark.asyncio
async def test_linked_audio_and_video_split_atomically_and_relink_right_halves() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "联动分割"})
        ).json()
        asset_id = await _ready_video_asset(project["id"])
        added = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "linked-add-clips",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": _media_clip(
                            "video-left",
                            track_id="visual-1",
                            kind="video",
                            asset_id=asset_id,
                            link_group_id="av-original",
                        ),
                    },
                    {
                        "type": "addClip",
                        "clip": _media_clip(
                            "audio-left",
                            track_id="audio-1",
                            kind="audio",
                            asset_id=asset_id,
                            link_group_id="av-original",
                        ),
                    },
                ],
            },
        )
        assert added.status_code == 200, added.text
        split = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "linked-split-clips",
                "operations": [
                    {
                        "type": "splitClip",
                        "clipId": "video-left",
                        "atUs": 3_000_000,
                        "newClipId": "video-right",
                        "linkedNewClipIds": {"audio-left": "audio-right"},
                        "newLinkGroupId": "av-right",
                    }
                ],
            },
        )
        assert split.status_code == 200, split.text
        clips = {
            clip["id"]: clip
            for track in split.json()["document"]["tracks"]
            for clip in track["clips"]
        }
        assert set(clips) == {"video-left", "video-right", "audio-left", "audio-right"}
        assert clips["video-left"]["durationUs"] == 2_000_000
        assert clips["audio-left"]["durationUs"] == 2_000_000
        assert clips["video-right"]["sourceInUs"] == 4_000_000
        assert clips["audio-right"]["sourceInUs"] == 4_000_000
        assert clips["video-left"]["linkGroupId"] == "av-original"
        assert clips["audio-left"]["linkGroupId"] == "av-original"
        assert clips["video-right"]["linkGroupId"] == "av-right"
        assert clips["audio-right"]["linkGroupId"] == "av-right"


@pytest.mark.asyncio
async def test_segment_export_creation_is_idempotent_and_preserves_each_config() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "分段导入"})
        ).json()
        asset_id = await _ready_video_asset(project["id"])
        added = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "segment-add-source",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": _media_clip(
                            "source-clip",
                            track_id="visual-1",
                            kind="video",
                            asset_id=asset_id,
                            link_group_id="source-group",
                        ),
                    }
                ],
            },
        )
        assert added.status_code == 200, added.text
        body = {
            "expectedRevision": 1,
            "requestId": "segment-export-request",
            "target": {"newProjectTitle": "分镜工坊"},
            "segments": [
                {
                    "clipId": "source-clip",
                    "name": "开场镜头",
                    "resolution": "1080p",
                    "fps": 60,
                    "quality": "high",
                    "audioMode": "mute",
                }
            ],
        }
        created = await client.post(
            f"/v1/video-editor/projects/{project['id']}/segment-exports", json=body
        )
        repeated = await client.post(
            f"/v1/video-editor/projects/{project['id']}/segment-exports", json=body
        )
        assert created.status_code == repeated.status_code == 200
        assert repeated.json()["id"] == created.json()["id"]
        detail = created.json()["resultDetail"]
        assert detail["timelineRevision"] == 1
        assert detail["segments"][0] == {
            "clipId": "source-clip",
            "name": "开场镜头",
            "sourceInUs": 2_000_000,
            "durationUs": 4_000_000,
            "playbackRate": 1,
            "assetId": asset_id,
            "status": "queued",
            "progress": 0,
        }
        cancelled = await client.post(
            f"/v1/video-editor/projects/{project['id']}/segment-exports/"
            f"{created.json()['id']}/cancel"
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_video_editor_business_routes_hide_other_workspace_projects() -> None:
    await _reset_projects()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "租户隔离"})
        ).json()

        async def other_workspace(session: SessionDep) -> StudioPrincipal:
            bind_workspace(session, "other-workspace")
            return StudioPrincipal(
                user_id="other-user",
                workspace_id="other-workspace",
                membership_id="other-membership",
                workspace_access="owner",
                member_role="owner",
                is_platform_admin=False,
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other-session",
            )

        app.dependency_overrides[require_studio_auth] = other_workspace
        try:
            root = f"/v1/video-editor/projects/{project['id']}"
            requests = (
                ("GET", f"{root}/timeline", None),
                ("GET", f"{root}/preview/frame?revision=0&timeUs=0", None),
                (
                    "POST",
                    f"{root}/renders/preflight",
                    {"expectedRevision": 0, "preset": "720p30", "startUs": 0},
                ),
                (
                    "POST",
                    f"{root}/renders",
                    {
                        "expectedRevision": 0,
                        "requestId": "other-render",
                        "preset": "720p30",
                        "startUs": 0,
                        "previewFingerprint": "a" * 64,
                    },
                ),
                ("GET", f"{root}/renders", None),
                ("GET", f"{root}/renders/task-id", None),
                ("POST", f"{root}/renders/task-id/cancel", None),
                (
                    "POST",
                    f"{root}/segment-exports",
                    {
                        "expectedRevision": 0,
                        "requestId": "other-segment",
                        "target": {"newProjectTitle": "隔离目标"},
                        "segments": [{"clipId": "clip", "name": "片段"}],
                    },
                ),
                ("GET", f"{root}/segment-exports", None),
                ("GET", f"{root}/segment-exports/task-id", None),
                ("GET", f"{root}/segment-exports/task-id/download", None),
                ("POST", f"{root}/segment-exports/task-id/cancel", None),
            )
            for method, path, body in requests:
                response = await client.request(method, path, json=body)
                assert response.status_code == 404, (path, response.text)
        finally:
            app.dependency_overrides.pop(require_studio_auth, None)


@pytest.mark.asyncio
async def test_senseaudio_audio_provider_payloads_and_results_follow_contract() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v2/music/song/create":
            return httpx.Response(200, json={"task_id": "music-task"})
        if request.url.path == "/v1/music/song/pending/music-task":
            return httpx.Response(
                200,
                json={
                    "status": "SUCCESS",
                    "response": {"data": [{"audio_url": "https://cdn.example/bgm.wav"}]},
                },
            )
        return httpx.Response(
            200,
            json={
                "generation_id": "sfx-generation",
                "status": "completed",
                "items": [{"audio_url": "https://cdn.example/door.mp3"}],
            },
        )

    transport = httpx.MockTransport(handler)
    task_id = await create_music_task(
        base_url="https://api.senseaudio.cn/v1",
        api_key="secret",
        model="senseaudio-music-2.0-260626",
        prompt="稳定、克制的片头音乐",
        theme="未来实验室",
        style="氛围电子乐",
        duration=30,
        output_format="wav",
        reference_urls=["https://cdn.example/reference.mp3"],
        transport=transport,
    )
    assert task_id == "music-task"
    music_body = json.loads(requests[0].content)
    assert music_body["mode"] == "instrumental"
    assert music_body["audio_settings"] == {"format": "wav", "duration": 30}
    assert music_body["attachments"] == [
        {"type": "audio", "url": "https://cdn.example/reference.mp3"}
    ]
    status = await get_music_task(
        base_url="https://api.senseaudio.cn/v1",
        api_key="secret",
        task_id=task_id,
        transport=transport,
    )
    assert status.status == "completed"
    assert status.result_url == "https://cdn.example/bgm.wav"

    sfx_url = await create_sound_effect(
        base_url="https://api.senseaudio.cn/v1",
        api_key="secret",
        model="senseaudio-sfx-1.0-260626",
        text="木门被敲响三次",
        duration=3,
        smart_duration=False,
        prompt_influence=0.7,
        output_format="mp3",
        transport=transport,
    )
    assert sfx_url == "https://cdn.example/door.mp3"
    sfx_body = json.loads(requests[-1].content)
    assert sfx_body["variants_count"] == 1
    assert sfx_body["duration_seconds"] == 3
    assert sfx_body["smart_duration"] is False


def test_generated_audio_type_detection_is_magic_and_mime_safe() -> None:
    assert generated_type(b"RIFF\x00\x00\x00\x00WAVEfmt ", "audio/wav") == (
        "audio",
        "audio/wav",
        ".wav",
    )
    assert generated_type(b"ID3\x04\x00", "audio/mpeg") == (
        "audio",
        "audio/mpeg",
        ".mp3",
    )
    assert generated_type(b"\x00\x00\x00\x18ftypM4A ", "audio/mp4") == (
        "audio",
        "audio/mp4",
        ".m4a",
    )
    assert generated_type(b"ID3\x04\x00", "video/mp4") is None
