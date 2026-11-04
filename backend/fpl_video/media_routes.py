"""The Video project media API keeps its original multipart and response shapes."""

import hashlib
import re
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.routes.errors import _error
from app.apps.video_editor.schemas import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAvailableAssetListOut,
)
from app.capabilities.asset_store.errors import AssetError
from app.deps import OwnerDep, SessionDep
from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.video_assets import VideoCopyQuery

from .media_reads import MediaReads
from .media_variants import derivative, retry

router = APIRouter()
FILES = "/projects/{project_id}/assets"


@router.get("/import-sources", response_model=VideoEditorAvailableAssetListOut)
async def import_sources(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
) -> VideoEditorAvailableAssetListOut:
    try:
        return await MediaReads(request, session, owner_user_id).available()
    except VideoEditorUnavailableError as exc:
        raise _error(exc) from None


@router.get(FILES, response_model=VideoEditorAssetListOut)
async def list_assets(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
) -> VideoEditorAssetListOut:
    try:
        return await MediaReads(request, session, owner_user_id).list(project_id)
    except (VideoEditorNotFoundError, VideoEditorUnavailableError) as exc:
        raise _error(exc) from None


async def upload_description(file):
    digest, size = hashlib.sha256(), 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        digest.update(chunk)
    if not size:
        raise AssetError("文件内容为空", code="invalid_file_content", status=422)
    mime = (file.content_type or "").split(";", 1)[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime):
        mime = "application/octet-stream"
    try:
        description = ModelOutputDescription(
            Path(file.filename or "").name, mime, size, digest.hexdigest()
        )
    except ValueError:
        raise AssetError("文件名无效", code="invalid_filename", status=422) from None
    await file.seek(0)
    return description


@router.post(FILES, response_model=VideoEditorAssetOut)
async def upload_asset(
    request: Request,
    owner_user_id: OwnerDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
) -> VideoEditorAssetOut:
    async def chunks():
        while chunk := await upload.read(1024 * 1024):
            yield chunk

    try:
        descriptor = await upload_description(upload)
        writer = request.app.state.asset_intakes
        pending = await writer.reserve(
            request, owner_user_id, project_id, "upload", descriptor.fingerprint, 1
        )
        entries = await writer.write(
            pending,
            headers={
                "Content-Length": str(descriptor.byte_size),
                "X-Fpl-Video-File": descriptor.header(),
            },
            content=chunks(),
        )
        return entries[0]
    except (VideoEditorNotFoundError, VideoEditorUnavailableError, AssetError) as exc:
        raise _error(exc) from None
    finally:
        await upload.close()


@router.post(FILES + "/import", response_model=VideoEditorAssetListOut)
async def import_assets(
    request: Request,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VideoEditorAssetImportIn,
) -> VideoEditorAssetListOut:
    try:
        query = VideoCopyQuery(asset_ids=body.asset_ids)
        writer = request.app.state.asset_intakes
        pending = await writer.reserve(
            request, owner_user_id, project_id, "copy", query.digest, len(query.asset_ids)
        )
        entries = await writer.write(pending, body=query.model_dump())
        return VideoEditorAssetListOut(items=entries)
    except ValueError:
        raise _error(VideoEditorValidationError("有素材不可导入", code="invalid_asset")) from None
    except (VideoEditorNotFoundError, VideoEditorUnavailableError, AssetError) as exc:
        raise _error(exc) from None


@router.post(FILES + "/{asset_id}/proxy/retry", response_model=VideoEditorAssetOut)
async def retry_proxy(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, project_id: str, asset_id: str
) -> VideoEditorAssetOut:
    if request.app.state.media_delivery is None:
        raise _error(VideoEditorUnavailableError("剪辑素材处理暂不可用"))
    try:
        return await retry(request, session, owner_user_id, project_id, asset_id)
    except (VideoEditorNotFoundError, VideoEditorUnavailableError) as exc:
        raise _error(exc) from None


@router.get(FILES + "/{asset_id}/{variant}")
async def asset_variant(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    variant: str,
) -> StreamingResponse:
    try:
        binding = await derivative(session, owner_user_id, project_id, asset_id, variant)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    delivery = request.app.state.media_delivery
    if delivery is None:
        raise _error(VideoEditorUnavailableError("派生素材暂不可用"))
    try:
        response = await delivery.output(binding, variant, request.headers)
    except httpx.HTTPError:
        raise _error(VideoEditorUnavailableError("派生素材暂不可用")) from None
    if (
        response.status_code not in {200, 206, 400, 416}
        or response.headers.get("content-encoding", "identity") != "identity"
    ):
        await response.aclose()
        if response.status_code == 404:
            raise _error(VideoEditorNotFoundError("派生素材文件不存在"))
        raise _error(VideoEditorUnavailableError("派生素材暂不可用"))

    async def chunks():
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(
        chunks(),
        status_code=response.status_code,
        headers={
            **{
                name: response.headers[name]
                for name in (
                    "accept-ranges",
                    "content-length",
                    "content-range",
                    "content-type",
                    "etag",
                    "last-modified",
                )
                if name in response.headers
            },
            "Content-Disposition": "inline",
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(response.aclose),
    )
