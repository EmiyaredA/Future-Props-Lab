"""Revalidate existing streams without granting a service arbitrary user impersonation."""

import secrets

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.capabilities.identity.permissions import (
    CLOUD_CONTROL_PERMISSION,
    requires_cloud_control,
    role_permissions,
    role_scopes,
)
from app.console.models.accounts import AuthSession, ManagementApiKey, User
from app.runtime.time import utc_now
from fpl_runtime.annotation_task_sources import upload_target as annotation_upload_target
from fpl_runtime.annotation_transcription import target as annotation_transcription_target
from fpl_runtime.claims import verify_context
from fpl_runtime.galgame_annotation_source import annotation_target
from fpl_runtime.galgame_annotation_source import audio_target as galgame_annotation_audio_target
from fpl_runtime.galgame_asr import asr_model_target
from fpl_runtime.galgame_asr_execution import catalog_target as galgame_asr_catalog_target
from fpl_runtime.galgame_asr_execution import execution_target as galgame_asr_execution_target
from fpl_runtime.galgame_asr_execution import original_target as galgame_asr_original_target
from fpl_runtime.galgame_assets import asset_query_target as galgame_file_query_target
from fpl_runtime.galgame_assets import export_download_target
from fpl_runtime.galgame_exports import inputs_target as galgame_export_inputs_target
from fpl_runtime.galgame_exports import job_target as galgame_export_job_target
from fpl_runtime.galgame_exports import submit_target as galgame_export_submit_target
from fpl_runtime.galgame_frames import frame_target as galgame_frame_target
from fpl_runtime.galgame_frames import inputs_target as galgame_frame_inputs_target
from fpl_runtime.galgame_handoff import video_target as galgame_handoff_video_target
from fpl_runtime.galgame_render import capacity_target
from fpl_runtime.galgame_snapshot import archive_target as galgame_archive_target
from fpl_runtime.galgame_snapshot import (
    model_reference_target,
    model_resolution_target,
    snapshot_files_target,
)
from fpl_runtime.galgame_upload import upload_target as galgame_upload_target
from fpl_runtime.model_outputs import is_model_output_path
from fpl_runtime.motion_exports import render_target
from fpl_runtime.project_reveal import reveal_target
from fpl_runtime.tools_video_library import is_library_path as is_tools_output_path
from fpl_runtime.video_assets import video_write_target
from fpl_runtime.video_audio import audio_target
from fpl_runtime.video_frames import target as video_frame_target
from fpl_runtime.video_handoff import handoff_target
from fpl_runtime.video_segments import bundle_target as segment_bundle_target
from fpl_runtime.video_snapshot import archive_target as video_archive_target
from fpl_runtime.visual_acceptance_assets import acceptance_asset_target
from fpl_runtime.visual_assistant import attachment_target
from fpl_runtime.visual_catalog import AGENT_ACCEPTANCE_TARGET
from fpl_runtime.visual_catalog import catalog_target as visual_catalog_target
from fpl_runtime.visual_composition import grid_asset_target, grid_render_target
from fpl_runtime.visual_generation import model_target as visual_generation_model_target
from fpl_runtime.visual_snapshot import archive_target as visual_archive_target
from fpl_runtime.visual_snapshot import asset_target as visual_snapshot_asset_target
from fpl_runtime.visual_snapshot import model_target as visual_snapshot_model_target
from fpl_runtime.visual_snapshot import resolution_target as visual_snapshot_resolution_target

router = APIRouter()


class LiveRequest(BaseModel):
    service: str = Field(max_length=64)
    assertion: str = Field(max_length=8192)
    method: str = Field(max_length=12)
    path: str = Field(max_length=4096)


