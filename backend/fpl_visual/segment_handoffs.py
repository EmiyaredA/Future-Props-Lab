"""Fence a target canvas and recover its decision after lost cross-service replies."""

import httpx
from sqlalchemy import select, text

from app.apps.visual_workshop.models import VisualWorkshopProject
from app.apps.visual_workshop.outputs import register_imported_output
from app.apps.visual_workshop.schemas.workshop import VisualWorkshopProjectCreateIn
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.video_segment_handoff import ASSET_HANDOFFS
from fpl_runtime.video_segments import PublishedSegment

from .models import VisualSegmentHandoff
from .projects import Projects


async def require_canvas_unreserved(session, owner, project):
    pending = await session.scalar(
        select(VisualSegmentHandoff.task_id)
        .where(
            VisualSegmentHandoff.owner_user_id == owner,
            VisualSegmentHandoff.project_id == project,
            VisualSegmentHandoff.state.in_(("prepared", "commit")),
        )
        .limit(1)
    )
    if pending is not None:
        raise ProjectResourceError("目标画布正在接收分段", "segment_target_reserved", 409)


class SegmentHandoffs:
    def __init__(self, database, client, assets, identity):
        self.database, self.client, self.assets, self.identity = database, client, assets, identity

    def sessions(self, owner):
        return self.database.sessions(info={"owner_user_id": owner})

    async def require_active(self, owner):
        reply = await self.identity.owner_permission(owner=owner, permission="content.write")
        if not reply["available"]:
            raise ProjectResourceError("账号授权暂不可用", "identity_unavailable", 503)
        if not reply["allowed"]:
            raise ProjectResourceError("画布接收授权已撤销", "segment_handoff_revoked", 403)

    async def assets_call(self, owner, scope, operation):
        path = scope.path(ASSET_HANDOFFS, operation)
        try:
            reply = await self.client.post(
                "http://assets:8080" + path,
                headers=self.assets.headers("POST", path, owner),
                json=scope.model_dump(mode="json"),
            )
            if reply.status_code == 404:
                raise ProjectResourceError("分段暂存批次不存在", "segment_batch_missing", 404)
            if reply.status_code == 409:
                code = reply.json().get("code")
                if code == "segment_target_projection_pending":
                    raise ProjectResourceError("目标画布引用正在结算", code, 503)
                raise ProjectResourceError("分段素材确认冲突", "segment_batch_conflict", 409)
            reply.raise_for_status()
            result = reply.json()
            if not isinstance(result, dict):
                raise ValueError("invalid asset handoff receipt")
            return result
        except (httpx.HTTPError, ValueError, TypeError):
            raise ProjectResourceError(
                "分段素材回执暂不可用", "segment_assets_unavailable", 503
            ) from None

    async def _row(self, session, owner, scope):
        row = await session.get(VisualSegmentHandoff, (owner, scope.task_id))
        if row is not None and row.scope_sha256 != scope.digest:
            raise ProjectResourceError("分段交接范围已变化", "segment_handoff_conflict", 409)
        return row

    @staticmethod
    def _receipt(row):
        return row.result or {"state": row.state}

    async def _validate_target(self, session, owner, target):
        if target.new_title is not None:
            if await session.get(VisualWorkshopProject, target.project_id) is not None:
                raise ProjectResourceError("新建目标项目已存在", "segment_target_conflict", 409)
            return
        row = await Projects(session, owner).canvas_row(target.project_id)
        if row.revision != target.expected_revision:
            raise ProjectResourceError("目标工作坊画布已变化", "segment_target_changed", 409)

    @staticmethod
    def _nodes(scope, source):
        if source.get("state") != "sealed":
            raise ProjectResourceError("分段批次状态已变化", "segment_batch_conflict", 409)
        try:
            files = [PublishedSegment.model_validate(item) for item in source["items"]]
            labels = source["labels"]
            if not files or not 1 <= len(files) <= 100:
                raise ValueError("invalid segment count")
            return [
                {
                    "id": f"segment-{scope.task_id[:8]}-{index + 1}",
                    "kind": "video",
                    "title": label,
                    "position": {"x": index * 540, "y": 0},
                    "asset_id": file.asset.id,
                    "generation_task_id": None,
                }
                for index, (label, file) in enumerate(zip(labels, files, strict=True))
            ]
        except (TypeError, ValueError, KeyError):
            raise ProjectResourceError(
                "分段暂存回执无效", "segment_assets_unavailable", 503
            ) from None

    async def prepare(self, owner, scope):
        async with self.sessions(owner) as session:
            prior = await self._row(session, owner, scope)
            if prior is not None:
                return self._receipt(prior)
        await self.require_active(owner)
        nodes = self._nodes(scope, await self.assets_call(owner, scope, "inspect"))
        target = scope.target
        async with self.sessions(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await self._row(session, owner, scope)
            if prior is not None:
                return self._receipt(prior)
            await self._validate_target(session, owner, target)
            await require_canvas_unreserved(session, owner, target.project_id)
            if target.new_title is None:
                canvas = await Projects(session, owner).canvas_row(target.project_id)
                if {item["id"] for item in (canvas.nodes or [])}.intersection(
                    node["id"] for node in nodes
                ):
                    raise ProjectResourceError(
                        "目标画布节点 ID 已存在", "segment_target_conflict", 409
                    )
            session.add(
                VisualSegmentHandoff(
                    owner_user_id=owner,
                    task_id=scope.task_id,
                    project_id=target.project_id,
                    scope_sha256=scope.digest,
                    state="prepared",
                    nodes=nodes,
                )
            )
            await session.commit()
        return {"state": "prepared"}

    async def _decide(self, owner, scope):
        async with self.sessions(owner) as session:
            row = await self._row(session, owner, scope)
            if row is None:
                raise ProjectResourceError("交接尚未准备", "segment_handoff_missing", 404)
            phase = row.state
        if phase == "prepared":
            await self.require_active(owner)
        async with self.sessions(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._row(session, owner, scope)
            if row.state == "prepared":
                row.state = "commit"
                await session.commit()
            elif row.state not in {"commit", "published"}:
                raise ProjectResourceError("交接已取消", "segment_handoff_aborted", 409)
            return self._receipt(row)

    async def commit(self, owner, scope):
        prior = await self._decide(owner, scope)
        if prior["state"] == "published":
            return prior
        receipt = await self.assets_call(owner, scope, "publish")
        if receipt.get("state") != "published":
            raise ProjectResourceError("分段素材未确认", "segment_assets_unavailable", 503)
        return await self._publish_canvas(owner, scope)

    async def _publish_canvas(self, owner, scope):
        target = scope.target
        async with self.sessions(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._row(session, owner, scope)
            if row.state == "published":
                return row.result
            await self._validate_target(session, owner, target)
            projects = Projects(session, owner)
            if target.new_title is not None:
                await projects.create(
                    VisualWorkshopProjectCreateIn(title=target.new_title, kind="canvas"),
                    project_id=target.project_id,
                )
            canvas = await projects.canvas_row(target.project_id)
            canvas.nodes = [*(canvas.nodes or []), *row.nodes]
            canvas.revision += 1
            canvas.updated_at = utc_now()
            for node in row.nodes:
                await register_imported_output(
                    session,
                    target.project_id,
                    node,
                    asset_id=node["asset_id"],
                    source_key=f"segment:{scope.task_id}:{node['id']}",
                )
            row.state = "published"
            row.result = {
                "state": row.state,
                "project_id": target.project_id,
                "node_ids": [node["id"] for node in row.nodes],
            }
            await session.commit()
            return row.result

    async def abort(self, owner, scope):
        async with self.sessions(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._row(session, owner, scope)
            if row is not None and row.state == "aborted":
                return {"state": "aborted"}
            if row is not None and row.state in {"commit", "published"}:
                raise ProjectResourceError("已提交的交接不能取消", "segment_handoff_decided", 409)
            if row is None:
                row = VisualSegmentHandoff(
                    owner_user_id=owner,
                    task_id=scope.task_id,
                    project_id=scope.target.project_id,
                    scope_sha256=scope.digest,
                    state="aborting",
                    nodes=[],
                )
                session.add(row)
            else:
                row.state = "aborting"
            await session.commit()
        result = await self.assets_call(owner, scope, "abort")
        if result.get("state") != "aborted":
            raise ProjectResourceError("分段素材清理未确认", "segment_assets_unavailable", 503)
        async with self.sessions(owner) as session:
            row = await self._row(session, owner, scope)
            row.state = "aborted"
            await session.commit()
        return {"state": "aborted"}
