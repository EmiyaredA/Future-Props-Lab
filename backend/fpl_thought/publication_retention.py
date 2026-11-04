"""Retain the published cover independently of the current private library cover."""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.publication.access import publication
from app.apps.thought_workshop.publication.catalog import output
from app.apps.thought_workshop.publication.models import Publication
from app.apps.thought_workshop.publication.mutations import publish
from app.apps.thought_workshop.publication.sessions import source_sessions
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from fpl_runtime.asset_references import PrepareReferenceChange


@dataclass
class RetainedPublication:
    publication_id: str
    revision: int
    cover: str | None
    references: object
    prepared: object
    settling: bool = False

    def verify(self, source, publication):
        if (
            (publication.id if publication else self.publication_id) != self.publication_id
            or (publication.revision if publication else -1) != self.revision
            or source.cover_asset_id != self.cover
        ):
            raise ThoughtError("发布配置或封面已更新，请重新打开后保存", 409, "revision_conflict")

    async def record(self, session, publication):
        await self.references.record(session, self.prepared, resource_revision=publication.revision)
        self.settling = True


async def publish_with_references(
    request_session,
    principal,
    body,
    *,
    assertion,
    source_method,
    source_path,
    references,
    library_id=None,
    publication_id=None,
):
    owner = principal.user_id
    async with source_sessions(request_session)(
        info={
            **request_session.info,
            "owner_user_id": owner,
            "allow_system_reads": True,
        }
    ) as session:
        if publication_id is not None:
            pub = await publication(session, publication_id, active=False)
            library_id = pub.knowledge_base_id
        else:
            pub = await session.scalar(
                select(Publication).where(
                    Publication.knowledge_base_id == library_id,
                    Publication.owner_user_id == owner,
                )
            )
        library = await KnowledgeBases(session, owner).get(library_id)
        if pub and pub.owner_user_id != owner:
            raise ThoughtError("内容不存在或不可访问", 404, "not_found")
        if pub and pub.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                pub.revision,
                (await output(session, principal, pub)).model_dump(mode="json"),
            )
        if pub is None and body.expected_revision != 0:
            raise ThoughtError("发布配置版本已变化", 409, "revision_conflict")
        identity, revision = (pub.id, pub.revision) if pub else (new_id(), -1)
        cover = library.cover_asset_id
        await session.rollback()
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="publication",
            resource_id=identity,
            expected_resource_revision=revision,
            asset_ids=[cover] if cover else [],
        )
        prepared = await references.prepare(
            owner=owner,
            assertion=assertion,
            source_method=source_method,
            source_path=source_path,
            change=change,
        )
        retained = RetainedPublication(identity, revision, cover, references, prepared)
        try:
            return await publish(session, principal, library_id, body, owner, retained=retained)
        except BaseException:
            if not retained.settling:
                await session.rollback()
                await references.abort_after_rollback(session, prepared)
            raise
