from app.runtime.config import get_settings
from studio.apps.visual_workshop.acceptance.media import extract_evidence, flush_evidence
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError
from studio.apps.visual_workshop.acceptance.record_revisions import cas
from studio.apps.visual_workshop.acceptance.review_records import ReviewRecords
from studio.apps.visual_workshop.acceptance.runs import run_out
from studio.apps.visual_workshop.acceptance.sample_values import positions
from studio.apps.visual_workshop.canvas import VisualCanvasDocuments


class Reviews(ReviewRecords):
    async def sample(self, project_id, run_id, body):

        row = await self.row(project_id, run_id)
        if row.scheme_id == "legacy" or row.decision == "historical":
            raise AcceptanceError(
                "历史验收记录只读，请选择内置方案重新验收", "historical_readonly", 409
            )
        if row.status != "completed" or row.snapshot["output"]["kind"] != "video":
            raise AcceptanceError("仅已完成的视频验收支持区间取样")
        if body.end_ms > row.snapshot.get("metadata", {}).get("duration_ms", 0):
            raise AcceptanceError("取样区间超出时长")
        if len(row.evidence) > 60:
            raise AcceptanceError("取样证据已达上限，请新建验收记录")
        # Decode before claiming the review revision, avoiding a long writer transaction.
        evidence, paths = await extract_evidence(
            self.session,
            get_settings(),
            row,
            row.snapshot["output"]["asset_id"],
            positions(row.snapshot["metadata"]["duration_ms"], body.start_ms, body.end_ms),
        )
        try:
            with self.session.no_autoflush:
                await cas(
                    self.session, row, body.expected_revision, lambda: self.get(project_id, run_id)
                )
            row.evidence = [*row.evidence, *evidence]
            row.decision = "pending"
            await flush_evidence(self.session)
            await self.session.commit()
        except BaseException:
            for path in paths:
                path.unlink(missing_ok=True)
            raise
        return run_out(row)

    async def write_repair(self, project_id, identity, body):
        return await super().write_repair(
            project_id, identity, body, replace_canvas=VisualCanvasDocuments(self.session).replace
        )
