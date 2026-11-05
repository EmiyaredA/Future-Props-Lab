"""CAS and audit coordinate fixed tool installation without holding a cross-service transaction."""

from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

import httpx
from sqlalchemy import select, text

from studio.apps.model_service.admission.task_usage import OwnedCatalogTaskUsage
from studio.apps.model_service.audit.audit import add_event
from studio.apps.model_service.audit.audit_client import PreparedChange
from studio.apps.model_service.catalog.service import ModelCatalogService
from studio.apps.model_service.storage.demo_install_records import DemoInstallation
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.errors import AccountError
from studio.contracts.integrations.integration_intents import (
    DemoInstallGrant,
    IntegrationScope,
    digest,
)
from studio.contracts.model_service.model_audit import PreparedModelAudit
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.tasks.polling import PollingTaskRunner

from .defaults import OwnedCatalogDefaults


class DemoInstallClient:
    def __init__(self, intents, *, base_url="http://integrations:8080", transport=None):
        self.intents = intents
        self.client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
        )

    async def request(self, intent_id, operation):
        description = DemoInstallGrant(intent_id=intent_id, operation=operation)
        assertion = await self.intents.demo_install_grant(intent_id, operation)
        try:
            response = await self.client.request(
                description.method, description.path, headers={HEADER: assertion}
            )
            if operation == "receipt" and response.status_code == 404:
                return None
            if response.status_code == 409:
                raise AccountError("demo_service_already_installed")
            response.raise_for_status()
            value = response.json()
            if (
                set(value) != {"id", "message"}
                or not isinstance(value["id"], str)
                or len(value["id"]) > 100
            ):
                raise ValueError("installation response")
            return value
        except (httpx.HTTPError, ValueError, TypeError):
            raise OperationError(
                "演示工具安装结果待确认，请刷新后重试原操作", "demo_installation_unconfirmed", 503
            ) from None

    async def close(self):
        await self.client.aclose()


class DemoInstallations(PollingTaskRunner):
    runner_name = "model-demo-tool-installation"

    def __init__(self, database, intents, client):
        super().__init__()
        self.database, self.intents, self.client = database, intents, client

    async def start_install(self, session, principal, body, *, assertion, method, path, audits):
        identity = str(
            uuid5(
                NAMESPACE_URL,
                f"fpl.example-tools:{principal.owner_user_id}:{body.expected_catalog_revision}",
            )
        )
        prior = await session.get(DemoInstallation, identity)
        await session.rollback()
        if prior is None:
            scope = IntegrationScope(
                kind="demo.install",
                task_id=identity,
                connection_id="example_tools",
                connection_revision=body.expected_catalog_revision,
                input_sha256=digest(
                    {
                        "service_id": "example_tools",
                        "expected_catalog_revision": body.expected_catalog_revision,
                    }
                ),
            )
            receipt = await self.intents.enroll(
                request_id=identity, assertion=assertion, method=method, path=path, scope=scope
            )
            prepared = await audits(
                "demo_service.installed", {"revision": body.expected_catalog_revision + 1}
            )
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.get(DemoInstallation, identity)
            if prior is None:
                catalog = ModelCatalogService(
                    session,
                    defaults_store=OwnedCatalogDefaults(session),
                    task_usage=OwnedCatalogTaskUsage(session),
                )
                await catalog.advance_revision(body.expected_catalog_revision)
                session.add(
                    DemoInstallation(
                        id=identity,
                        owner_user_id=principal.owner_user_id,
                        expected_revision=body.expected_catalog_revision,
                        intent_id=str(receipt.id),
                        audit={
                            "receipt": prepared.receipt.model_dump(mode="json"),
                            "event_type": prepared.event_type,
                            "detail": prepared.detail,
                            "created_at": prepared.created_at.isoformat(),
                        },
                    )
                )
                await session.commit()
            else:
                await session.rollback()
        await self.process(identity, principal.owner_user_id)
        async with self.database.sessions(info={"owner_user_id": principal.owner_user_id}) as owned:
            row = await owned.get(DemoInstallation, identity)
            if row.status == "complete":
                return dict(row.result)
            if row.error_code == "demo_service_already_installed":
                raise AccountError(row.error_code)
            if row.status == "failed":
                raise OperationError(
                    "原演示安装授权已撤销，未执行新安装", "demo_installation_revoked", 403
                )
        raise OperationError("演示工具安装结果待确认", "demo_installation_unconfirmed", 503)

    async def process(self, identity, owner):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(DemoInstallation, identity)
            if row is None or row.status != "pending":
                return
            intent_id = row.intent_id
        result = await self.client.request(intent_id, "receipt")
        error = ""
        if result is None:
            decision = await self.intents.check(intent_id)
            if (
                decision.scope.kind != "demo.install"
                or str(decision.scope.task_id) != identity
                or decision.actor.user_id != owner
            ):
                raise OperationError("演示安装授权不匹配", "demo_installation_scope_mismatch", 503)
            if not decision.allowed:
                error = "authorization_revoked"
            else:
                try:
                    result = await self.client.request(intent_id, "install")
                except AccountError:
                    error = "demo_service_already_installed"
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(DemoInstallation, identity)
            if row.status != "pending":
                return
            if error:
                row.status, row.error_code = "failed", error
            else:
                prepared = PreparedChange(
                    PreparedModelAudit.model_validate(row.audit["receipt"]),
                    row.audit["event_type"],
                    row.audit["detail"],
                    datetime.fromisoformat(row.audit["created_at"]),
                )
                add_event(session, owner, prepared)
                row.status, row.result = "complete", result
            await session.commit()

    async def recover(self):
        pass

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            rows = list(
                await session.scalars(
                    select(DemoInstallation).where(DemoInstallation.status == "pending")
                )
            )
        for row in rows:
            await self.process(row.id, row.owner_user_id)
