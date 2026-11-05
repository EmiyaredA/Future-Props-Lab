"""Private digest-bound output streams; no browser cookies, owner selection or foreign paths."""

import binascii
import json

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.asset_library.library_outputs import LibraryOutputFiles
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.audio_annotation.task_sources import (
    UPLOADS,
    AnnotationTaskOriginal,
    upload_target,
)
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.tools.tools_video_library import (
    PREFIX,
    ToolLibraryDescription,
    is_library_path,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription

router = APIRouter(include_in_schema=False)


class OutputStream:
    def __init__(self, request, description):
        self.filename, self.content_type = description.filename, description.mime_type
        self.description = description
        self.stream = request.stream().__aiter__()
        self.buffer, self.ended, self.received = bytearray(), False, 0

    async def read(self, size=-1):
        if type(size) is not int or size < -1:
            raise ValueError("结果读取大小无效")
        if size == 0:
            return b""
        limit = 1024 * 1024 if size == -1 else min(size, 1024 * 1024)
        while len(self.buffer) < limit and not self.ended:
            try:
                chunk = await anext(self.stream)
                self.received += len(chunk)
                if self.received > self.description.byte_size:
                    raise AssetError("模型结果长度不匹配", code="output_changed", status=422)
                self.buffer.extend(chunk)
            except StopAsyncIteration:
                self.ended = True
                if self.received != self.description.byte_size:
                    raise AssetError(
                        "模型结果长度不匹配", code="output_changed", status=422
                    ) from None
        result = bytes(self.buffer[:limit])
        del self.buffer[:limit]
        return result

    async def close(self):
        await self.stream.aclose()
        self.buffer.clear()
        self.ended = True


@router.post("/_internal/v1/model-library-outputs/{task_id}/{descriptor_sha256}")
async def library_output(request: Request, task_id: str, descriptor_sha256: str):
    return await _store_output(request, task_id, descriptor_sha256, ModelOutputDescription)


@router.post(UPLOADS + "/{task_id}/{descriptor_sha256}")
async def annotation_original(request: Request, task_id: str, descriptor_sha256: str):
    if not upload_target(request.url.path):
        raise HTTPException(404, "annotation_original_not_found")
    return await _store_output(
        request,
        "annotation-" + task_id,
        descriptor_sha256,
        AnnotationTaskOriginal,
        verify_replay=True,
    )


@router.post(PREFIX + "/{job_id}/{descriptor_sha256}")
async def tools_library_output(request: Request, job_id: str, descriptor_sha256: str):
    if not is_library_path(request.url.path):
        raise HTTPException(404, "file_output_not_found")
    return await _store_output(
        request, "tools-" + job_id, descriptor_sha256, ToolLibraryDescription
    )


async def _store_output(
    request, task_id, descriptor_sha256, descriptor_type, *, verify_replay=False
):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_file_output_required")
    if request.headers.get("content-encoding", "identity").strip().lower() not in {"", "identity"}:
        raise HTTPException(422, "output_encoding_forbidden")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "file_output_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "file_output_authorization_forbidden")
    try:
        description = descriptor_type.from_header(
            request.headers.get("X-Fpl-Output-Descriptor", "")
        )
        length = int(request.headers.get("content-length", "-1"))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise HTTPException(422, "invalid_output_descriptor") from None
    if description.fingerprint != descriptor_sha256 or length != description.byte_size:
        raise HTTPException(422, "output_descriptor_mismatch")
    if description.byte_size > request.app.state.settings.fpl_visual_asset_max_bytes:
        raise HTTPException(413, "output_too_large")

    async def active():
        return await request.app.state.identity.status(
            assertion=request.headers.get(HEADER, ""), method="POST", path=request.url.path
        )

    async with request.app.state.database.sessions(
        info={"owner_user_id": actor.user_id}
    ) as session:
        return await LibraryOutputFiles(
            session, request.app.state.settings, actor.user_id, active=active
        ).store(
            task_id,
            description,
            OutputStream(request, description),
            folder_id=getattr(description, "folder_id", None),
            verify_replay=verify_replay,
        )
