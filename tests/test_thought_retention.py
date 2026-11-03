"""Thought source outcomes protect prepared Assets pins across uncertain responses."""

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.claims import Actor
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply
from fpl_runtime.retention_authority import issue_retention
from fpl_thought.migrations.registry import MIGRATIONS
from fpl_thought.models import ACCOUNT_MODELS, MODELS
from fpl_thought.retention import ThoughtReferenceDelivery, ThoughtReferences
from fpl_thought.retention_records import ThoughtReferenceMutation


class Remote:
    def __init__(self, key):
        self.key = key
        self.prepared = {}
        self.outcomes = {}
        self.lost_prepare = False
        self.lost_commit = False

    async def authorize(self, *, change, **_kwargs):
        actor = Actor("alpha", "user", "session", ("studio:write",), session_id="s")
        return issue_retention(
            actor, caller="thought", change=change, private_key=self.key, key_id="k"
        )

    async def prepare(self, *, authority, change):
        assert authority
        identity = self.prepared.setdefault(change.request_id, "intent-" + change.request_id)
        if self.lost_prepare:
            self.lost_prepare = False
            raise ConnectionError("lost prepare reply")
        return {"intent_id": identity, "state": "prepared"}

    async def commit(self, *, intent_id, resource_revision, deleted, **_kwargs):
        value = {"state": "committed", "revision": resource_revision, "deleted": deleted}
        previous = self.outcomes.setdefault(intent_id, value)
        assert previous == value
        if self.lost_commit:
            self.lost_commit = False
            raise ConnectionError("lost commit reply")
        return previous

    async def abort(self, *, intent_id, **_kwargs):
        return self.outcomes.setdefault(intent_id, {"state": "aborted"})


