from __future__ import annotations

import json

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.presentation_workshop.project_errors import PresentationError as PresentationError
from studio.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
    PresentationProjectSummary,
)
from studio.apps.presentation_workshop.storage.models import PresentationProject
from studio.apps.presentation_workshop.templates.models import PresentationTemplate
from studio.apps.presentation_workshop.templates.resolver import resolve_document
from studio.runtime.database.operation_receipts import forget
from studio.runtime.database.project_records import (
    delete_revisioned_project,
    load_owned_project,
    patch_revisioned_project,
)
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


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
            "version": 5 if row.template.get("snapshot", {}).get("version") == 2 else 4,
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
    def __init__(self, session: AsyncSession, owner_user_id: str):
        self.session, self.owner_user_id = session, owner_user_id
        self.asset_access = session.info["presentation_project_assets"](session, owner_user_id)
        self.retention = session.info.get("presentation_retention")

    async def row(self, project_id: str) -> PresentationProject:
        return await load_owned_project(
            self.session,
            PresentationProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: PresentationError("演示文稿不存在", 404, "not_found"),
        )

    async def get(self, project_id: str) -> PresentationProjectOut:
        row = await self.row(project_id)
        await self.session.refresh(row)
        return project_out(row)

    async def list(self, query: str, offset: int, limit: int) -> PresentationProjectList:
        filters = [PresentationProject.owner_user_id == self.owner_user_id]
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

    async def assets(self, document):
        return await self.asset_access.assets(document)

    async def normalize_template_source(self, document):
        sources = {
            s.layout_source.template_id
            for s in document.slides
            if s.layout_source and s.layout_source.template_id
        }
        if sources:
            accessible = set(
                await self.session.scalars(
                    select(PresentationTemplate.id).where(
                        PresentationTemplate.id.in_(sources),
                        PresentationTemplate.owner_user_id == self.owner_user_id,
                    )
                )
            )
            for slide in document.slides:
                if slide.layout_source and slide.layout_source.template_id not in accessible:
                    slide.layout_source.template_id = None
        if document.template and document.template.template_id:
            identity = await self.session.scalar(
                select(PresentationTemplate.id).where(
                    PresentationTemplate.id == document.template.template_id,
                    PresentationTemplate.owner_user_id == self.owner_user_id,
                )
            )
            if identity is None:
                document.template.template_id = None

    async def _prepare(self, project_id, expected, document=None):
        if self.retention is None:
            return None
        await self.session.rollback()
        assets = await self.assets(document) if document is not None else ()
        return await self.retention.prepare(project_id, expected, [asset.id for asset in assets])

    async def _abort(self, prepared):
        await self.session.rollback()
        if prepared is not None:
            await self.retention.abort(self.session, prepared)

    async def create(self, body: PresentationProjectIn) -> PresentationProjectOut:
        await self.normalize_template_source(body.document)
        project_id = new_id()
        prepared = await self._prepare(project_id, -1, body.document)
        legacy_assets = await self.assets(body.document) if prepared is None else ()
        row = PresentationProject(
            id=project_id,
            owner_user_id=self.owner_user_id,
            title=body.title,
            document=body.document.model_dump(),
        )
        try:
            self.session.add(row)
            await self.session.flush()
            if prepared is None:
                await self.asset_access.references(project_id, legacy_assets)
            else:
                await self.retention.record(self.session, prepared, resource_revision=row.revision)
            result = project_out(row)
        except BaseException:
            await self._abort(prepared)
            raise
        await self.session.commit()
        return result

    async def put(
        self,
        project_id: str,
        body: PresentationProjectPut,
        *,
        before_write=None,
        record_operation=None,
    ) -> PresentationProjectOut:
        current = await self.row(project_id)
        if body.document.source_version < 5 and current.document.get("version", 3) >= 5:
            raise PresentationError(
                "当前文稿包含原生模板布局，请更新客户端后保存", 422, "document_downgrade"
            )
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
        if current.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                project_out(current).model_dump(mode="json"),
            )
        await self.normalize_template_source(body.document)
        prepared = await self._prepare(project_id, body.expected_revision, body.document)
        legacy_assets = await self.assets(body.document) if prepared is None else ()
        try:
            if before_write is not None:
                await before_write()
            await patch_revisioned_project(
                self.session,
                PresentationProject,
                project_id,
                self.owner_user_id,
                expected_revision=body.expected_revision,
                values={
                    "title": body.title,
                    "document": body.document.model_dump(),
                    "revision": body.expected_revision + 1,
                    "updated_at": utc_now(),
                },
                load_current=lambda: self.get(project_id),
            )
            if prepared is None:
                await self.asset_access.references(project_id, legacy_assets)
            result = await self.get(project_id)
            if prepared is not None:
                await self.retention.record(
                    self.session, prepared, resource_revision=result.revision
                )
            if record_operation is not None:
                record_operation(result)
        except BaseException:
            await self._abort(prepared)
            raise
        await self.session.commit()
        return result

    async def delete(self, project_id: str, revision: int):
        current = await self.row(project_id)
        if current.revision != revision:
            raise RevisionConflictError(
                revision, current.revision, project_out(current).model_dump(mode="json")
            )
        prepared = await self._prepare(project_id, revision)
        try:
            await delete_revisioned_project(
                self.session,
                PresentationProject,
                project_id,
                self.owner_user_id,
                expected_revision=revision,
                load_current=lambda: self.get(project_id),
            )
            await forget(
                self.session,
                owner_user_id=self.owner_user_id,
                kind="presentation",
                resource_id=project_id,
            )
            if prepared is not None:
                await self.retention.record(
                    self.session,
                    prepared,
                    resource_revision=revision + 1,
                    deleted=True,
                )
        except BaseException:
            await self._abort(prepared)
            raise
        await self.session.commit()
