"""Commit community edits against the source owner's document and reference ledger."""

from uuid import uuid4

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.publication.access import missing
from studio.apps.thought_workshop.publication.content import authorize_note_edit, write_note_edit
from studio.apps.thought_workshop.publication.mutations import begin_write
from studio.apps.thought_workshop.publication.sessions import source_sessions
from studio.apps.thought_workshop.retention import note_pin_ids
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.website.asset_metadata import LibraryAsset
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.asset_library.retention_authority import CommunityRetentionScope


class PreparedCommunityAssets:
    def __init__(self, prepared):
        self.owner = prepared.owner
        self.files = {asset.id: LibraryAsset(**asset.model_dump()) for asset in prepared.metadata}

    def for_owner(self, owner):
        if owner != self.owner:
            raise missing()
        return self

    async def describe(self, asset_ids):
        if not asset_ids <= self.files.keys():
            raise missing()
        return {asset_id: self.files[asset_id] for asset_id in asset_ids}


async def require_actor(identity, assertion, method, path):
    status = await identity.status(assertion=assertion, method=method, path=path)
    if status is None:
        raise ThoughtError("无法复核社区编辑权限", 503, "community_authorization_unavailable")
    if not status:
        raise missing()


async def save_note(
    request_session,
    principal,
    publication_id,
    note_id,
    body,
    *,
    accounts,
    references,
    identity,
    assertion,
    source_path,
):
    if principal.auth_kind != "session":
        raise missing()
    async with source_sessions(request_session)() as session:
        accounts = accounts.for_session(session)
        edit = await authorize_note_edit(
            session, principal, publication_id, note_id, body, accounts=accounts
        )
        assets = file_ids(edit.body.document)
        pins = await note_pin_ids(session, edit.owner, note_id, assets)
        scope = CommunityRetentionScope(
            actor_id=principal.user_id,
            owner_id=edit.owner,
            publication_id=publication_id,
            note_id=note_id,
            publication_revision=edit.publication_revision,
            article_revision=edit.article_revision,
            note_revision=body.expected_revision,
        )
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="note",
            resource_id=note_id,
            expected_resource_revision=body.expected_revision,
            asset_ids=sorted(pins),
            metadata_asset_ids=sorted(assets),
        )
        await session.rollback()
        prepared = await references.prepare(
            owner=edit.owner,
            assertion=assertion,
            source_method="PUT",
            source_path=source_path,
            change=change,
            community=scope,
        )
        commit_started = False
        try:
            await require_actor(identity, assertion, "PUT", source_path)
            await begin_write(session)
            current = await authorize_note_edit(
                session, principal, publication_id, note_id, body, accounts=accounts
            )
            if (
                current.owner != scope.owner_id
                or current.publication_revision != scope.publication_revision
                or current.article_revision != scope.article_revision
            ):
                raise missing()
            assets = PreparedCommunityAssets(prepared).for_owner(current.owner)
            result = await write_note_edit(
                session,
                principal,
                publication_id,
                note_id,
                current,
                accounts=accounts,
                assets=assets,
            )
            await references.record(session, prepared, resource_revision=result.note.revision)
            commit_started = True
            await session.commit()
            return result
        except BaseException:
            if not commit_started:
                await session.rollback()
                # Permission may have been revoked before the source session was bound.
                async with references.sessions(info={"owner_user_id": edit.owner}) as bound:
                    await references.abort_after_rollback(bound, prepared)
            raise
