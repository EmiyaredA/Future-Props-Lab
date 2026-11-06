"""account document projects and atomic project revision reservations."""

from datetime import UTC

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.history import History
from studio.apps.thought_workshop.publication.lifecycle import withdraw_library
from studio.apps.thought_workshop.schemas.document import empty_document
from studio.apps.thought_workshop.schemas.knowledge import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    KnowledgeBasePut,
)
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.website.asset_metadata import describe_assets
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class KnowledgeBases:
    def __init__(
        self,
        session: AsyncSession,
        owner_user_id: str,
        author_id: str | None = None,
        *,
        assets=None,
        accounts=None,
    ):
        self.session, self.owner_user_id = session, owner_user_id
        self.author_id = author_id
        self.assets, self.accounts = assets, accounts

    async def get(self, project_id: str, *, include_deleted: bool = False) -> ThoughtKnowledgeBase:
        row = await self.session.scalar(
            select(ThoughtKnowledgeBase)
            .where(
                ThoughtKnowledgeBase.id == project_id,
                ThoughtKnowledgeBase.owner_user_id == self.owner_user_id,
            )
            .execution_options(populate_existing=True)
        )
        if row is None or (row.deleted_at and not include_deleted):
            raise ThoughtError("知识库不存在", 404, "not_found")
        return row

    async def output(self, row: ThoughtKnowledgeBase) -> KnowledgeBaseOut:
        count = await self.session.scalar(
            select(func.count())
            .select_from(ThoughtNote)
            .where(
                ThoughtNote.knowledge_base_id == row.id,
                ThoughtNote.is_home.is_(False),
                ThoughtNote.deleted_at.is_(None),
            )
        )
        return KnowledgeBaseOut.model_validate(row).model_copy(
            update={
                "document_count": count or 0,
                "created_at": row.created_at.replace(tzinfo=UTC),
                "updated_at": row.updated_at.replace(tzinfo=UTC),
                "deleted_at": row.deleted_at.replace(tzinfo=UTC) if row.deleted_at else None,
            }
        )

    async def list(self, query: str = "", trash: bool = False) -> list[KnowledgeBaseOut]:
        rows = (
            await self.session.scalars(
                select(ThoughtKnowledgeBase)
                .where(
                    ThoughtKnowledgeBase.owner_user_id == self.owner_user_id,
                    ThoughtKnowledgeBase.deleted_at.is_not(None)
                    if trash
                    else ThoughtKnowledgeBase.deleted_at.is_(None),
                    ThoughtKnowledgeBase.title.contains(query.strip(), autoescape=True),
                )
                .order_by(ThoughtKnowledgeBase.updated_at.desc(), ThoughtKnowledgeBase.id)
            )
        ).all()
        return [await self.output(row) for row in rows]

    async def cover(self, asset_id: str | None) -> None:
        if asset_id is None:
            return
        rows = await describe_assets(self.assets, {asset_id})
        if rows[asset_id].media_kind != "image":
            raise ThoughtError("封面图片不存在", 404, "not_found")

    async def reserve(
        self, project_id: str, expected: int, *, include_deleted: bool = False
    ) -> ThoughtKnowledgeBase:
        await self.get(project_id, include_deleted=include_deleted)
        result = await self.session.execute(
            update(ThoughtKnowledgeBase)
            .where(
                ThoughtKnowledgeBase.id == project_id,
                ThoughtKnowledgeBase.owner_user_id == self.owner_user_id,
                ThoughtKnowledgeBase.revision == expected,
            )
            .values(revision=expected + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.output(await self.get(project_id, include_deleted=True))
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))
        return await self.get(project_id, include_deleted=include_deleted)

    async def create(
        self,
        body: KnowledgeBaseIn,
        *,
        project_id: str | None = None,
        home_note_id: str | None = None,
        commit: bool = True,
        cover_validated: bool = False,
    ) -> KnowledgeBaseOut:
        if not cover_validated:
            await self.cover(body.cover_asset_id)
        row = ThoughtKnowledgeBase(
            id=project_id,
            owner_user_id=self.owner_user_id,
            **body.model_dump(),
        )
        self.session.add(row)
        await self.session.flush()
        home = ThoughtNote(
            id=home_note_id,
            owner_user_id=self.owner_user_id,
            knowledge_base_id=row.id,
            is_home=True,
            title="首页",
            document=empty_document(),
        )
        self.session.add(home)
        await self.session.flush()
        row.home_note_id = home.id
        await History(self.session, accounts=self.accounts).append(home, self.author_id, "create")
        if commit:
            await self.session.commit()
        return await self.output(await self.get(row.id))

    async def put(
        self,
        project_id: str,
        body: KnowledgeBasePut,
        *,
        commit: bool = True,
        cover_validated: bool = False,
    ) -> KnowledgeBaseOut:
        if not cover_validated:
            await self.cover(body.cover_asset_id)
        row = await self.reserve(project_id, body.expected_revision)
        for key, value in body.model_dump(exclude={"expected_revision"}).items():
            setattr(row, key, value)
        if commit:
            await self.session.commit()
        return await self.output(await self.get(project_id))

    async def transition(self, project_id: str, expected: int, restore: bool) -> KnowledgeBaseOut:
        row = await self.reserve(project_id, expected, include_deleted=True)
        row.deleted_at = None if restore else utc_now()
        if not restore:
            await withdraw_library(self.session, project_id)
        await self.session.commit()
        return await self.output(await self.get(project_id, include_deleted=True))
