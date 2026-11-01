"""Template and example transactions, tenant checks and protected references."""

from sqlalchemy import delete, func, select

from app.apps.presentation_workshop.projects import PresentationError, Presentations
from app.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationProjectIn,
)
from app.apps.presentation_workshop.templates.contracts import (
    PresentationExampleList,
    PresentationExampleOut,
    PresentationTemplateList,
    PresentationTemplateOut,
    TemplateBundleOut,
)
from app.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationExampleAsset,
    PresentationTemplate,
    PresentationTemplateAsset,
)
from app.apps.presentation_workshop.templates.native_scene import default_page
from app.apps.presentation_workshop.templates.schema import TemplateBinding
from app.runtime.project_records import (
    delete_revisioned_project,
    load_owned_project,
    patch_revisioned_project,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


def template_document(definition, name="模板预览"):
    return PresentationDocument.model_validate(
        {
            "version": 5 if definition.version == 2 else 4,
            "width": definition.width,
            "height": definition.height,
            "template": {"name": name, "snapshot": definition.model_dump()},
            "slides": [
                {"id": "template-preview", "background": "#FFFFFF", "notes": "", "elements": []}
            ],
        }
    )


class TemplateLibrary:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id
        self.projects = Presentations(session, owner_user_id)

    def kinds(self, kind):
        if kind == "templates":
            return (
                PresentationTemplate,
                PresentationTemplateOut,
                PresentationTemplateList,
                PresentationTemplateAsset,
                "template_id",
            )
        return (
            PresentationExample,
            PresentationExampleOut,
            PresentationExampleList,
            PresentationExampleAsset,
            "example_id",
        )

    async def row(self, kind, identity):
        model, *_ = self.kinds(kind)
        return await load_owned_project(
            self.session,
            model,
            identity,
            self.owner_user_id,
            not_found=lambda: PresentationError("模板或示例不存在", 404, "not_found"),
        )

    async def get(self, kind, identity):
        row = await self.row(kind, identity)
        await self.session.refresh(row)
        out = self.kinds(kind)[1]
        return out(**{key: getattr(row, key) for key in out.model_fields})

    async def list(self, kind, query="", offset=0, limit=24):
        model, out, listing, *_ = self.kinds(kind)
        filters = [model.owner_user_id == self.owner_user_id]
        if query.strip():
            filters.append(model.title.contains(query.strip(), autoescape=True))
        total = await self.session.scalar(select(func.count()).select_from(model).where(*filters))
        rows = await self.session.scalars(
            select(model)
            .where(*filters)
            .order_by(model.updated_at.desc(), model.id)
            .offset(offset)
            .limit(limit)
        )
        return listing(
            total=total or 0,
            items=[out(**{key: getattr(row, key) for key in out.model_fields}) for row in rows],
        )

    async def references(self, kind, identity, body):
        _, _, _, ref, owner = self.kinds(kind)
        document = (
            template_document(body.definition, body.title) if kind == "templates" else body.document
        )
        assets = await self.projects.assets(document)
        await self.session.execute(delete(ref).where(getattr(ref, owner) == identity))
        self.session.add_all(ref(**{owner: identity, "asset_id": asset.id}) for asset in assets)

    async def create(self, kind, body, *, commit=True):
        model = self.kinds(kind)[0]
        if kind == "examples":
            await self.projects.normalize_template_source(body.document)
        row = model(owner_user_id=self.owner_user_id, **body.model_dump())
        self.session.add(row)
        try:
            await self.session.flush()
            await self.references(kind, row.id, body)
            if commit:
                await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return await self.get(kind, row.id)

    async def put(self, kind, identity, body):
        current = await self.row(kind, identity)
        if (
            kind == "templates"
            and current.definition.get("version") == 2
            and body.definition.version < 2
        ):
            raise PresentationError(
                "当前模板包含原生场景，请更新客户端后保存", 422, "template_downgrade"
            )
        if (
            kind == "examples"
            and body.document.source_version < 5
            and current.document.get("version", 3) >= 5
        ):
            raise PresentationError(
                "当前示例包含原生模板布局，请更新客户端后保存", 422, "document_downgrade"
            )
        if (
            kind == "examples"
            and body.document.source_version < 4
            and PresentationDocument.model_validate(current.document).needs_v4()
        ):
            raise PresentationError(
                "当前示例包含模板数据，请更新客户端后保存", 422, "document_downgrade"
            )
        model = self.kinds(kind)[0]
        if kind == "examples":
            await self.projects.normalize_template_source(body.document)
        try:
            await patch_revisioned_project(
                self.session,
                model,
                identity,
                self.owner_user_id,
                expected_revision=body.expected_revision,
                values={
                    **body.model_dump(exclude={"expected_revision"}),
                    "revision": body.expected_revision + 1,
                    "updated_at": utc_now(),
                },
                load_current=lambda: self.get(kind, identity),
            )
            await self.references(kind, identity, body)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return await self.get(kind, identity)

    async def delete(self, kind, identity, revision):
        await self.row(kind, identity)
        await delete_revisioned_project(
            self.session,
            self.kinds(kind)[0],
            identity,
            self.owner_user_id,
            expected_revision=revision,
            load_current=lambda: self.get(kind, identity),
        )
        await self.session.commit()

    async def create_document(self, kind, identity, body):
        source = await self.get(kind, identity)
        if source.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, source.revision, source.model_dump(mode="json")
            )
        if kind == "templates":
            document = template_document(source.definition, source.title)
            document.template = TemplateBinding(
                template_id=source.id,
                template_revision=source.revision,
                name=source.title,
                snapshot=source.definition,
            )
            document.slides[0].page_type = "cover"
            if source.definition.version == 2:
                document.slides[0] = default_page(
                    source.definition, "cover", document.slides[0].id, source.id, source.revision
                )
            document.slides[0].title = body.title
        else:
            document = source.document.model_copy(deep=True)
            # Snapshot works even if the source template was deleted or not accessible.
            if document.template and document.template.template_id:
                try:
                    await self.row("templates", document.template.template_id)
                except PresentationError:
                    document.template.template_id = None
        return await self.projects.create(
            PresentationProjectIn(title=body.title, document=document)
        )

    async def import_bundle(self, body):

        try:
            template = await self.create("templates", body.template, commit=False)
            document = body.example.document.model_copy(deep=True)
            document.version = 5 if template.definition.version == 2 else max(4, document.version)
            document.template = TemplateBinding(
                template_id=template.id,
                template_revision=template.revision,
                name=template.title,
                snapshot=template.definition,
            )
            document = PresentationDocument.model_validate(document.model_dump())
            example = await self.create(
                "examples", body.example.model_copy(update={"document": document}), commit=False
            )
            await self.session.commit()
            return TemplateBundleOut(template=template, example=example)
        except Exception:
            await self.session.rollback()
            raise
