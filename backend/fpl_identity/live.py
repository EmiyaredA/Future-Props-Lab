"""Revalidate existing streams without granting a service arbitrary user impersonation."""

import secrets

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.capabilities.identity.permissions import role_permissions, role_scopes
from app.console.models.accounts import AuthSession, ManagementApiKey, User
from app.runtime.time import utc_now
from fpl_runtime.claims import verify_context
from fpl_runtime.model_outputs import is_model_output_path

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
    expected = options["service_credentials"].get(body.service)
    if expected is None or not secrets.compare_digest(credential, expected):
        raise HTTPException(403, "service_credential_required")
    operation = request.app.state.service_catalog.match(body.method, body.path)
    private_output = (
        body.service == "assets" and body.method == "POST" and is_model_output_path(body.path)
    )
    from fpl_runtime.external_sync import close_target, read_target
    from fpl_runtime.thought_uploads import is_upload_target
    from fpl_runtime.writing import writing_target

    private_writing = (
        body.service == "models" and writing_target(body.method, body.path) is not None
    )
    socket = (
        request.app.state.service_catalog.match_socket(body.path) if body.method == "GET" else None
    )
    if socket is not None:
        operation = socket
    private_external = body.service == "integrations" and bool(
        read_target(body.method, body.path) or close_target(body.method, body.path)
    )
    private_thought_upload = body.service == "assets" and is_upload_target(body.method, body.path)
    if not (private_output or private_writing or private_external or private_thought_upload) and (
        operation is None or operation.service != body.service
    ):
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
    async with request.app.state.database.sessions() as session:
        return {"active": await active_actor(session, actor)}


class TaskAuthorizationRequest(BaseModel):
    service: str = Field(max_length=64)
    owner_user_id: str = Field(min_length=1, max_length=100)
    permission: str = Field(max_length=100)


TASK_PERMISSIONS = {"agents": frozenset({"content.read"})}


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
