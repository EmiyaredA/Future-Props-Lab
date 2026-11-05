"""Issue narrow target assertions from an authenticated, still-active source request."""

import secrets
from dataclasses import replace
from typing import Literal

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.asset_library.reveal import reveal_grant
from studio.contracts.galgame_workshop.galgame_annotation_source import (
    source_grant as galgame_annotation_grant,
)
from studio.contracts.galgame_workshop.galgame_asr_execution import PURPOSE_EXECUTION, asr_job_grant
from studio.contracts.galgame_workshop.galgame_assets import (
    export_download_grant,
    galgame_asset_grant,
)
from studio.contracts.galgame_workshop.galgame_exports import PURPOSE_INPUT as GALGAME_EXPORT_INPUT
from studio.contracts.galgame_workshop.galgame_exports import export_grant as galgame_export_grant
from studio.contracts.galgame_workshop.galgame_frames import frame_grant as galgame_frame_grant
from studio.contracts.galgame_workshop.galgame_handoff import (
    video_handoff_grant as galgame_handoff_grant,
)
from studio.contracts.galgame_workshop.galgame_render import capacity_grant
from studio.contracts.galgame_workshop.galgame_snapshot import (
    archive_grant as galgame_archive_grant,
)
from studio.contracts.galgame_workshop.galgame_snapshot import (
    snapshot_files_grant,
    snapshot_model_grant,
)
from studio.contracts.galgame_workshop.galgame_upload import upload_grant as galgame_upload_grant
from studio.contracts.identity.claims import issue_context, verify_context
from studio.contracts.identity.delegation import RequestGrant, permitted, target_permission_path
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.identity.route_permissions import route_permission
from studio.contracts.motion_compositor.motion_exports import render_grant as motion_export_grant
from studio.contracts.motion_compositor.motion_preview import motion_preview_grant
from studio.contracts.motion_compositor.motion_snapshot import motion_snapshot_grant
from studio.contracts.thought_workshop.community_uploads import (
    upload_grant as community_upload_grant,
)
from studio.contracts.video_editor.video_audio import audio_grant
from studio.contracts.video_editor.video_frames import frame_grant as video_frame_grant
from studio.contracts.video_editor.video_segment_handoff import target_grant as segment_target_grant
from studio.contracts.video_editor.video_snapshot import snapshot_grant as video_snapshot_grant
from studio.contracts.visual_workshop.visual_acceptance_assets import acceptance_asset_grant
from studio.contracts.visual_workshop.visual_agent_review import agent_review_grant
from studio.contracts.visual_workshop.visual_assistant import assistant_grant
from studio.contracts.visual_workshop.visual_assistant import model_grant as assistant_model_grant
from studio.contracts.visual_workshop.visual_catalog import (
    acceptance_agent_grant,
    visual_catalog_grant,
)
from studio.contracts.visual_workshop.visual_composition import composition_grant, model_grid_grant
from studio.contracts.visual_workshop.visual_generation import (
    visual_generation_asset_grant,
    visual_generation_model_grant,
    visual_generation_plan_grant,
)
from studio.contracts.visual_workshop.visual_review import review_model_grant
from studio.contracts.visual_workshop.visual_samples import baseline_grant, sample_grant
from studio.contracts.visual_workshop.visual_snapshot import archive_grant as visual_archive_grant
from studio.contracts.visual_workshop.visual_snapshot import snapshot_grant as visual_snapshot_grant

from .live import active_actor

router = APIRouter()


class DelegationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: str = Field(min_length=1, max_length=64)
    purpose: str = Field(min_length=1, max_length=100)
    source_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    source_path: str = Field(max_length=4096)
    target_service: str = Field(max_length=64)
    target_method: Literal["GET", "POST", "PATCH", "PUT", "DELETE"]
    target_path: str = Field(max_length=4096)
    target_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    assertion: str = Field(min_length=1, max_length=8192)


