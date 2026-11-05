from sqlalchemy import select

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError, project
from studio.apps.visual_workshop.acceptance.record_revisions import cas
from studio.apps.visual_workshop.acceptance.schemas import AcceptanceRunListOut, AcceptanceRunOut
from studio.runtime.time import iso_utc


def run_out(row):
    return AcceptanceRunOut(
        id=row.id,
        node_id=row.node_id,
        output_id=row.output_id,
        previous_run_id=row.previous_run_id,
        standard_version=row.snapshot["standard_version"],
        model_id=row.model_id,
        status=row.status,
        decision=row.decision,
        snapshot=row.snapshot,
        results=row.results,
        evidence=row.evidence,
        decisions=row.decisions,
        error_message=row.error_message,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        scheme_id=row.scheme_id,
        execution_result=row.execution_result or {},
    )


class Runs:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id

    async def row(self, project_id, run_id):
        await project(self.session, self.owner_user_id, project_id)
        row = await self.session.scalar(
            select(AcceptanceRun).where(
                AcceptanceRun.id == run_id,
                AcceptanceRun.project_id == project_id,
                AcceptanceRun.owner_user_id == self.owner_user_id,
            )
        )
        if row is None:
            raise AcceptanceError("验收记录不存在", "not_found", 404)
        return row

    async def get(self, project_id, run_id):
        return run_out(await self.row(project_id, run_id))

    async def list(self, project_id, node_id=None, page=1):
        await project(self.session, self.owner_user_id, project_id)
        query = select(AcceptanceRun).where(
            AcceptanceRun.project_id == project_id,
            AcceptanceRun.owner_user_id == self.owner_user_id,
        )
        if node_id:
            query = query.where(AcceptanceRun.node_id == node_id)
        rows = await self.session.scalars(
            query.order_by(AcceptanceRun.created_at.desc()).offset((page - 1) * 50).limit(50)
        )
        return AcceptanceRunListOut(items=[run_out(row) for row in rows])

    async def cancel(self, project_id, run_id, expected):

        row = await self.row(project_id, run_id)
        if row.scheme_id == "legacy" or row.decision == "historical":
            raise AcceptanceError("历史验收记录只读", "historical_readonly", 409)
        await cas(self.session, row, expected, lambda: self.get(project_id, run_id))
        if row.status not in {"queued", "processing"}:
            raise AcceptanceError("仅可取消执行中的检查", "invalid_state", 409)
        row.status = "cancelled"
        await self.session.commit()
        return run_out(row)
