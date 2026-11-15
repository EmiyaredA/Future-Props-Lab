"""Owned preview task operations shared by the website and independent service."""

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.preview_renders import PreviewRenders
from studio.apps.video_editor.schemas.preview_render import (
    VideoEditorPreviewRenderCreateIn,
    VideoEditorPreviewRenderListOut,
    VideoEditorPreviewRenderOut,
)
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()
PATH = "/projects/{project_id}/preview/renders"


def use_case(request, session, owner):
    remote = hasattr(request.app.state, "render_delivery")
    if remote and request.app.state.render_delivery is None:
        raise _error(VideoEditorUnavailableError("预渲染暂不可用"))
    return PreviewRenders(session, owner, remote=remote)


ERRORS = (VideoEditorNotFoundError, VideoEditorUnavailableError, VideoEditorValidationError)


@router.post(PATH, response_model=VideoEditorPreviewRenderOut)
async def create_preview(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    body: VideoEditorPreviewRenderCreateIn,
):
    try:
        return await use_case(request, session, owner).create(project_id, body)
    except ERRORS as exc:
        raise _error(exc) from None


@router.get(PATH, response_model=VideoEditorPreviewRenderListOut)
async def list_previews(request: Request, session: SessionDep, owner: OwnerDep, project_id: str):
    try:
        return await use_case(request, session, owner).list(project_id)
    except ERRORS as exc:
        raise _error(exc) from None


@router.delete(PATH)
async def clear_previews(
    request: Request, session: SessionDep, owner: OwnerDep, project_id: str
) -> dict[str, bool]:
    try:
        await use_case(request, session, owner).clear(project_id)
    except ERRORS as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.post(PATH + "/{task_id}/cancel", response_model=VideoEditorPreviewRenderOut)
async def cancel_preview(
    request: Request, session: SessionDep, owner: OwnerDep, project_id: str, task_id: str
):
    try:
        return await use_case(request, session, owner).cancel(project_id, task_id)
    except ERRORS as exc:
        raise _error(exc) from None


@router.get(
    PATH + "/{task_id}/media",
    response_class=FileResponse,
    responses={200: {"content": {"video/mp4": {}}}, 206: {"content": {"video/mp4": {}}}},
)
async def preview_media(
    request: Request, session: SessionDep, owner: OwnerDep, project_id: str, task_id: str
):
    try:
        previews = use_case(request, session, owner)
        task = await previews.get(project_id, task_id)
        _timeline, preview, fingerprint = await previews.identity(project_id)
        if not preview.ready or not previews.output(task, fingerprint).valid:
            raise VideoEditorNotFoundError("预览缓存已过期或尚未就绪")
        await session.rollback()
        if not previews.remote:
            path = request.app.state.video_preview_path(owner, project_id, task_id)
            if not path.is_file() or path.is_symlink():
                raise VideoEditorNotFoundError("预览缓存文件不存在，请清理后重新生成")
            return FileResponse(
                path,
                media_type="video/mp4",
                headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
            )
        response = await request.app.state.render_delivery.preview_output(
            owner, task_id, request.headers
        )
    except ERRORS as exc:
        raise _error(exc) from None
    except httpx.HTTPError:
        raise _error(VideoEditorUnavailableError("预览缓存暂不可用")) from None
    if response.status_code not in {200, 206, 416}:
        await response.aclose()
        if response.status_code == 404:
            raise _error(VideoEditorNotFoundError("预览缓存文件不存在，请清理后重新生成"))
        raise _error(VideoEditorUnavailableError("预览缓存暂不可用"))
    if response.headers.get("content-encoding", "identity") != "identity":
        await response.aclose()
        raise HTTPException(502, "invalid_preview_encoding")

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
                key: response.headers[key]
                for key in (
                    "accept-ranges",
                    "content-length",
                    "content-range",
                    "content-type",
                    "etag",
                    "last-modified",
                )
                if key in response.headers
            },
            "Cache-Control": "no-store",
            "Content-Disposition": "inline",
        },
        background=BackgroundTask(response.aclose),
    )
