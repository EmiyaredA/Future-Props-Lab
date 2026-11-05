from contextlib import aclosing
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.capabilities.asset_store.schemas.files import VisualAssetOut
from app.llm.http_errors import mapped
from app.llm.inference.assets import InferenceAssets
from app.llm.inference.catalog import options
from app.llm.inference.tasks import InferenceTasks
from app.llm.inference.text import events, prepare
from app.llm.library_inputs import library_inputs
from app.llm.library_outputs import library_outputs
from app.llm.provider_transports import provider_options
from app.llm.routes.model_capacity import task_admission
from app.llm.stream_access import stream_access
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.model_credentials import CallCredentialDep
from studio.contracts.model_service.schemas.model_inference import (
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

router = APIRouter(prefix="/model-inference", tags=["model-inference"])


@router.get("/options", response_model=InferenceOptionsOut)
async def model_options(session: SessionDep, owner_user_id: OwnerDep):
    return await options(session, owner_user_id)


@router.post("/text", response_model=InferenceTextOut)
async def generate_text(
    request: Request,
    body: InferenceTextIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
):
    args = await mapped(prepare(session, owner_user_id, body))
    async with aclosing(
        events(
            owner_user_id,
            body,
            args,
            credential=credential,
            session_factory=request.app.state.database.sessions,
            check_access=stream_access(request),
            **provider_options(request, args["base_url"]),
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
    credential: CallCredentialDep,
):
    args = await mapped(prepare(session, owner_user_id, body))

    async def stream():
        async with aclosing(
            events(
                owner_user_id,
                body,
                args,
                credential=credential,
                session_factory=request.app.state.database.sessions,
                check_access=stream_access(request),
                **provider_options(request, args["base_url"]),
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
async def import_asset(
    request: Request, body: InferenceAssetImportIn, session: SessionDep, owner_user_id: OwnerDep
):
    sources = library_inputs(request, session, owner_user_id)
    return await mapped(
        InferenceAssets(session, owner_user_id, library=sources).import_library(body.asset_id)
    )


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, session: SessionDep, owner_user_id: OwnerDep):
    await mapped(InferenceAssets(session, owner_user_id).delete(asset_id))


@router.post("/tasks", response_model=InferenceTaskOut)
async def create_task(
    body: InferenceTaskIn,
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
):
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
async def save_result(task_id: str, request: Request, session: SessionDep, owner_user_id: OwnerDep):
    outputs = library_outputs(request, session, owner_user_id)
    return await mapped(
        InferenceTasks(session, owner_user_id, library_outputs=outputs).save_to_library(task_id)
    )


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
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await mapped(
        InferenceTasks(
            session,
            owner_user_id,
            native_retention=getattr(request.app.state, "native_model_retention", None),
        ).delete(task_id, expected_revision)
    )
