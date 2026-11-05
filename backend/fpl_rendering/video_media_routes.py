"""Private ownership-checked Video job receipts and derivative streaming."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from fpl_runtime.video_processing import JOBS, VARIANTS, MediaJobIn, valid_id

router = APIRouter(include_in_schema=False)


def access(request, job_id):
    state = request.app.state
    if (
        state.video_media_peer is None
        or not valid_id(job_id)
        or "origin" in request.headers
        or "cookie" in request.headers
    ):
        raise HTTPException(403, "video_media_peer_required")
    try:
        owner = state.video_media_peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "video_media_peer_required") from None
    return state.video_jobs, owner


@router.post(JOBS + "/{job_id}/{project_id}/{asset_id}")
async def submit(request: Request, job_id: str, project_id: str, asset_id: str):
    jobs, owner = access(request, job_id)
    if not valid_id(project_id) or not valid_id(asset_id):
        raise HTTPException(422, "invalid_video_media_source")
    try:
        return await jobs.enqueue(
            owner, job_id, MediaJobIn(project_id=project_id, asset_id=asset_id)
        )
    except ValueError:
        raise HTTPException(409, "video_media_scope_changed") from None


@router.get(JOBS + "/{job_id}")
async def status(request: Request, job_id: str):
    jobs, owner = access(request, job_id)
    job = await jobs.load(owner, job_id)
    if job is None:
        raise HTTPException(404, "video_media_job_missing")
    return jobs.receipt(job)


@router.delete(JOBS + "/{job_id}")
async def purge(request: Request, job_id: str):
    jobs, owner = access(request, job_id)
    job = await jobs.load(owner, job_id)
    if job is not None and not await jobs.purge(job):
        raise HTTPException(409, "video_media_job_pending")
    return {"deleted": True}


@router.get(JOBS + "/{job_id}/files/{variant}")
async def output(request: Request, job_id: str, variant: str):
    jobs, owner = access(request, job_id)
    job = await jobs.load(owner, job_id)
    if job is None or job.status != "completed" or variant not in VARIANTS:
        raise HTTPException(404, "video_derivative_not_found")
    filename = job.outputs.get(variant)
    if not filename:
        raise HTTPException(404, "video_derivative_not_found")
    root = jobs.folder(owner, job_id) / "outputs"
    path = root / filename
    if path.is_symlink() or not path.resolve().is_relative_to(root) or not path.is_file():
        raise HTTPException(404, "video_derivative_not_found")
    return FileResponse(path, headers={"Cache-Control": "no-store"})
