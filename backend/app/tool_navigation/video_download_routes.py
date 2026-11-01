"""HTTP adapter for the Douyin / Bilibili video download tool."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.deps import OwnerDep
from app.tool_navigation.video_download import (
    VideoDownloadDepsOut,
    VideoDownloadError,
    VideoDownloadJobCreate,
    VideoDownloadJobOut,
    create_job,
    get_job,
    job_file,
    probe_deps,
)

router = APIRouter(prefix="/tool-navigation/video-download", tags=["tool-navigation"])


def _http_error(exc: VideoDownloadError) -> HTTPException:
    return HTTPException(
        status_code=exc.status,
        detail={"code": exc.code, "message": str(exc)},
    )


@router.get("/deps", response_model=VideoDownloadDepsOut)
def get_video_download_deps() -> VideoDownloadDepsOut:
    return probe_deps()


@router.post("/jobs", response_model=VideoDownloadJobOut)
async def post_video_download_job(
    body: VideoDownloadJobCreate,
    owner_user_id: OwnerDep,
) -> VideoDownloadJobOut:
    try:
        return create_job(body, owner_user_id=owner_user_id)
    except VideoDownloadError as exc:
        raise _http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "invalid_request", "message": str(exc)}) from exc


@router.get("/jobs/{job_id}", response_model=VideoDownloadJobOut)
def get_video_download_job(job_id: str, owner_user_id: OwnerDep) -> VideoDownloadJobOut:
    try:
        return get_job(job_id, owner_user_id=owner_user_id).to_out()
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
def download_video_download_file(job_id: str, owner_user_id: OwnerDep) -> FileResponse:
    try:
        path, filename = job_file(job_id, owner_user_id=owner_user_id)
    except VideoDownloadError as exc:
        raise _http_error(exc) from exc
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
