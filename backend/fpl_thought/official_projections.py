"""Reserve empty Assets projections for the shipped, attachment-free package."""

from uuid import uuid4

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.notes import Notes
from fpl_runtime.asset_references import PrepareReferenceChange


class OfficialProjections:
    def __init__(self, *, owner, identity, assertion, source_method, source_path, references):
        self.owner = owner
        self.identity = identity
        self.references = references
        self.source = dict(
            assertion=assertion, source_method=source_method, source_path=source_path
        )
        self.prepared = {}

    async def prepare(self, project_ids, note_ids):
        for kind, ids in (("knowledge-base", project_ids), ("note", note_ids)):
            for resource_id in ids.values():
                self.prepared[kind, resource_id] = await self.references.prepare(
                    owner=self.owner,
                    **self.source,
                    change=PrepareReferenceChange(
                        request_id=uuid4().hex,
                        resource_kind=kind,
                        resource_id=resource_id,
                        expected_resource_revision=-1,
                        asset_ids=[],
                    ),
                )

    async def require_active(self):
        current = await self.identity.status(
            assertion=self.source["assertion"],
            method=self.source["source_method"],
            path=self.source["source_path"],
        )
        if current is None:
            raise ThoughtError("无法确认官方文档导入权限", 503, "authorization_unavailable")
        if not current:
            raise ThoughtError("官方文档导入权限已撤销", 403, "official_forbidden")

    async def record(self, session):
        knowledge, notes = KnowledgeBases(session, self.owner), Notes(session, self.owner)
        for (kind, resource_id), reference in self.prepared.items():
            row = (
                await notes.get(resource_id)
                if kind == "note"
                else await knowledge.get(resource_id, include_deleted=True)
            )
            await self.references.record(session, reference, resource_revision=row.revision)

    async def abort(self, session):
        for reference in self.prepared.values():
            await self.references.abort_after_rollback(session, reference)
