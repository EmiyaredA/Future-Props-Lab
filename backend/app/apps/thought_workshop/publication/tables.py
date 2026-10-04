"""Independent table grants, with explicit parent checks for embedded views."""

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.apps.thought_workshop.knowledge_tools.references import reference_ids
from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.multitable.storage import asset_ids, snapshot
from app.apps.thought_workshop.multitable.use_cases import Multitable

from .access import article, bind_source, missing, publication
from .catalog import visible
from .models import CommunityUpload, Publication
from .mutations import begin_write


class TableAccess:
    def __init__(self, session, principal):
        self.session, self.principal = session, principal

    async def access(self, pub_id, note_id, parent_id=None, *, write=False):
        pub = await publication(self.session, pub_id)
        if parent_id:
            _, parent, _ = await article(self.session, self.principal, pub, parent_id)
            if note_id not in reference_ids(parent.document):
                raise missing()
            target = await self.session.scalar(
                select(Publication)
                .join(ThoughtNote, ThoughtNote.knowledge_base_id == Publication.knowledge_base_id)
                .where(
                    ThoughtNote.id == note_id,
                    Publication.workspace_id == pub.workspace_id,
                    Publication.active.is_(True),
                )
            )
            if target is None:
                raise missing()
            pub = await publication(self.session, target.id)
        _, note, role = await article(
            self.session, self.principal, pub, note_id, level="edit" if write else "read"
        )
        bind_source(self.session, pub)
        use_case = Multitable(self.session, pub.workspace_id, self.principal.user_id)
        await use_case.note(note.id)
        return use_case, pub, role

    async def structure(self, pub_id, note_id, parent_id):
        use_case, pub, role = await self.access(pub_id, note_id, parent_id)
        result = await use_case.structure(note_id, role)
        result.publication_id = pub.id
        return result

    async def conversion(self, pub_id, note_id, body, parent_id):
        use_case, _, _ = await self.access(pub_id, note_id, parent_id, write=True)
        return await use_case.conversion(note_id, body)

    async def records(self, pub_id, note_id, table_id, body, parent_id):
        use_case, _, _ = await self.access(pub_id, note_id, parent_id)
        return await use_case.records(note_id, table_id, body)

    async def apply(self, pub_id, note_id, body, parent_id):
        await begin_write(self.session)
        use_case, pub, role = await self.access(pub_id, note_id, parent_id, write=True)
        current = await snapshot(self.session, note_id)
        allowed_assets = asset_ids(current) | set(
            await self.session.scalars(
                select(CommunityUpload.asset_id).where(
                    CommunityUpload.note_id == note_id,
                    CommunityUpload.user_id == self.principal.user_id,
                )
            )
        )
        rows, _ = await visible(self.session, self.principal, pub)
        result = await use_case.apply(
            note_id, body, allowed_assets=allowed_assets, allowed_notes={n.id for n, _, _ in rows}
        )
        result.structure.role = role
        result.structure.can_edit = role in {"edit", "manage"}
        result.structure.can_manage = role == "manage"
        result.structure.publication_id = pub.id
        return result


class CommunityTables:
    """Each browser operation binds the source only inside its own session."""

    def __init__(self, request_session, principal):
        self.sessions = async_sessionmaker(request_session.bind, expire_on_commit=False)
        self.principal = principal

    async def run(self, method, *args):
        async with self.sessions() as session:
            await session.execute(text("BEGIN"))
            return await getattr(TableAccess(session, self.principal), method)(*args)

    async def structure(self, *args):
        return await self.run("structure", *args)

    async def records(self, *args):
        return await self.run("records", *args)

    async def conversion(self, *args):
        return await self.run("conversion", *args)

    async def apply(self, *args):
        return await self.run("apply", *args)