async def authorize_delegation(app, body, credential):
    options = app.identity_options
    expected = options["service_credentials"].get(body.caller)
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "service_credential_required")
    grant = RequestGrant(**body.model_dump(exclude={"assertion"}))
    if not permitted(grant, app.service_catalog):
        raise HTTPException(403, "delegation_not_permitted")
    try:
        actor = verify_context(
            body.assertion,
            service=body.caller,
            method=body.source_method,
            path=body.source_path,
            public_key=options["private_key"].public_key(),
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
        raise HTTPException(401, "invalid_source_assertion") from exc
    async with app.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, "source_authorization_revoked")
    reveal = reveal_grant(grant)
    if reveal and (not actor.local or actor.auth_kind != "session" or actor.purpose != "studio"):
        raise HTTPException(403, "local_access_required")
    principal = StudioPrincipal(
        user_id=actor.user_id,
        platform_role=actor.platform_role,
        must_change_password=False,
        auth_kind=actor.auth_kind,
        scopes=frozenset(actor.scopes),
        session_id=actor.session_id,
        api_key_id=actor.api_key_id,
    )
    review = agent_review_grant(grant)
    source_permission = (
        "models.use"
        if review and body.caller == "agent-runtime"
        else route_permission(body.source_method, body.source_path)
    )
    if review and not principal.allows("content.write"):
        raise HTTPException(403, "source_permission_denied")
    community_directory = (
        source_permission == "community.access"
        and body.caller == "thought"
        and body.purpose == "thought.accounts.read"
        and principal.auth_kind == "session"
        and principal.permits("studio:read")
    )
    community_upload = community_upload_grant(grant)
    if community_upload and (
        source_permission != "community.access"
        or principal.auth_kind != "session"
        or not principal.permits("studio:read")
    ):
        raise HTTPException(403, "community_session_required")
    if not (community_directory or community_upload) and (
        source_permission is None or not principal.allows(source_permission)
    ):
        raise HTTPException(403, "source_permission_denied")
    permission = (
        "content.read"
        if (
            assistant_grant(grant)
            or acceptance_asset_grant(grant)
            or acceptance_agent_grant(grant)
            or visual_catalog_grant(grant)
            or visual_snapshot_grant(grant)
            or galgame_asset_grant(grant)
            or (asr_job_grant(grant) and grant.purpose != PURPOSE_EXECUTION)
            or snapshot_files_grant(grant)
            or snapshot_model_grant(grant)
            or export_download_grant(grant)
            or capacity_grant(grant)
            or galgame_frame_grant(grant)
            or (galgame_export_grant(grant) and grant.purpose == GALGAME_EXPORT_INPUT)
            or galgame_annotation_grant(grant)
            or motion_preview_grant(grant)
            or motion_snapshot_grant(grant)
            or video_frame_grant(grant)
            or audio_grant(grant)
            or video_snapshot_grant(grant)
        )
        else (
            "content.write"
            if motion_export_grant(grant)
            or segment_target_grant(grant)
            or galgame_upload_grant(grant)
            or galgame_archive_grant(grant)
            or visual_archive_grant(grant)
            or (composition_grant(grant) and not model_grid_grant(grant))
            or (sample_grant(grant) and not baseline_grant(grant))
            or galgame_export_grant(grant)
            or galgame_handoff_grant(grant)
            else (
                "models.use"
                if (
                    asr_job_grant(grant)
                    or visual_generation_model_grant(grant)
                    or visual_generation_asset_grant(grant)
                    or visual_generation_plan_grant(grant)
                    or model_grid_grant(grant)
                    or review_model_grant(grant)
                    or assistant_model_grant(grant)
                    or review
                    or baseline_grant(grant)
                )
                else route_permission(body.target_method, target_permission_path(grant))
            )
        )
    )
    if permission is None or (
        permission != "community.access" if community_upload else not principal.allows(permission)
    ):
        raise HTTPException(403, "target_permission_denied")
    if community_upload:
        scope = "studio:read"
    elif permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}:
        scope = "studio:private_read"
    else:
        scope = "studio:write"
    if not principal.permits(scope):
        raise HTTPException(403, "target_scope_denied")
    return issue_context(
        replace(actor, local=bool(reveal)),
        service=body.target_service,
        method=body.target_method,
        path=body.target_path,
        private_key=options["private_key"],
        key_id=options["key_id"],
        request_sha256=grant.target_sha256,
    )


@router.post("/_internal/v1/authorization/delegate")
async def delegate(request: Request, body: DelegationRequest):
    credential = request.headers.get("authorization", "").removeprefix("Bearer ")
    token = await authorize_delegation(request.app.state, body, credential)
    from starlette.responses import JSONResponse

    return JSONResponse({"assertion": token}, headers={"Cache-Control": "no-store"})
