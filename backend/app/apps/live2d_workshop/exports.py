from __future__ import annotations

from sqlalchemy import select

from app.apps.live2d_workshop.models import Live2DExport
from app.apps.live2d_workshop.projects import (
    APP,
    Live2DInvalid,
    Live2DNotFound,
    Live2DProjectsStore,
)
from app.apps.live2d_workshop.schemas import (
    Live2DExportIn,
    Live2DExportOut,
    Live2DExports,
    Live2DPreflight,
)
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError


class Live2DExportsStore(Live2DProjectsStore):
    @staticmethod
    def task_out(row: Live2DExport) -> Live2DExportOut:
        return Live2DExportOut(
            id=row.id,
            settings=Live2DExportIn.model_validate(row.payload),
            status=row.status,
            progress=row.progress,
            error=row.error,
            download=f"/v1/{APP}/projects/{row.project_id}/exports/{row.id}/download"
            if row.status == "completed"
            else None,
        )

    async def task(self, project_id: str, task_id: str) -> Live2DExport:
        await self.row(project_id)
        row = await self.session.scalar(
            select(Live2DExport).where(
                Live2DExport.id == task_id,
                Live2DExport.project_id == project_id,
                Live2DExport.workspace_id == self.workspace_id,
            )
        )
        if row is None:
            raise Live2DNotFound("导出任务不存在")
        return row

    async def preflight(self, project_id: str, body: Live2DExportIn) -> Live2DPreflight:
        snapshot = await self.document(project_id)
        if snapshot.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                snapshot.revision,
                snapshot.model_dump(mode="json", by_alias=True),
            )
        doc = snapshot.document
        messages = []
        if not doc.parts:
            messages.append("请先导入角色素材")
        paths = await self.paths(project_id)
        if any(p.asset_id not in paths or not paths[p.asset_id].is_file() for p in doc.parts):
            messages.append("角色存在缺失素材")
        motions = {m.id: m for m in doc.motions}
        for pair in body.combinations:
            if pair.expression_id and pair.expression_id not in {e.id for e in doc.expressions}:
                messages.append("所选表情不存在")
            if pair.motion_id:
                motion = motions.get(pair.motion_id)
                if motion is None:
                    messages.append("所选动作不存在")
                elif body.end_frame / body.fps > motion.duration / motion.fps:
                    messages.append(f"导出范围超过动作“{motion.name}”")
        if body.crop and (
            body.crop.x + body.crop.width > doc.width or body.crop.y + body.crop.height > doc.height
        ):
            messages.append("裁切区域超出角色画布")
        return Live2DPreflight(
            ready=not messages,
            messages=messages or ["素材、参数引用和导出范围检查通过"],
            frameCount=(body.end_frame - body.start_frame) * len(body.combinations),
        )

    async def create_export(self, project_id: str, body: Live2DExportIn) -> Live2DExportOut:
        await self.row(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(Live2DExport).where(
                Live2DExport.project_id == project_id,
                Live2DExport.workspace_id == self.workspace_id,
                Live2DExport.request_id == body.request_id,
            )
        )
        if existing:
            if existing.payload != payload:
                raise Live2DInvalid("requestId 已用于不同的导出请求")
            return self.task_out(existing)
        check = await self.preflight(project_id, body)
        if not check.ready:
            raise Live2DInvalid("；".join(check.messages))
        snapshot = await self.document(project_id)
        if snapshot.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                snapshot.revision,
                snapshot.model_dump(mode="json", by_alias=True),
            )
        task = Live2DExport(
            id=new_id(),
            workspace_id=self.workspace_id,
            project_id=project_id,
            request_id=body.request_id,
            payload=payload,
            snapshot=snapshot.document.model_dump(mode="json", by_alias=True),
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return self.task_out(task)

    async def list_exports(self, project_id: str) -> Live2DExports:
        await self.row(project_id)
        rows = (
            await self.session.scalars(
                select(Live2DExport)
                .where(
                    Live2DExport.project_id == project_id,
                    Live2DExport.workspace_id == self.workspace_id,
                )
                .order_by(Live2DExport.created_at.desc())
            )
        ).all()
        return Live2DExports(items=[self.task_out(r) for r in rows])

    async def cancel(self, project_id: str, task_id: str) -> Live2DExportOut:
        task = await self.task(project_id, task_id)
        if task.status in {"queued", "running"}:
            task.cancel_requested = True
            if task.status == "queued":
                task.status = "cancelled"
            await self.session.commit()
        return self.task_out(task)

    async def download(self, project_id: str, task_id: str):
        task = await self.task(project_id, task_id)
        path = self.root(project_id) / "exports" / f"{task.id}.zip"
        if task.status != "completed" or not path.is_file():
            raise Live2DNotFound("导出结果尚不可用")
        return path
