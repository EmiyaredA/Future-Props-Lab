from copy import deepcopy

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert

from app.apps.visual_workshop.acceptance.access import (
    AcceptanceError,
    asset,
    cas,
    clear_approvals,
    project,
)
from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
)
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceDocument,
    AcceptanceStandardOut,
    AcceptanceTemplateListOut,
    AcceptanceTemplateOut,
)
from app.apps.visual_workshop.acceptance.templates import builtin_templates
from app.apps.visual_workshop.models import VisualCanvasDocument
from app.runtime.ids import new_id


class Standards:
    def __init__(self, session, workspace_id):
        self.session, self.workspace_id = session, workspace_id

    async def templates(self):
        rows = await self.session.scalars(
            select(AcceptanceTemplate)
            .where(AcceptanceTemplate.workspace_id == self.workspace_id)
            .order_by(AcceptanceTemplate.created_at.desc())
        )
        return AcceptanceTemplateListOut(
            items=[
                *builtin_templates(),
                *[
                    AcceptanceTemplateOut(
                        id=row.id, title=row.title, revision=row.revision, document=row.document
                    )
                    for row in rows
                ],
            ]
        )

    async def template(self, identity):
        row = await self.session.scalar(
            select(AcceptanceTemplate).where(
                AcceptanceTemplate.id == identity,
                AcceptanceTemplate.workspace_id == self.workspace_id,
            )
        )
        if not row:
            raise AcceptanceError("模板不存在", "not_found", 404)
        return row

    async def write_template(self, body, identity=None):
        data = body.document.model_dump(mode="json")
        data["node_ids"] = []
        for item in data["criteria"]:
            item["reference_asset_ids"] = []
        if identity:
            row = await self.template(identity)

            async def current():
                fresh = await self.template(identity)
                return AcceptanceTemplateOut(
                    id=fresh.id, title=fresh.title, revision=fresh.revision, document=fresh.document
                )

            await cas(self.session, row, body.expected_revision, current)
            row.title, row.document = data["title"], data
        else:
            if body.expected_revision != 0:
                raise AcceptanceError("新模板 revision 必须为 0")
            row = AcceptanceTemplate(
                id=new_id(), workspace_id=self.workspace_id, title=data["title"], document=data
            )
            self.session.add(row)
        await self.session.commit()
        return AcceptanceTemplateOut(
            id=row.id, title=row.title, revision=row.revision, document=row.document
        )

    async def delete_template(self, identity, expected):
        row = await self.template(identity)

        async def current():
            fresh = await self.template(identity)
            return AcceptanceTemplateOut(
                id=fresh.id, title=fresh.title, revision=fresh.revision, document=fresh.document
            )

        await cas(self.session, row, expected, current)
        await self.session.delete(row)
        await self.session.commit()

    async def get(self, project_id):
        await project(self.session, self.workspace_id, project_id)
        row = await self.session.get(AcceptanceStandard, project_id)
        if row is None:
            return AcceptanceStandardOut(project_id=project_id)
        version = await self.session.scalar(
            select(AcceptanceStandardVersion).where(
                AcceptanceStandardVersion.project_id == project_id,
                AcceptanceStandardVersion.version == row.published_version,
            )
        )
        return AcceptanceStandardOut(
            project_id=project_id,
            revision=row.revision,
            required=row.required,
            published_version=row.published_version,
            draft=row.draft,
            published=version.document if version else None,
        )

    async def validate(self, project_id, document):
        canvas = await self.session.get(VisualCanvasDocument, project_id)
        nodes = {node["id"] for node in canvas.nodes}
        if not set(document.node_ids) <= nodes:
            raise AcceptanceError("应用节点不存在", "not_found", 404)
        if len({value for item in document.criteria for value in item.reference_asset_ids}) > 6:
            raise AcceptanceError("每套标准最多绑定 6 个不同参考素材")
        for item in document.criteria:
            if item.reference_label and item.method == "ai" and not item.reference_asset_ids:
                raise AcceptanceError(f"请绑定参考：{item.reference_label}", "reference_required")
            for identity in item.reference_asset_ids:
                ref = await asset(self.session, self.workspace_id, project_id, identity)
                if ref.media_kind not in {"image", "video"}:
                    raise AcceptanceError("AI 参考仅支持图片或视频")

    async def write(self, project_id, body):
        await project(self.session, self.workspace_id, project_id)
        await self.session.execute(
            insert(AcceptanceStandard)
            .values(
                project_id=project_id,
                workspace_id=self.workspace_id,
                draft=AcceptanceDocument().model_dump(mode="json"),
                published_version=0,
                required=False,
                revision=0,
            )
            .on_conflict_do_nothing(index_elements=["project_id"])
        )
        row = await self.session.get(AcceptanceStandard, project_id, populate_existing=True)
        await cas(self.session, row, body.expected_revision, lambda: self.get(project_id))
        data = body.document.model_dump(mode="json")
        row.draft = data
        if body.publish:
            if not body.document.criteria:
                raise AcceptanceError("至少添加一项验收要求")
            await self.validate(project_id, body.document)
            version = AcceptanceStandardVersion(
                id=new_id(),
                workspace_id=self.workspace_id,
                project_id=project_id,
                version=row.published_version + 1,
                document=deepcopy(data),
            )
            self.session.add(version)
            await self.session.flush()
            row.published_version = version.version
            row.required = body.required
            for identity in {
                value for item in body.document.criteria for value in item.reference_asset_ids
            }:
                self.session.add(
                    AcceptanceAssetReference(
                        owner_id=version.id, project_id=project_id, asset_id=identity
                    )
                )
            if row.required:
                await clear_approvals(self.session, project_id)
        elif body.required != row.required:
            raise AcceptanceError("切换强制验收需要发布标准")
        await self.session.commit()
        return await self.get(project_id)


async def delete_acceptance(session, project_id):
    # Remove restrictive child references before the project's output and asset cleanup.
    from app.apps.visual_workshop.acceptance.models import AcceptanceRepairDraft, AcceptanceRun

    for cls in (
        AcceptanceRepairDraft,
        AcceptanceRun,
        AcceptanceAssetReference,
        AcceptanceStandardVersion,
        AcceptanceStandard,
    ):
        await session.execute(delete(cls).where(cls.project_id == project_id))
