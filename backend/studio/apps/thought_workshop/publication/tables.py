"""Independent table grants, with explicit parent checks for embedded views."""

from sqlalchemy import select, text

from studio.apps.thought_workshop.knowledge_tools.references import reference_ids
from studio.apps.thought_workshop.multitable.storage import asset_ids, snapshot
from studio.apps.thought_workshop.multitable.use_cases import Multitable
from studio.apps.thought_workshop.publication.access import (
    article,
    bind_source,
    missing,
    publication,
)
from studio.apps.thought_workshop.publication.catalog import visible
from studio.apps.thought_workshop.publication.models import CommunityUpload, Publication
from studio.apps.thought_workshop.publication.mutations import begin_write
from studio.apps.thought_workshop.publication.sessions import source_sessions
from studio.apps.thought_workshop.storage.models import ThoughtNote


class TableAccess:
    def __init__(self, session, principal, *, accounts):
        self.session, self.principal, self.accounts = session, principal, accounts

    async def access(self, pub_id, note_id, parent_id=None, *, write=False, source_assets=None):
        pub = await publication(self.session, pub_id)
        if parent_id:
            _, parent, _ = await article(
                self.session, self.principal, pub, parent_id, accounts=self.accounts
            )
            if note_id not in reference_ids(parent.document):
                raise missing()
            target = await self.session.scalar(
                select(Publication)
                .join(ThoughtNote, ThoughtNote.knowledge_base_id == Publication.knowledge_base_id)
                .where(
                    ThoughtNote.id == note_id,
                    Publication.owner_user_id == pub.owner_user_id,
                    Publication.active.is_(True),
                )
            )
            if target is None:
                raise missing()
            pub = await publication(self.session, target.id)
        config, note, role = await article(
            self.session,
            self.principal,
            pub,
            note_id,
            level="edit" if write else "read",
            accounts=self.accounts,
        )
        bind_source(self.session, pub)
        assets = (
            source_assets(self.session, pub.owner_user_id) if source_assets is not None else None
        )
        use_case = Multitable(
            self.session,
            pub.owner_user_id,
            self.principal.user_id,
            assets=assets,
            accounts=self.accounts,
        )
        await use_case.note(note.id)
        return use_case, pub, role, config

    async def structure(self, pub_id, note_id, parent_id):
        use_case, pub, role, _ = await self.access(pub_id, note_id, parent_id)
        result = await use_case.structure(note_id, role)
        result.publication_id = pub.id
        return result

    async def conversion(self, pub_id, note_id, body, parent_id):
        use_case, _, _, _ = await self.access(pub_id, note_id, parent_id, write=True)
        return await use_case.conversion(note_id, body)

    async def records(self, pub_id, note_id, table_id, body, parent_id):
        use_case, _, _, _ = await self.access(pub_id, note_id, parent_id)
        return await use_case.records(note_id, table_id, body)

    async def allowed_assets(self, note_id, state):
        return asset_ids(state) | set(
            await self.session.scalars(
                select(CommunityUpload.asset_id).where(
                    CommunityUpload.note_id == note_id,
                    CommunityUpload.user_id == self.principal.user_id,
                )
            )
        )

    async def apply(
        self,
        pub_id,
        note_id,
        body,
        parent_id,
        *,
        prepare=None,
        after_write=None,
        source_assets=None,
    ):
        use_case, pub, role, config = await self.access(
            pub_id, note_id, parent_id, write=True, source_assets=source_assets
        )
        authorized_source = pub.id, pub.owner_user_id, pub.revision, config.revision
        current = await snapshot(self.session, note_id)
        allowed_assets = await self.allowed_assets(note_id, current)
        rows, _ = await visible(self.session, self.principal, pub, accounts=self.accounts)

        async def before_write(before, after):
            nonlocal pub, role
            assets = (
                await prepare(authorized_source, before, after) if prepare is not None else None
            )
            # All remote preparation is complete. Serialize local grants with the mutation.
            await begin_write(self.session)
            _, pub, role, config = await self.access(pub_id, note_id, parent_id, write=True)
            if prepare is not None and (
                (pub.id, pub.owner_user_id, pub.revision, config.revision) != authorized_source
                or not asset_ids(after) <= await self.allowed_assets(note_id, before)
            ):
                raise missing()
            current_rows, _ = await visible(
                self.session, self.principal, pub, accounts=self.accounts
            )

            def note_refs(state):
                return {
                    id
                    for table in state.tables
                    for field in table.fields
                    if field.type == "note"
                    for record in state.records.get(table.id, [])
                    for id in record.values.get(field.id, []) or []
                }

            if not (note_refs(after) - note_refs(before)) <= {
                note.id for note, _, _ in current_rows
            }:
                raise missing()
            return assets

        result = await use_case.apply(
            note_id,
            body,
            allowed_assets=allowed_assets,
            allowed_notes={n.id for n, _, _ in rows},
            before_write=before_write,
            after_write=after_write,
            prepared_assets=prepare is not None,
        )
        result.structure.role = role
        result.structure.can_edit = role in {"edit", "manage"}
        result.structure.can_manage = role == "manage"
        result.structure.publication_id = pub.id
        return result


class CommunityTables:
    """Each browser operation binds the source only inside its own session."""

    def __init__(self, request_session, principal, *, accounts):
        self.sessions = source_sessions(request_session)
        self.principal, self.accounts = principal, accounts

    async def run(self, method, *args, **kwargs):
        async with self.sessions() as session:
            await session.execute(text("BEGIN"))
            return await getattr(
                TableAccess(session, self.principal, accounts=self.accounts.for_session(session)),
                method,
            )(*args, **kwargs)

    async def structure(self, *args):
        return await self.run("structure", *args)

    async def records(self, *args):
        return await self.run("records", *args)

    async def conversion(self, *args):
        return await self.run("conversion", *args)

    async def apply(self, *args, source_assets):
        return await self.run("apply", *args, source_assets=source_assets)
