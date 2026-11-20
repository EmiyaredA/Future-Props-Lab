"""Visual project scene routes, shared by both application assemblies."""

from fastapi import APIRouter, HTTPException, Query, Request

from studio.apps.visual_workshop.previs_scenes import (
    PrevisSceneCreate,
    PrevisSceneOut,
    PrevisScenes,
    PrevisSceneSummary,
    PrevisSceneUpdate,
)
from studio.apps.visual_workshop.transport.creative_asset_scope import creative_asset_inspection
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.runtime.project_errors import ProjectResourceError

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


async def resolve(action):
    try:
        return await action
    except ProjectResourceError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/{project_id}/previs-scenes", response_model=list[PrevisSceneSummary])
async def list_previs_scenes(session: SessionDep, owner: OwnerDep, project_id: str):
    return await resolve(PrevisScenes(session, owner).list(project_id))


@router.post("/{project_id}/previs-scenes", response_model=PrevisSceneOut, status_code=201)
async def create_previs_scene(
    request: Request, session: SessionDep, owner: OwnerDep, project_id: str, body: PrevisSceneCreate
):
    return await resolve(
        PrevisScenes(session, owner, creative_asset_inspection(request, session, owner)).create(
            project_id, body
        )
    )


@router.get("/{project_id}/previs-scenes/{scene_id}", response_model=PrevisSceneOut)
async def get_previs_scene(session: SessionDep, owner: OwnerDep, project_id: str, scene_id: str):
    return await resolve(PrevisScenes(session, owner).get(project_id, scene_id))


def require_current(scene, conflicted):
    if conflicted:
        raise HTTPException(
            409,
            {
                "code": "previs_revision_conflict",
                "message": "预演场景已在其他窗口更新",
                "current": scene.model_dump(mode="json"),
            },
        )


@router.put("/{project_id}/previs-scenes/{scene_id}", response_model=PrevisSceneOut)
async def update_previs_scene(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    scene_id: str,
    body: PrevisSceneUpdate,
):
    scene, conflicted = await resolve(
        PrevisScenes(session, owner, creative_asset_inspection(request, session, owner)).change(
            project_id, scene_id, body.expected_revision, body
        )
    )
    require_current(scene, conflicted)
    return scene


@router.delete("/{project_id}/previs-scenes/{scene_id}")
async def delete_previs_scene(
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    scene_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    scene, conflicted = await resolve(
        PrevisScenes(session, owner).change(project_id, scene_id, expected_revision)
    )
    require_current(scene, conflicted)
    return {"deleted": True}
