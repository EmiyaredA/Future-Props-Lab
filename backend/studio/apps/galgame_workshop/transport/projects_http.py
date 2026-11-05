"""Published project and initial Story operations for the Galgame owner."""

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import ValidationError

from studio.apps.asset_library.clients.project_reveal_http import (
    open_verified_project_folder,
    require_local_project_request,
)
from studio.apps.galgame_workshop.asset_repair import repair_asset
from studio.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryNotReadyError,
)
from studio.apps.galgame_workshop.project_deletion import ProjectDeletion
from studio.apps.galgame_workshop.projects import Projects
from studio.apps.galgame_workshop.schemas import (
    GalgameMissingAssetRepairIn,
    GalgamePortraitUpgradeApplyIn,
    GalgamePortraitUpgradePreviewOut,
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryEditsPatchIn,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)
from studio.apps.galgame_workshop.schemas.operations import GalgameOperationsIn
from studio.apps.galgame_workshop.story.migration_inventory import (
    MAX_STORY_IMPORT_BYTES,
    decode_legacy_story,
)
from studio.apps.galgame_workshop.story_writes import PREFIX, StoryWrites
from studio.apps.galgame_workshop.transport.asset_read_routes import read_assets
from studio.assembly.independent.asset_references import reference_lifespan
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.dependencies import OwnerDep, SessionDep, StudioAuth
from studio.runtime.project_errors import ProjectResourceError

router = APIRouter(prefix=PREFIX, tags=["galgame-workshop"], lifespan=reference_lifespan)


def story_writes(request, session, owner):
    return StoryWrites(
        session, owner, request.app.state.reference_mutations, request.state.service_assertion
    )


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: GalgameWorkshopProjectCreateIn,
):
    return await story_writes(request, session, owner_user_id).create_project(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).story(project_id)


@router.put("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def put_story(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryDocumentPutIn,
):
    return await story_writes(request, session, owner_user_id).put(project_id, body)


@router.patch("/{project_id}/story/edits", response_model=GalgameStoryDocumentOut)
async def patch_story_edits(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryEditsPatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_edits(project_id, body)


@router.patch("/{project_id}/story/dialogue", response_model=GalgameStoryDialoguePatchOut)
async def patch_story_dialogue(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryDialoguePatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_dialogue(project_id, body)


@router.patch(
    "/{project_id}/story/stage-expression", response_model=GalgameStoryStageExpressionPatchOut
)
async def patch_story_stage_expression(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryStageExpressionPatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_stage_expression(
        project_id, body
    )


@router.post("/{project_id}/story/operations", response_model=GalgameStoryDocumentOut)
async def apply_story_operations(
    request: Request,
    project_id: str,
    body: GalgameOperationsIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        return await story_writes(request, session, owner_user_id).apply_operations(
            project_id, body
        )
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None
    except ProjectResourceError as exc:
        if exc.code == "invalid_story_document":
            raise HTTPException(422, {"code": "invalid_story", "message": str(exc)}) from None
        raise


@router.get("/{project_id}/story/snapshots", response_model=list[GalgameStorySnapshotOut])
async def list_story_snapshots(session: SessionDep, project_id: str, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).snapshots(project_id)


@router.post(
    "/{project_id}/story/snapshots/{snapshot_id}/restore",
    response_model=GalgameStoryDocumentOut,
)
async def restore_story_snapshot(
    request: Request,
    session: SessionDep,
    project_id: str,
    snapshot_id: str,
    body: GalgameStorySnapshotRestoreIn,
    owner_user_id: OwnerDep,
):
    return await story_writes(request, session, owner_user_id).restore_snapshot(
        project_id, snapshot_id, body.expected_story_revision
    )


@router.post("/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_project_folder(
    request: Request, principal: StudioAuth, session: SessionDep, project_id: str
) -> ProjectFolderOpenOut:
    require_local_project_request(request, principal)
    await Projects(session, principal.user_id).row(project_id)
    return await open_verified_project_folder(request, session, "galgame-workshop", project_id)


@router.post("/{project_id}/story/import", response_model=GalgameStoryDocumentOut)
async def import_legacy_story(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: Annotated[int, Form(alias="expectedRevision", ge=0)],
    file: Annotated[UploadFile, File()],
) -> GalgameStoryDocumentOut:
    try:
        document = decode_legacy_story(await file.read(MAX_STORY_IMPORT_BYTES + 1))
        return await story_writes(request, session, owner_user_id).import_legacy(
            project_id, expected_revision, document
        )
    except GalgameStoryDocumentInvalidError as exc:
        raise HTTPException(422, {"code": "invalid_story_document", "message": str(exc)}) from None
    finally:
        await file.close()


@router.patch("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def patch_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameWorkshopProjectPatchIn,
) -> GalgameWorkshopProjectOut:
    try:
        return await Projects(session, owner_user_id).patch(
            project_id, body, readiness=read_assets(request, session, owner_user_id).report
        )
    except GalgameStoryNotReadyError as exc:
        raise HTTPException(
            422,
            {
                "code": "story_not_ready",
                "message": str(exc),
                "report": exc.report.model_dump(mode="json"),
            },
        ) from None


@router.post("/{project_id}/assets/repair", response_model=GalgameStoryDocumentOut)
async def repair_project_asset(
    session: SessionDep,
    project_id: str,
    body: GalgameMissingAssetRepairIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameStoryDocumentOut:
    try:
        return await repair_asset(
            read_assets(request, session, owner_user_id),
            story_writes(request, session, owner_user_id),
            project_id,
            body,
        )
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/{project_id}/story/portrait-upgrade", response_model=GalgamePortraitUpgradePreviewOut)
async def preview_portrait_upgrade(
    session: SessionDep,
    project_id: str,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgamePortraitUpgradePreviewOut:
    return await story_writes(request, session, owner_user_id).preview_portrait_upgrade(project_id)


@router.post("/{project_id}/story/portrait-upgrade", response_model=GalgameStoryDocumentOut)
async def apply_portrait_upgrade(
    session: SessionDep,
    project_id: str,
    body: GalgamePortraitUpgradeApplyIn,
    request: Request,
    owner_user_id: OwnerDep,
) -> GalgameStoryDocumentOut:
    return await story_writes(request, session, owner_user_id).apply_portrait_upgrade(
        project_id, body.expected_story_revision
    )


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    request: Request,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    await ProjectDeletion(request, session, owner_user_id).delete(project_id, expected_revision)
    return {"deleted": True}
