from contextlib import aclosing
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.schemas.files import VisualAssetOut
from app.capabilities.transcription import TranscriptionParameterError
from app.deps import OwnerDep, SessionDep, StudioAuth
from app.llm.call_logs.credentials import snapshot_from_principal
from app.llm.inference.assets import InferenceAssets
from app.llm.inference.catalog import options
from app.llm.inference.tasks import InferenceTasks
from app.llm.inference.text import events, prepare
from app.llm.routes.model_capacity import task_admission
from app.llm.schemas.model_inference import (
    InferenceAssetImportIn,
    InferenceAssetOut,
    InferenceOptionsOut,
    InferenceRevisionIn,
    InferenceTaskIn,
    InferenceTaskOut,
    InferenceTasksOut,
    InferenceTextEvent,
    InferenceTextIn,
    InferenceTextOut,
)
from app.runtime.operation_receipts import OperationError

router = APIRouter(prefix="/model-inference", tags=["model-inference"])


async def mapped(operation):
    try:
        return await operation
    except (OperationError, AssetError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_parameters", "errors": exc.errors(include_context=False)}
        ) from None
    except TranscriptionParameterError as exc:
        raise HTTPException(422, {"code": "unsupported_parameter", "message": str(exc)}) from None


@router.get("/options", response_model=InferenceOptionsOut)
async def model_options(session: SessionDep, owner_user_id: OwnerDep):
    return await options(session, owner_user_id)


@router.post("/text", response_model=InferenceTextOut)
async def generate_text(
    request: Request,
    body: InferenceTextIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
    principal: StudioAuth,
):
    args = await mapped(prepare(session, owner_user_id, body))
    credential = await snapshot_from_principal(session, principal)
    async with aclosing(
        events(
            owner_user_id,
            body,
            args,
            credential=credential,
            session_factory=request.app.state.database.sessions,
        )
    ) as stream:
        async for event in stream:
            if event.type == "done":
                return event.result
            if event.type == "error":
                raise HTTPException(
                    502,
                    {"code": "model_call_failed", "message": event.message, "log_id": event.log_id},
                )
    raise HTTPException(502, {"code": "model_call_incomplete"})


@router.post(
    "/text/stream",
    responses={
        200: {
            "content": {
                "text/event-stream": {
                    "schema": InferenceTextEvent.model_json_schema(
                        ref_template="#/components/schemas/{model}"
                    ),
                }
            }
        }
    },
)
async def stream_text(
    request: Request,
    body: InferenceTextIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
    principal: StudioAuth,
):
    args = await mapped(prepare(session, owner_user_id, body))
    credential = await snapshot_from_principal(session, principal)

    async def stream():
        async with aclosing(
            events(
                owner_user_id,
                body,
                args,
                credential=credential,
                session_factory=request.app.state.database.sessions,
            )
        ) as source:
            async for event in source:
                yield "data: " + event.model_dump_json(exclude_none=True) + "\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/assets", response_model=InferenceAssetOut)
async def upload_asset(
    session: SessionDep, owner_user_id: OwnerDep, upload: Annotated[UploadFile, File()]
):
    try:
        return await mapped(InferenceAssets(session, owner_user_id).upload(upload))
    finally:
        await upload.close()


@router.post("/assets/import", response_model=InferenceAssetOut)
async def import_asset(body: InferenceAssetImportIn, session: SessionDep, owner_user_id: OwnerDep):
    return await mapped(InferenceAssets(session, owner_user_id).import_library(body.asset_id))


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, session: SessionDep, owner_user_id: OwnerDep):
    await mapped(InferenceAssets(session, owner_user_id).delete(asset_id))


@router.post("/tasks", response_model=InferenceTaskOut)
async def create_task(
    body: InferenceTaskIn,
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    principal: StudioAuth,
):
    credential = await snapshot_from_principal(session, principal)
    return await mapped(
        InferenceTasks(session, owner_user_id).create(
            body,
            task_admission(request, session, "inference"),
            credential=credential,
        )
    )


@router.get("/tasks", response_model=InferenceTasksOut)
async def list_tasks(
    session: SessionDep,
    owner_user_id: OwnerDep,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await InferenceTasks(session, owner_user_id).list(offset, limit)


@router.get("/tasks/{task_id}", response_model=InferenceTaskOut)
async def get_task(task_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return await mapped(InferenceTasks(session, owner_user_id).get(task_id))


@router.get(
    "/tasks/{task_id}/content",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def download_result(task_id: str, session: SessionDep, owner_user_id: OwnerDep):
    path, filename, mime = await mapped(InferenceTasks(session, owner_user_id).content(task_id))
    return FileResponse(path, filename=filename, media_type=mime)


@router.post("/tasks/{task_id}/save-to-library", response_model=VisualAssetOut)
async def save_result(task_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return await mapped(InferenceTasks(session, owner_user_id).save_to_library(task_id))


@router.post("/tasks/{task_id}/retry-materialization", response_model=InferenceTaskOut)
async def retry_materialization(
    task_id: str,
    body: InferenceRevisionIn,
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await mapped(
        InferenceTasks(session, owner_user_id).retry_materialization(
            task_id, body.expected_revision, task_admission(request, session, "inference")
        )
    )


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await mapped(InferenceTasks(session, owner_user_id).delete(task_id, expected_revision))
