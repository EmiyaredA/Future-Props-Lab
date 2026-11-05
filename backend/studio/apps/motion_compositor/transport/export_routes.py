"""Public Motion export operations keep their original names and response shapes."""

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from studio.apps.motion_compositor.exports import Exports, export_out
from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionUnavailable
from studio.apps.motion_compositor.schemas import ExportCreateIn, ExportListOut, ExportOut
from studio.apps.motion_compositor.transport.file_routes import FORWARDED_RESPONSE
from studio.apps.motion_compositor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter()
PATH = "/projects/{project_id}/exports"


@router.post(PATH, response_model=ExportOut)
async def create_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: ExportCreateIn,
) -> ExportOut:
    if request.app.state.motion_export_delivery is None:
        raise _error(MotionUnavailable("导出执行服务暂不可用"))
    try:
        return await Exports(session, owner_user_id).create(request, project_id, body)
    except (MotionNotFound, MotionInvalid, MotionUnavailable) as exc:
        raise _error(exc) from None
    except (CapabilityDenied, CapabilityUnavailable):
        raise _error(MotionUnavailable("导出授权暂不可用")) from None


@router.get(PATH, response_model=ExportListOut)
async def list_exports(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> ExportListOut:
    try:
        return await Exports(session, owner_user_id).list(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get(PATH + "/{task_id}", response_model=ExportOut)
async def get_export(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
) -> ExportOut:
    try:
        return export_out(await Exports(session, owner_user_id).task(project_id, task_id))
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post(PATH + "/{task_id}/cancel", response_model=ExportOut)
async def cancel_export(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
) -> ExportOut:
    try:
        return await Exports(session, owner_user_id).cancel(project_id, task_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get(PATH + "/{task_id}/download/{format_name}")
async def download_export(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    task_id: str,
    format_name: str,
) -> StreamingResponse:
    try:
        binding = await Exports(session, owner_user_id).output(project_id, task_id, format_name)
    except MotionNotFound as exc:
        raise _error(exc) from None
    delivery = request.app.state.motion_export_delivery
    if delivery is None:
        raise _error(MotionUnavailable("导出文件暂不可用"))
    try:
        response = await delivery.open_output(binding, format_name, request.headers)
    except httpx.HTTPError:
        raise _error(MotionUnavailable("导出文件暂不可用")) from None
    if (
        response.status_code not in {200, 206, 400, 416}
        or response.headers.get("content-encoding", "identity") != "identity"
    ):
        await response.aclose()
        if response.status_code == 404:
            raise _error(MotionNotFound("导出文件不存在"))
        raise _error(MotionUnavailable("导出文件暂不可用"))

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
                for name in FORWARDED_RESPONSE
                if name in response.headers
            },
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(response.aclose),
    )
