from copy import deepcopy

import httpx
import pytest

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.galgame_workshop.schemas import GalgameStoryProject
from studio.apps.galgame_workshop.storage.models import (
    GalgameAssetMetadata,
)
from studio.config.settings import get_settings
from website_test_support import SessionLocal, app


def playable_story() -> dict:
    return {
        "schemaVersion": "1.0",
        "synopsis": "一次会抵达两个不同答案的夜间调查。",
        "characters": [{"id": "character-one", "name": "调查员", "description": "保持冷静"}],
        "scenes": [{"id": "scene-lab", "name": "夜间研究所", "description": "灯光昏暗"}],
        "variables": [],
        "assets": [],
        "chapters": [
            {
                "id": "chapter-1",
                "title": "第一章",
                "order": 1,
                "entryFragmentId": "main",
                "fragments": [
                    {
                        "id": "main",
                        "title": "抉择",
                        "blocks": [
                            {"id": "block-scene", "type": "scene", "sceneId": "scene-lab"},
                            {
                                "id": "block-dialogue",
                                "type": "dialogue",
                                "characterId": "character-one",
                                "text": "线索只够支持一次选择。",
                            },
                            {
                                "id": "block-branch",
                                "type": "branch",
                                "prompt": "检查哪里？",
                                "choices": [
                                    {
                                        "id": "choice-device",
                                        "text": "检查设备",
                                        "targetFragmentId": "device-ending",
                                    },
                                    {
                                        "id": "choice-clock",
                                        "text": "检查时钟",
                                        "targetFragmentId": "clock-ending",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        "id": "device-ending",
                        "title": "设备结局",
                        "blocks": [
                            {
                                "id": "block-device-text",
                                "type": "narration",
                                "text": "设备留下了干扰痕迹。",
                            },
                            {
                                "id": "block-device-end",
                                "type": "endChapter",
                                "endingId": "ending-device",
                                "label": "设备的答案",
                            },
                        ],
                    },
                    {
                        "id": "clock-ending",
                        "title": "时钟结局",
                        "blocks": [
                            {
                                "id": "block-clock-text",
                                "type": "narration",
                                "text": "时间戳出现了偏差。",
                            },
                            {
                                "id": "block-clock-end",
                                "type": "endChapter",
                                "endingId": "ending-clock",
                                "label": "时间的答案",
                            },
                        ],
                    },
                ],
            }
        ],
    }


def test_character_expression_flip_defaults_and_round_trips() -> None:
    document = playable_story()
    document["assets"] = [
        {
            "id": "portrait-default",
            "type": "image",
            "role": "characterPortrait",
            "fileId": "file-portrait",
            "status": "ready",
        }
    ]
    document["characters"][0]["expressions"] = [
        {
            "id": "expression-default",
            "label": "默认",
            "assetId": "portrait-default",
            "flipX": True,
        }
    ]
    document["characters"][0]["defaultExpressionId"] = "expression-default"

    parsed = GalgameStoryProject.model_validate(document)
    expression = parsed.characters[0].expressions[0]
    assert expression.flip_x is True
    assert expression.model_dump(mode="json", by_alias=True)["flipX"] is True

    del document["characters"][0]["expressions"][0]["flipX"]
    legacy = GalgameStoryProject.model_validate(document)
    assert legacy.characters[0].expressions[0].flip_x is False
    assert legacy.characters[0].expressions[0].render_mode == "staticImage"
    assert legacy.schema_version == "1.4"


def test_character_expression_sequence_validates_and_round_trips() -> None:
    document = playable_story()
    document["schemaVersion"] = "1.3"
    document["assets"] = [
        {
            "id": f"portrait-{index}",
            "type": "image",
            "role": "characterPortrait",
            "fileId": f"file-portrait-{index}",
            "status": "ready",
        }
        for index in range(3)
    ]
    document["characters"][0]["expressions"] = [
        {
            "id": "expression-idle",
            "label": "待机",
            "assetId": "portrait-0",
            "renderMode": "frameSequence",
            "sequence": {
                "fps": 12,
                "loop": False,
                "frames": [
                    {"id": "idle-frame-0", "assetId": "portrait-0"},
                    {"id": "idle-frame-1", "assetId": "portrait-1"},
                ],
            },
        }
    ]
    document["characters"][0]["defaultExpressionId"] = "expression-idle"

    parsed = GalgameStoryProject.model_validate(document)
    expression = parsed.characters[0].expressions[0]
    assert parsed.schema_version == "1.4"
    assert expression.render_mode == "frameSequence"
    assert expression.sequence is not None
    assert expression.sequence.playback_mode == "timed"
    assert expression.sequence.fps == 12
    assert expression.sequence.loop is False
    assert [frame.id for frame in expression.sequence.frames] == [
        "idle-frame-0",
        "idle-frame-1",
    ]

    default_fps = deepcopy(document)
    del default_fps["characters"][0]["expressions"][0]["sequence"]["fps"]
    default_expression = (
        GalgameStoryProject.model_validate(default_fps).characters[0].expressions[0]
    )
    assert default_expression.sequence is not None
    assert default_expression.sequence.fps == 2

    missing_sequence = deepcopy(document)
    del missing_sequence["characters"][0]["expressions"][0]["sequence"]
    with pytest.raises(ValueError, match="必须保存序列帧配置"):
        GalgameStoryProject.model_validate(missing_sequence)

    wrong_poster = deepcopy(document)
    wrong_poster["characters"][0]["expressions"][0]["assetId"] = "portrait-1"
    with pytest.raises(ValueError, match="代表素材必须与首帧一致"):
        GalgameStoryProject.model_validate(wrong_poster)

    duplicate_frame = deepcopy(document)
    duplicate_frame["characters"][0]["expressions"][0]["sequence"]["frames"][1]["id"] = (
        "idle-frame-0"
    )
    with pytest.raises(ValueError, match="帧 ID 不能重复"):
        GalgameStoryProject.model_validate(duplicate_frame)

    lip_sync = deepcopy(document)
    lip_sync_sequence = lip_sync["characters"][0]["expressions"][0]["sequence"]
    lip_sync_sequence["playbackMode"] = "lipSync"
    lip_sync_sequence["frames"].append({"id": "idle-frame-2", "assetId": "portrait-2"})
    parsed_lip_sync = GalgameStoryProject.model_validate(lip_sync)
    assert parsed_lip_sync.characters[0].expressions[0].sequence.playback_mode == "lipSync"

    incomplete_lip_sync = deepcopy(document)
    incomplete_lip_sync["characters"][0]["expressions"][0]["sequence"]["playbackMode"] = "lipSync"
    with pytest.raises(ValueError, match="闭口、半口和张口三帧"):
        GalgameStoryProject.model_validate(incomplete_lip_sync)

    wrong_role = deepcopy(document)
    wrong_role["assets"][1]["role"] = "sceneLayer"
    with pytest.raises(ValueError, match="序列帧只能引用角色立绘素材"):
        GalgameStoryProject.model_validate(wrong_role)


def test_galgame_cgs_validate_variants_blocks_and_timeline_conflicts() -> None:
    legacy = GalgameStoryProject.model_validate(playable_story())
    assert legacy.cgs == []

    document = playable_story()
    document["assets"] = [
        {
            "id": "cg-rain-asset",
            "type": "image",
            "role": "storyCg",
            "fileId": "file-cg",
            "status": "ready",
        }
    ]
    document["cgs"] = [
        {
            "id": "cg-rain",
            "name": "雨中告白",
            "description": "雨幕中的关键分镜",
            "variants": [
                {
                    "id": "normal",
                    "label": "标准",
                    "assetId": "cg-rain-asset",
                }
            ],
            "defaultVariantId": "normal",
        }
    ]
    fragment = document["chapters"][0]["fragments"][0]
    fragment["blocks"].insert(
        1,
        {
            "id": "show-cg",
            "type": "showCg",
            "cgId": "cg-rain",
            "variantId": None,
            "fit": "cover",
            "transition": {"durationMs": 400, "fade": True},
        },
    )
    fragment["blocks"].insert(
        3,
        {
            "id": "hide-cg",
            "type": "hideCg",
            "transition": {"durationMs": 250, "fade": True},
        },
    )
    parsed = GalgameStoryProject.model_validate(document)
    assert parsed.cgs[0].default_variant_id == "normal"
    show_cg = parsed.chapters[0].fragments[0].blocks[1]
    assert show_cg.type == "showCg"
    assert show_cg.display_mode == "fullscreen"
    assert show_cg.fit == "cover"
    assert show_cg.overlay.x == 50
    assert show_cg.overlay.width == 60
    assert show_cg.overlay.placement == "frontOfCharacters"
    assert show_cg.transition.duration_ms == 400

    overlay_document = deepcopy(document)
    overlay_block = overlay_document["chapters"][0]["fragments"][0]["blocks"][1]
    overlay_block["displayMode"] = "overlay"
    overlay_block["overlay"] = {
        "x": 25,
        "y": 40,
        "width": 85,
        "opacity": 0.65,
        "placement": "behindCharacters",
    }
    overlay = GalgameStoryProject.model_validate(overlay_document)
    overlay_cg = overlay.chapters[0].fragments[0].blocks[1]
    assert overlay_cg.type == "showCg"
    assert overlay_cg.display_mode == "overlay"
    assert overlay_cg.overlay.model_dump(by_alias=True) == {
        "x": 25.0,
        "y": 40.0,
        "width": 85.0,
        "opacity": 0.65,
        "placement": "behindCharacters",
    }

    invalid_overlay = deepcopy(overlay_document)
    invalid_overlay["chapters"][0]["fragments"][0]["blocks"][1]["overlay"]["width"] = 201
    with pytest.raises(ValueError, match="less than or equal to 200"):
        GalgameStoryProject.model_validate(invalid_overlay)

    duplicate_cg = deepcopy(document)
    duplicate_cg["cgs"].append(deepcopy(duplicate_cg["cgs"][0]))
    with pytest.raises(ValueError, match="CG ID 不能重复"):
        GalgameStoryProject.model_validate(duplicate_cg)

    duplicate_variant = deepcopy(document)
    duplicate_variant["cgs"][0]["variants"].append(
        deepcopy(duplicate_variant["cgs"][0]["variants"][0])
    )
    with pytest.raises(ValueError, match="同一 CG 的差分 ID 不能重复"):
        GalgameStoryProject.model_validate(duplicate_variant)

    missing_default = deepcopy(document)
    missing_default["cgs"][0]["defaultVariantId"] = None
    with pytest.raises(ValueError, match="存在 CG 差分时必须指定默认差分"):
        GalgameStoryProject.model_validate(missing_default)

    wrong_role = deepcopy(document)
    wrong_role["assets"][0]["role"] = "sceneBackground"
    with pytest.raises(ValueError, match="CG 差分只能引用剧情 CG 素材"):
        GalgameStoryProject.model_validate(wrong_role)

    missing_variant = deepcopy(document)
    missing_variant["chapters"][0]["fragments"][0]["blocks"][1]["variantId"] = "missing"
    with pytest.raises(ValueError, match="有效的 CG 差分"):
        GalgameStoryProject.model_validate(missing_variant)

    cross_cg_variant = deepcopy(document)
    cross_cg_variant["cgs"].append(
        {
            "id": "cg-other",
            "name": "另一张 CG",
            "variants": [{"id": "other", "label": "另一差分", "assetId": "cg-rain-asset"}],
            "defaultVariantId": "other",
        }
    )
    cross_cg_variant["chapters"][0]["fragments"][0]["blocks"][1]["variantId"] = "other"
    with pytest.raises(ValueError, match="有效的 CG 差分"):
        GalgameStoryProject.model_validate(cross_cg_variant)

    conflict = deepcopy(document)
    conflict_fragment = conflict["chapters"][0]["fragments"][0]
    conflict_fragment["timeline"] = {"durationMs": 3000}
    conflict_fragment["blocks"][1]["atMs"] = 1000
    conflict_fragment["blocks"][3]["atMs"] = 1000
    dialogue = conflict_fragment["blocks"][2]
    dialogue["startMs"] = 1000
    dialogue["endMs"] = 2000
    with pytest.raises(ValueError, match="同一时刻只能有一个 CG 事件"):
        GalgameStoryProject.model_validate(conflict)


@pytest.mark.asyncio
async def test_galgame_cg_asset_delete_reports_variant_location() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\ncg-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "CG 素材"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("confession.png", png, "image/png")},
            )
        ).json()
        document = playable_story()
        document["schemaVersion"] = "1.2"
        document["assets"] = [
            {
                "id": "cg-confession-asset",
                "type": "image",
                "role": "storyCg",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["cgs"] = [
            {
                "id": "cg-confession",
                "name": "雨中告白",
                "description": "",
                "variants": [
                    {
                        "id": "normal",
                        "label": "标准",
                        "assetId": "cg-confession-asset",
                    }
                ],
                "defaultVariantId": "normal",
            }
        ]
        document["chapters"][0]["fragments"][0]["blocks"].insert(
            1,
            {
                "id": "show-confession",
                "type": "showCg",
                "cgId": "cg-confession",
                "variantId": None,
                "fit": "contain",
            },
        )
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        blocked = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}",
            params={"expected_revision": uploaded["revision"]},
        )
        assert blocked.status_code == 409
        references = blocked.json()["references"]
        assert references == [
            {
                "kind": "cgVariant",
                "cgId": "cg-confession",
                "variantId": "normal",
                "storyAssetId": "cg-confession-asset",
                "label": "剧情 CG“雨中告白”· 标准",
            },
            {
                "kind": "showCg",
                "chapterId": "chapter-1",
                "fragmentId": "main",
                "blockId": "show-confession",
                "storyAssetId": "cg-confession-asset",
                "label": "第一章 · 抉择 · Block 2",
                "cgId": "cg-confession",
                "variantId": "normal",
            },
        ]

        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200


@pytest.mark.asyncio
async def test_galgame_cg_asset_repair_rebinds_story_asset() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\nrepair-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "CG 修复"})
        ).json()
        old_asset = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("old.png", png, "image/png")},
            )
        ).json()
        replacement = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("replacement.png", png, "image/png")},
            )
        ).json()
        document = playable_story()
        document["assets"] = [
            {
                "id": "cg-repair-asset",
                "type": "image",
                "role": "storyCg",
                "fileId": old_asset["id"],
                "status": "ready",
            }
        ]
        document["cgs"] = [
            {
                "id": "cg-repair",
                "name": "待修复 CG",
                "description": "",
                "variants": [
                    {
                        "id": "normal",
                        "label": "默认",
                        "assetId": "cg-repair-asset",
                    }
                ],
                "defaultVariantId": "normal",
            }
        ]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        repaired = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/repair",
            json={
                "expectedStoryRevision": saved.json()["revision"],
                "storyAssetId": "cg-repair-asset",
                "replacementFileId": replacement["id"],
            },
        )
        assert repaired.status_code == 200, repaired.text
        assert repaired.json()["revision"] == saved.json()["revision"] + 1
        story_asset = next(
            item
            for item in repaired.json()["document"]["assets"]
            if item["id"] == "cg-repair-asset"
        )
        assert story_asset["fileId"] == replacement["id"]


