"""Cubism sidecars are revisioned with their owning native project."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from sqlalchemy import select

from app.apps.live2d_workshop.cubism import MAX_CUBISM_PACKAGE, inspect_cubism_package
from app.apps.live2d_workshop.models import Live2DCubismAttachment, Live2DProject
from app.apps.live2d_workshop.projects import Live2DInvalid, Live2DNotFound, Live2DProjectsStore
from app.apps.live2d_workshop.schemas import Live2DCubismBindings, Live2DCubismOut
from app.capabilities.asset_store.incoming import IncomingFile
from app.runtime.project_records import patch_revisioned_project
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

STATES = {"idle", "listening", "thinking", "tool", "success", "error", "paused"}
IDLE_GROUPS = {"idle", "待机", "待命"}


class Live2DCubismStore(Live2DProjectsStore):
    async def attachment(self, project_id: str) -> Live2DCubismAttachment:
        await self.row(project_id)
        row = await self.session.scalar(
            select(Live2DCubismAttachment).where(
                Live2DCubismAttachment.project_id == project_id,
                Live2DCubismAttachment.workspace_id == self.workspace_id,
            )
        )
        if row is None:
            raise Live2DNotFound("角色尚未挂载 Cubism 运行包")
        return row

    def source_path(self, project_id: str, digest: str) -> Path:
        return self.root(project_id) / "cubism" / f"{digest}.zip"

    @staticmethod
    def suggested_bindings(metadata: dict) -> dict:
        idle = [
            group
            for group, motions in metadata["motions"].items()
            if group.casefold() in IDLE_GROUPS and motions
        ]
        return {"idle": {"motion": f"{idle[0]}:0"}} if len(idle) == 1 else {}

    async def get(self, project_id: str) -> Live2DCubismOut:
        item = await self.attachment(project_id)
        project = await self.row(project_id)
        return Live2DCubismOut(
            revision=project.revision,
            sha256=item.sha256,
            metadata=item.metadata_json,
            stateBindings=item.state_bindings,
        )

    async def archive_path(self, project_id: str) -> Path:
        item = await self.attachment(project_id)
        path = self.source_path(project_id, item.sha256)
        if not path.is_file():
            raise Live2DInvalid("Cubism 附件文件缺失")
        return path

    async def attach(
        self, project_id: str, expected_revision: int, incoming: IncomingFile
    ) -> Live2DCubismOut:
        data = await incoming.read(MAX_CUBISM_PACKAGE + 1)
        metadata = await asyncio.to_thread(inspect_cubism_package, data)
        return await self.attach_bytes(project_id, expected_revision, data, metadata)

    async def attach_bytes(
        self,
        project_id: str,
        expected_revision: int,
        data: bytes,
        metadata: dict | None = None,
        bindings: dict | None = None,
    ) -> Live2DCubismOut:
        metadata = metadata or await asyncio.to_thread(inspect_cubism_package, data)
        project = await self.row(project_id)
        if project.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision,
                project.revision,
                (await self.document(project_id)).model_dump(mode="json"),
            )
        digest = hashlib.sha256(data).hexdigest()
        path = self.source_path(project_id, digest)
        old = await self.session.get(Live2DCubismAttachment, project_id)
        old_digest = old.sha256 if old and old.workspace_id == self.workspace_id else None
        resolved_bindings = bindings if bindings is not None else self.suggested_bindings(metadata)
        self.validate_bindings(resolved_bindings, metadata)
        new_file = not path.is_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        if new_file:
            await asyncio.to_thread(path.write_bytes, data)
        try:
            await patch_revisioned_project(
                self.session,
                Live2DProject,
                project_id,
                self.workspace_id,
                expected_revision=expected_revision,
                values={"revision": expected_revision + 1, "updated_at": utc_now()},
                load_current=lambda: self.document(project_id),
            )
            if old is None:
                self.session.add(
                    Live2DCubismAttachment(
                        project_id=project_id,
                        workspace_id=self.workspace_id,
                        sha256=digest,
                        metadata_json=metadata,
                        state_bindings=resolved_bindings,
                    )
                )
            else:
                old.sha256 = digest
                old.metadata_json = metadata
                old.state_bindings = resolved_bindings
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            if new_file:
                path.unlink(missing_ok=True)
            raise
        if old_digest and old_digest != digest:
            self.source_path(project_id, old_digest).unlink(missing_ok=True)
        return await self.get(project_id)

    @staticmethod
    def validate_bindings(bindings: dict, metadata: dict) -> None:
        if set(bindings) - STATES:
            raise Live2DInvalid("未知的执行状态")
        motions = {
            f"{group}:{index}"
            for group, items in metadata["motions"].items()
            for index in range(len(items))
        }
        expressions = {item["name"] for item in metadata["expressions"]}
        for state, value in bindings.items():
            if not isinstance(value, dict):
                raise Live2DInvalid(f"{state} 绑定无效")
            if value.get("motion") and value["motion"] not in motions:
                raise Live2DInvalid(f"{state} 引用了不存在的动作")
            if value.get("expression") and value["expression"] not in expressions:
                raise Live2DInvalid(f"{state} 引用了不存在的表情")

    async def save_bindings(self, project_id: str, body: Live2DCubismBindings) -> Live2DCubismOut:
        item = await self.attachment(project_id)
        self.validate_bindings(body.state_bindings, item.metadata_json)
        await patch_revisioned_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values={"revision": body.expected_revision + 1, "updated_at": utc_now()},
            load_current=lambda: self.document(project_id),
        )
        item.state_bindings = body.state_bindings
        await self.session.commit()
        return await self.get(project_id)

    async def remove(self, project_id: str, expected_revision: int) -> None:
        item = await self.attachment(project_id)
        digest = item.sha256
        await patch_revisioned_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            expected_revision=expected_revision,
            values={"revision": expected_revision + 1, "updated_at": utc_now()},
            load_current=lambda: self.document(project_id),
        )
        await self.session.delete(item)
        await self.session.commit()
        self.source_path(project_id, digest).unlink(missing_ok=True)
