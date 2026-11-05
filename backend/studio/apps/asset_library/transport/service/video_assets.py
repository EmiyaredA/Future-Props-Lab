"""Handle the Video Editor's signed exact metadata request."""

from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import ValidationError

from studio.apps.asset_library.scoped_writes import VideoFileWrites
from studio.apps.asset_library.transport.service.library_outputs import OutputStream
from studio.apps.asset_library.video.video_files import (
    available,
    describe,
    files,
    original_record,
    record,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.video_editor.video_assets import (
    MAX_IDS,
    PREFIX,
    VideoAssetQuery,
    VideoCopyQuery,
    video_write_target,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription

router = APIRouter(include_in_schema=False)


def owner_for(request, *, method="GET", permission="content.read", replay=False):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_video_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
            allow_expired=replay,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "video_assets_authorization_required") from None
    if actor.purpose != "studio" or permission not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "video_assets_authorization_forbidden")
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
        query = VideoAssetQuery(asset_ids=id)
        if query.digest != digest or query.path(project_id) != request.url.path:
            raise HTTPException(403, "video_asset_query_changed")
    except (ValidationError, ValueError):
        raise HTTPException(422, "video_asset_query_invalid") from None
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await describe(session, owner, project_id, query.asset_ids)}


@router.get(PREFIX + "/sources")
async def sources(request: Request):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await available(session, owner)}


@router.get(PREFIX + "/{project_id}/files")
async def project_files(request: Request, project_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return {"items": await files(session, owner, project_id)}


@router.api_route(
    PREFIX + "/{project_id}/writes/{request_id}/{action}/{fingerprint}",
    methods=["GET", "POST"],
)
async def write(request: Request, project_id: str, request_id: str, action: str, fingerprint: str):
    path = request.url.path
    if not video_write_target("POST", path):
        raise HTTPException(404, "video_file_write_not_found")
    replay = request.method == "GET"
    owner = owner_for(request, method="POST", permission="content.write", replay=replay)
    state = request.app.state

    async def active():
        status = await state.identity.status(
            assertion=request.headers.get(HEADER, ""), method="POST", path=path
        )
        if status is None:
            raise HTTPException(503, "identity_unavailable")
        if not status:
            raise HTTPException(401, "video_file_write_revoked")

    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        writer = VideoFileWrites(
            session, state.settings, owner, project_id, request_id, fingerprint, active=active
        )
        if replay:
            prior = await writer.prior()
            if prior is None:
                raise HTTPException(404, "video_file_write_unconfirmed")
            return {"items": prior}
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise HTTPException(422, "video_file_encoding_forbidden")
        if action == "upload":
            return {"items": [await upload(request, writer, fingerprint)]}
        query = await copy_query(request, fingerprint)
        return {"items": await writer.copy(query.asset_ids)}


async def upload(request, writer, fingerprint):
    try:
        descriptor = ModelOutputDescription.from_header(request.headers.get("x-fpl-video-file", ""))
        length = int(request.headers.get("content-length", "-1"))
    except (TypeError, ValueError):
        raise HTTPException(422, "invalid_video_file") from None
    if descriptor.fingerprint != fingerprint or length != descriptor.byte_size:
        raise HTTPException(422, "video_file_descriptor_changed")
    if length > request.app.state.settings.fpl_visual_asset_max_bytes:
        raise HTTPException(413, {"code": "file_too_large", "message": "文件超过上传大小限制"})
    return await writer.store_upload(descriptor, OutputStream(request, descriptor))


async def copy_query(request, fingerprint):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > 20 * 1024:
            raise HTTPException(413, "video_copy_request_too_large")
        raw.extend(chunk)
    try:
        query = VideoCopyQuery.model_validate_json(bytes(raw))
    except ValidationError:
        raise HTTPException(422, "invalid_video_copy_request") from None
    if query.digest != fingerprint:
        raise HTTPException(403, "video_copy_request_changed")
    return query


@router.get(PREFIX + "/{project_id}/files/{asset_id}/descriptor")
async def descriptor(request: Request, project_id: str, asset_id: str):
    owner = owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        row = await original_record(session, owner, project_id, asset_id)
        if row is None:
            raise HTTPException(404, "video_original_not_found")
        return record(project_id, row)
