"""Published fixed acceptance schemes and their provider-neutral response values."""

from studio.apps.visual_workshop.acceptance.node_schemas import (
    AcceptanceSchemeOut,
    NodeAcceptanceCatalogOut,
    NodeAcceptanceTemplateOut,
)
from studio.apps.visual_workshop.acceptance.templates import builtin_templates

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


def scheme_out(identity, available, message, *, label, slug="", provider_kind=""):
    title, kind = SCHEMES[identity]
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


def catalog_out(schemes):
    return NodeAcceptanceCatalogOut(
        items=[
            NodeAcceptanceTemplateOut(
                criteria=builtin_templates()[0].document.criteria, schemes=schemes
            )
        ]
    )
