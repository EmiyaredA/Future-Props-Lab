"""Published Galgame annotation, video export and editor handoff records."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from studio.apps.galgame_workshop.annotation.annotation_jobs import enqueue_import
from studio.apps.galgame_workshop.annotation.annotation_preview import annotation_preview
from studio.apps.galgame_workshop.exact_frame import exact_frame
from studio.apps.galgame_workshop.exports.export_download import download_export
from studio.apps.galgame_workshop.exports.export_jobs import enqueue_export
from studio.apps.galgame_workshop.exports.export_preflight import export_preview
from studio.apps.galgame_workshop.handoffs.handoff_jobs import enqueue_handoff
from studio.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
    GalgameVideoEditorHandoffCreateIn,
    GalgameVideoEditorHandoffTaskListOut,
    GalgameVideoEditorHandoffTaskOut,
    GalgameVideoExportCreateIn,
    GalgameVideoExportFrameIn,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)
from studio.apps.galgame_workshop.storage.task_records import TaskRecords
from studio.apps.galgame_workshop.transport.asset_read_routes import read_assets
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.galgame_workshop.galgame_assets import SOURCE
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix=SOURCE, tags=["galgame-workshop"])


@router.post(
    "/{project_id}/annotation-imports/preview", response_model=GalgameAnnotationImportPreviewOut
)
async def preview_annotation_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
    request: Request,
) -> GalgameAnnotationImportPreviewOut:
    return await annotation_preview(read_assets(request, session, owner_user_id), project_id, body)


@router.post(
    "/{project_id}/annotation-imports",
    response_model=GalgameAnnotationImportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_annotation_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
    request: Request,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await enqueue_import(read_assets(request, session, owner_user_id), project_id, body)
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None


@router.get(
    "/{project_id}/annotation-imports/{import_id}", response_model=GalgameAnnotationImportTaskOut
)
async def get_annotation_import(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, import_id: str
) -> GalgameAnnotationImportTaskOut:
    return await TaskRecords(session, owner_user_id).annotation_import(project_id, import_id)


@router.post("/{project_id}/video-exports/preview", response_model=GalgameVideoExportPreviewOut)
async def preview_video_export(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportPreviewIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameVideoExportPreviewOut:
    return await export_preview(
        request, read_assets(request, session, owner_user_id), project_id, body
    )


@router.post("/{project_id}/video-exports/frame")
async def exact_video_export_frame(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportFrameIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> Response:
    try:
        png = await exact_frame(
            request, read_assets(request, session, owner_user_id), project_id, body
        )
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-store"})


@router.post(
    "/{project_id}/video-exports",
    response_model=GalgameVideoExportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_video_export(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoExportCreateIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameVideoExportTaskOut:
    try:
        return await enqueue_export(
            request, read_assets(request, session, owner_user_id), project_id, body
        )
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None


@router.get("/{project_id}/video-exports", response_model=GalgameVideoExportTaskListOut)
async def list_video_exports(
    session: SessionDep, project_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskListOut:
    return await TaskRecords(session, owner_user_id).list_exports(project_id)


@router.get("/{project_id}/video-exports/{export_id}", response_model=GalgameVideoExportTaskOut)
async def get_video_export(
    session: SessionDep, project_id: str, export_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskOut:
    return await TaskRecords(session, owner_user_id).export(project_id, export_id)


@router.post(
    "/{project_id}/video-exports/{export_id}/cancel", response_model=GalgameVideoExportTaskOut
)
async def cancel_video_export(
    session: SessionDep, project_id: str, export_id: str, owner_user_id: OwnerDep
) -> GalgameVideoExportTaskOut:
    return await TaskRecords(session, owner_user_id).cancel_export(project_id, export_id)


@router.post(
    "/{project_id}/video-editor-handoffs",
    response_model=GalgameVideoEditorHandoffTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_handoff(
    session: SessionDep,
    project_id: str,
    body: GalgameVideoEditorHandoffCreateIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameVideoEditorHandoffTaskOut:
    try:
        return await enqueue_handoff(
            request, read_assets(request, session, owner_user_id), project_id, body
        )
    except AssetError as exc:
        raise HTTPException(
            exc.status, {"code": exc.code, "message": str(exc), **exc.detail}
        ) from None


@router.get(
    "/{project_id}/video-editor-handoffs", response_model=GalgameVideoEditorHandoffTaskListOut
)
async def list_handoffs(
    session: SessionDep, project_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskListOut:
    return await TaskRecords(session, owner_user_id).list_handoffs(project_id)


@router.get(
    "/{project_id}/video-editor-handoffs/{task_id}", response_model=GalgameVideoEditorHandoffTaskOut
)
async def get_handoff(
    session: SessionDep, project_id: str, task_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskOut:
    return await TaskRecords(session, owner_user_id).handoff(project_id, task_id)


@router.post(
    "/{project_id}/video-editor-handoffs/{task_id}/cancel",
    response_model=GalgameVideoEditorHandoffTaskOut,
)
async def cancel_handoff(
    session: SessionDep, project_id: str, task_id: str, owner_user_id: OwnerDep
) -> GalgameVideoEditorHandoffTaskOut:
    return await TaskRecords(session, owner_user_id).cancel_handoff(project_id, task_id)


@router.get("/{project_id}/video-exports/{export_id}/download")
async def download_video_export(
    session: SessionDep, project_id: str, export_id: str, request: Request, owner_user_id: OwnerDep
):
    return await download_export(request, session, owner_user_id, project_id, export_id)
