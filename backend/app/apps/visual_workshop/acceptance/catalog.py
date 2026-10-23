"""Developer-authored acceptance plans and read-only deployment connection status."""

import os

from sqlalchemy import select

from app.capabilities.agents.cli import probe
from app.capabilities.agents.cli.catalog import connection
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
}
TEMPLATE_VERSION = 1
INPUT_VERSION = 1
API_RESULT_VERSION = 1
AGENT_REPORT_VERSION = 1
SCHEME_VERSION = 1


def cli_configuration(settings, scheme_id):
    codex = scheme_id == "motion-transfer:codex"

    agent_id = "codex" if codex else "claude-code"
    _, path, _ = connection(settings, agent_id)
    users = (
        settings.fpl_acceptance_codex_user_ids if codex else settings.fpl_acceptance_claude_user_ids
    )
    return ("codex" if codex else "claude-code"), path, set(filter(None, users.split(os.pathsep)))


async def fixed_model(session, workspace_id, settings):
    if (
        settings.fpl_acceptance_model_workspace_id != workspace_id
        or not settings.fpl_acceptance_model_id
    ):
        return None
    pair = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelEntry.provider_id == ModelProvider.id)
            .where(
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
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


async def scheme_status(session, workspace_id, user_id, identity, *, check_cli=True, settings=None):
    settings = settings or get_settings()
    title, kind = SCHEMES[identity]
    label, slug, provider_kind = title, "", ""
    if kind == "model_api":
        pair = await fixed_model(session, workspace_id, settings)
        available = bool(pair)
        message = "已配置" if pair else "尚未配置本空间可用的固定视觉模型"
        if pair:
            label = f"{pair[0].label or pair[0].slug} · {pair[1].name}"
            slug, provider_kind = pair[0].slug, pair[1].kind
    else:
        agent, path, users = cli_configuration(settings, identity)
        label = "Codex" if agent == "codex" else "Claude Code"

        available = bool(
            path
            and await authorized(
                session, workspace_id, user_id, agent, "visual_acceptance", settings=settings
            )
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


async def catalog(session, workspace_id, user_id):
    criteria = builtin_templates()[0].document.criteria
    return NodeAcceptanceCatalogOut(
        items=[
            NodeAcceptanceTemplateOut(
                criteria=criteria,
                schemes=[
                    await scheme_status(session, workspace_id, user_id, key) for key in SCHEMES
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
