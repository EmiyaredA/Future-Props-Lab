"""HTTP adapter for the Douyin / Bilibili video download tool."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.tool_navigation.video_download import (
    VideoDownloadDepsOut,
    VideoDownloadError,
    VideoDownloadJobCreate,
    VideoDownloadJobOut,
)
from studio.assembly.http_dependencies import OwnerDep

router = APIRouter(prefix="/tool-navigation/video-download", tags=["tool-navigation"])


def _http_error(exc: VideoDownloadError) -> HTTPException:
    return HTTPException(
        status_code=exc.status,
        detail={"code": exc.code, "message": str(exc)},
    )


@router.get("/deps", response_model=VideoDownloadDepsOut)
def get_video_download_deps(request: Request) -> VideoDownloadDepsOut:
    return request.app.state.video_downloads.probe()


@router.post("/jobs", response_model=VideoDownloadJobOut)
async def post_video_download_job(
    body: VideoDownloadJobCreate,
    request: Request,
    owner_user_id: OwnerDep,
) -> VideoDownloadJobOut:
    try:
        return request.app.state.video_downloads.create_job(body, owner_user_id=owner_user_id)
    except VideoDownloadError as exc:
        raise _http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "invalid_request", "message": str(exc)}) from exc


@router.get("/jobs/{job_id}", response_model=VideoDownloadJobOut)
def get_video_download_job(
    job_id: str, request: Request, owner_user_id: OwnerDep
) -> VideoDownloadJobOut:
    try:
        return request.app.state.video_downloads.get_job(
            job_id, owner_user_id=owner_user_id
        ).to_out()
    except VideoDownloadError as exc:
        raise _http_error(exc) from exc


@router.get(
    "/jobs/{job_id}/file",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
def download_video_download_file(
    job_id: str, request: Request, owner_user_id: OwnerDep
) -> FileResponse:
    try:
        path, filename = request.app.state.video_downloads.job_file(
            job_id, owner_user_id=owner_user_id
        )
    except VideoDownloadError as exc:
        raise _http_error(exc) from exc
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
