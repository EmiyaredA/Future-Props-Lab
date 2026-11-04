"""Developer-authored acceptance plans and read-only deployment connection status."""

import os

from sqlalchemy import select

from app.capabilities.agents.cli import probe
from app.capabilities.agents.cli.catalog import DEFINITIONS, connection
from app.console.governance.code_agents import authorized
from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS
from app.runtime.config import get_settings

from .node_schemas import AcceptanceSchemeOut, NodeAcceptanceCatalogOut, NodeAcceptanceTemplateOut
from .templates import builtin_templates

SCHEMES = {
    "motion-transfer:api": ("模型 API 方案", "model_api"),
    "motion-transfer:codex": ("Codex 方案", "code_agent"),
    "motion-transfer:claude-code": ("Claude Code 方案", "code_agent"),
    "motion-transfer:opencode": ("OpenCode 方案", "code_agent"),
    "motion-transfer:dsh": ("DeepSeek Harness 方案", "code_agent"),
    "motion-transfer:pi": ("Pi 方案", "code_agent"),
}
TEMPLATE_VERSION = 1
INPUT_VERSION = 1
API_RESULT_VERSION = 1
AGENT_REPORT_VERSION = 1
SCHEME_VERSION = 1


def cli_configuration(settings, scheme_id):
    agent_id = scheme_id.removeprefix("motion-transfer:")
    _, path, _ = connection(settings, agent_id)
    prefix = "claude" if agent_id == "claude-code" else agent_id
    users = getattr(settings, f"fpl_acceptance_{prefix}_user_ids", "")
    return agent_id, path, set(filter(None, users.split(os.pathsep)))


async def fixed_model(session, owner_user_id, settings):
    if (
        settings.fpl_acceptance_model_owner_user_id != owner_user_id
        or not settings.fpl_acceptance_model_id
    ):
        return None
    pair = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelEntry.provider_id == ModelProvider.id)
            .where(
                ModelEntry.owner_user_id == owner_user_id,
                ModelProvider.owner_user_id == owner_user_id,
                ModelEntry.id == settings.fpl_acceptance_model_id,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
                ModelProvider.kind.in_(TEXT_PROVIDER_KINDS),
            )
        )
    ).first()
    if not pair or not {"chat", "vision"} <= set(pair[0].capabilities or []):
        return None
    return pair if pair[1].api_key_ciphertext or pair[1].base_url else None


async def scheme_status(
    session, owner_user_id, user_id, identity, *, check_cli=True, settings=None
):
    settings = settings or get_settings()
    title, kind = SCHEMES[identity]
    label, slug, provider_kind = title, "", ""
    if kind == "model_api":
        pair = await fixed_model(session, owner_user_id, settings)
        available = bool(pair)
        message = "已配置" if pair else "尚未配置本空间可用的固定视觉模型"
        if pair:
            label = f"{pair[0].label or pair[0].slug} · {pair[1].name}"
            slug, provider_kind = pair[0].slug, pair[1].kind
    else:
        agent, path, users = cli_configuration(settings, identity)
        label = DEFINITIONS[agent].name

        available = bool(
            path and await authorized(session, owner_user_id, user_id, agent, "visual_acceptance")
        )
        message = "已配置" if available else "此账号尚未获准使用该固定 Agent 连接"
        if available and check_cli:
            available, message = await probe(agent, path)
    return AcceptanceSchemeOut(
        id=identity,
        title=title,
        kind=kind,
        available=available,
        message=message,
        connection_label=label,
        model_slug=slug,
        provider_kind=provider_kind,
        input_description="角色基准图、原动作抽帧、输出抽帧、检查要求"
        if kind == "model_api"
        else "节点要求、原动作视频、角色参考、当前输出",
        output_description="逐项建议、证据帧、无法判断项"
        if kind == "model_api"
        else "验收报告、问题区间、证据附件",
    )


async def catalog(session, owner_user_id, user_id):
    criteria = builtin_templates()[0].document.criteria
    return NodeAcceptanceCatalogOut(
        items=[
            NodeAcceptanceTemplateOut(
                criteria=criteria,
                schemes=[
                    await scheme_status(session, owner_user_id, user_id, key) for key in SCHEMES
                ],
            )
        ]
    )


def connection_signature(scheme_id, settings, pair=None):
    import hashlib
    import json

    def fingerprint(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    if pair:
        model, provider = pair
        return fingerprint(
            {
                "model_id": model.id,
                "slug": model.slug,
                "provider_id": provider.id,
                "kind": provider.kind,
                "updated_at": str(provider.updated_at),
                "model_updated_at": str(model.updated_at),
            }
        )
    kind, path, _ = cli_configuration(settings, scheme_id)
    return fingerprint({"kind": kind, "executable": path})
