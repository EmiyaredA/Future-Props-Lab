from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.migrations import apply_migrations
from studio.apps.model_service.catalog.seed import seed_sayflow_text_catalog
from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)

EXPECTED_OPENAI_MODELS = (
    ("senseaudio-s2", ["chat", "tools"], "百万上下文旗舰文本生成与工具调用模型"),
    ("senseaudio-s2-flash", ["chat", "tools"], "高速低成本文本生成与工具调用模型"),
    ("senseaudio-s2-lite", ["chat", "tools"], "轻量低成本文本生成模型"),
    ("senseaudio-s1", ["chat", "tools"], "百万上下文文本生成与工具调用模型"),
    (
        "senseaudio-vl-1.0-260319",
        ["chat", "vision", "tools"],
        "支持视觉理解和工具调用的多模态模型",
    ),
    (
        "senseaudio-vl-lite-1.0-260319",
        ["chat", "vision", "tools"],
        "轻量低成本视觉理解与工具调用模型",
    ),
    (
        "sensenova-6.8-flash-lite",
        ["chat", "vision", "tools"],
        "面向真实工作流的轻量多模态智能体模型",
    ),
    ("deepseek-v4.1-flash", ["chat", "tools"], "高速高性价比文本生成与工具调用模型"),
    (
        "deepseek-v4-flash-0731",
        ["chat", "tools"],
        "百万上下文高速文本生成与工具调用模型",
    ),
    ("qwen3.6-35b-a3b", ["chat", "vision", "tools"], "高效 MoE 视觉语言模型"),
    ("qwen3.8-27b", ["chat", "tools"], "通用文本生成与工具调用模型"),
    (
        "kimi-k2.6",
        ["chat", "vision", "tools"],
        "支持图像、视频理解与多步工具调用的多模态模型",
    ),
    ("glm-5.3-flash", ["chat", "tools"], "百万上下文高速文本生成模型"),
    ("glm-5.2", ["chat", "tools"], "百万上下文长程任务文本生成模型"),
    ("minimax-m2.7", ["chat", "tools"], "面向编程与 Agent 工作流的文本生成模型"),
    (
        "doubao-seed-2-0-pro-260215",
        ["chat", "vision", "tools"],
        "面向复杂推理与长链路任务的多模态通用模型",
    ),
)


@pytest.mark.asyncio
async def test_sayflow_text_catalog_seed_is_complete_and_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "seed.db"
    apply_migrations(database_path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        dbapi_connection.execute("PRAGMA foreign_keys = ON")

    sessions = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with sessions() as session:
            assert await seed_sayflow_text_catalog(session, "test-user") is True
        async with sessions() as session:
            assert await seed_sayflow_text_catalog(session, "test-user") is False
            providers = (await session.execute(select(ModelProvider))).scalars().all()
            models = (await session.execute(select(ModelEntry))).scalars().all()
            state = await session.get(ModelCatalogState, "test-user")

        assert {(item.name, item.kind) for item in providers} == {
            ("OpenAI 兼容网关", "openai"),
            ("Anthropic", "anthropic"),
            ("SenseAudio 图片生成", "senseaudio_image"),
            ("SenseAudio 视频生成", "senseaudio_video"),
            ("SenseAudio 专业说话人识别", "senseaudio_asr"),
            ("ASR API 专业语音识别", "senseaudio_asr_pro"),
            ("SenseAudio 实时语音", "senseaudio_realtime"),
            ("SenseAudio 音乐生成", "senseaudio_music"),
            ("SenseAudio 音效生成", "senseaudio_sfx"),
        }
        assert all(item.api_key_ciphertext == "" for item in providers)
        assert {item.name: item.enabled for item in providers} == {
            "OpenAI 兼容网关": True,
            "Anthropic": True,
            "SenseAudio 图片生成": False,
            "SenseAudio 视频生成": False,
            "SenseAudio 专业说话人识别": False,
            "ASR API 专业语音识别": False,
            "SenseAudio 实时语音": False,
            "SenseAudio 音乐生成": False,
            "SenseAudio 音效生成": False,
        }
        provider_ids = {p.kind: p.id for p in providers}
        openai_models = sorted(
            (item for item in models if item.provider_id == provider_ids["openai"]),
            key=lambda item: item.sort_order,
        )
        assert [(item.slug, item.capabilities, item.description) for item in openai_models] == list(
            EXPECTED_OPENAI_MODELS
        )
        assert {tuple(item.categories) for item in openai_models} == {("text_generation",)}
        assert [item.sort_order for item in openai_models] == list(range(16))
        assert {
            (item.slug, tuple(item.capabilities))
            for item in models
            if item.provider_id == provider_ids["anthropic"]
        } == {("claude-haiku-4-5-20251001", ("chat", "vision", "tools"))}
        assert {
            tuple(item.categories)
            for item in models
            if item.provider_id == provider_ids["anthropic"]
        } == {("text_generation",)}
        assert {
            (item.slug, tuple(item.capabilities))
            for item in models
            if item.provider_id == provider_ids["senseaudio_image"]
        } == {
            ("senseaudio-image-2.0-260319", ("image_generation",)),
            ("doubao-seedream-5-0-260128", ("image_generation",)),
            ("sensenova-u1-fast", ("image_generation",)),
        }
        assert {
            tuple(item.categories)
            for item in models
            if item.provider_id == provider_ids["senseaudio_image"]
        } == {("image_generation",)}
        assert {
            (item.slug, tuple(item.capabilities))
            for item in models
            if item.provider_id == provider_ids["senseaudio_video"]
        } == {("doubao-seedance-2-0-260128", ("video_generation",))}
        assert {
            tuple(item.categories)
            for item in models
            if item.provider_id == provider_ids["senseaudio_video"]
        } == {("video_generation",)}
        assert {
            (item.slug, tuple(item.capabilities), tuple(item.categories))
            for item in models
            if item.provider_id == provider_ids["senseaudio_asr"]
        } == {
            (
                "senseaudio-asr-pro-1.5-260319",
                ("speech_recognition",),
                ("speech_recognition",),
            )
        }
        assert {
            (item.slug, tuple(item.capabilities), tuple(item.categories))
            for item in models
            if item.provider_id == provider_ids["senseaudio_asr_pro"]
        } == {
            (
                "pro-asr",
                ("speech_recognition",),
                ("speech_recognition",),
            )
        }
        assert {
            (item.slug, tuple(item.capabilities), tuple(item.categories))
            for item in models
            if item.provider_id == provider_ids["senseaudio_realtime"]
        } == {
            (
                "senseaudio-realtime-1.0",
                ("voice",),
                ("end_to_end_speech",),
            )
        }
        assert {
            (item.slug, tuple(item.capabilities), tuple(item.categories))
            for item in models
            if item.provider_id == provider_ids["senseaudio_music"]
        } == {
            (
                "senseaudio-music-1.0-260319",
                ("audio_generation",),
                ("music_generation",),
            ),
            (
                "senseaudio-music-2.0-260626",
                ("audio_generation",),
                ("music_generation",),
            ),
        }
        assert {
            (item.slug, tuple(item.capabilities), tuple(item.categories))
            for item in models
            if item.provider_id == provider_ids["senseaudio_sfx"]
        } == {
            (
                "senseaudio-sfx-1.0-260626",
                ("audio_generation",),
                ("music_generation",),
            )
        }
        assert state is not None and state.revision == 1
    finally:
        await engine.dispose()
