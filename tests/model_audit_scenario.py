"""Audit intent delivery uses two temporary owned databases and no retained JWTs."""

from types import SimpleNamespace
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.console.models.accounts import SecurityAuditEvent
from studio.apps.identity.storage.service_models import ModelAuditDelivery, ModelAuditIntent
from studio.apps.model_service.audit.audit import add_child_event, add_event
from studio.apps.model_service.audit.audit_client import ModelAuditClient
from studio.apps.model_service.audit.audit_delivery import ModelAuditDelivery as DeliveryRunner
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS, GovernanceAudit
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.model_service.model_audit import (
    AuditSource,
    ChildModelAudit,
    ModelAuditRecord,
)
from studio.runtime.database.migrations import apply
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.sessions import Database
from studio.runtime.time import utc_now


class LostCommitReply(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.inner = httpx.ASGITransport(app=app)
        self.failed = False

    async def handle_async_request(self, request):
        response = await self.inner.handle_async_request(request)
        if request.url.path.endswith("/model-audit/commit") and not self.failed:
            self.failed = True
            await response.aread()
            raise httpx.ReadError("synthetic commit response loss", request=request)
        return response

    async def aclose(self):
        await self.inner.aclose()


async def exercise_audit(app, management, private, token, path, root, unsafe):
    models_root = root / "models-audit"
    apply(models_root / "service.db", "models", MIGRATIONS)
    database = Database("models", models_root, models=MODELS, account_models=ACCOUNT_MODELS)
    client = ModelAuditClient(
        credential="models-fixture-credential-" * 3, transport=LostCommitReply(app)
    )
    request = SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(service_assertion=token),
    )
    actor = verify_context(
        token,
        service="models",
        method="POST",
        path=path,
        public_key=app.state.identity_options["private_key"].public_key(),
    )
    try:
        prepared = await client.prepare(
            request, "platform.model_template.previewed", {"role_to": "user"}
        )
        assert token not in repr(prepared)
        async with database.sessions() as session:
            add_event(session, actor.user_id, prepared)
            await session.commit()
        # A rolled-back Models mutation leaves only an inert Identity intent.
        rolled_back = await client.prepare(
            request, "platform.model_template.previewed", {"role_to": "user"}
        )
        async with database.sessions() as session:
            add_event(session, actor.user_id, rolled_back)
            await session.flush()
            await session.rollback()
        source = "/v1/platform/model-service-templates/sync-jobs/" + str(uuid4()) + "/start"
        authorization = await management.get(
            "/_internal/v1/authorize",
            headers={
                **unsafe,
                "X-Fpl-Target-Service": "models",
                "X-Fpl-Request-Method": "POST",
                "X-Fpl-Request-Uri": source,
            },
        )
        assert authorization.status_code == 204, authorization.text
        start_request = SimpleNamespace(
            method="POST",
            url=SimpleNamespace(path=source),
            state=SimpleNamespace(service_assertion=authorization.headers[HEADER]),
        )
        parent = await client.prepare(
            start_request, "platform.model_template.sync_started", {"role_to": "user"}
        )
        child = ChildModelAudit(
            id=uuid4(), parent_id=parent.receipt.id, created_at=utc_now(), status="succeeded"
        )
        response = await private.post(
            "/_internal/v1/model-audit/prepare-child", json=child.model_dump(mode="json")
        )
        assert response.status_code == 409
        async with database.sessions() as session:
            add_event(session, actor.user_id, parent)
            add_child_event(session, actor.user_id, parent.receipt.id, "succeeded")
            await session.commit()
        async with app.state.database.sessions() as session:
            intents = list(await session.scalars(select(ModelAuditIntent)))
            assert len(intents) == 3
            assert all("assertion" not in row.payload.get("source", {}) for row in intents)
            assert all(token not in str(row.payload) for row in intents)
            assert not list(await session.scalars(select(ModelAuditDelivery)))
        assert (await management.post("/v1/auth/logout", headers=unsafe)).status_code == 204
        runner = DeliveryRunner(database.sessions, client)
        try:
            await runner.process_once()
        except OperationError as exc:
            assert exc.code == "model_audit_unavailable"
        else:
            raise AssertionError("the synthetic lost commit reply was not exercised")
        async with database.sessions() as session:
            row = await session.get(GovernanceAudit, str(prepared.receipt.id))
            assert row.delivered_at is None
            assert not any(
                "assertion" in column.name for column in GovernanceAudit.__table__.columns
            )
        await runner.process_once()
        await runner.process_once()
        async with app.state.database.sessions() as session:
            events = list(
                await session.scalars(
                    select(SecurityAuditEvent).where(
                        SecurityAuditEvent.event_type.in_(
                            (
                                "platform.model_template.previewed",
                                "platform.model_template.sync_started",
                                "platform.model_template.sync_item",
                            )
                        )
                    )
                )
            )
            assert len(events) == 3
            assert len(list(await session.scalars(select(ModelAuditDelivery)))) == 3
        async with database.sessions() as session:
            rows = list(await session.scalars(select(GovernanceAudit)))
            assert len(rows) == 3 and all(row.delivered_at is not None for row in rows)
        pointer = prepared.receipt.model_dump(mode="json")
        assert (
            await private.post(
                "/_internal/v1/model-audit/commit", json={**pointer, "fingerprint": "0" * 64}
            )
        ).status_code == 409
        assert (
            await private.post(
                "/_internal/v1/model-audit/commit", json={**pointer, "actor_user_id": "forged"}
            )
        ).status_code == 422
        assert (
            await private.post(
                "/_internal/v1/model-audit/commit",
                json=pointer,
                headers={"Origin": "https://browser.invalid"},
            )
        ).status_code == 403
        fresh = ModelAuditRecord(
            id=uuid4(),
            event_type="platform.model_template.previewed",
            created_at=utc_now(),
            detail={"role_to": "user"},
            source=AuditSource(method="POST", path=path, assertion=token),
        )
        assert (
            await private.post(
                "/_internal/v1/model-audit/prepare", json=fresh.model_dump(mode="json")
            )
        ).status_code == 401
    finally:
        await client.close()
        await database.close()
