"""Personal filters use CAS; reading activity is an independently ordered event."""

import re

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.sqlite import insert

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtReadingState,
    ThoughtSavedFilter,
)
from studio.apps.thought_workshop.knowledge_tools.references import resolve
from studio.apps.thought_workshop.knowledge_tools.schemas import ReadingOut, SavedFilterOut
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class Preferences:
    def __init__(self, session, owner_user_id, user_id):
        self.session, self.owner_user_id, self.user_id = session, owner_user_id, user_id

    def owner(self, model):
        return model.owner_user_id == self.owner_user_id, model.user_id == self.user_id

    async def filters(self):
        return [
            SavedFilterOut.model_validate(row)
            for row in await self.session.scalars(
                select(ThoughtSavedFilter)
                .where(*self.owner(ThoughtSavedFilter))
                .order_by(ThoughtSavedFilter.name, ThoughtSavedFilter.id)
            )
        ]

    async def filter(self, id):
        row = await self.session.scalar(
            select(ThoughtSavedFilter)
            .where(*self.owner(ThoughtSavedFilter), ThoughtSavedFilter.id == id)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ThoughtError("筛选不存在", 404, "not_found")
        return row

    async def save_filter(self, body, id=None):
        if body.criteria.knowledge_base_id:
            project = await self.session.scalar(
                select(ThoughtKnowledgeBase.id).where(
                    ThoughtKnowledgeBase.id == body.criteria.knowledge_base_id,
                    ThoughtKnowledgeBase.owner_user_id == self.owner_user_id,
                    ThoughtKnowledgeBase.deleted_at.is_(None),
                )
            )
            if project is None:
                raise ThoughtError("知识库不存在", 404, "not_found")
        if id is None:
            row = ThoughtSavedFilter(
                owner_user_id=self.owner_user_id, user_id=self.user_id, **body.model_dump()
            )
            self.session.add(row)
        else:
            await self.filter(id)
            result = await self.session.execute(
                update(ThoughtSavedFilter)
                .where(
                    *self.owner(ThoughtSavedFilter),
                    ThoughtSavedFilter.id == id,
                    ThoughtSavedFilter.revision == body.expected_revision,
                )
                .values(
                    **body.model_dump(exclude={"expected_revision"}),
                    revision=body.expected_revision + 1,
                )
            )
            if result.rowcount != 1:
                await self.filter_conflict(id, body.expected_revision)
            row = await self.filter(id)
        await self.session.commit()
        return SavedFilterOut.model_validate(row)

    async def filter_conflict(self, id, expected):
        await self.session.rollback()
        current = SavedFilterOut.model_validate(await self.filter(id))
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def delete_filter(self, id, expected):
        await self.filter(id)
        result = await self.session.execute(
            delete(ThoughtSavedFilter).where(
                *self.owner(ThoughtSavedFilter),
                ThoughtSavedFilter.id == id,
                ThoughtSavedFilter.revision == expected,
            )
        )
        if result.rowcount != 1:
            await self.filter_conflict(id, expected)
        await self.session.commit()

    async def resource(self, id):
        if id.startswith("official/"):
            if not re.fullmatch(r"official/[a-z0-9-]{1,100}/[a-z0-9-]{1,100}", id):
                raise ThoughtError("官方文档标识无效")
            return None
        targets = await resolve(self.session, self.owner_user_id, [id])
        if not targets[0].available:
            raise ThoughtError("文档不存在", 404, "not_found")
        return targets[0].title

    async def reading(self, id):
        await self.resource(id)
        row = await self.session.scalar(
            select(ThoughtReadingState).where(
                *self.owner(ThoughtReadingState), ThoughtReadingState.resource_id == id
            )
        )
        return ReadingOut.model_validate(row) if row else None

    async def record(self, body):
        title = await self.resource(body.resource_id)
        values = {
            **body.model_dump(),
            "title": title or body.title,
            "owner_user_id": self.owner_user_id,
            "user_id": self.user_id,
            "visited_at": utc_now(),
        }
        statement = (
            insert(ThoughtReadingState)
            .values(id=new_id(), **values)
            .on_conflict_do_update(
                index_elements=["owner_user_id", "user_id", "resource_id"], set_=values
            )
        )
        await self.session.execute(statement)
        await self.session.commit()
        return await self.reading(body.resource_id)

    async def recent(self):
        active_notes = (
            select(ThoughtNote.id)
            .join(ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id)
            .where(
                ThoughtNote.owner_user_id == self.owner_user_id,
                ThoughtNote.deleted_at.is_(None),
                ThoughtKnowledgeBase.deleted_at.is_(None),
            )
        )
        rows = list(
            await self.session.scalars(
                select(ThoughtReadingState)
                .where(
                    *self.owner(ThoughtReadingState),
                    or_(
                        ThoughtReadingState.resource_id.startswith("official/"),
                        ThoughtReadingState.resource_id.in_(active_notes),
                    ),
                )
                .order_by(ThoughtReadingState.visited_at.desc(), ThoughtReadingState.id)
                .limit(50)
            )
        )
        targets = {
            row.id: row
            for row in await self.session.scalars(
                select(ThoughtNote)
                .join(
                    ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id
                )
                .where(
                    ThoughtNote.owner_user_id == self.owner_user_id,
                    ThoughtNote.id.in_([r.resource_id for r in rows]),
                    ThoughtNote.deleted_at.is_(None),
                    ThoughtKnowledgeBase.deleted_at.is_(None),
                )
            )
        }
        result = []
        for row in rows:
            if row.resource_id.startswith("official/") or row.resource_id in targets:
                value = ReadingOut.model_validate(row)
                if row.resource_id in targets:
                    value.title = targets[row.resource_id].title
                result.append(value)
            if len(result) == 50:
                break
        return result
