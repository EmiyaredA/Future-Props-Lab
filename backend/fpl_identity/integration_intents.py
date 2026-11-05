"""Issue inert integration intent ids from a current request; check original grants live."""

import secrets
import time
from dataclasses import asdict

import jwt
from fastapi import HTTPException
from sqlalchemy import select, text

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import Actor, issue_context, verify_context
from fpl_runtime.integration_intents import IntegrationDecision, IntegrationIntentReceipt, digest

from .live import active_actor
from .models import IntegrationIntent


def require_client(request, service):
    credentials = request.app.state.identity_options["service_credentials"]
    expected = credentials.get(service)
    value = request.headers.get("authorization", "").removeprefix("Bearer ")
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or not isinstance(expected, str)
        or len(expected) < 32
        or any(other == expected for name, other in credentials.items() if name != service)
        or not secrets.compare_digest(value.encode(), expected.encode())
    ):
        raise HTTPException(403, "integration_client_required")


class IntegrationIntents:
    def __init__(self, database, key, catalog, *, private_key=None, key_id="identity"):
        self.database, self.key, self.catalog = database, key, catalog
        self.private_key, self.key_id = private_key, key_id

    async def create(self, body):
        if not body.matches(self.catalog):
            raise HTTPException(403, "integration_source_forbidden")
        async with self.database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.scalar(
                select(IntegrationIntent).where(
                    IntegrationIntent.caller == body.caller,
                    IntegrationIntent.request_id == str(body.request_id),
                )
            )
            try:
                actor = verify_context(
                    body.assertion,
                    service=body.caller,
                    method=body.source_method,
                    path=body.source_path,
                    public_key=self.key,
                    allow_expired=prior is not None,
                )
            except (jwt.InvalidTokenError, ValueError, TypeError):
                raise HTTPException(401, "integration_source_required") from None
            if body.scope.kind == "demo.install" and actor.auth_kind != "session":
                raise HTTPException(403, "browser_session_required")
            if actor.purpose != "studio" or "configuration.manage" not in effective_permissions(
                actor.platform_role, frozenset(actor.scopes)
            ):
                raise HTTPException(403, "integration_permission_required")
            value = {
                "caller": body.caller,
                "method": body.source_method,
                "path": body.source_path,
                "actor": asdict(actor),
                "scope": body.scope.model_dump(mode="json"),
            }
            fingerprint = digest(value)
            if prior is not None:
                if prior.fingerprint != fingerprint:
                    raise HTTPException(409, "integration_intent_conflict")
                return IntegrationIntentReceipt(
                    id=prior.id, fingerprint=fingerprint, scope=body.scope
                )
            if not await active_actor(session, actor):
                raise HTTPException(401, "integration_source_revoked")
            row = IntegrationIntent(
                caller=body.caller,
                request_id=str(body.request_id),
                fingerprint=fingerprint,
                source_method=body.source_method,
                source_path=body.source_path,
                actor=value["actor"],
                scope=value["scope"],
            )
            session.add(row)
            await session.commit()
            return IntegrationIntentReceipt(id=row.id, fingerprint=fingerprint, scope=body.scope)

    async def check(self, body):
        async with self.database.sessions() as session:
            row = await session.get(IntegrationIntent, str(body.intent_id))
            if row is None:
                raise HTTPException(404, "integration_intent_not_found")
            if body.service in {"thought", "amadeus"} and row.caller != body.service:
                raise HTTPException(404, "integration_intent_not_found")
            if body.service == "models" and row.scope["kind"] not in {
                "mcp.validate",
                "tool.validate",
                "demo.install",
            }:
                raise HTTPException(403, "integration_scope_forbidden")
            actor = Actor(**{**row.actor, "scopes": tuple(row.actor["scopes"])})
            allowed = await active_actor(
                session, actor
            ) and "configuration.manage" in effective_permissions(
                actor.platform_role, frozenset(actor.scopes)
            )
            return IntegrationDecision(
                allowed=allowed, expires_at=int(time.time()) + 5, scope=row.scope, actor=row.actor
            )

    async def capacity_grant(self, body):
        async with self.database.sessions() as session:
            row = await session.get(IntegrationIntent, str(body.intent_id))
            if (
                row is None
                or row.caller != "integrations"
                or row.scope["kind"] not in {"tool.validate", "mcp.validate"}
            ):
                raise HTTPException(404, "integration_intent_not_found")
            actor = Actor(**{**row.actor, "scopes": tuple(row.actor["scopes"])})
            if body.operation in {"acquire", "demo"} and not await active_actor(session, actor):
                raise HTTPException(401, "integration_source_revoked")
            if self.private_key is None:
                raise HTTPException(503, "integration_grant_unavailable")
            return issue_context(
                actor,
                service="models",
                method="POST",
                path=body.path,
                private_key=self.private_key,
                key_id=self.key_id,
            )

    async def external_grant(self, body):
        async with self.database.sessions() as session:
            row = await session.get(IntegrationIntent, str(body.intent_id))
            if row is None or row.caller != "thought" or row.scope["kind"] != "external.sync":
                raise HTTPException(404, "integration_intent_not_found")
            actor = Actor(**{**row.actor, "scopes": tuple(row.actor["scopes"])})
            if not await active_actor(session, actor):
                raise HTTPException(401, "integration_source_revoked")
            if self.private_key is None:
                raise HTTPException(503, "integration_grant_unavailable")
            return issue_context(
                actor,
                service="integrations",
                method="POST",
                path=body.path,
                private_key=self.private_key,
                key_id=self.key_id,
            )

    async def demo_install_grant(self, body):
        async with self.database.sessions() as session:
            row = await session.get(IntegrationIntent, str(body.intent_id))
            if row is None or row.caller != "models" or row.scope["kind"] != "demo.install":
                raise HTTPException(404, "integration_intent_not_found")
            actor = Actor(**{**row.actor, "scopes": tuple(row.actor["scopes"])})
            if body.operation == "install" and not await active_actor(session, actor):
                raise HTTPException(401, "integration_source_revoked")
            if self.private_key is None:
                raise HTTPException(503, "integration_grant_unavailable")
            return issue_context(
                actor,
                service="integrations",
                method=body.method,
                path=body.path,
                private_key=self.private_key,
                key_id=self.key_id,
            )
