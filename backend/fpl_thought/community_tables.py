"""Prepare table attachments before the published table transaction acquires its lock."""

from uuid import uuid4

from sqlalchemy import text

from app.apps.thought_workshop.multitable.storage import asset_ids
from app.apps.thought_workshop.publication.access import missing
from app.apps.thought_workshop.publication.sessions import source_sessions
from app.apps.thought_workshop.publication.tables import TableAccess
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.retention_authority import CommunityRetentionScope

from .community_edits import PreparedCommunityAssets, require_actor
from .retention import note_pin_ids


async def apply_table(
    request_session,
    principal,
    publication_id,
    note_id,
    body,
    parent_note_id,
    *,
    references,
    identity,
    assertion,
    source_path,
):
    if principal.auth_kind != "session":
        raise missing()
    async with source_sessions(request_session)() as session:
        prepared = None
        commit_started = False

        async def prepare(source, before, after):
            nonlocal prepared
            article_publication_id, owner, publication_revision, article_revision = source
            assets = asset_ids(after)
            pins = await note_pin_ids(session, owner, note_id, assets | asset_ids(before))
            scope = CommunityRetentionScope(
                actor_id=principal.user_id,
                owner_id=owner,
                publication_id=publication_id,
                article_publication_id=article_publication_id,
                note_id=note_id,
                publication_revision=publication_revision,
                article_revision=article_revision,
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
                owner=owner,
                assertion=assertion,
                source_method="POST",
                source_path=source_path,
                change=change,
                community=scope,
            )
            session.info["thought_asset_metadata_factory"] = PreparedCommunityAssets(
                prepared
            ).for_owner
            await require_actor(identity, assertion, "POST", source_path)

        async def after_write(revision):
            nonlocal commit_started
            await references.record(session, prepared, resource_revision=revision)
            commit_started = True

        try:
            await session.execute(text("BEGIN"))
            return await TableAccess(session, principal).apply(
                publication_id,
                note_id,
                body,
                parent_note_id,
                prepare=prepare,
                after_write=after_write,
            )
        except BaseException:
            if prepared is not None and not commit_started:
                await session.rollback()
                await references.abort_after_rollback(session, prepared)
            raise
