"""Only an authorized original write can issue a bounded retention authority."""

import re
import secrets
import time

import jwt
from fastapi import HTTPException

from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.claims import verify_context
from fpl_runtime.retention_authority import issue_retention, story_metadata, verify_retention

from .live import active_actor


def require_credential(options, service, credential):
    expected = options["service_credentials"].get(service)
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "service_credential_required")


def _galgame_story_source(body):
    change = body.change
    if change.expected_resource_revision == -1:
        return (
            body.source_method == "POST"
            and body.source_path == "/v1/galgame-workshop/projects"
            and re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                change.resource_id,
            )
            is not None
            and not change.asset_ids
            and change.metadata_asset_ids is None
        )
    return (
        body.source_method == "PUT"
        and body.source_path == f"/v1/galgame-workshop/projects/{change.resource_id}/story"
        and story_metadata(body.caller, change)
    )


class RetentionAuthorization:
    def __init__(self, state):
        self.state = state
        self.options = state.identity_options

    async def issue(self, body, credential):
        require_credential(self.options, body.caller, credential)
        operation = self.state.service_catalog.match(body.source_method, body.source_path)
        publication_source = (
            re.fullmatch(
                r"/v1/thought-workshop/community/(libraries|publications)/([A-Za-z0-9_-]+)/"
                r"(publication|management)",
                body.source_path,
            )
            if body.caller == "thought" and body.source_method == "PUT"
            else None
        )
        if publication_source and (publication_source[1], publication_source[3]) not in {
            ("libraries", "publication"),
            ("publications", "management"),
        }:
            publication_source = None
        community = body.community
        if (
            community is None
            and body.change.metadata_asset_ids is not None
            and not story_metadata(body.caller, body.change)
        ):
            raise HTTPException(403, "retention_metadata_scope_required")
        if community is not None and (
            body.caller != "thought"
            or not community.matches_source(body.source_method, body.source_path)
            or not community.matches_change(body.change)
        ):
            raise HTTPException(403, "retention_community_scope_mismatch")
        expected_permission = (
            "community.access" if publication_source or community else "content.write"
        )
        if (
            operation is None
            or operation.service != body.caller
            or route_permission(body.source_method, body.source_path) != expected_permission
        ):
            raise HTTPException(403, "retention_source_forbidden")
        if body.caller == "galgame" and not (
            body.change.resource_kind == "story" and _galgame_story_source(body)
        ):
            raise HTTPException(403, "retention_resource_mismatch")
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
            knowledge_update = (
                re.fullmatch(
                    r"/v1/thought-workshop/knowledge-bases/([A-Za-z0-9_-]+)", body.source_path
                )
                if body.source_method == "PUT" and body.change.expected_resource_revision >= 0
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
            initial_id = (
                re.fullmatch(
                    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                    body.change.resource_id,
                )
                is not None
            )
            new_template = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/templates"
                and body.change.resource_kind == "template"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            create_knowledge_base = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/knowledge-bases"
                and body.change.resource_kind in {"knowledge-base", "note"}
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            official_import = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/community/official-import"
                and body.change.resource_kind in {"knowledge-base", "note", "template"}
                and body.change.expected_resource_revision == -1
                and not body.change.asset_ids
                and initial_id
            )
            apply_template = (
                body.source_method == "POST"
                and re.fullmatch(
                    r"/v1/thought-workshop/templates/[A-Za-z0-9_-]+/apply", body.source_path
                )
                is not None
                and body.change.resource_kind == "note"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            create_note = (
                body.source_method == "POST"
                and (
                    body.source_path == "/v1/thought-workshop/notes"
                    or re.fullmatch(
                        r"/v1/thought-workshop/knowledge-bases/[A-Za-z0-9_-]+/documents",
                        body.source_path,
                    )
                    is not None
                    or re.fullmatch(
                        r"/v1/thought-workshop/notes/[A-Za-z0-9_-]+/duplicate",
                        body.source_path,
                    )
                    is not None
                )
                and body.change.resource_kind == "note"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            if community:
                expected_kind, expected_id = "note", community.note_id
            elif publication_source:
                # The library operation resolves its publication in Thought's owned registry.
                # The management operation already carries the exact publication in its path.
                expected_kind = "publication"
                expected_id = (
                    publication_source[2]
                    if publication_source[1] == "publications"
                    else body.change.resource_id
                )
                initial = body.change.expected_resource_revision == -1
                if len(body.change.asset_ids) > 1 or (
                    initial and (publication_source[1] != "libraries" or not initial_id)
                ):
                    raise HTTPException(403, "retention_resource_mismatch")
            elif (
                new_template
                or apply_template
                or create_note
                or create_knowledge_base
                or official_import
            ):
                expected_kind = (
                    "template"
                    if new_template
                    else body.change.resource_kind
                    if create_knowledge_base or official_import
                    else "note"
                )
                expected_id = body.change.resource_id
            elif direct:
                expected_kind = "note" if direct.group(1) == "notes" else "template"
                expected_id = direct.group(2)
            elif knowledge_update:
                expected_kind, expected_id = "knowledge-base", knowledge_update.group(1)
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
        permitted = (
            actor.auth_kind == "session" and principal.permits("studio:read")
            if publication_source or community
            else principal.allows("content.write") and principal.permits("studio:write")
        )
        if not permitted or (community is not None and actor.user_id != community.actor_id):
            raise HTTPException(403, "retention_source_forbidden")
        if body.source_path == "/v1/thought-workshop/community/official-import" and (
            actor.auth_kind != "session" or actor.platform_role != "admin"
        ):
            raise HTTPException(403, "retention_source_forbidden")
        async with self.state.database.sessions() as session:
            if not await active_actor(session, actor):
                raise HTTPException(401, "source_authorization_revoked")
        return issue_retention(
            actor,
            caller=body.caller,
            change=body.change,
            community=community,
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
