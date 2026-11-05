"""Installing synthetic tool entries is an owned transaction, not a cross-database write."""

from sqlalchemy import select, text

from app.integrations.models import ToolApiIntegration
from studio.apps.integrations.storage.demo_records import DemoToolInstallation
from studio.contracts.identity.errors import AccountError
from studio.contracts.integrations.integration_intents import digest
from studio.contracts.model_service.demo import TOOL_BASE_URL


class DemoToolInstallations:
    def __init__(self, database):
        self.database = database

    async def receipt(self, owner, intent_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(DemoToolInstallation, str(intent_id))
            return dict(row.result) if row else None

    async def install(self, actor, scope, intent_id):
        expected = digest(
            {"service_id": "example_tools", "expected_catalog_revision": scope.connection_revision}
        )
        if scope.connection_id != "example_tools" or scope.input_sha256 != expected:
            raise AccountError("account_access_forbidden")
        async with self.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.get(DemoToolInstallation, str(intent_id))
            if prior:
                return dict(prior.result)
            existing = await session.scalar(
                select(ToolApiIntegration.id).where(
                    ToolApiIntegration.url.startswith(TOOL_BASE_URL + "/")
                )
            )
            if existing:
                raise AccountError("demo_service_already_installed")
            rows = []
            for tool, label, parameters in (
                ("orders", "演示订单查询", {"order_id": {"type": "string"}}),
                ("products", "演示商品搜索", {"q": {"type": "string"}}),
                ("product", "演示商品详情", {"id": {"type": "string"}}),
            ):
                row = ToolApiIntegration(
                    owner_user_id=actor.user_id,
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
            result = {"id": rows[0].id, "message": "已接入当前账号"}
            session.add(
                DemoToolInstallation(
                    intent_id=str(intent_id), owner_user_id=actor.user_id, result=result
                )
            )
            await session.commit()
            return result