@pytest.mark.asyncio
async def test_galgame_timeline_master_readiness_checks_exact_media_duration() -> None:
    transport = httpx.ASGITransport(app=app)
    audio = b"\x00\x00\x00\x18ftypM4A complete-drama"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "主音轨工程"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("complete.m4a", audio, "audio/mp4")},
            )
        ).json()
        document = playable_story()
        document["assets"] = [
            {
                "id": "complete-drama",
                "type": "audio",
                "role": "timelineMaster",
                "label": "完整广播剧",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        fragment = document["chapters"][0]["fragments"][0]
        fragment["timeline"] = {
            "durationMs": 20_000,
            "masterAudio": {"assetId": "complete-drama", "volume": 100},
        }
        fragment["blocks"][1].update({"startMs": 1_000, "endMs": 6_000})
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

    async with SessionLocal() as session:
        metadata = await session.get(GalgameAssetMetadata, uploaded["id"])
        assert metadata is not None
        metadata.duration_ms = 20_002
        await session.commit()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        mismatch = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert "timeline_master_audio_duration_mismatch" in {
            issue["code"] for issue in mismatch["errors"]
        }

    async with SessionLocal() as session:
        metadata = await session.get(GalgameAssetMetadata, uploaded["id"])
        assert metadata is not None
        metadata.duration_ms = 20_001
        await session.commit()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        exact = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert "timeline_master_audio_duration_mismatch" not in {
            issue["code"] for issue in exact["errors"]
        }
        await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )


@pytest.mark.asyncio
async def test_galgame_scene_background_missing_file_blocks_completion() -> None:
    transport = httpx.ASGITransport(app=app)
    png = b"\x89PNG\r\n\x1a\nbackground-content"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "背景文件检查"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("day.png", png, "image/png")},
            )
        ).json()
        document = playable_story()
        document["assets"] = [
            {
                "id": "background-day-asset",
                "type": "image",
                "role": "sceneLayer",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["scenes"][0]["layers"] = [
            {
                "id": "background-day",
                "name": "白昼",
                "assetId": "background-day-asset",
            }
        ]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

    async with SessionLocal() as session:
        row = await session.get(VisualAsset, uploaded["id"])
        assert row is not None
        AssetStorage(get_settings()).path_for(row).unlink()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        report = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story/report")
        ).json()
        assert report["ready"] is False
        assert "missing_asset_file" in {issue["code"] for issue in report["errors"]}
        blocked = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}",
            json={"expected_revision": project["revision"], "status": "completed"},
        )
        assert blocked.status_code == 422
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200


