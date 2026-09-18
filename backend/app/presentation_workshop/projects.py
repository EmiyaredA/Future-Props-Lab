from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetStorage
from app.capabilities.asset_store.svg import normalize_svg
from app.models.defaults import utc_now
from app.models.files import VisualAsset
from app.models.presentation_workshop import PresentationAssetReference, PresentationProject
from app.runtime.config import get_settings
from app.runtime.operation_receipts import forget
from app.runtime.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.schemas.presentation_workshop import (
    PresentationDocument,
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
    PresentationProjectSummary,
)


class PresentationError(Exception):
    def __init__(self, message: str, status: int = 422, code: str = "invalid_presentation"):
        super().__init__(message)
        self.status, self.code = status, code


def project_out(row: PresentationProject) -> PresentationProjectOut:
    return PresentationProjectOut(
        **{key: getattr(row, key) for key in PresentationProjectOut.model_fields}
    )


class Presentations:
    def __init__(self, session: AsyncSession, workspace_id: str):
        self.session, self.workspace_id = session, workspace_id

    async def row(self, project_id: str) -> PresentationProject:
        return await load_workspace_project(
            self.session,
            PresentationProject,
            project_id,
            self.workspace_id,
            not_found=lambda: PresentationError("演示文稿不存在", 404, "not_found"),
        )

    async def get(self, project_id: str) -> PresentationProjectOut:
        row = await self.row(project_id)
        await self.session.refresh(row)
        return project_out(row)

    async def list(self, query: str, offset: int, limit: int) -> PresentationProjectList:
        filters = [PresentationProject.workspace_id == self.workspace_id]
        if query.strip():
            filters.append(PresentationProject.title.contains(query.strip(), autoescape=True))
        total = await self.session.scalar(
            select(func.count()).select_from(PresentationProject).where(*filters)
        )
        # Project cards only need one slide; avoid deserializing every full deck.
        rows = await self.session.execute(
            select(
                PresentationProject.id,
                PresentationProject.title,
                PresentationProject.revision,
                PresentationProject.updated_at,
                func.json_array_length(PresentationProject.document["slides"]).label("slide_count"),
                PresentationProject.document["slides"][0].label("first_slide"),
            )
            .where(*filters)
            .order_by(PresentationProject.updated_at.desc(), PresentationProject.id)
            .offset(offset)
            .limit(limit)
        )
        return PresentationProjectList(
            total=total or 0,
            items=[
                PresentationProjectSummary(
                    id=row.id,
                    title=row.title,
                    revision=row.revision,
                    updated_at=row.updated_at,
                    slide_count=row.slide_count,
                    first_slide=row.first_slide,
                )
                for row in rows
            ],
        )

    async def assets(self, document: PresentationDocument) -> list[VisualAsset]:
        ids = {e.asset_id for slide in document.slides for e in slide.elements if e.asset_id}
        if not ids:
            return []
        rows = list(
            await self.session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.workspace_id == self.workspace_id,
                    VisualAsset.project_id.is_(None),
                    VisualAsset.galgame_project_id.is_(None),
                    VisualAsset.video_editor_project_id.is_(None),
                    VisualAsset.media_kind == "image",
                )
            )
        )
        if {row.id for row in rows} != ids:
            raise PresentationError("图片不存在或不属于当前空间的公共文件库", 404, "not_found")
        for slide in document.slides:
            for element in slide.elements:
                if not element.asset_id:
                    continue
                row = next(r for r in rows if r.id == element.asset_id)
                if (element.kind == "vector") != (row.mime_type == "image/svg+xml"):
                    raise PresentationError(
                        "素材类型与图片／矢量元素不匹配", 422, "invalid_asset_type"
                    )
                if element.vector_color:
                    source = AssetStorage(get_settings()).path_for(row)
                    if not normalize_svg(source.read_text())["monochrome"]:
                        raise PresentationError(
                            "多色 SVG 不支持统一改色", 422, "invalid_vector_color"
                        )
        return rows

    async def references(self, project_id: str, document: PresentationDocument):
        assets = await self.assets(document)
        await self.session.execute(
            delete(PresentationAssetReference).where(
                PresentationAssetReference.project_id == project_id
            )
        )
        self.session.add_all(
            PresentationAssetReference(project_id=project_id, asset_id=a.id) for a in assets
        )

    async def create(self, body: PresentationProjectIn) -> PresentationProjectOut:
        await self.assets(body.document)
        row = PresentationProject(
            workspace_id=self.workspace_id, title=body.title, document=body.document.model_dump()
        )
        self.session.add(row)
        await self.session.flush()
        await self.references(row.id, body.document)
        await self.session.commit()
        return await self.get(row.id)

    async def put(
        self, project_id: str, body: PresentationProjectPut, *, commit: bool = True
    ) -> PresentationProjectOut:
        await self.row(project_id)
        await patch_revisioned_project(
            self.session,
            PresentationProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values={
                "title": body.title,
                "document": body.document.model_dump(),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        try:
            await self.references(project_id, body.document)
            if commit:
                await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return await self.get(project_id)

    async def delete(self, project_id: str, revision: int):
        await self.row(project_id)
        await delete_revisioned_project(
            self.session,
            PresentationProject,
            project_id,
            self.workspace_id,
            expected_revision=revision,
            load_current=lambda: self.get(project_id),
        )
        await forget(
            self.session,
            workspace_id=self.workspace_id,
            kind="presentation",
            resource_id=project_id,
        )
        await self.session.commit()
