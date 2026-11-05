"""Receive and replay one signed Galgame project upload."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.galgame.galgame_upload import GalgameUploadFiles
from studio.contracts.galgame_workshop.galgame_upload import (
    MAX_MANIFEST,
    PREFIX,
    UploadManifest,
    upload_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.http.framed_media import SIZE, FramedInputs

router = APIRouter(include_in_schema=False)


async def read_manifest(request, fingerprint, mode):
    reader = FramedInputs(request.stream())
    try:
        size = SIZE.unpack(await reader.read(SIZE.size))[0]
        if not 1 <= size <= MAX_MANIFEST:
            raise ValueError("invalid manifest size")
        manifest = UploadManifest.model_validate_json(await reader.read(size))
        length = int(request.headers.get("content-length", "-1"))
        if (
            manifest.digest != fingerprint
            or length != manifest.total_bytes
            or (mode in {"single", "export"} and len(manifest.files) != 1)
            or (
                mode == "export"
                and (
                    not manifest.files[0].filename.endswith(".mp4")
                    or manifest.files[0].mime_type != "video/mp4"
                )
            )
            or (
                mode == "annotation"
                and any(
                    not file.filename.endswith(".m4a") or file.mime_type != "audio/mp4"
                    for file in manifest.files
                )
            )
        ):
            raise ValueError("manifest changed")
    except (CapabilityUnavailable, ValueError) as exc:
        raise HTTPException(422, "galgame_upload_manifest_invalid") from exc
    return reader, manifest


@router.api_route(
    PREFIX + "/{project_id}/{request_id}/{mode}/{fingerprint}", methods=["GET", "POST"]
)
async def upload(request: Request, project_id: str, request_id: str, mode: str, fingerprint: str):
    path = request.url.path
    replay = request.method == "GET"
    if (
        upload_target("POST", path) is None
        or "cookie" in request.headers
        or "origin" in request.headers
    ):
        raise HTTPException(403, "galgame_upload_grant_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="assets",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
            allow_expired=replay,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_upload_grant_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_upload_forbidden")

    def admit():
        try:
            verify_context(
                token,
                service="assets",
                method="POST",
                path=path,
                public_key=state.identity_public_key,
            )
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(410, "galgame_upload_aborted") from exc

    async def active():
        result = await state.identity.status(assertion=token, method="POST", path=path)
        if result is not True:
            raise HTTPException(401 if result is False else 503, "galgame_upload_authority_ended")

    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        writer = GalgameUploadFiles(
            session,
            state.settings,
            actor.user_id,
            project_id,
            request_id,
            fingerprint,
            active=active,
        )
        if replay:
            return {"items": await writer.replay(admit)}

        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise HTTPException(422, "galgame_upload_encoding_forbidden")
        await active()
        reader, manifest = await read_manifest(request, fingerprint, mode)
        maximum = (
            state.settings.fpl_galgame_export_max_bytes
            if mode == "export"
            else state.settings.fpl_visual_asset_max_bytes
        )
        if any(file.byte_size > maximum for file in manifest.files):
            raise HTTPException(413, {"code": "file_too_large", "message": "文件超过上传大小限制"})
        return {"items": await writer.store(reader, manifest, maximum, admit=admit)}
