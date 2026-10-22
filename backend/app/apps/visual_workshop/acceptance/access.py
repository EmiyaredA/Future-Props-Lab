from copy import deepcopy

from sqlalchemy import select, update

from app.apps.visual_workshop.acceptance.models import (
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
)
from app.apps.visual_workshop.models import VisualCanvasDocument, VisualWorkshopProject
from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class AcceptanceError(Exception):
    def __init__(self, message, code="invalid_acceptance", status=422):
        super().__init__(message)
        self.code, self.status = code, status


async def project(session, workspace_id, project_id):
    row = await session.scalar(
        select(VisualWorkshopProject).where(
            VisualWorkshopProject.id == project_id,
            VisualWorkshopProject.workspace_id == workspace_id,
        )
    )
    if row is None:
        raise AcceptanceError("项目不存在", "not_found", 404)
    return row


async def asset(session, workspace_id, project_id, asset_id):
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id, VisualAsset.workspace_id == workspace_id
        )
    )
    ref = await session.scalar(
        select(VisualProjectAssetReference.id).where(
            VisualProjectAssetReference.project_id == project_id,
            VisualProjectAssetReference.workspace_id == workspace_id,
            VisualProjectAssetReference.asset_id == asset_id,
        )
    )
    if row is None or (row.project_id != project_id and not ref):
        raise AcceptanceError("参考素材不存在或不属于项目", "not_found", 404)
    return row


async def cas(session, row, expected, current):
    # Take the SQLite writer lock before re-reading the revision; a stale client must
    # never overwrite either a worker result or another reviewer's decision.
    cls = type(row)
    key = cls.project_id == row.project_id if cls is AcceptanceStandard else cls.id == row.id
    result = await session.execute(
        update(cls)
        .where(key, cls.revision == expected)
        .values(revision=expected + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await session.rollback()
        snapshot = await current()
        raise RevisionConflictError(expected, snapshot.revision, snapshot.model_dump(mode="json"))
    await session.refresh(row)


async def required_for(session, project_id, node_id):
    standard = await session.get(AcceptanceStandard, project_id)
    if not standard or not standard.required:
        return False
    version = await session.scalar(
        select(AcceptanceStandardVersion).where(
            AcceptanceStandardVersion.project_id == project_id,
            AcceptanceStandardVersion.version == standard.published_version,
        )
    )
    return bool(
        version and (not version.document["node_ids"] or node_id in version.document["node_ids"])
    )


async def require_passed(session, project_id, node_id, output_id):
    if not await required_for(session, project_id, node_id):
        return
    standard = await session.get(AcceptanceStandard, project_id)
    found = await session.scalar(
        select(AcceptanceRun.id)
        .join(AcceptanceStandardVersion, AcceptanceStandardVersion.id == AcceptanceRun.standard_id)
        .where(
            AcceptanceRun.project_id == project_id,
            AcceptanceRun.node_id == node_id,
            AcceptanceRun.output_id == output_id,
            AcceptanceRun.status == "completed",
            AcceptanceRun.decision == "passed",
            AcceptanceStandardVersion.version == standard.published_version,
        )
    )
    if not found:
        raise AcceptanceError("当前输出尚未通过生效标准的验收", "acceptance_required", 409)


async def clear_approvals(session, project_id):
    await session.execute(
        update(VisualCanvasDocument)
        .where(VisualCanvasDocument.project_id == project_id)
        .values(revision=VisualCanvasDocument.revision + 1, updated_at=utc_now())
    )
    canvas = await session.get(VisualCanvasDocument, project_id, populate_existing=True)
    if canvas:
        nodes = deepcopy(canvas.nodes)
        for node in nodes:
            if await required_for(session, project_id, node["id"]):
                node["approved"] = False
        canvas.nodes = nodes
