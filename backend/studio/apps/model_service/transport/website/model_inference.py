from contextlib import aclosing
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from studio.apps.model_service.inference.assets import InferenceAssets
from studio.apps.model_service.inference.catalog import options
from studio.apps.model_service.inference.tasks import InferenceTasks
from studio.apps.model_service.inference.text import events, prepare
from studio.apps.model_service.library.inputs import library_inputs
from studio.apps.model_service.library.outputs import library_outputs
from studio.apps.model_service.transport.errors import mapped
from studio.apps.model_service.transport.provider_bindings import provider_options
from studio.apps.model_service.transport.stream_access import stream_access
from studio.apps.model_service.transport.website.model_capacity import task_admission
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.model_credentials import CallCredentialDep
from studio.contracts.asset_library.files import VisualAssetOut
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
async def model_options(request: Request, session: SessionDep, owner_user_id: OwnerDep):
    return await options(
        session,
        owner_user_id,
        upload_configured=bool(request.app.state.settings.fpl_temp_media_upload_url),
        readiness=request.app.state.model_catalog_bindings.readiness,
    )


@router.post("/text", response_model=InferenceTextOut)
async def generate_text(
    request: Request,
    body: InferenceTextIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
):
    args = await mapped(
        prepare(
            session,
            owner_user_id,
            body,
            decrypt=request.app.state.model_decrypt,
            settings=request.app.state.settings,
            readiness=request.app.state.model_catalog_bindings.readiness,
        )
    )
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
    args = await mapped(
        prepare(
            session,
            owner_user_id,
            body,
            decrypt=request.app.state.model_decrypt,
            settings=request.app.state.settings,
            readiness=request.app.state.model_catalog_bindings.readiness,
        )
    )

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
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    upload: Annotated[UploadFile, File()],
):
    try:
        return await mapped(
            InferenceAssets(session, owner_user_id, settings=request.app.state.settings).upload(
                upload
            )
        )
    finally:
        await upload.close()


@router.post("/assets/import", response_model=InferenceAssetOut)
async def import_asset(
    request: Request, body: InferenceAssetImportIn, session: SessionDep, owner_user_id: OwnerDep
):
    sources = library_inputs(request, session, owner_user_id)
    return await mapped(
        InferenceAssets(
            session, owner_user_id, settings=request.app.state.settings, library=sources
        ).import_library(body.asset_id)
    )


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(
    request: Request, asset_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    await mapped(
        InferenceAssets(session, owner_user_id, settings=request.app.state.settings).delete(
            asset_id
        )
    )


@router.post("/tasks", response_model=InferenceTaskOut)
async def create_task(
    body: InferenceTaskIn,
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
):
    return await mapped(
        InferenceTasks(session, owner_user_id, settings=request.app.state.settings).create(
            body,
            task_admission(request, session, "inference"),
            credential=credential,
            readiness=request.app.state.model_catalog_bindings.readiness,
        )
    )


@router.get("/tasks", response_model=InferenceTasksOut)
async def list_tasks(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await InferenceTasks(session, owner_user_id, settings=request.app.state.settings).list(
        offset, limit
    )


@router.get("/tasks/{task_id}", response_model=InferenceTaskOut)
async def get_task(request: Request, task_id: str, session: SessionDep, owner_user_id: OwnerDep):
    return await mapped(
        InferenceTasks(session, owner_user_id, settings=request.app.state.settings).get(task_id)
    )


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
async def download_result(
    request: Request, task_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    path, filename, mime = await mapped(
        InferenceTasks(session, owner_user_id, settings=request.app.state.settings).content(task_id)
    )
    return FileResponse(path, filename=filename, media_type=mime)


@router.post("/tasks/{task_id}/save-to-library", response_model=VisualAssetOut)
async def save_result(task_id: str, request: Request, session: SessionDep, owner_user_id: OwnerDep):
    outputs = library_outputs(request, session, owner_user_id)
    return await mapped(
        InferenceTasks(
            session, owner_user_id, settings=request.app.state.settings, library_outputs=outputs
        ).save_to_library(task_id)
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
        InferenceTasks(
            session, owner_user_id, settings=request.app.state.settings
        ).retry_materialization(
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
            settings=request.app.state.settings,
            native_retention=getattr(request.app.state, "native_model_retention", None),
            require_native_retention=request.app.state.require_native_model_retention,
        ).delete(task_id, expected_revision)
    )
