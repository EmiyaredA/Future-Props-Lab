"""Only an authorized original write can issue a bounded retention authority."""

import re
import secrets
import time

import jwt
from fastapi import HTTPException

from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.claims import verify_context
from fpl_runtime.retention_authority import issue_retention, verify_retention

from .live import active_actor


def require_credential(options, service, credential):
    expected = options["service_credentials"].get(service)
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "service_credential_required")


class RetentionAuthorization:
    def __init__(self, state):
        self.state = state
        self.options = state.identity_options

    async def issue(self, body, credential):
        require_credential(self.options, body.caller, credential)
        operation = self.state.service_catalog.match(body.source_method, body.source_path)
        if (
            operation is None
            or operation.service != body.caller
            or route_permission(body.source_method, body.source_path) != "content.write"
        ):
            raise HTTPException(403, "retention_source_forbidden")
        if body.caller == "thought":
            # An original write is not by itself authority to change an arbitrary
            # source resource. Admit only operations whose path binds the exact ID.
            direct = (
                re.fullmatch(
                    r"/v1/thought-workshop/(notes|templates)/([A-Za-z0-9_-]+)", body.source_path
                )
                if body.source_method in {"PUT", "DELETE"}
                else None
            )
            note_operation = (
                re.fullmatch(
                    r"/v1/thought-workshop/notes/([A-Za-z0-9_-]+)/"
                    r"(?:operations|history/[A-Za-z0-9_-]+/restore|multitable/operations|"
                    r"multitable/history/[0-9]+/restore|"
                    r"multitable/tables/[A-Za-z0-9_-]+/csv-import)",
                    body.source_path,
                )
                if body.source_method == "POST"
                else None
            )
            if direct:
                expected_kind = "note" if direct.group(1) == "notes" else "template"
                expected_id = direct.group(2)
            elif note_operation:
                expected_kind, expected_id = "note", note_operation.group(1)
            else:
                raise HTTPException(403, "retention_source_forbidden")
            if body.change.resource_kind != expected_kind or body.change.resource_id != expected_id:
                raise HTTPException(403, "retention_resource_mismatch")
        try:
            body.change.validate_service(body.caller)
            actor = verify_context(
                body.assertion,
                service=body.caller,
                method=body.source_method,
                path=body.source_path,
                public_key=self.options["private_key"].public_key(),
            )
        except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
            raise HTTPException(401, "invalid_source_assertion") from exc
        principal = StudioPrincipal(
            user_id=actor.user_id,
            must_change_password=False,
            platform_role=actor.platform_role,
            auth_kind=actor.auth_kind,
            scopes=frozenset(actor.scopes),
        )
        if not principal.allows("content.write") or not principal.permits("studio:write"):
            raise HTTPException(403, "retention_source_forbidden")
        async with self.state.database.sessions() as session:
            if not await active_actor(session, actor):
                raise HTTPException(401, "source_authorization_revoked")
        return issue_retention(
            actor,
            caller=body.caller,
            change=body.change,
            private_key=self.options["private_key"],
            key_id=self.options["key_id"],
        )

    async def can_prepare(self, token, credential):
        require_credential(self.options, "assets", credential)
        try:
            authority = verify_retention(token, public_key=self.options["private_key"].public_key())
        except (jwt.InvalidTokenError, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(401, "invalid_retention_authority") from exc
        if authority.prepare_before <= time.time():
            return False
        async with self.state.database.sessions() as session:
            return await active_actor(session, authority.actor)
