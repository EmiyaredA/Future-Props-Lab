from __future__ import annotations

import json

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.presentation_workshop.asset_references import document_references
from app.apps.presentation_workshop.models import PresentationAssetReference, PresentationProject
from app.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
    PresentationProjectSummary,
)
from app.apps.presentation_workshop.templates.models import PresentationTemplate
from app.apps.presentation_workshop.templates.resolver import resolve_document
from app.capabilities.asset_store import AssetStorage
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.svg import normalize_svg
from app.runtime.config import get_settings
from app.runtime.operation_receipts import forget
from app.runtime.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.runtime.time import utc_now


class PresentationError(Exception):
    def __init__(self, message: str, status: int = 422, code: str = "invalid_presentation"):
        super().__init__(message)
        self.status, self.code = status, code


def project_out(row: PresentationProject) -> PresentationProjectOut:
    return PresentationProjectOut(
        **{key: getattr(row, key) for key in PresentationProjectOut.model_fields}
    )


def summary_slide(row):
    if not row.template:
        return row.first_slide

    semantics = json.loads(row.semantics)
    pages = [
        {
            "id": item["id"],
            "chapter_id": item["chapter_id"],
            "background": "#FFFFFF",
            "notes": "",
            "elements": [],
        }
        for item in semantics
    ]
    pages[0] = row.first_slide
    document = PresentationDocument.model_validate(
        {
            "version": 4,
            "width": row.width,
            "height": row.height,
            "slides": pages,
            "template": row.template,
            "template_overrides": row.template_overrides or {},
            "chapters": row.chapters or [],
        }
    )
    return resolve_document(document)[0].slides[0]


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
        slide_values = func.json_each(PresentationProject.document["slides"]).table_valued("value")
        semantics = (
            select(
                func.json_group_array(
                    func.json_object(
                        "id",
                        func.json_extract(slide_values.c.value, "$.id"),
                        "chapter_id",
                        func.json_extract(slide_values.c.value, "$.chapter_id"),
                    )
                )
            )
            .select_from(slide_values)
            .correlate(PresentationProject)
            .scalar_subquery()
        )
        rows = await self.session.execute(
            select(
                PresentationProject.id,
                PresentationProject.title,
                PresentationProject.revision,
                PresentationProject.updated_at,
                func.json_array_length(PresentationProject.document["slides"]).label("slide_count"),
                PresentationProject.document["slides"][0].label("first_slide"),
                PresentationProject.document["width"].label("width"),
                PresentationProject.document["height"].label("height"),
                PresentationProject.document["template"].label("template"),
                PresentationProject.document["template_overrides"].label("template_overrides"),
                PresentationProject.document["chapters"].label("chapters"),
                semantics.label("semantics"),
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
                    first_slide=summary_slide(row),
                    width=row.width,
                    height=row.height,
                )
                for row in rows
            ],
        )

    async def assets(self, document: PresentationDocument) -> list[VisualAsset]:
        references = document_references(document)
        ids = set(references)
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
                    VisualAsset.motion_compositor_project_id.is_(None),
                    VisualAsset.media_kind.in_(["image", "audio", "video"]),
                )
            )
        )
        if {row.id for row in rows} != ids:
            raise PresentationError("图片不存在或不属于当前空间的公共文件库", 404, "not_found")
        by_id = {row.id: row for row in rows}
        for row in rows:
            if references[row.id] != {row.media_kind}:
                raise PresentationError("素材类型与引用用途不匹配", 422, "invalid_asset_type")
        for slide in document.slides:
            for element in slide.elements:
                if not element.asset_id:
                    continue
                row = by_id[element.asset_id]
                expected_kind = element.kind if element.kind in {"audio", "video"} else "image"
                if row.media_kind != expected_kind or (
                    expected_kind == "image"
                    and (element.kind in {"vector", "formula"})
                    != (row.mime_type == "image/svg+xml")
                ):
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

    async def normalize_template_source(self, document):
        if document.template and document.template.template_id:
            identity = await self.session.scalar(
                select(PresentationTemplate.id).where(
                    PresentationTemplate.id == document.template.template_id,
                    PresentationTemplate.workspace_id == self.workspace_id,
                )
            )
            if identity is None:
                document.template.template_id = None

    async def create(self, body: PresentationProjectIn) -> PresentationProjectOut:
        await self.normalize_template_source(body.document)
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
        current = await self.row(project_id)
        if (
            body.document.source_version < 4
            and PresentationDocument.model_validate(current.document).needs_v4()
        ):
            raise PresentationError(
                "当前文稿包含模板数据，请更新客户端后保存", 422, "document_downgrade"
            )
        if (
            body.document.source_version < 3
            and PresentationDocument.model_validate(current.document).needs_v3()
        ):
            raise PresentationError(
                "当前文稿包含新版内容，请更新客户端后保存", 422, "document_downgrade"
            )
        await self.normalize_template_source(body.document)
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