async def active_actor(session, actor):
    user = await session.get(User, actor.user_id)
    if (
        user is None
        or user.status != "active"
        or user.must_change_password
        or user.platform_role != actor.platform_role
    ):
        return False
    now = utc_now()
    scopes = role_scopes(user.platform_role)
    if actor.auth_kind == "session":
        auth = await session.get(AuthSession, actor.session_id)
        active = bool(
            auth
            and auth.user_id == actor.user_id
            and auth.revoked_at is None
            and auth.idle_expires_at > now
            and auth.absolute_expires_at > now
            and (await session.scalar(select(AuthSession.purpose).where(AuthSession.id == auth.id)))
            == actor.purpose
        )
    else:
        key = await session.get(ManagementApiKey, actor.api_key_id)
        active = bool(
            key and key.user_id == actor.user_id and key.revoked_at is None and key.expires_at > now
        )
        key_scopes = set(key.scopes) if key else set()
        if "studio:write" in key_scopes:
            key_scopes.add("studio:read")
        if "studio:read" in key_scopes:
            key_scopes.add("studio:private_read")
        scopes = key_scopes & scopes
    return active and set(actor.scopes) == set(scopes)


@router.post("/_internal/v1/authorization/live")
async def live(request: Request, body: LiveRequest):
    options = request.app.state.identity_options
    credential = request.headers.get("authorization", "").removeprefix("Bearer ")
    render_export = body.service == "rendering" and render_target(body.method, body.path)
    expected = options["service_credentials"].get(body.service)
    assets_credential = options["service_credentials"].get("assets")
    if (
        render_export
        and assets_credential
        and secrets.compare_digest(credential, assets_credential)
    ):
        expected = assets_credential
    if expected is None or not secrets.compare_digest(credential, expected):
        raise HTTPException(403, "service_credential_required")
    operation = request.app.state.service_catalog.match(body.method, body.path)
    private_output = (
        body.service == "assets"
        and body.method == "POST"
        and (
            is_model_output_path(body.path)
            or is_tools_output_path(body.path)
            or annotation_upload_target(body.path)
        )
    )
    from fpl_runtime.community_uploads import upload_target as community_upload_target
    from fpl_runtime.creative_preview import preview_target
    from fpl_runtime.creative_source_evidence import source_transfer_target
    from fpl_runtime.creative_stdio import stdio_target
    from fpl_runtime.external_sync import close_target, read_target
    from fpl_runtime.motion_assets import motion_asset_write_target
    from fpl_runtime.motion_preview import preview_target as motion_preview_target
    from fpl_runtime.motion_snapshot import motion_archive_target
    from fpl_runtime.presentation_archives import archive_target as presentation_archive_target
    from fpl_runtime.thought_archives import archive_target
    from fpl_runtime.thought_uploads import is_upload_target
    from fpl_runtime.writing import writing_target

    private_models = body.service == "models" and (
        writing_target(body.method, body.path) is not None
        or annotation_transcription_target(body.method, body.path) is not None
        or visual_catalog_target(body.method, body.path)
        or visual_snapshot_model_target(body.method, body.path)
        or visual_generation_model_target(body.method, body.path)
        or visual_snapshot_resolution_target(body.method, body.path)
        or asr_model_target(body.method, body.path)
        or galgame_asr_catalog_target(body.method, body.path)
        or galgame_asr_execution_target(body.method, body.path)
        or model_reference_target(body.method, body.path)
        or model_resolution_target(body.method, body.path)
    )
    socket = (
        request.app.state.service_catalog.match_socket(body.path) if body.method == "GET" else None
    )
    if socket is not None:
        operation = socket
    private_external = body.service == "integrations" and bool(
        read_target(body.method, body.path)
        or close_target(body.method, body.path)
        or preview_target(body.method, body.path)
        or source_transfer_target(body.method, body.path)
        or stdio_target(body.method, body.path)
    )
    private_thought_upload = body.service == "assets" and (
        is_upload_target(body.method, body.path)
        or galgame_upload_target(body.method, body.path)
        or galgame_archive_target(body.method, body.path)
        or visual_archive_target(body.method, body.path)
        or grid_asset_target(body.method, body.path)
        or archive_target(body.method, body.path)
        or presentation_archive_target(body.method, body.path)
        or motion_asset_write_target(body.method, body.path)
        or video_write_target(body.method, body.path)
        or video_archive_target(body.method, body.path)
        or motion_archive_target(body.method, body.path)
        or community_upload_target(body.method, body.path)
    )
    private_render = body.service == "rendering" and (
        capacity_target(body.method, body.path)
        or galgame_frame_target(body.method, body.path)
        or grid_render_target(body.method, body.path)
        or galgame_export_submit_target(body.method, body.path)
        or galgame_export_job_target(body.method, body.path)
        or motion_preview_target(body.method, body.path)
        or video_frame_target(body.method, body.path)
        or audio_target(body.method, body.path)
    )
    if not (
        private_output
        or (body.service, body.method, body.path)
        == ("agent-runtime", "GET", AGENT_ACCEPTANCE_TARGET)
        or private_models
        or private_external
        or private_thought_upload
        or private_render
        or render_export
        or reveal_target(body.method, body.path, body.service)
        or (body.service == "assets" and galgame_file_query_target(body.method, body.path))
        or (body.service == "assets" and galgame_asr_original_target(body.method, body.path))
        or (body.service == "assets" and snapshot_files_target(body.method, body.path))
        or (body.service == "assets" and galgame_frame_inputs_target(body.method, body.path))
        or (body.service == "assets" and galgame_export_inputs_target(body.method, body.path))
        or (body.service == "assets" and attachment_target(body.method, body.path))
        or (body.service == "assets" and acceptance_asset_target(body.method, body.path))
        or (body.service == "assets" and visual_snapshot_asset_target(body.method, body.path))
        or (body.service == "assets" and export_download_target(body.method, body.path))
        or (body.service == "assets" and galgame_annotation_audio_target(body.method, body.path))
        or (body.service == "annotation" and annotation_target(body.method, body.path))
        or (body.service == "assets" and segment_bundle_target(body.method, body.path))
        or (body.service == "video" and handoff_target(body.method, body.path))
        or (body.service == "video" and galgame_handoff_video_target(body.method, body.path))
    ) and (operation is None or operation.service != body.service):
        raise HTTPException(403, "invalid_service_target")
    try:
        actor = verify_context(
            body.assertion,
            service=body.service,
            method=body.method,
            path=body.path,
            public_key=options["private_key"].public_key(),
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return {"active": False}
    if requires_cloud_control(body.path) and (
        actor.auth_kind != "session"
        or CLOUD_CONTROL_PERMISSION not in role_permissions(actor.platform_role)
    ):
        return {"active": False}
    async with request.app.state.database.sessions() as session:
        return {"active": await active_actor(session, actor)}


class TaskAuthorizationRequest(BaseModel):
    service: str = Field(max_length=64)
    owner_user_id: str = Field(min_length=1, max_length=100)
    permission: str = Field(max_length=100)


TASK_PERMISSIONS = {
    "agents": frozenset({CLOUD_CONTROL_PERMISSION}),
    "interview": frozenset({"content.write"}),
    "rendering": frozenset({"content.write"}),
    "visual": frozenset({"content.write"}),
    "assets": frozenset({"content.write"}),
}


@router.post("/_internal/v1/tasks/authorize")
async def task_authorization(request: Request, body: TaskAuthorizationRequest):
    options = request.app.state.identity_options
    credential = request.headers.get("authorization", "").removeprefix("Bearer ")
    expected = options["service_credentials"].get(body.service)
    if expected is None or not secrets.compare_digest(credential, expected):
        raise HTTPException(403, "service_credential_required")
    if body.permission not in TASK_PERMISSIONS.get(body.service, ()):
        raise HTTPException(403, "task_permission_forbidden")
    async with request.app.state.database.sessions() as session:
        user = await session.get(User, body.owner_user_id)
        allowed = bool(
            user
            and user.status == "active"
            and not user.must_change_password
            and body.permission in role_permissions(user.platform_role)
        )
        return {"allowed": allowed, "revision": user.revision if user else None}