@pytest.fixture
async def instance(tmp_path):
    apply(tmp_path / "service.db", "thought", MIGRATIONS)
    database = Database("thought", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    private = Ed25519PrivateKey.generate()
    remote = Remote(private)
    yield (
        database,
        remote,
        ThoughtReferences(database.sessions, remote, public_key=private.public_key()),
    )
    await database.close()


def change(request="one", assets=("asset-a",)):
    return PrepareReferenceChange(
        request_id=request,
        resource_kind="note",
        resource_id="note-a",
        expected_resource_revision=0,
        asset_ids=list(assets),
    )


async def prepare(service, request):
    return await service.prepare(
        owner="alpha",
        assertion="source",
        source_method="PUT",
        source_path="/v1/thought-workshop/notes/note-a",
        change=request,
    )


async def state(database, request="one"):
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        return await session.get(ThoughtReferenceMutation, ("alpha", request))


async def test_commit_is_recorded_in_source_transaction_and_delivery_is_idempotent(instance):
    db, remote, service = instance
    prepared = await prepare(service, change())
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        await service.record(session, prepared, resource_revision=1)
        await session.rollback()
    assert (await state(db)).state == "prepared"
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        await service.record(session, prepared, resource_revision=1)
        await session.commit()
    delivery = ThoughtReferenceDelivery(db.sessions, remote)
    remote.lost_commit = True
    with pytest.raises(ConnectionError):
        await delivery.process_once()
    assert (await state(db)).state == "commit"
    await delivery.process_once()
    await delivery.process_once()
    assert (await state(db)).state == "delivered"
    assert len(remote.outcomes) == 1


async def test_lost_prepare_is_recovered_after_restart_without_creating_another_intent(instance):
    db, remote, service = instance
    remote.lost_prepare = True
    with pytest.raises(ConnectionError):
        await prepare(service, change())
    assert (await state(db)).state == "preparing"
    delivery = ThoughtReferenceDelivery(db.sessions, remote)
    await delivery.recover()
    await delivery.process_once()
    assert (await state(db)).state == "delivered"
    assert remote.outcomes == {"intent-one": {"state": "aborted"}}
    assert len(remote.prepared) == 1


async def test_request_identity_and_account_are_bound(instance):
    db, remote, service = instance
    prepared = await prepare(service, change())
    with pytest.raises(ThoughtError) as exc:
        await prepare(service, change(assets=("another",)))
    assert exc.value.status == 409
    async with db.sessions(info={"owner_user_id": "beta"}) as session:
        with pytest.raises(ThoughtError):
            await service.record(session, prepared, resource_revision=1)
    assert (await state(db)).state == "prepared"


async def test_abort_requires_closed_source_transaction(instance):
    db, remote, service = instance
    prepared = await prepare(service, change())
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        await session.scalar(select(ThoughtReferenceMutation))
        with pytest.raises(ValueError, match="源事务"):
            await service.abort_after_rollback(session, prepared)
        await session.rollback()
        await service.abort_after_rollback(session, prepared)
    await ThoughtReferenceDelivery(db.sessions, remote).process_once()
    assert remote.outcomes == {"intent-one": {"state": "aborted"}}


async def test_real_note_save_commits_history_and_retention_as_one_outcome(instance):
    from app.apps.thought_workshop.asset_metadata import LibraryAsset
    from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
    from app.apps.thought_workshop.schemas.workshop import ThoughtNotePut
    from fpl_thought.note_retention import save_note_with_references

    db, remote, service = instance
    old = {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": "old"}}]}
    new = {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": "new"}}]}
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="alpha", title="Book"))
        await session.flush()
        session.add(
            ThoughtNote(
                id="note-a",
                owner_user_id="alpha",
                knowledge_base_id="book",
                title="Original",
                kind="note",
                document=old,
                search_text="",
            )
        )
        await session.commit()

    class Metadata:
        async def describe(self, ids):
            return {
                asset: LibraryAsset(asset, asset + ".png", "image/png", "image", 8, 1)
                for asset in ids
            }

    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.info["thought_asset_metadata_factory"] = lambda _session, _owner: Metadata()
        original_prepare = remote.prepare

        async def prepare_without_write_lock(*, authority, change):
            assert not session.in_transaction()
            assert change.asset_ids == ["new", "old"]
            return await original_prepare(authority=authority, change=change)

        remote.prepare = prepare_without_write_lock
        body = ThoughtNotePut(
            knowledge_base_id="book", title="Updated", document=new, expected_revision=0
        )
        result = await save_note_with_references(
            session,
            owner="alpha",
            author_id=None,
            note_id="note-a",
            body=body,
            assertion="source",
            source_method="PUT",
            source_path="/v1/thought-workshop/notes/note-a",
            references=service,
        )
        assert result.revision == 1
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        note = await session.get(ThoughtNote, "note-a")
        receipt = await session.scalar(select(ThoughtReferenceMutation))
        assert note.document == new
        assert receipt.state == "commit" and receipt.resource_revision == 1
        assert receipt.change["asset_ids"] == ["new", "old"]
    await ThoughtReferenceDelivery(db.sessions, remote).process_once()
    assert next(iter(remote.outcomes.values()))["revision"] == 1


async def test_lost_source_commit_reply_preserves_committed_note_and_pins(instance, monkeypatch):
    from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
    from app.apps.thought_workshop.schemas.workshop import ThoughtNotePut
    from fpl_thought.note_retention import save_note_with_references

    db, remote, service = instance
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="alpha", title="Book"))
        await session.flush()
        session.add(
            ThoughtNote(
                id="note-a",
                owner_user_id="alpha",
                knowledge_base_id="book",
                title="Before",
                kind="note",
                document={"type": "doc", "content": []},
                search_text="",
            )
        )
        await session.commit()
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        real_commit = session.commit

        async def lost_reply():
            await real_commit()
            raise RuntimeError("source commit reply lost")

        monkeypatch.setattr(session, "commit", lost_reply)
        body = ThoughtNotePut(knowledge_base_id="book", title="After", expected_revision=0)
        with pytest.raises(RuntimeError, match="source commit reply lost"):
            await save_note_with_references(
                session,
                owner="alpha",
                author_id=None,
                note_id="note-a",
                body=body,
                assertion="source",
                source_method="PUT",
                source_path="/v1/thought-workshop/notes/note-a",
                references=service,
            )
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ThoughtNote, "note-a")).title == "After"
        assert (await session.scalar(select(ThoughtReferenceMutation))).state == "commit"
    await ThoughtReferenceDelivery(db.sessions, remote).recover()
    await ThoughtReferenceDelivery(db.sessions, remote).process_once()
    assert next(iter(remote.outcomes.values()))["state"] == "committed"


