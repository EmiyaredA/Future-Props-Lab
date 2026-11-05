"""Stage a community attachment without exposing it in the source library."""

import base64

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.transport.service.library_outputs import OutputStream
from studio.apps.asset_library.transport.service.thought_archives import (
    context,
    receipt,
    require_active,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.thought_workshop.community_uploads import (
    PREFIX,
    CommunityUploadScope,
    upload_target,
)
from studio.contracts.thought_workshop.thought_archives import ArchiveFileKey, ArchiveManifest
from studio.contracts.thought_workshop.thought_uploads import ThoughtUploadDescription

router = APIRouter(include_in_schema=False)


@router.post(PREFIX + "/{publication_id}/{note_id}/{batch_id}/{fingerprint}")
async def stage(request: Request):
    auth, nonce, archives = context(request)
    target = request.url.path
    matched = upload_target(request.method, target)
    if not matched:
        raise HTTPException(404, "community_upload_target_not_found")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=target,
            public_key=request.app.state.identity_public_key,
        )
        encoded = request.headers.get("x-fpl-community-upload-context", "")
        if not 1 <= len(encoded) <= 4096:
            raise ValueError("invalid community upload scope size")
        data = base64.b64decode(encoded, validate=True)
        scope = CommunityUploadScope.model_validate_json(data)
        auth.verify(
            request.headers.get("x-fpl-community-upload-proof", ""),
            "community-stage",
            path=target,
            owner=scope.owner_id,
            nonce=nonce,
            body=data,
        )
        if (
            actor.auth_kind != "session"
            or actor.purpose != "studio"
            or actor.user_id != scope.actor_id
            or scope.target != target
            or not StudioPrincipal(
                user_id=actor.user_id,
                must_change_password=False,
                platform_role=actor.platform_role,
                auth_kind=actor.auth_kind,
                scopes=frozenset(actor.scopes),
            ).permits("studio:read")
        ):
            raise ValueError("community upload actor or target mismatch")
    except (ValueError, TypeError, jwt.InvalidTokenError):
        raise HTTPException(401, "community_upload_authorization_required") from None
    try:
        description = ThoughtUploadDescription.from_header(
            request.headers.get("x-fpl-upload-descriptor", "")
        )
        length = int(request.headers.get("content-length", "-1"))
        if description.fingerprint != matched[4] or length != description.byte_size:
            raise ValueError("community upload descriptor mismatch")
    except (ValueError, TypeError):
        raise HTTPException(422, "community_upload_descriptor_mismatch") from None
    if length > request.app.state.settings.fpl_visual_asset_max_bytes:
        raise HTTPException(413, "community_upload_too_large")

    async def active():
        await require_active(request)

    result = await archives.stage_file(
        owner=scope.owner_id,
        key=scope.key,
        ordinal=0,
        description=description,
        incoming=OutputStream(request, description),
        require_active=active,
    )
    await active()
    manifest = ArchiveManifest(
        files=[ArchiveFileKey(ordinal=0, descriptor_sha256=description.fingerprint)],
        projections=[],
    )
    state = await archives.seal(owner=scope.owner_id, key=scope.key, manifest=manifest)
    if state != "sealed":
        raise HTTPException(409, "community_upload_already_settled")
    return receipt(
        request,
        auth,
        nonce,
        scope.owner_id,
        {"asset": result, "manifest_sha256": manifest.fingerprint},
    )
