from copy import deepcopy

from sqlalchemy import select

from app.apps.visual_workshop.acceptance.access import AcceptanceError, cas
from app.apps.visual_workshop.acceptance.media import extract_evidence, flush_evidence, positions
from app.apps.visual_workshop.acceptance.models import AcceptanceRepairDraft
from app.apps.visual_workshop.acceptance.runs import Runs, run_out
from app.apps.visual_workshop.acceptance.schemas import AcceptanceRepairOut
from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.runtime.config import get_settings
from app.runtime.ids import new_id
from app.runtime.time import iso_utc, utc_now


class Reviews(Runs):
    async def sample(self, project_id, run_id, body):

        row = await self.row(project_id, run_id)
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

    async def decide(self, project_id, run_id, body, actor):
        row = await self.row(project_id, run_id)
        await cas(self.session, row, body.expected_revision, lambda: self.get(project_id, run_id))
        if row.status != "completed":
            raise AcceptanceError("检查完成后才能记录结论", "invalid_state", 409)
        results = deepcopy(row.results)
        if body.finalize:
            if any(item["verdict"] == "pending" for item in results):
                raise AcceptanceError("请先处理所有待确认项")
            criteria = {item["id"]: item for item in row.snapshot["criteria"]}
            failed = any(
                item["verdict"] == "failed" and criteria[item["criterion_id"]]["required"]
                for item in results
            )
            row.decision = "failed" if failed else "passed"
        else:
            result = next(
                (item for item in results if item["criterion_id"] == body.criterion_id), None
            )
            if result is None:
                raise AcceptanceError("验收项不存在", "not_found", 404)
            changing = result["verdict"] != "pending" and result["verdict"] != body.verdict
            if (
                body.verdict == "not_applicable" or changing or body.verdict == "failed"
            ) and not body.reason.strip():
                raise AcceptanceError("不适用、修改结论或问题标注需要说明原因")
            if body.region is not None and (
                any(not 0 <= value <= 1 for value in body.region)
                or body.region[2] <= 0
                or body.region[3] <= 0
                or body.region[0] + body.region[2] > 1
                or body.region[1] + body.region[3] > 1
            ):
                raise AcceptanceError("图片区域必须为有效的归一化矩形")
            if body.start_ms is not None or body.end_ms is not None:
                duration = row.snapshot.get("metadata", {}).get("duration_ms", 0)
                if (
                    body.start_ms is None
                    or body.end_ms is None
                    or not 0 <= body.start_ms < body.end_ms <= duration
                ):
                    raise AcceptanceError("问题区间超出视频时长")
            result.update(
                verdict=body.verdict, start_ms=body.start_ms, end_ms=body.end_ms, region=body.region
            )
            row.results = results
            row.decision = "pending"
        row.decisions = [
            *row.decisions,
            {
                **body.model_dump(mode="json"),
                "actor": actor,
                "at": iso_utc(utc_now()),
                "decision": row.decision,
            },
        ]
        await self.session.commit()
        return run_out(row)

    async def repair(self, project_id, run_id):
        row = await self.row(project_id, run_id)
        issues = [item for item in row.results if item["verdict"] == "failed"]
        if not issues:
            raise AcceptanceError("请先确认至少一个需要修改的问题")
        criteria = {item["id"]: item for item in row.snapshot["criteria"]}
        reasons = {
            item["criterion_id"]: item["reason"]
            for item in row.decisions
            if item.get("criterion_id")
        }
        text = [row.snapshot.get("prompt", ""), "返修要求：保留未涉及的构图、角色与镜头设计。"]
        for issue in issues:
            criterion = criteria[issue["criterion_id"]]
            text.append(
                f"- {criterion['title']}：{criterion['requirement']}\n"
                f"问题：{reasons.get(criterion['id']) or issue['explanation']}"
            )
        draft = AcceptanceRepairDraft(
            id=new_id(),
            workspace_id=self.workspace_id,
            project_id=project_id,
            run_id=run_id,
            text="\n".join(text).strip()[:6000],
        )
        self.session.add(draft)
        await self.session.commit()
        return repair_out(draft)

    async def repair_row(self, project_id, identity):
        row = await self.session.scalar(
            select(AcceptanceRepairDraft).where(
                AcceptanceRepairDraft.id == identity,
                AcceptanceRepairDraft.project_id == project_id,
                AcceptanceRepairDraft.workspace_id == self.workspace_id,
            )
        )
        if row is None:
            raise AcceptanceError("返修草稿不存在", "not_found", 404)
        return row

    async def write_repair(self, project_id, identity, body):
        row = await self.repair_row(project_id, identity)

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


def repair_out(row):
    return AcceptanceRepairOut(
        id=row.id,
        run_id=row.run_id,
        text=row.text,
        revision=row.revision,
        prompt_version_id=row.prompt_version_id,
    )
