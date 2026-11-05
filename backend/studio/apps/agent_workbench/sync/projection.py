from dataclasses import asdict, replace

from sqlalchemy import bindparam, delete, select, text

from app.runtime.ownership import bind_owner
from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchSession,
    WorkbenchSource,
)
from studio.runtime.time import utc_now


async def apply_batch(
    sessions, source_id, owner, revision, locator, expected_state, batch, *, receipt=None
):
    """Persist entries and the corresponding source cursor atomically; fence unbind/pause."""
    async with sessions() as db:
        bind_owner(db, owner)
        await db.execute(text("BEGIN IMMEDIATE"))
        source = await db.scalar(
            select(WorkbenchSource).where(
                WorkbenchSource.id == source_id, WorkbenchSource.owner_user_id == owner
            )
        )
        if not source or not source.enabled or source.revision != revision:
            return False
        if receipt is not None and await receipt.already_recorded(db):
            return True
        checkpoint = await db.scalar(
            select(WorkbenchCheckpoint).where(
                WorkbenchCheckpoint.source_id == source_id, WorkbenchCheckpoint.locator == locator
            )
        )
        if checkpoint and checkpoint.state != expected_state:
            return False
        if not batch.info.native_id:
            return False
        normalized = {}
        for entry in batch.entries:
            previous = normalized.get(entry.native_id)
            normalized[entry.native_id] = (
                replace(entry, ordinal=previous.ordinal) if previous else entry
            )
        entries = list(normalized.values())
        conversation = await db.scalar(
            select(WorkbenchSession).where(
                WorkbenchSession.owner_user_id == owner,
                WorkbenchSession.agent_id == source.agent_id,
                WorkbenchSession.native_id == batch.info.native_id,
            )
        )
        changed = conversation is None
        if conversation is None:
            conversation = WorkbenchSession(
                owner_user_id=owner, agent_id=source.agent_id, native_id=batch.info.native_id
            )
            db.add(conversation)
            await db.flush()
        info = batch.info
        metadata = {}
        if not conversation.updated_at or info.updated_at >= conversation.updated_at:
            metadata.update(
                cwd=info.cwd,
                native_model=info.model,
                parent_native_id=info.parent_id,
                updated_at=info.updated_at,
            )
            if info.title:
                metadata["title"] = info.title[:120]
        linked_states = (
            await db.scalars(
                select(WorkbenchCheckpoint.state).where(
                    WorkbenchCheckpoint.session_id == conversation.id,
                    WorkbenchCheckpoint.locator != locator,
                )
            )
        ).all()
        metadata["archived"] = info.archived and all(
            state.get("info", {}).get("archived", False) for state in linked_states
        )
        metadata["origins"] = sorted(set((conversation.origins or []) + info.origins))
        metadata["evidence"] = list(dict.fromkeys((conversation.evidence or []) + info.evidence))
        for key, value in metadata.items():
            if getattr(conversation, key) != value:
                setattr(conversation, key, value)
                changed = True
        if checkpoint is None:
            checkpoint = WorkbenchCheckpoint(
                source_id=source_id, locator=locator, session_id=conversation.id, state={}
            )
            db.add(checkpoint)
        # A complete replacement removes deleted/rewritten native entries, not just appends.
        if batch.reset:
            keep = [entry.native_id for entry in entries]
            removed = await db.execute(
                delete(WorkbenchEntry).where(
                    WorkbenchEntry.session_id == conversation.id,
                    WorkbenchEntry.native_id.not_in(keep),
                )
            )
            changed = changed or bool(removed.rowcount)
            await db.execute(
                text(
                    "DELETE FROM agent_workbench_search "
                    "WHERE owner_user_id=:owner AND session_id=:id AND entry_id NOT IN :keep"
                ).bindparams(bindparam("keep", expanding=True)),
                {"owner": owner, "id": conversation.id, "keep": keep},
            )
        existing = {
            row.native_id: row
            for row in (
                await db.scalars(
                    select(WorkbenchEntry).where(
                        WorkbenchEntry.session_id == conversation.id,
                        WorkbenchEntry.native_id.in_([e.native_id for e in entries]),
                    )
                )
            ).all()
        }
        search = []
        dirty_ids = []
        for entry in entries:
            value = asdict(entry)
            row = existing.get(entry.native_id)
            dirty = row is None
            if row is None:
                row = WorkbenchEntry(session_id=conversation.id, **value)
                db.add(row)
                existing[entry.native_id] = row
            else:
                if not batch.reset:
                    value["ordinal"] = min(row.ordinal, entry.ordinal)
                for key, item in value.items():
                    if getattr(row, key) != item:
                        setattr(row, key, item)
                        dirty = True
            if dirty:
                changed = True
                dirty_ids.append(entry.native_id)
                if entry.text:
                    search.append(
                        {
                            "owner": owner,
                            "session": conversation.id,
                            "entry": entry.native_id,
                            "text": entry.text,
                        }
                    )
        if dirty_ids:
            await db.execute(
                text(
                    "DELETE FROM agent_workbench_search WHERE owner_user_id=:owner "
                    "AND session_id=:session AND entry_id IN :entries"
                ).bindparams(bindparam("entries", expanding=True)),
                {"owner": owner, "session": conversation.id, "entries": dirty_ids},
            )
        if search:
            await db.execute(
                text(
                    "INSERT INTO agent_workbench_search(owner_user_id,session_id,entry_id,text) "
                    "VALUES (:owner,:session,:entry,:text)"
                ),
                search,
            )
        checkpoint.state = batch.checkpoint
        checkpoint.session_id = conversation.id
        checkpoint.error = ""
        conversation.last_synced_at = utc_now()
        if changed:
            db.add(WorkbenchChange(owner_user_id=owner, session_id=conversation.id, kind="session"))
        if receipt is not None:
            await receipt.record(db)
        await db.commit()
        return True