async def test_concurrent_note_change_aborts_only_its_prepared_intent(instance):
    from sqlalchemy import update

    from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
    from app.apps.thought_workshop.schemas.workshop import ThoughtNotePut
    from app.runtime.revisions import RevisionConflictError
    from fpl_thought.note_retention import save_note_with_references

    db, remote, service = instance
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="alpha", title="Book"))
        await session.flush()
        session.add(
            ThoughtNote(
                id="note-a",
                owner_user_id="alpha",
                knowledge_base_id="book",
                title="Before",
                kind="note",
                document={"type": "doc", "content": []},
                search_text="",
            )
        )
        await session.commit()
    initial_prepare = remote.prepare

    async def concurrent_save(*, authority, change):
        result = await initial_prepare(authority=authority, change=change)
        async with db.sessions(info={"owner_user_id": "alpha"}) as other:
            await other.execute(
                update(ThoughtNote)
                .where(ThoughtNote.id == "note-a")
                .values(revision=1, title="Other")
            )
            await other.commit()
        return result

    remote.prepare = concurrent_save
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        body = ThoughtNotePut(knowledge_base_id="book", title="After", expected_revision=0)
        with pytest.raises(RevisionConflictError):
            await save_note_with_references(
                session,
                owner="alpha",
                author_id=None,
                note_id="note-a",
                body=body,
                assertion="source",
                source_method="PUT",
                source_path="/v1/thought-workshop/notes/note-a",
                references=service,
            )
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ThoughtNote, "note-a")).title == "Other"
        assert (await session.scalar(select(ThoughtReferenceMutation))).state == "abort"
    await ThoughtReferenceDelivery(db.sessions, remote).process_once()
    assert next(iter(remote.outcomes.values()))["state"] == "aborted"


async def test_template_update_and_delete_record_exact_asset_pins(instance):
    from app.apps.thought_workshop.asset_metadata import LibraryAsset
    from app.apps.thought_workshop.knowledge_tools.models import ThoughtTemplate
    from app.apps.thought_workshop.knowledge_tools.schemas import TemplatePut
    from fpl_thought.template_retention import mutate_template_with_references

    db, remote, service = instance
    empty = {"type": "doc", "content": []}
    replacement = {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": "new"}}]}
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            ThoughtTemplate(id="template", owner_user_id="alpha", name="Before", document=empty)
        )
        await session.commit()

    class Metadata:
        async def describe(self, ids):
            return {
                asset: LibraryAsset(asset, asset + ".png", "image/png", "image", 8, 1)
                for asset in ids
            }

    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.info["thought_asset_metadata_factory"] = lambda _session, _owner: Metadata()
        body = TemplatePut(name="After", document=replacement, expected_revision=0)
        result = await mutate_template_with_references(
            session,
            owner="alpha",
            template_id="template",
            assertion="source",
            source_method="PUT",
            source_path="/v1/thought-workshop/templates/template",
            references=service,
            body=body,
        )
        assert result.name == "After" and result.revision == 1
    delivery = ThoughtReferenceDelivery(db.sessions, remote)
    await delivery.process_once()
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        receipts = list(await session.scalars(select(ThoughtReferenceMutation)))
        assert len(receipts) == 1
        assert receipts[0].change["asset_ids"] == ["new"]
        assert receipts[0].state == "delivered"
        await mutate_template_with_references(
            session,
            owner="alpha",
            template_id="template",
            assertion="source",
            source_method="DELETE",
            source_path="/v1/thought-workshop/templates/template",
            references=service,
            expected_revision=1,
        )
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await session.get(ThoughtTemplate, "template") is None
        receipts = list(await session.scalars(select(ThoughtReferenceMutation)))
        deletion = next(row for row in receipts if row.state == "commit")
        assert deletion.deleted and deletion.resource_revision == 2
        assert deletion.change["asset_ids"] == []
    await delivery.process_once()
    assert len(remote.outcomes) == 2


async def test_permanent_note_purge_releases_pins_only_with_committed_deletion(instance):
    from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
    from app.runtime.time import utc_now
    from fpl_thought.note_retention import purge_note_with_references

    db, remote, service = instance
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="alpha", title="Book"))
        await session.flush()
        session.add(
            ThoughtNote(
                id="note-a",
                owner_user_id="alpha",
                knowledge_base_id="book",
                title="Trash",
                kind="note",
                document={"type": "doc", "content": []},
                search_text="",
                deleted_at=utc_now(),
            )
        )
        await session.commit()
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        result = await purge_note_with_references(
            session,
            owner="alpha",
            note_id="note-a",
            expected_revision=0,
            expected_knowledge_revision=0,
            assertion="source",
            source_method="DELETE",
            source_path="/v1/thought-workshop/notes/note-a",
            references=service,
        )
        assert result.title == "Trash"
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await session.get(ThoughtNote, "note-a") is None
        receipt = await session.scalar(select(ThoughtReferenceMutation))
        assert receipt.state == "commit" and receipt.deleted
        assert receipt.resource_revision == 1 and receipt.change["asset_ids"] == []
    await ThoughtReferenceDelivery(db.sessions, remote).process_once()
    assert next(iter(remote.outcomes.values()))["deleted"] is True
