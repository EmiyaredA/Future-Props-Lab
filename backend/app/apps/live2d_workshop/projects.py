from __future__ import annotations

import asyncio
import io

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.live2d_workshop.models import Live2DAsset, Live2DExport, Live2DProject
from app.apps.live2d_workshop.schemas import (
    Live2DAssetOut,
    Live2DAssets,
    Live2DCreate,
    Live2DCrop,
    Live2DDocumentOut,
    Live2DPatch,
    Live2DProjectOut,
    Live2DProjects,
    Live2DSave,
)
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.live2d.document import CharacterDocument, initial_document
from app.capabilities.media_rendering.live2d.render import render_frame
from app.runtime.config import get_settings
from app.runtime.ids import new_id
from app.runtime.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now

APP = "live2d-workshop"


class Live2DNotFound(Exception):
    pass


class Live2DInvalid(ValueError):
    pass


def decode_png(data: bytes) -> tuple[bytes, int, int]:
    try:
        with Image.open(io.BytesIO(data)) as source:
            if (
                source.format != "PNG"
                or max(source.size) > 8192
                or source.width * source.height > 32_000_000
            ):
                raise Live2DInvalid("只支持不超过 8192 边长 / 3200 万像素的 PNG")
            out = io.BytesIO()
            source.convert("RGBA").save(out, format="PNG")
            return out.getvalue(), source.width, source.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise Live2DInvalid("PNG 素材损坏或尺寸过大") from exc


