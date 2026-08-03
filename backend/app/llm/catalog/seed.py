from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
)


async def seed_sayflow_text_catalog(session: AsyncSession) -> bool:
    """仅向全新目录播种 Sayflow 文本供应商，不覆盖后续用户配置。"""
    state = await session.get(ModelCatalogState, "default")
    providers = (await session.execute(select(ModelProvider))).scalars().all()
    if state is None or state.revision != 0 or providers:
        await session.rollback()
        return False

    for provider_seed in SAYFLOW_TEXT_CATALOG:
        provider = ModelProvider(
            id=provider_seed.id,
            name=provider_seed.name,
            kind=provider_seed.kind,
            base_url=provider_seed.base_url,
            api_key_ciphertext="",
            enabled=True,
            sort_order=provider_seed.sort_order,
        )
        session.add(provider)
        for sort_order, model_seed in enumerate(provider_seed.models):
            session.add(
                ModelEntry(
                    id=model_seed.id,
                    provider_id=provider.id,
                    slug=model_seed.slug,
                    label=model_seed.label,
                    description=model_seed.description,
                    capabilities=list(model_seed.capabilities),
                    enabled=True,
                    sort_order=sort_order,
                )
            )
    state.revision = 1
    await session.commit()
    return True
