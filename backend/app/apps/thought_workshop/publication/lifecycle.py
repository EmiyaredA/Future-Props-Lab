"""Recycling content revokes publication in the same source transaction."""

from sqlalchemy import select, update

from app.runtime.time import utc_now

from .models import Publication, PublishedArticle


async def withdraw_notes(session, note_ids):
    await session.execute(
        update(PublishedArticle)
        .where(PublishedArticle.note_id.in_(note_ids))
        .values(active=False, revision=PublishedArticle.revision + 1)
    )


async def withdraw_library(session, library_id):
    await session.execute(
        update(Publication)
        .where(Publication.knowledge_base_id == library_id)
        .values(active=False, revision=Publication.revision + 1)
    )


async def touch_note(session, note_id):
    await session.execute(
        update(Publication)
        .where(
            Publication.active.is_(True),
            select(PublishedArticle.note_id)
            .where(
                PublishedArticle.publication_id == Publication.id,
                PublishedArticle.note_id == note_id,
                PublishedArticle.active.is_(True),
            )
            .exists(),
        )
        .values(updated_at=utc_now())
    )