@pytest.mark.asyncio
async def test_galgame_audio_upload_story_validation_and_delete_locations() -> None:
    transport = httpx.ASGITransport(app=app)
    samples = [
        ("theme.mp3", b"ID3\x04\x00\x00audio", "audio/mpeg"),
        ("room.wav", b"RIFF\x10\x00\x00\x00WAVEaudio", "audio/wav"),
        ("voice.m4a", b"\x00\x00\x00\x18ftypM4A audio", "audio/mp4"),
        ("bell.ogg", b"OggS\x00audio", "audio/ogg"),
    ]
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "声音工程"})
        ).json()
        uploaded = []
        for filename, content, mime_type in samples:
            response = await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": (filename, content, mime_type)},
            )
            assert response.status_code == 200, response.text
            assert response.json()["media_kind"] == "audio"
            uploaded.append(response.json())
        invalid = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets",
            files={"upload": ("fake.mp3", b"not-audio", "audio/mpeg")},
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "invalid_file_content"

        document = playable_story()
        roles = [
            ("sample-audio", "voiceSample", "声线样本"),
            ("line-audio", "voiceLine", "对白配音"),
            ("bgm-audio", "backgroundMusic", "主题曲"),
            ("ambient-audio", "ambientSound", "雨声"),
            ("sfx-audio", "soundEffect", "门铃"),
        ]
        document["assets"] = [
            {
                "id": asset_id,
                "type": "audio",
                "role": role,
                "label": label,
                "fileId": uploaded[0]["id"],
                "status": "ready",
            }
            for asset_id, role, label in roles
        ]
        document["characters"][0]["voiceProfile"] = {
            "name": "冷静低声线",
            "language": "zh-CN",
            "description": "克制",
            "sampleAssetId": "sample-audio",
        }
        blocks = document["chapters"][0]["fragments"][0]["blocks"]
        blocks[1]["voiceAssetId"] = "line-audio"
        blocks[1]["voiceVolume"] = 88
        blocks[1:1] = [
            {
                "id": "block-bgm",
                "type": "audio",
                "action": "play",
                "channel": "bgm",
                "assetId": "bgm-audio",
            },
            {
                "id": "block-ambient",
                "type": "audio",
                "action": "play",
                "channel": "ambient",
                "assetId": "ambient-audio",
            },
            {
                "id": "block-sfx",
                "type": "audio",
                "action": "play",
                "channel": "sfx",
                "assetId": "sfx-audio",
            },
        ]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        saved_blocks = saved.json()["document"]["chapters"][0]["fragments"][0]["blocks"]
        assert saved_blocks[1]["volume"] == 70
        assert saved_blocks[1]["loop"] is True
        assert saved_blocks[1]["fadeMs"] == 1000
        assert saved_blocks[3]["volume"] == 100
        assert saved_blocks[3]["loop"] is False
        assert saved_blocks[3]["fadeMs"] == 0

        protected = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded[0]['id']}",
            params={"expected_revision": uploaded[0]["revision"]},
        )
        assert protected.status_code == 409
        kinds = {item["kind"] for item in protected.json()["references"]}
        assert {"characterVoiceSample", "dialogueVoice", "audioBlock"} <= kinds

        mismatched = deepcopy(document)
        mismatched["chapters"][0]["fragments"][0]["blocks"][1]["assetId"] = "sfx-audio"
        rejected = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": mismatched},
        )
        assert rejected.status_code == 422

        cleared = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": playable_story()},
        )
        assert cleared.status_code == 200
        for asset in uploaded:
            removed = await client.delete(
                f"/v1/galgame-workshop/projects/{project['id']}/assets/{asset['id']}",
                params={"expected_revision": asset["revision"]},
            )
            assert removed.status_code == 200, removed.text
        await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )


