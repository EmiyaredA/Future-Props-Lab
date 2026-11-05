"""Private metadata scoped to the authenticated account's exact Motion project."""

import hashlib
from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.motion_assets import (
    MAX_IDS,
    PREFIX,
    MotionAssetQuery,
    MotionCopyQuery,
    motion_asset_write_target,
)

from ..motion_files import describe, files, import_sources, original
from ..scoped_writes import MotionFileWrites
from .library_outputs import OutputStream

router = APIRouter(include_in_schema=False)


def owner_for(request, *, permission="content.read"):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_motion_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_assets_authorization_required") from None
    if actor.purpose != "studio" or permission not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_assets_authorization_forbidden")
    return actor.user_id


@router.get(PREFIX + "/{project_id}/metadata/{digest}")
async def metadata(
    request: Request,
    project_id: str,
    digest: str,
    id: Annotated[list[str], Query(max_length=MAX_IDS)],
):
    owner = owner_for(request)
    try:
        query = MotionAssetQuery(asset_ids=id)
        if query.digest != digest:
            raise HTTPException(403, "motion_asset_query_changed")
    except (ValidationError, ValueError):
        raise HTTPException(422, "motion_asset_query_invalid") from None
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        items = await describe(session, owner, project_id, query.asset_ids)
    return {"items": items}


@router.get(PREFIX + "/sources")
async def sources(request: Request):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await import_sources(session, owner)}


@router.get(PREFIX + "/{project_id}/files")
async def list_files(request: Request, project_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await files(session, owner, project_id)}


@router.get(PREFIX + "/{project_id}/files/{asset_id}")
async def file(request: Request, project_id: str, asset_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        path, mime = await original(
            session, request.app.state.settings, owner, project_id, asset_id
        )
    return FileResponse(path, media_type=mime, content_disposition_type="inline")


@router.post(PREFIX + "/{project_id}/writes/{request_id}/{action}/{fingerprint}")
async def write_file(
    request: Request, project_id: str, request_id: str, action: str, fingerprint: str
):
    if not motion_asset_write_target(request.method, request.url.path):
        raise HTTPException(404, "motion_file_write_not_found")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(422, "motion_file_encoding_forbidden")
    owner = owner_for(request, permission="content.write")
    state = request.app.state

    async def active():
        granted = await state.identity.status(
            assertion=request.headers.get(HEADER, ""), method="POST", path=request.url.path
        )
        if granted is None:
            raise HTTPException(503, "identity_unavailable")
        if not granted:
            raise HTTPException(401, "motion_file_write_revoked")

    digest = hashlib.sha256(f"{action}:{fingerprint}".encode()).hexdigest()
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        writer = MotionFileWrites(
            session, state.settings, owner, project_id, request_id, digest, active=active
        )
        if action == "upload":
            try:
                descriptor = ModelOutputDescription.from_header(
                    request.headers.get("x-fpl-motion-file", "")
                )
                length = int(request.headers.get("content-length", "-1"))
            except (ValueError, TypeError):
                raise HTTPException(422, "invalid_motion_file") from None
            if descriptor.fingerprint != fingerprint or length != descriptor.byte_size:
                raise HTTPException(422, "motion_file_descriptor_changed")
            if length > state.settings.fpl_visual_asset_max_bytes:
                raise HTTPException(
                    413, {"code": "file_too_large", "message": "文件超过上传大小限制"}
                )
            return await writer.store_upload(descriptor, OutputStream(request, descriptor))

        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 20 * 1024:
                raise HTTPException(413, "motion_copy_request_too_large")
            raw.extend(chunk)
        try:
            query = MotionCopyQuery.model_validate_json(bytes(raw))
        except ValidationError:
            raise HTTPException(422, "invalid_motion_copy_request") from None
        if query.digest != fingerprint:
            raise HTTPException(403, "motion_copy_request_changed")
        return {"items": await writer.copy(query.asset_ids)}
