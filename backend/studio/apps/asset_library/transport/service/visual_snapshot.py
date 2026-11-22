"""Expose Visual snapshot data only under exact, live project assertions."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from studio.apps.asset_library.content_audits import ContentAudits
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.transport.service.context import cases
from studio.apps.asset_library.visual.visual_snapshot_files import (
    card_media,
    metadata,
    originals,
    scoped_assets,
)
from studio.contracts.asset_library.content_identity import ContentIdentities
from studio.contracts.asset_library.descriptions import LibraryAssetDescription, LibraryAssetQuery
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_snapshot import SnapshotScope
from studio.contracts.visual_workshop.visual_snapshot import (
    ASSETS,
    CARD_MEDIA,
    CardMediaDescription,
    SnapshotAssetQuery,
    SnapshotFiles,
    asset_target,
    card_media_target,
)
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)


async def authorize(request, digest, expected):
    path = request.url.path
    if (
        not (asset_target("POST", path) or card_media_target("POST", path))
        or "cookie" in request.headers
        or "origin" in request.headers
        or digest != expected
    ):
        raise HTTPException(403, "visual_snapshot_grant_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "visual_snapshot_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_snapshot_access_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_snapshot_authority_ended")
    return actor.user_id


@router.post(CARD_MEDIA + "/{digest}", response_model=list[CardMediaDescription])
async def card_media_selection(request: Request, digest: str, body: LibraryAssetQuery):
    owner = await authorize(request, digest, body.digest)
    if not 1 <= len(body.asset_ids) <= 500:
        raise HTTPException(422, "visual_asset_selection_size")
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return await card_media(session, owner, body.asset_ids)


@router.post(ASSETS + "/{project_id}/metadata/{digest}", response_model=SnapshotFiles)
async def visual_metadata(request: Request, project_id: str, digest: str, body: SnapshotAssetQuery):
    owner = await authorize(request, digest, body.digest)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        return await metadata(session, state.settings, project_id, body)


@router.post(ASSETS + "/{project_id}/identities/{digest}", response_model=ContentIdentities)
async def reference_image_identities(
    request: Request, project_id: str, digest: str, body: LibraryAssetQuery
):
    owner = await authorize(request, digest, body.digest)
    if len(body.asset_ids) != 1:
        raise HTTPException(422, "reference_image_selection_size")
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project_id)
        rows = await scoped_assets(session, project_id, body.asset_ids, include_private=False)
        if len(rows) != 1 or rows[0][0].media_kind != "image":
            raise HTTPException(422, "reference_image_project_scope")
        return await ContentAudits(cases(request, session, owner)).identities(body.asset_ids)


@router.post(
    ASSETS + "/{project_id}/selection/{digest}", response_model=list[LibraryAssetDescription]
)
async def visual_asset_selection(
    request: Request, project_id: str, digest: str, body: LibraryAssetQuery
):
    owner = await authorize(request, digest, body.digest)
    if not 1 <= len(body.asset_ids) <= 500:
        raise HTTPException(422, "visual_asset_selection_size")
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        await check_project_scope(session, "visual", project_id)
        rows = await scoped_assets(session, project_id, body.asset_ids, include_private=False)
        return [
            LibraryAssetDescription(
                id=row.id,
                original_filename=row.original_filename,
                mime_type=row.mime_type,
                media_kind=row.media_kind,
                byte_size=row.byte_size,
                revision=row.revision,
            )
            for row, _ in rows
            if row.mime_type != "model/gltf-binary" or row.project_id == project_id
        ]


@router.post(ASSETS + "/{project_id}/originals/{digest}")
async def visual_originals(request: Request, project_id: str, digest: str, body: SnapshotScope):
    owner = await authorize(request, digest, body.digest)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        files = await originals(session, state.settings, project_id, body.files)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            "Cache-Control": "private, no-store",
        },
    )