class Live2DProjectsStore:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(get_settings())

    def root(self, project_id: str):
        return self.storage.project_root(APP, project_id, workspace_id=self.workspace_id)

    async def row(self, project_id: str) -> Live2DProject:
        return await load_workspace_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            not_found=lambda: Live2DNotFound("角色项目不存在"),
        )

    @staticmethod
    def out(row: Live2DProject) -> Live2DProjectOut:
        return Live2DProjectOut(
            id=row.id,
            title=row.title,
            revision=row.revision,
            createdAt=iso_utc(row.created_at),
            updatedAt=iso_utc(row.updated_at),
            thumbnail=f"/v1/{APP}/projects/{row.id}/thumbnail?revision={row.revision}"
            if row.document.get("parts")
            else None,
        )

    async def list(self) -> Live2DProjects:
        rows = (
            await self.session.scalars(
                select(Live2DProject)
                .where(Live2DProject.workspace_id == self.workspace_id)
                .order_by(Live2DProject.updated_at.desc())
            )
        ).all()
        return Live2DProjects(items=[self.out(r) for r in rows])

    async def get(self, project_id: str) -> Live2DProjectOut:
        return self.out(await self.row(project_id))

    async def create(self, body: Live2DCreate) -> Live2DProjectOut:
        if not body.title.strip():
            raise Live2DInvalid("项目名称不能为空")
        row = Live2DProject(
            id=new_id(),
            workspace_id=self.workspace_id,
            title=body.title.strip(),
            document=initial_document(body.width, body.height).model_dump(
                mode="json", by_alias=True
            ),
        )
        async with creating_project_layout(
            self.session, self.storage, APP, row.id, workspace_id=self.workspace_id
        ):
            self.session.add(row)
        await self.session.refresh(row)
        return self.out(row)

    async def document(self, project_id: str) -> Live2DDocumentOut:
        row = await self.row(project_id)
        return Live2DDocumentOut(
            revision=row.revision, document=CharacterDocument.model_validate(row.document)
        )

    async def patch(self, project_id: str, body: Live2DPatch) -> Live2DProjectOut:
        await self.row(project_id)
        if not body.title.strip():
            raise Live2DInvalid("项目名称不能为空")
        await patch_revisioned_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values={
                "title": body.title.strip(),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    async def save(self, project_id: str, body: Live2DSave) -> Live2DDocumentOut:
        await self.row(project_id)
        assets = await self.paths(project_id)
        if any(
            p.asset_id not in assets or not assets[p.asset_id].is_file()
            for p in body.document.parts
        ):
            raise Live2DInvalid("文档引用了缺失素材或其他项目的素材")
        await patch_revisioned_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values={
                "document": body.document.model_dump(mode="json", by_alias=True),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.document(project_id),
        )
        await self.session.commit()
        return Live2DDocumentOut(revision=body.expected_revision + 1, document=body.document)

    async def delete(self, project_id: str, revision: int) -> None:
        await self.row(project_id)
        running = await self.session.scalar(
            select(Live2DExport.id).where(
                Live2DExport.project_id == project_id,
                Live2DExport.workspace_id == self.workspace_id,
                Live2DExport.status.in_(["queued", "running"]),
            )
        )
        if running:
            raise Live2DInvalid("请先取消正在运行的导出任务，再删除项目")
        async with deleting_project_layout(
            self.session, self.storage, APP, project_id, workspace_id=self.workspace_id
        ):
            await delete_revisioned_project(
                self.session,
                Live2DProject,
                project_id,
                self.workspace_id,
                expected_revision=revision,
                load_current=lambda: self.get(project_id),
            )

    async def asset_rows(self, project_id: str) -> list[Live2DAsset]:
        await self.row(project_id)
        return list(
            (
                await self.session.scalars(
                    select(Live2DAsset).where(
                        Live2DAsset.project_id == project_id,
                        Live2DAsset.workspace_id == self.workspace_id,
                    )
                )
            ).all()
        )

    def asset_out(self, row: Live2DAsset) -> Live2DAssetOut:
        return Live2DAssetOut(
            id=row.id,
            name=row.name,
            width=row.width,
            height=row.height,
            url=f"/v1/{APP}/projects/{row.project_id}/assets/{row.id}/file",
        )

    async def assets(self, project_id: str) -> Live2DAssets:
        return Live2DAssets(items=[self.asset_out(r) for r in await self.asset_rows(project_id)])

    async def paths(self, project_id: str):
        return {
            r.id: self.root(project_id) / "assets" / f"{r.id}.png"
            for r in await self.asset_rows(project_id)
        }

    async def asset_path(self, project_id: str, asset_id: str):
        path = (await self.paths(project_id)).get(asset_id)
        if path is None or not path.is_file():
            raise Live2DNotFound("素材不存在")
        return path

    async def retire_asset(
        self, project_id: str, asset_id: str, expected_revision: int
    ) -> Live2DProjectOut:
        project = await self.row(project_id)
        if project.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision,
                project.revision,
                (await self.document(project_id)).model_dump(mode="json"),
            )
        if any(
            part.asset_id == asset_id
            for part in CharacterDocument.model_validate(project.document).parts
        ):
            raise Live2DInvalid("素材仍被工程引用，不能清理")
        asset = await self.session.scalar(
            select(Live2DAsset).where(
                Live2DAsset.id == asset_id,
                Live2DAsset.project_id == project_id,
                Live2DAsset.workspace_id == self.workspace_id,
            )
        )
        if asset is None:
            raise Live2DNotFound("素材不存在")
        path = self.root(project_id) / "assets" / f"{asset_id}.png"
        await patch_revisioned_project(
            self.session,
            Live2DProject,
            project_id,
            self.workspace_id,
            expected_revision=expected_revision,
            values={"revision": expected_revision + 1, "updated_at": utc_now()},
            load_current=lambda: self.document(project_id),
        )
        await self.session.delete(asset)
        await self.session.commit()
        path.unlink(missing_ok=True)
        return await self.get(project_id)

    async def upload(self, project_id: str, incoming: IncomingFile) -> Live2DAssetOut:
        await self.row(project_id)
        data = await incoming.read(32 * 1024 * 1024 + 1)
        if len(data) > 32 * 1024 * 1024:
            raise Live2DInvalid("单张素材不能超过 32 MiB")
        data, width, height = await asyncio.to_thread(decode_png, data)
        row = Live2DAsset(
            id=new_id(),
            project_id=project_id,
            workspace_id=self.workspace_id,
            name=(incoming.filename or "素材.png")[:255],
            width=width,
            height=height,
        )
        path = self.root(project_id) / "assets" / f"{row.id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)
        try:
            self.session.add(row)
            await self.session.commit()
        except BaseException:
            path.unlink(missing_ok=True)
            await self.session.rollback()
            raise
        return self.asset_out(row)

    async def preview(
        self,
        project_id: str,
        frame: float = 0,
        motion_id: str | None = None,
        expression_id: str | None = None,
        width: int = 480,
        height: int | None = None,
        expected_revision: int | None = None,
        crop: Live2DCrop | None = None,
    ) -> bytes:
        snapshot = await self.document(project_id)
        if expected_revision is not None and snapshot.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision,
                snapshot.revision,
                snapshot.model_dump(mode="json", by_alias=True),
            )
        paths = await self.paths(project_id)
        doc = snapshot.document
        if motion_id and motion_id not in {m.id for m in doc.motions}:
            raise Live2DInvalid("所选动作不存在")
        if expression_id and expression_id not in {e.id for e in doc.expressions}:
            raise Live2DInvalid("所选表情不存在")
        if crop and (crop.x + crop.width > doc.width or crop.y + crop.height > doc.height):
            raise Live2DInvalid("裁切区域超出角色画布")
        image = await asyncio.to_thread(
            render_frame,
            doc,
            paths,
            frame=frame,
            motion_id=motion_id,
            expression_id=expression_id,
            width=width if height else min(width, max(1, round(width * doc.width / doc.height))),
            height=height or min(width, max(1, round(width * doc.height / doc.width))),
            crop=(crop.x, crop.y, crop.width, crop.height) if crop else None,
        )
        out = io.BytesIO()
        await asyncio.to_thread(image.save, out, format="PNG")
        return out.getvalue()
