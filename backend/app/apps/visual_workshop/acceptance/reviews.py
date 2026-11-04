from copy import deepcopy

from app.apps.visual_workshop.acceptance.media import extract_evidence, flush_evidence, positions
from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.runtime.config import get_settings
from app.runtime.ids import new_id

from .project_access import AcceptanceError
from .record_revisions import cas
from .review_records import ReviewRecords, repair_out
from .runs import run_out


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
        row = await self.repair_row(project_id, identity)
        run = await self.row(project_id, row.run_id)
        if run.scheme_id == "legacy" or run.decision == "historical":
            raise AcceptanceError("历史验收记录只读", "historical_readonly", 409)

        async def current():
            return repair_out(await self.repair_row(project_id, identity))

        await cas(self.session, row, body.expected_revision, current)
        row.text = body.text
        if body.apply:
            if body.expected_canvas_revision is None:
                raise AcceptanceError("保存提示词版本需要画布 revision")
            if row.prompt_version_id:
                raise AcceptanceError("此草稿已保存为提示词版本", "already_applied", 409)
            run = await self.row(project_id, row.run_id)
            canvas = await self.session.get(VisualCanvasDocument, project_id)
            nodes = deepcopy(canvas.nodes)
            node = next((node for node in nodes if node["id"] == run.node_id), None)
            if not node or not node.get("generation_draft"):
                raise AcceptanceError("此节点没有媒体生成配置")
            draft = node["generation_draft"]
            versions = draft.get("prompt_versions") or [
                {"id": "v1", "name": "v1", "prompt": draft.get("prompt", "")}
            ]
            if len(versions) >= 20:
                raise AcceptanceError("提示词版本已达上限，请先整理")
            identity = new_id()
            draft.update(
                prompt_versions=[
                    *versions,
                    {"id": identity, "name": "验收返修", "prompt": body.text},
                ],
                active_prompt_version_id=identity,
                prompt=body.text,
            )
            await VisualCanvasDocuments(self.session).replace(
                project_id,
                VisualCanvasDocumentPutIn(
                    expected_revision=body.expected_canvas_revision,
                    nodes=nodes,
                    edges=canvas.edges,
                    categories=canvas.categories,
                ),
            )
            row.prompt_version_id = identity
        await self.session.commit()
        return repair_out(row)
