"""Resolve standard note references through visible publications, never private notes."""

from sqlalchemy import select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.schemas import ReferenceTarget
from studio.apps.thought_workshop.publication.access import article, missing, publication
from studio.apps.thought_workshop.publication.catalog import visible
from studio.apps.thought_workshop.publication.models import Publication
from studio.apps.thought_workshop.storage.models import ThoughtNote


class CommunityReferenceTarget(ReferenceTarget):
    publication_id: str | None = None


async def resolve(session, principal, pub_id, ids):
    source = await publication(session, pub_id)
    rows, manager = await visible(session, principal, source)
    if not rows and not manager:
        raise missing()
    candidates = (
        await session.execute(
            select(ThoughtNote.id, Publication.id)
            .join(Publication, Publication.knowledge_base_id == ThoughtNote.knowledge_base_id)
            .where(
                ThoughtNote.id.in_(ids),
                ThoughtNote.owner_user_id == source.owner_user_id,
                Publication.owner_user_id == source.owner_user_id,
                Publication.active.is_(True),
            )
        )
    ).all()
    found = {}
    for note_id, target_id in candidates:
        try:
            target = await publication(session, target_id)
            _, note, _ = await article(session, principal, target, note_id)
        except ThoughtError as error:
            if error.status != 404:
                raise
            continue
        found[note_id] = CommunityReferenceTarget(
            id=note_id,
            available=True,
            title=note.title,
            knowledge_base_id=note.knowledge_base_id,
            publication_id=target.id,
            excerpt=note.search_text[:240],
            revision=note.revision,
        )
    return [
        found.get(id, CommunityReferenceTarget(id=id, available=False)) for id in dict.fromkeys(ids)
    ]
