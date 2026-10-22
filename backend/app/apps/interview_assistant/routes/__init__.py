"""Authenticated HTTP boundary; business writes and file selection remain in Rooms."""

from contextlib import contextmanager

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response

from app.deps import SessionDep, StudioAuth
from app.runtime.operation_receipts import OperationError

from ..bundles import markdown
from ..codex import executor_status
from ..rooms import Rooms
from ..schemas import (
    InterviewCreateIn,
    InterviewExecutorOut,
    InterviewPrepareIn,
    InterviewRevisionIn,
    InterviewRoomList,
    InterviewRoomOut,
    InterviewTaskProgress,
    PreparationBundle,
)

router = APIRouter(prefix="/interview-assistant", tags=["interview-assistant"])


@contextmanager
def errors():
    try:
        yield
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/executor", response_model=InterviewExecutorOut)
async def get_interview_executor(principal: StudioAuth):
    return await executor_status(principal.user_id)


@router.get("/rooms", response_model=InterviewRoomList)
async def list_interview_rooms(session: SessionDep, principal: StudioAuth):
    with errors():
        return InterviewRoomList(items=await Rooms(session, principal).list())


@router.post("/rooms", response_model=InterviewRoomOut, status_code=201)
async def create_interview_room(
    body: InterviewCreateIn, session: SessionDep, principal: StudioAuth
):
    with errors():
        return await Rooms(session, principal).create(body)


@router.get("/rooms/{room_id}", response_model=InterviewRoomOut)
async def get_interview_room(room_id: str, session: SessionDep, principal: StudioAuth):
    with errors():
        return await Rooms(session, principal).get(room_id)


@router.delete("/rooms/{room_id}")
async def delete_interview_room(
    room_id: str, session: SessionDep, principal: StudioAuth, expected_revision: int = Query(ge=0)
) -> dict[str, bool]:
    with errors():
        await Rooms(session, principal).delete(room_id, expected_revision)
        return {"deleted": True}


@router.post("/rooms/{room_id}/materials", response_model=InterviewRoomOut)
async def upload_interview_material(
    room_id: str,
    session: SessionDep,
    principal: StudioAuth,
    expected_revision: int = Query(ge=0),
    file: UploadFile = File(...),
):
    with errors():
        return await Rooms(session, principal).upload(room_id, expected_revision, file)


@router.get(
    "/rooms/{room_id}/materials/{material_id}/download",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def download_interview_material(
    room_id: str, material_id: str, session: SessionDep, principal: StudioAuth
):
    with errors():
        path, filename = await Rooms(session, principal).material(room_id, material_id)
        return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.post("/rooms/{room_id}/preparations", response_model=InterviewRoomOut, status_code=202)
async def prepare_interview(
    room_id: str, body: InterviewPrepareIn, session: SessionDep, principal: StudioAuth
):
    with errors():
        status = await executor_status(principal.user_id)
        if not status.available:
            raise OperationError(status.message, status.code, 409)
        return await Rooms(session, principal).prepare(room_id, body)


@router.post("/rooms/{room_id}/preparations/{task_id}/cancel", response_model=InterviewRoomOut)
async def cancel_interview_preparation(
    room_id: str,
    task_id: str,
    body: InterviewRevisionIn,
    session: SessionDep,
    principal: StudioAuth,
):
    with errors():
        return await Rooms(session, principal).cancel(room_id, task_id, body.expected_revision)


@router.get("/rooms/{room_id}/preparations/{task_id}/events", response_model=InterviewTaskProgress)
async def get_interview_progress(
    room_id: str, task_id: str, session: SessionDep, principal: StudioAuth
):
    with errors():
        task = await Rooms(session, principal).task(room_id, task_id)
        return InterviewTaskProgress.model_validate(task, from_attributes=True)


@router.get("/rooms/{room_id}/preparations/{task_id}/bundle", response_model=PreparationBundle)
async def get_interview_bundle(
    room_id: str, task_id: str, session: SessionDep, principal: StudioAuth
):
    with errors():
        return await Rooms(session, principal).bundle(room_id, task_id)


@router.get(
    "/rooms/{room_id}/preparations/{task_id}/export",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def export_interview_bundle(
    room_id: str,
    task_id: str,
    session: SessionDep,
    principal: StudioAuth,
    format: str = Query("markdown", pattern="^(json|markdown)$"),
):
    with errors():
        bundle = PreparationBundle.model_validate(
            await Rooms(session, principal).bundle(room_id, task_id)
        )
        content = bundle.model_dump_json(indent=2) if format == "json" else markdown(bundle)
        extension = "json" if format == "json" else "md"
        return Response(
            content,
            media_type="application/json" if format == "json" else "text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="interview-materials.{extension}"'
            },
        )
