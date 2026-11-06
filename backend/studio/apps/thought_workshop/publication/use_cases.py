"""Public entry point: each community operation owns an independent session."""

from sqlalchemy import delete, select, text

from studio.apps.thought_workshop.directory import Directory
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.publication import catalog, content, mutations
from studio.apps.thought_workshop.publication.access import (
    bind_source,
    publication,
    require_source_manager,
)
from studio.apps.thought_workshop.publication.models import CommunityFavorite, OfficialSource
from studio.apps.thought_workshop.publication.schemas import CommunityManagement, FavoritesOut
from studio.apps.thought_workshop.publication.sessions import source_sessions
from studio.apps.thought_workshop.storage.models import ThoughtNote


class Community:
    def __init__(self, request_session, principal, *, accounts):
        self.sessions = source_sessions(request_session)
        self.principal, self.accounts = principal, accounts

    async def run(self, operation, *args, **kwargs):
        async with self.sessions() as session:
            await session.execute(text("BEGIN"))
            return await operation(
                session,
                self.principal,
                *args,
                accounts=self.accounts.for_session(session),
                **kwargs,
            )

    async def list(self, query="", mine=False, favorites=False, offset=0, limit=24, official=None):
        return await self.run(catalog.listing, query, mine, favorites, offset, limit, official)

    async def directory(self, id):
        return await self.run(catalog.directory, id)

    async def get_note(self, id, note):
        return await self.run(content.get_note, id, note)

    async def save_note(self, id, note, body, *, source_assets):
        return await self.run(content.save_note, id, note, body, source_assets=source_assets)

    async def config(self, library):
        return await self.run(mutations.config, library)

    async def publish(self, library, body):
        return await self.run(mutations.publish, library, body)

    async def management(self, id):
        async with self.sessions() as session:
            await session.execute(text("BEGIN"))
            pub = await publication(session, id, active=False)
            await require_source_manager(
                session,
                self.principal,
                pub.owner_user_id,
                accounts=self.accounts.for_session(session),
            )
            bind_source(session, pub)
            return CommunityManagement(
                directory=await Directory(session, pub.owner_user_id).tree(pub.knowledge_base_id),
                config=await mutations.config(
                    session,
                    self.principal,
                    pub.knowledge_base_id,
                    pub.owner_user_id,
                    accounts=self.accounts.for_session(session),
                ),
            )

    async def manage(self, id, body):
        async with self.sessions() as session:
            pub = await publication(session, id, active=False)
            return await mutations.publish(
                session,
                self.principal,
                pub.knowledge_base_id,
                body,
                pub.owner_user_id,
                accounts=self.accounts.for_session(session),
            )

    async def settings(self, id, notes):
        return await self.run(mutations.settings, id, notes)

    async def permissions(self, id, body):
        return await self.run(mutations.permissions, id, body)

    async def backlinks(self, id, note, offset, limit):
        return await self.run(content.backlinks, id, note, offset, limit)

    async def snapshot(self, id):
        return await self.run(content.snapshot, id)

    async def favorites(self):
        async with self.sessions() as session:
            return FavoritesOut(
                resource_ids=list(
                    await session.scalars(
                        select(CommunityFavorite.resource_id).where(
                            CommunityFavorite.user_id == self.principal.user_id
                        )
                    )
                )
            )

    async def favorite(self, resource_id, body):
        if resource_id.startswith("community/") and body.favorite:
            await self.directory(resource_id.removeprefix("community/"))
        elif (
            not resource_id.startswith(("official/", "community/"))
            or len(resource_id.split("/")) != 2
        ):
            raise ThoughtError("收藏对象无效", 422, "invalid_resource")
        async with self.sessions() as session:
            await mutations.begin_write(session)
            await session.execute(
                delete(CommunityFavorite).where(
                    CommunityFavorite.user_id == self.principal.user_id,
                    CommunityFavorite.resource_id == resource_id,
                )
            )
            if not body.favorite and resource_id.startswith("community/"):
                pub = await publication(
                    session, resource_id.removeprefix("community/"), active=False
                )
                if pub.is_official:
                    keys = await session.scalars(
                        select(OfficialSource.library_key)
                        .join(ThoughtNote, ThoughtNote.id == OfficialSource.note_id)
                        .where(
                            ThoughtNote.knowledge_base_id == pub.knowledge_base_id,
                            OfficialSource.owner_user_id == pub.owner_user_id,
                        )
                    )
                    await session.execute(
                        delete(CommunityFavorite).where(
                            CommunityFavorite.user_id == self.principal.user_id,
                            CommunityFavorite.resource_id.in_(["official/" + k for k in keys]),
                        )
                    )
            if body.favorite:
                session.add(
                    CommunityFavorite(user_id=self.principal.user_id, resource_id=resource_id)
                )
            await session.commit()
        return await self.favorites()
