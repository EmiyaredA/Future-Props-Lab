from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import new_id
from app.llm.catalog.metadata import categories_for_provider
from app.models import ModelCatalogState, ModelEntry, ModelProvider


@dataclass(frozen=True)
class SeedModel:
    id: str
    slug: str
    label: str
    description: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class SeedProvider:
    id: str
    name: str
    kind: str
    base_url: str
    sort_order: int
    models: tuple[SeedModel, ...]


SAYFLOW_TEXT_CATALOG = (
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000001",
        name="OpenAI 兼容网关",
        kind="openai",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=0,
        models=(
            SeedModel(
                id="f1000000-0000-4000-8000-000000000005",
                slug="senseaudio-s2",
                label="SenseAudio S2",
                description="百万上下文旗舰文本生成与工具调用模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000006",
                slug="senseaudio-s2-flash",
                label="SenseAudio S2 Flash",
                description="高速低成本文本生成与工具调用模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000001",
                slug="senseaudio-s2-lite",
                label="SenseAudio S2 Lite",
                description="轻量低成本文本生成模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000007",
                slug="senseaudio-s1",
                label="SenseAudio S1",
                description="百万上下文文本生成与工具调用模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000002",
                slug="senseaudio-vl-1.0-260319",
                label="SenseAudio VL 1.0",
                description="支持视觉理解和工具调用的多模态模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000008",
                slug="senseaudio-vl-lite-1.0-260319",
                label="SenseAudio VL Lite 1.0",
                description="轻量低成本视觉理解与工具调用模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000009",
                slug="sensenova-6.7-flash-lite",
                label="SenseNova 6.7 Flash-Lite",
                description="面向真实工作流的轻量多模态智能体模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000010",
                slug="deepseek-v4-flash",
                label="DeepSeek V4 Flash",
                description="高速高性价比文本生成与工具调用模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000003",
                slug="deepseek-v4-pro",
                label="DeepSeek V4 Pro",
                description="旗舰文本生成与工具调用模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000011",
                slug="qwen3.6-27b",
                label="Qwen3.6 27B",
                description="原生视觉语言 Dense 模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000012",
                slug="qwen3.6-35b-a3b",
                label="Qwen3.6 35B-A3B",
                description="高效 MoE 视觉语言模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000013",
                slug="kimi-k2.6",
                label="Kimi K2.6",
                description="支持图像、视频理解与多步工具调用的多模态模型",
                capabilities=("chat", "vision", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000014",
                slug="glm-5.1",
                label="GLM-5.1",
                description="面向长程任务与 Coding 的文本生成模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000015",
                slug="glm-5.2",
                label="GLM-5.2",
                description="百万上下文长程任务文本生成模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000016",
                slug="minimax-m2.7",
                label="MiniMax M2.7",
                description="面向编程与 Agent 工作流的文本生成模型",
                capabilities=("chat", "tools"),
            ),
            SeedModel(
                id="f1000000-0000-4000-8000-000000000017",
                slug="doubao-seed-2-0-pro-260215",
                label="Doubao Seed 2.0 Pro",
                description="面向复杂推理与长链路任务的多模态通用模型",
                capabilities=("chat", "vision", "tools"),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000002",
        name="Anthropic",
        kind="anthropic",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=1,
        models=(
            SeedModel(
                id="f1000000-0000-4000-8000-000000000004",
                slug="claude-haiku-4-5-20251001",
                label="Claude Haiku 4.5",
                description="支持视觉理解和工具调用的 Claude 模型",
                capabilities=("chat", "vision", "tools"),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000003",
        name="SenseAudio 图片生成",
        kind="senseaudio_image",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=2,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000001",
                slug="senseaudio-image-2.0-260319",
                label="SenseAudio Image 2.0",
                description="SenseAudio 高清多比例图片生成模型",
                capabilities=("image_generation",),
            ),
            SeedModel(
                id="f2000000-0000-4000-8000-000000000002",
                slug="senseaudio-image-1.0-260319",
                label="SenseAudio Image 1.0",
                description="SenseAudio 通用图片生成模型",
                capabilities=("image_generation",),
            ),
            SeedModel(
                id="f2000000-0000-4000-8000-000000000003",
                slug="doubao-seedream-5-0-260128",
                label="Doubao Seedream 5.0 Lite",
                description="高分辨率图片生成模型",
                capabilities=("image_generation",),
            ),
            SeedModel(
                id="f2000000-0000-4000-8000-000000000004",
                slug="sensenova-u1-fast",
                label="SenseNova U1 Fast",
                description="面向信息图与高密度版式的图片生成模型",
                capabilities=("image_generation",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000004",
        name="SenseAudio 视频生成",
        kind="senseaudio_video",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=3,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000005",
                slug="doubao-seedance-2-0-260128",
                label="Doubao Seedance 2.0",
                description="支持文本、首尾帧与多模态参考素材的视频生成模型",
                capabilities=("video_generation",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000005",
        name="SenseAudio 专业说话人识别",
        kind="senseaudio_asr",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=4,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000006",
                slug="senseaudio-asr-pro-1.5-260319",
                label="SenseAudio ASR Pro 1.5",
                description="支持说话人分离与句级时间戳的专业语音识别模型",
                capabilities=("speech_recognition",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000006",
        name="ASR API 专业语音识别",
        kind="senseaudio_asr_pro",
        base_url="http://180.184.148.131:30002/api/v2/asr/pro",
        sort_order=5,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000007",
                slug="pro-asr",
                label="专业语音识别",
                description="支持说话人分段、句级时间戳与保真文本整理的专业语音识别模型",
                capabilities=("speech_recognition",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000007",
        name="SenseAudio 实时语音",
        kind="senseaudio_realtime",
        base_url="wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog",
        sort_order=6,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000008",
                slug="senseaudio-realtime-1.0",
                label="SenseAudio Realtime 1.0",
                description="支持免按键双工、实时转写与语音打断的端到端语音模型",
                capabilities=("voice",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000008",
        name="SenseAudio 音乐生成",
        kind="senseaudio_music",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=7,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000009",
                slug="senseaudio-music-2.0-260626",
                label="SenseAudio Music 2.0",
                description="面向纯音乐与背景音乐创作的异步生成模型",
                capabilities=("audio_generation",),
            ),
        ),
    ),
    SeedProvider(
        id="f0000000-0000-4000-8000-000000000009",
        name="SenseAudio 音效生成",
        kind="senseaudio_sfx",
        base_url="https://api.senseaudio.cn/v1",
        sort_order=8,
        models=(
            SeedModel(
                id="f2000000-0000-4000-8000-000000000010",
                slug="senseaudio-sfx-1.0-260626",
                label="SenseAudio SFX 1.0",
                description="根据描述同步生成短音效的模型",
                capabilities=("audio_generation",),
            ),
        ),
    ),
)


async def ensure_workspace_model_catalog(session: AsyncSession, workspace_id: str) -> bool:
    """向指定 Workspace 的全新目录播种无密钥内置供应商。"""
    state = await session.get(ModelCatalogState, workspace_id)
    providers = (
        (
            await session.execute(
                select(ModelProvider).where(ModelProvider.workspace_id == workspace_id)
            )
        )
        .scalars()
        .all()
    )
    if (state is not None and state.revision != 0) or providers:
        return False
    if state is None:
        state = ModelCatalogState(workspace_id=workspace_id, revision=0)
        session.add(state)
        await session.flush()

    providers_by_id: dict[str, ModelProvider] = {}
    for provider_seed in SAYFLOW_TEXT_CATALOG:
        provider_id = provider_seed.id if workspace_id == "default" else new_id()
        provider = ModelProvider(
            id=provider_id,
            workspace_id=workspace_id,
            name=provider_seed.name,
            kind=provider_seed.kind,
            base_url=provider_seed.base_url,
            api_key_ciphertext="",
            enabled=provider_seed.kind in {"openai", "anthropic"},
            sort_order=provider_seed.sort_order,
        )
        session.add(provider)
        providers_by_id[provider_seed.id] = provider
    await session.flush()

    for provider_seed in SAYFLOW_TEXT_CATALOG:
        provider = providers_by_id[provider_seed.id]
        for sort_order, model_seed in enumerate(provider_seed.models):
            session.add(
                ModelEntry(
                    id=model_seed.id if workspace_id == "default" else new_id(),
                    workspace_id=workspace_id,
                    provider_id=provider.id,
                    slug=model_seed.slug,
                    label=model_seed.label,
                    description=model_seed.description,
                    capabilities=list(model_seed.capabilities),
                    categories=categories_for_provider(provider_seed.kind),
                    enabled=True,
                    sort_order=sort_order,
                )
            )
    state.revision = 1
    await session.flush()
    return True


async def seed_sayflow_text_catalog(session: AsyncSession) -> bool:
    """向历史 default Workspace 播种内置供应商。"""
    changed = await ensure_workspace_model_catalog(session, "default")
    await session.commit()
    return changed
