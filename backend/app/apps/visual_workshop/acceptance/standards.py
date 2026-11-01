from sqlalchemy import delete, select

from app.apps.visual_workshop.acceptance.access import (
    project,
)
from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
)
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceStandardOut,
    AcceptanceTemplateListOut,
    AcceptanceTemplateOut,
)
from app.apps.visual_workshop.acceptance.templates import builtin_templates


class Standards:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id

    async def templates(self):
        rows = await self.session.scalars(
            select(AcceptanceTemplate).where(AcceptanceTemplate.owner_user_id == self.owner_user_id)
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

    async def get(self, project_id):
        await project(self.session, self.owner_user_id, project_id)
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


async def delete_acceptance(session, project_id):
    # Remove restrictive child references before the project's output and asset cleanup.

    for cls in (
        NodeAcceptanceBinding,
        AcceptanceRepairDraft,
        AcceptanceRun,
        AcceptanceAssetReference,
        AcceptanceStandardVersion,
        AcceptanceStandard,
    ):
        await session.execute(delete(cls).where(cls.project_id == project_id))
