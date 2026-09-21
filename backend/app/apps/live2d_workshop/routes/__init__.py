from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.routing import APIRoute

from app.apps.live2d_workshop.exports import Live2DExportsStore
from app.apps.live2d_workshop.packages import Live2DPackages
from app.apps.live2d_workshop.projects import Live2DNotFound, Live2DProjectsStore
from app.apps.live2d_workshop.schemas import (
    Live2DAssetOut,
    Live2DAssets,
    Live2DCreate,
    Live2DCrop,
    Live2DDocumentOut,
    Live2DExportIn,
    Live2DExportOut,
    Live2DExports,
    Live2DPatch,
    Live2DPreflight,
    Live2DProjectOut,
    Live2DProjects,
    Live2DSave,
)
from app.deps import SessionDep, WorkspaceDep


class CharacterRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except Live2DNotFound as exc:
                raise HTTPException(404, str(exc)) from None
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None

        return handle


router = APIRouter(prefix="/live2d-workshop", tags=["live2d-workshop"], route_class=CharacterRoute)


@router.get("/projects", response_model=Live2DProjects)
async def list_projects(session: SessionDep, workspace_id: WorkspaceDep):
    return await Live2DProjectsStore(session, workspace_id).list()


@router.post("/projects", response_model=Live2DProjectOut)
async def create_project(session: SessionDep, workspace_id: WorkspaceDep, body: Live2DCreate):
    return await Live2DProjectsStore(session, workspace_id).create(body)


@router.post("/projects/import", response_model=Live2DProjectOut)
async def import_project(
    session: SessionDep, workspace_id: WorkspaceDep, file: Annotated[UploadFile, File()]
):
    return await Live2DPackages(session, workspace_id).import_package(file)


@router.get("/projects/{project_id}", response_model=Live2DProjectOut)
async def get_project(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await Live2DProjectsStore(session, workspace_id).get(project_id)


@router.patch("/projects/{project_id}", response_model=Live2DProjectOut)
async def patch_project(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: Live2DPatch
):
    return await Live2DProjectsStore(session, workspace_id).patch(project_id, body)


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    expected_revision: int = Query(alias="expectedRevision", ge=0),
) -> dict[str, bool]:
    await Live2DProjectsStore(session, workspace_id).delete(project_id, expected_revision)
    return {"deleted": True}


@router.get("/projects/{project_id}/document", response_model=Live2DDocumentOut)
async def get_document(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await Live2DProjectsStore(session, workspace_id).document(project_id)


@router.put("/projects/{project_id}/document", response_model=Live2DDocumentOut)
async def save_document(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: Live2DSave
):
    return await Live2DProjectsStore(session, workspace_id).save(project_id, body)


@router.get("/projects/{project_id}/assets", response_model=Live2DAssets)
async def list_assets(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await Live2DProjectsStore(session, workspace_id).assets(project_id)


@router.post("/projects/{project_id}/assets", response_model=Live2DAssetOut)
async def upload_asset(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    file: Annotated[UploadFile, File()],
):
    return await Live2DProjectsStore(session, workspace_id).upload(project_id, file)


@router.get(
    "/projects/{project_id}/assets/{asset_id}/file",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def asset_file(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, asset_id: str
):
    path = await Live2DProjectsStore(session, workspace_id).asset_path(project_id, asset_id)
    return FileResponse(path, media_type="image/png")


@router.get(
    "/projects/{project_id}/thumbnail",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def thumbnail(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return Response(
        await Live2DProjectsStore(session, workspace_id).preview(project_id, width=256),
        media_type="image/png",
    )


@router.get(
    "/projects/{project_id}/preview",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
async def preview(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    frame: float = Query(default=0, ge=0, le=36000),
    motion_id: str | None = Query(default=None, alias="motionId"),
    expression_id: str | None = Query(default=None, alias="expressionId"),
    expected_revision: int | None = Query(default=None, alias="expectedRevision", ge=0),
    width: int = Query(default=480, ge=32, le=2048),
    height: int | None = Query(default=None, ge=32, le=2048),
    crop_x: float | None = Query(default=None, alias="cropX", ge=0, allow_inf_nan=False),
    crop_y: float | None = Query(default=None, alias="cropY", ge=0, allow_inf_nan=False),
    crop_width: float | None = Query(
        default=None, alias="cropWidth", gt=0, le=4096, allow_inf_nan=False
    ),
    crop_height: float | None = Query(
        default=None, alias="cropHeight", gt=0, le=4096, allow_inf_nan=False
    ),
):
    values = (crop_x, crop_y, crop_width, crop_height)
    if any(v is not None for v in values) and not all(v is not None for v in values):
        raise HTTPException(422, "请提供完整裁切区域")
    crop = (
        Live2DCrop(x=crop_x, y=crop_y, width=crop_width, height=crop_height)
        if all(v is not None for v in values)
        else None
    )
    data = await Live2DProjectsStore(session, workspace_id).preview(
        project_id, frame, motion_id, expression_id, width, height, expected_revision, crop
    )
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get(
    "/projects/{project_id}/package",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_package(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    data = await Live2DPackages(session, workspace_id).export(project_id)
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="character.fpllive2d"'},
    )


@router.post("/projects/{project_id}/exports/preflight", response_model=Live2DPreflight)
async def preflight(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: Live2DExportIn
):
    return await Live2DExportsStore(session, workspace_id).preflight(project_id, body)


@router.post("/projects/{project_id}/exports", response_model=Live2DExportOut)
async def create_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, body: Live2DExportIn
):
    return await Live2DExportsStore(session, workspace_id).create_export(project_id, body)


@router.get("/projects/{project_id}/exports", response_model=Live2DExports)
async def list_exports(session: SessionDep, workspace_id: WorkspaceDep, project_id: str):
    return await Live2DExportsStore(session, workspace_id).list_exports(project_id)


@router.get("/projects/{project_id}/exports/{task_id}", response_model=Live2DExportOut)
async def get_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
):
    store = Live2DExportsStore(session, workspace_id)
    return store.task_out(await store.task(project_id, task_id))


@router.post("/projects/{project_id}/exports/{task_id}/cancel", response_model=Live2DExportOut)
async def cancel_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
):
    return await Live2DExportsStore(session, workspace_id).cancel(project_id, task_id)


@router.get(
    "/projects/{project_id}/exports/{task_id}/download",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
async def download_export(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str, task_id: str
):
    path = await Live2DExportsStore(session, workspace_id).download(project_id, task_id)
    return FileResponse(path, media_type="application/zip", filename="character-frames.zip")