@pytest.mark.asyncio
async def test_galgame_video_upload_overview_and_reference_protection() -> None:
    transport = httpx.ASGITransport(app=app)
    video = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00video"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "视频演出"})
        ).json()
        response = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets",
            files={"upload": ("opening.mp4", video, "video/mp4")},
        )
        assert response.status_code == 200, response.text
        uploaded = response.json()
        assert uploaded["media_kind"] == "video"

        document = playable_story()
        document["assets"] = [
            {
                "id": "opening-video",
                "type": "video",
                "role": "video",
                "label": "片头",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["chapters"][0]["fragments"][0]["blocks"].insert(
            1,
            {
                "id": "play-opening",
                "type": "video",
                "assetId": "opening-video",
                "action": "play",
            },
        )
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        overview = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/overview"
        )
        assert overview.status_code == 200, overview.text
        item = overview.json()["items"][0]
        assert item["category"] == "video"
        assert item["reference_count"] == 1
        assert item["references"][0]["blockId"] == "play-opening"

        blocked = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}",
            params={"expected_revision": uploaded["revision"]},
        )
        assert blocked.status_code == 409
        assert blocked.json()["references"][0]["kind"] == "videoBlock"

        cleared = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": playable_story()},
        )
        assert cleared.status_code == 200, cleared.text
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}",
            params={"expected_revision": uploaded["revision"]},
        )
        assert removed.status_code == 200, removed.text
        deleted = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_galgame_timeline_validates_ranges_roles_and_asset_references() -> None:
    transport = httpx.ASGITransport(app=app)
    audio = b"\x00\x00\x00\x18ftypM4A timeline-audio"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "时间轴工程"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                files={"upload": ("timeline.m4a", audio, "audio/mp4")},
            )
        ).json()

        document = playable_story()
        document["assets"] = [
            {
                "id": "runaway-bgm",
                "type": "audio",
                "role": "backgroundMusic",
                "label": "完整广播剧",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        fragment = document["chapters"][0]["fragments"][0]
        fragment["timeline"] = {"durationMs": 20_000}
        dialogue = fragment["blocks"][1]
        dialogue.update({"startMs": 1_000, "endMs": 6_000})
        fragment["blocks"].insert(
            2,
            {
                "id": "block-timed-narration",
                "type": "narration",
                "text": "时间继续流动。",
                "startMs": 7_000,
                "endMs": 9_000,
            },
        )
        fragment["blocks"].insert(
            3,
            {
                "id": "block-timeline-bgm",
                "type": "audio",
                "atMs": 0,
                "action": "play",
                "channel": "bgm",
                "assetId": "runaway-bgm",
                "volume": 100,
                "loop": False,
                "fadeMs": 0,
            },
        )
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        protected = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}",
            params={"expected_revision": uploaded["revision"]},
        )
        assert protected.status_code == 409
        assert "audioBlock" in {item["kind"] for item in protected.json()["references"]}

        invalid_documents = []
        missing_range = deepcopy(document)
        del missing_range["chapters"][0]["fragments"][0]["blocks"][1]["endMs"]
        invalid_documents.append(missing_range)

        overlap = deepcopy(document)
        overlap["chapters"][0]["fragments"][0]["blocks"][2].update(
            {"startMs": 5_000, "endMs": 8_000}
        )
        invalid_documents.append(overlap)

        out_of_range = deepcopy(document)
        out_of_range["chapters"][0]["fragments"][0]["blocks"][2]["endMs"] = 20_001
        invalid_documents.append(out_of_range)

        wrong_role = deepcopy(document)
        wrong_role["assets"][0]["role"] = "soundEffect"
        invalid_documents.append(wrong_role)

        missing_asset = deepcopy(document)
        missing_asset["chapters"][0]["fragments"][0]["blocks"][3]["assetId"] = "missing"
        invalid_documents.append(missing_asset)

        legacy_role = deepcopy(document)
        legacy_role["assets"][0]["role"] = "timelineTrack"
        invalid_documents.append(legacy_role)

        legacy_timeline_asset = deepcopy(document)
        legacy_timeline_asset["chapters"][0]["fragments"][0]["timeline"]["assetId"] = "runaway-bgm"
        invalid_documents.append(legacy_timeline_asset)

        for invalid_document in invalid_documents:
            rejected = await client.put(
                f"/v1/galgame-workshop/projects/{project['id']}/story",
                json={"expected_revision": 1, "document": invalid_document},
            )
            assert rejected.status_code == 422, rejected.text

        timeline_without_audio = deepcopy(document)
        timeline_without_audio["assets"] = []
        del timeline_without_audio["chapters"][0]["fragments"][0]["blocks"][3]
        saved_without_audio = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 1, "document": timeline_without_audio},
        )
        assert saved_without_audio.status_code == 200, saved_without_audio.text

        cleared = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 2, "document": playable_story()},
        )
        assert cleared.status_code == 200
        removed = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}",
            params={"expected_revision": uploaded["revision"]},
        )
        assert removed.status_code == 200
