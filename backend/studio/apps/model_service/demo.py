"""Models-owned deterministic demo configuration and account installation use cases."""

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert

from studio.apps.model_service.admission.task_usage import OwnedCatalogTaskUsage
from studio.apps.model_service.audit.audit import add_event
from studio.apps.model_service.catalog.service import ModelCatalogService
from studio.apps.model_service.demonstration.execution import (
    DEFAULT_CONFIG,
    SERVICE_IDS,
)
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.service_models import DemoSetting
from studio.contracts.identity.errors import AccountError
from studio.contracts.model_service.demo import MOCK_BASE_URL, DemoConfig, DemoConfigIn
from studio.runtime.time import utc_now

from .defaults import OwnedCatalogDefaults


class DemoConfiguration:
    def __init__(self, sessions):
        self.sessions = sessions

    async def read(self, session, service_id):
        row = await session.get(DemoSetting, service_id, populate_existing=True)
        return {
            "revision": row.revision if row else 0,
            "value": {**DEFAULT_CONFIG, **(row.payload if row else {})},
        }

    async def configuration(self, service_id):
        async with self.sessions() as session:
            return (await self.read(session, service_id))["value"]

    async def save(self, session, service_id, body):
        current = await self.read(session, service_id)
        if current["revision"] != body.expected_revision:
            raise AccountError("revision_conflict", current=current)
        values = dict(payload=body.value.model_dump(), updated_at=utc_now())
        if body.expected_revision == 0:
            statement = insert(DemoSetting).values(id=service_id, revision=1, **values)
            statement = statement.on_conflict_do_nothing(index_elements=[DemoSetting.id])
        else:
            statement = (
                update(DemoSetting)
                .where(DemoSetting.id == service_id, DemoSetting.revision == body.expected_revision)
                .values(revision=body.expected_revision + 1, **values)
            )
        if (await session.execute(statement)).rowcount != 1:
            raise AccountError("revision_conflict", current=await self.read(session, service_id))
        return await self.read(session, service_id)


class DemoServices:
    def __init__(self, configuration, runtime, *, cipher):
        self.configuration, self.runtime = configuration, runtime
        self.cipher = cipher

    async def services(self, session):
        return [
            {
                **await self.runtime.status(service_id),
                **await self.configuration.read(session, service_id),
            }
            for service_id in SERVICE_IDS
        ]

    async def configure(self, session, principal, service_id, body, *, audits):
        await session.rollback()
        prepared = await audits("demo_service.configured", {"service_id": service_id})
        await self.configuration.save(session, service_id, body)
        add_event(session, principal.user_id, prepared)
        await session.commit()
        self.runtime.record(service_id, "配置已更新")
        return next(item for item in await self.services(session) if item["id"] == service_id)

    async def action(self, session, principal, service_id, body, *, audits):
        current = await self.configuration.read(session, service_id)
        if current["revision"] != body.expected_revision:
            raise AccountError("revision_conflict", current=current)
        await session.rollback()
        prepared = await audits(
            "demo_service.action", {"service_id": service_id, "action": body.action}
        )
        value = DemoConfig.model_validate({**current["value"], "enabled": body.action == "start"})
        await self.configuration.save(
            session, service_id, DemoConfigIn(expected_revision=body.expected_revision, value=value)
        )
        add_event(session, principal.user_id, prepared)
        await session.commit()
        if body.action == "reinitialize":
            await self.runtime.reinitialize(service_id)
            await self.configuration.save(
                session,
                service_id,
                DemoConfigIn(
                    expected_revision=body.expected_revision + 1,
                    value=DemoConfig.model_validate(current["value"]),
                ),
            )
            await session.commit()
        self.runtime.record(
            service_id,
            {"start": "服务已启用", "stop": "服务已停用", "reinitialize": "重新初始化完成"}[
                body.action
            ],
        )
        return next(item for item in await self.services(session) if item["id"] == service_id)

    async def install(self, session, principal, service_id, body, *, audits):
        if not principal.allows("configuration.manage"):
            raise AccountError("account_access_required")
        if service_id != "mock_model":
            raise ValueError("Models演示目录用例只安装mock_model")
        existing = await session.scalar(
            select(ModelProvider.id).where(ModelProvider.base_url == MOCK_BASE_URL)
        )
        if existing:
            raise AccountError("demo_service_already_installed")
        await session.rollback()
        prepared = await audits(
            "demo_service.installed", {"revision": body.expected_catalog_revision + 1}
        )
        catalog = ModelCatalogService(
            session,
            defaults_store=OwnedCatalogDefaults(session),
            task_usage=OwnedCatalogTaskUsage(session),
            cipher=self.cipher,
        )
        await catalog.advance_revision(body.expected_catalog_revision)
        provider = ModelProvider(
            owner_user_id=principal.user_id,
            name="本地 Mock 模型",
            kind="openai",
            base_url=MOCK_BASE_URL,
            api_key_ciphertext=self.cipher.encrypt("local-demo-placeholder"),
            enabled=True,
        )
        session.add(provider)
        await session.flush()
        session.add(
            ModelEntry(
                owner_user_id=principal.user_id,
                provider_id=provider.id,
                slug="fpl-mock",
                label="本地确定性模型",
                capabilities=["chat", "tools"],
                categories=["text_generation"],
                enabled=True,
            )
        )
        add_event(session, principal.user_id, prepared)
        await session.commit()
        return {"id": provider.id, "message": "已接入当前账号"}
