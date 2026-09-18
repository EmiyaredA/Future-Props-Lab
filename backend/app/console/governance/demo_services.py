from sqlalchemy import select

from app.capabilities.identity.errors import AccountError
from app.console.governance.governance_transactions import begin_governance
from app.console.governance.platform_policy import read_setting
from app.console.governance.platform_settings import write_setting
from app.console.governance.service import add_audit_event
from app.demo_runtime.runtime import (
    DEFAULT_CONFIG,
    MOCK_BASE_URL,
    SERVICE_IDS,
    TOOL_BASE_URL,
    record,
    reinitialize,
    status,
)
from app.llm.catalog.service import ModelCatalogService
from app.llm.models import ModelEntry, ModelProvider
from app.models import ToolApiIntegration
from app.runtime.credentials import encrypt_secret


async def services(session):
    result = []
    for service_id in SERVICE_IDS:
        setting = await read_setting(session, f"demo_service:{service_id}", DEFAULT_CONFIG)
        result.append({**await status(service_id), **setting})
    return result


async def configure(session, principal, service_id, body, client_ip):
    await write_setting(
        session,
        principal,
        f"demo_service:{service_id}",
        body.value.model_dump(),
        body.expected_revision,
        client_ip,
    )
    record(service_id, "配置已更新")
    return next(item for item in await services(session) if item["id"] == service_id)


async def action(session, principal, service_id, body, client_ip):
    state = await read_setting(session, f"demo_service:{service_id}", DEFAULT_CONFIG)
    if body.expected_revision != state["revision"]:
        raise AccountError("revision_conflict", current=state)
    value = {**state["value"], "enabled": body.action == "start"}
    updated = await write_setting(
        session, principal, f"demo_service:{service_id}", value, body.expected_revision, client_ip
    )
    if body.action == "reinitialize":
        await reinitialize(service_id)
        await write_setting(
            session,
            principal,
            f"demo_service:{service_id}",
            {**value, "enabled": state["value"]["enabled"]},
            updated["revision"],
            client_ip,
        )
    record(
        service_id,
        {"start": "服务已启用", "stop": "服务已停用", "reinitialize": "重新初始化完成"}[
            body.action
        ],
    )
    return next(item for item in await services(session) if item["id"] == service_id)


async def install(session, principal, service_id, expected_catalog_revision, client_ip):
    principal = await begin_governance(session, principal)
    if not principal.allows("configuration.manage"):
        raise AccountError("workspace_owner_required")
    if service_id == "mock_model":
        exists = await session.scalar(
            select(ModelProvider.id).where(
                ModelProvider.workspace_id == principal.workspace_id,
                ModelProvider.base_url == MOCK_BASE_URL,
            )
        )
    else:
        exists = await session.scalar(
            select(ToolApiIntegration.id).where(
                ToolApiIntegration.workspace_id == principal.workspace_id,
                ToolApiIntegration.url.startswith(TOOL_BASE_URL + "/"),
            )
        )
    if exists:
        raise AccountError("demo_service_already_installed")
    revision = await ModelCatalogService(session)._bump(expected_catalog_revision)
    if service_id == "mock_model":
        provider = ModelProvider(
            workspace_id=principal.workspace_id,
            name="本地 Mock 模型",
            kind="openai",
            base_url=MOCK_BASE_URL,
            api_key_ciphertext=encrypt_secret("local-demo-placeholder"),
            enabled=True,
        )
        session.add(provider)
        await session.flush()
        session.add(
            ModelEntry(
                workspace_id=principal.workspace_id,
                provider_id=provider.id,
                slug="fpl-mock",
                label="本地确定性模型",
                capabilities=["chat", "tools"],
                categories=["text_generation"],
                enabled=True,
            )
        )
        result_id = provider.id
    else:
        rows = []
        for tool, label, parameters in (
            ("orders", "演示订单查询", {"order_id": {"type": "string"}}),
            ("products", "演示商品搜索", {"q": {"type": "string"}}),
            ("product", "演示商品详情", {"id": {"type": "string"}}),
        ):
            row = ToolApiIntegration(
                workspace_id=principal.workspace_id,
                name=label,
                description="固定演示数据，不读取真实业务记录",
                method="GET",
                url=TOOL_BASE_URL + "/" + tool,
                auth_kind="none",
                parameters_schema={"type": "object", "properties": parameters},
                query_template={},
                enabled=True,
                status="unchecked",
            )
            session.add(row)
            rows.append(row)
        await session.flush()
        result_id = rows[0].id
    add_audit_event(
        session,
        "demo_service.installed",
        actor_user_id=principal.user_id,
        workspace_id=principal.workspace_id,
        client_ip=client_ip,
        metadata={"revision": revision},
    )
    await session.commit()
    return {"id": result_id, "message": "已接入当前工作区"}
