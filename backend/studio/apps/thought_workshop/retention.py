"""Thought's reference ledger and current/history/table pin collection."""

from sqlalchemy import select

from studio.apps.asset_library.clients.reference_mutations import (
    ReferenceDelivery,
    ReferenceMutations,
)
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.multitable.models import DataAsset
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtNote,
    ThoughtNoteHistory,
)
from studio.apps.thought_workshop.storage.retention_records import ThoughtReferenceMutation


async def note_pin_ids(session, owner, note_id, prospective=()):
    """Current and historical documents/tables retain their files until permanent purge."""
    note = await session.scalar(
        select(ThoughtNote).where(ThoughtNote.id == note_id, ThoughtNote.owner_user_id == owner)
    )
    if note is None:
        raise ThoughtError("笔记不存在", 404, "not_found")
    current = set(file_ids(note.document)) | set(prospective)
    historical = set(
        await session.scalars(
            select(ThoughtHistoryAsset.asset_id)
            .join(ThoughtNoteHistory, ThoughtNoteHistory.id == ThoughtHistoryAsset.history_id)
            .where(ThoughtNoteHistory.note_id == note_id)
        )
    )
    tables = set(
        await session.scalars(select(DataAsset.asset_id).where(DataAsset.note_id == note_id))
    )
    return current | historical | tables


class ThoughtReferences(ReferenceMutations):
    def __init__(self, sessions, client, *, public_key):
        super().__init__(
            sessions,
            client,
            service="thought",
            model=ThoughtReferenceMutation,
            public_key=public_key,
            failure=ThoughtError,
        )


class ThoughtReferenceDelivery(ReferenceDelivery):
    def __init__(self, sessions, client):
        super().__init__(sessions, client, service="thought", model=ThoughtReferenceMutation)
