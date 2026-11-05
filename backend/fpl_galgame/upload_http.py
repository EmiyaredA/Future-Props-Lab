"""Published multipart uploads for Galgame project originals."""

import hashlib
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, Request, UploadFile

from app.apps.galgame_workshop.schemas import (
    GalgameAssetBatchUploadOut,
    GalgameAssetCategory,
    GalgameProjectAssetOut,
)
from fpl_runtime.galgame_assets import SOURCE
from fpl_runtime.galgame_upload import MAX_FILES
from fpl_runtime.http_dependencies import OwnerDep
from fpl_runtime.project_errors import ProjectResourceError

from .upload_intakes import UploadSignature

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


async def signature(file):
    digest, size = hashlib.sha256(), 0
    while chunk := await file.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
    if size == 0:
        raise ProjectResourceError("文件内容与声明的类型不匹配", "invalid_file_content", 422)
    await file.seek(0)
    return UploadSignature(file.filename or "asset", file.content_type, size, digest.hexdigest())


async def save_uploads(request, owner, project_id, files, category, mode):
    if not 1 <= len(files) <= MAX_FILES:
        raise ProjectResourceError("每次请选择 1 到 500 个文件", "invalid_upload_count", 422)
    intake = request.app.state.upload_intakes
    await intake.require_project(owner, project_id)
    pending, manifest = await intake.reserve(
        owner,
        project_id,
        category,
        [await signature(file) for file in files],
        mode,
        assertion=request.state.service_assertion,
        source_path=request.url.path,
    )
    return await intake.upload(pending, manifest, files)


@router.post("/{project_id}/assets", response_model=GalgameProjectAssetOut)
async def upload_project_asset(
    request: Request,
    owner_user_id: OwnerDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
    category: Annotated[GalgameAssetCategory | None, Form()] = None,
) -> GalgameProjectAssetOut:
    suffix = Path(upload.filename or "").suffix.lower()
    if category is None:
        if suffix in {".mp4", ".webm", ".mov"}:
            category = "video"
        elif suffix in {".ttf", ".otf", ".woff", ".woff2"}:
            category = "font"
        else:
            category = "other"
    items, _ = await save_uploads(request, owner_user_id, project_id, [upload], category, "single")
    return items[0]


@router.post("/{project_id}/assets/batch", response_model=GalgameAssetBatchUploadOut)
async def batch_upload_project_assets(
    request: Request,
    owner_user_id: OwnerDep,
    project_id: str,
    uploads: Annotated[list[UploadFile], File()],
    category: Annotated[GalgameAssetCategory, Form()],
) -> GalgameAssetBatchUploadOut:
    items, plans = await save_uploads(
        request, owner_user_id, project_id, uploads, category, "batch"
    )
    return GalgameAssetBatchUploadOut(items=items, importItems=plans)
