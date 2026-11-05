"""Recheck only the owner and exact publication registered by a live approval."""

from dataclasses import asdict

import jwt
from fastapi import HTTPException
from sqlalchemy import text

from studio.apps.identity.storage.service_models import VisualGenerationApproval
from studio.contracts.asset_library.retention_authority import canvas_metadata, issue_retention
from studio.contracts.identity.claims import Actor, verify_context
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.visual_workshop.visual_assistant import approval_source

from .live import active_actor


def permitted(actor):
    principal = StudioPrincipal(
        user_id=actor.user_id,
        must_change_password=False,
        platform_role=actor.platform_role,
        auth_kind=actor.auth_kind,
        scopes=frozenset(actor.scopes),
    )
    return (
        actor.purpose == "studio"
        and principal.permits("studio:write")
        and principal.allows("content.write")
        and principal.allows("models.use")
    )


async def reserve(state, body, assertion):
    match = approval_source("POST", body.source_path)
    if not match or match[1] != body.project_id:
        raise HTTPException(403, "generation_approval_scope_mismatch")
    options = state.identity_options
    try:
        actor = verify_context(
            assertion,
            service="visual",
            method="POST",
            path=body.source_path,
            public_key=options["private_key"].public_key(),
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "generation_approval_required") from None
    if actor.user_id != body.owner_id or not permitted(actor):
        raise HTTPException(403, "generation_approval_scope_mismatch")
    admission = body.model_dump(mode="json")
    attribution = asdict(actor)
    attribution["scopes"] = list(actor.scopes)
    async with state.database.sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        if not await active_actor(session, actor):
            raise HTTPException(401, "source_authorization_revoked")
        row = await session.get(VisualGenerationApproval, str(body.task_id))
        if row is None:
            session.add(
                VisualGenerationApproval(
                    id=str(body.task_id),
                    owner_id=actor.user_id,
                    admission=admission,
                    actor=attribution,
                )
            )
            await session.commit()
        elif row.admission != admission or row.actor != attribution:
            raise HTTPException(409, "generation_approval_changed")
    return {"task_id": str(body.task_id), "plan_sha256": body.plan_sha256}


async def authorize_publication(state, body):
    change = body.change
    upload = change.visual_upload
    if (
        upload is None
        or upload.generation_task_id is None
        or upload.composition_batch_id is not None
        or not canvas_metadata("visual", change)
        or change.expected_resource_revision < 0
        or change.metadata_asset_ids != []
    ):
        raise HTTPException(403, "generation_publication_scope_mismatch")
    async with state.database.sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        row = await session.get(VisualGenerationApproval, upload.generation_task_id)
        if (
            row is None
            or row.admission["project_id"] != change.resource_id
            or row.admission["kind"] != upload.kind
            or row.admission["plan_sha256"] != body.plan_sha256
        ):
            raise HTTPException(404, "generation_approval_not_found")
        actor = Actor(**{**row.actor, "scopes": tuple(row.actor["scopes"])})
        if not permitted(actor) or not await active_actor(session, actor):
            raise HTTPException(401, "source_authorization_revoked")
        if row.content_sha256 is None:
            row.content_sha256, row.byte_size = upload.content_sha256, upload.byte_size
            await session.commit()
        elif (row.content_sha256, row.byte_size) != (upload.content_sha256, upload.byte_size):
            raise HTTPException(409, "generation_publication_bytes_changed")
    options = state.identity_options
    return issue_retention(
        actor,
        caller="visual",
        change=change,
        private_key=options["private_key"],
        key_id=options["key_id"],
    )
