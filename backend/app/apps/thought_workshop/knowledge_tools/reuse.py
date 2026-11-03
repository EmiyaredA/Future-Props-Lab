"""Independent template snapshots and atomic document-tree copies."""

from copy import deepcopy
from pathlib import Path

from sqlalchemy import delete, select, update

from app.apps.thought_workshop.content_exports import resolve_assets
from app.apps.thought_workshop.directory import Directory
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.history import History
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.apps.thought_workshop.multitable.archive import (
    archive_assets,
    entity_mapping,
    export_tables,
    import_tables,
    remap_embeds,
    remap_state,
)
from app.apps.thought_workshop.multitable.models import DataChange
from app.apps.thought_workshop.multitable.schemas import Snapshot
from app.apps.thought_workshop.multitable.storage import asset_ids, journal, persist, snapshot
from app.apps.thought_workshop.notes import Notes, note_out
from app.apps.thought_workshop.schemas.document import attachment_nodes, file_ids, image_ids
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteIn
from app.capabilities.asset_store.policy import ATTACHMENT_EXTENSIONS
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

from .models import ThoughtTemplate, ThoughtTemplateAsset
from .references import remap_references, validate_targets
from .schemas import DuplicateOut, DuplicateSnapshot, TemplateOut


class ReusableContent:
    def __init__(self, session, owner_user_id, author_id=None):
        self.session, self.owner_user_id, self.author_id = session, owner_user_id, author_id

    async def template(self, id):
        row = await self.session.scalar(
            select(ThoughtTemplate)
            .where(ThoughtTemplate.id == id, ThoughtTemplate.owner_user_id == self.owner_user_id)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ThoughtError("模板不存在", 404, "not_found")
        return row

    async def templates(self):
        return [
            TemplateOut.model_validate(row)
            for row in await self.session.scalars(
                select(ThoughtTemplate)
                .where(ThoughtTemplate.owner_user_id == self.owner_user_id)
                .order_by(ThoughtTemplate.updated_at.desc(), ThoughtTemplate.id)
            )
        ]

    async def validate_template(self, body, existing=None):
        await validate_targets(self.session, self.owner_user_id, body.document, existing)
        ids = file_ids(body.document)
        if body.multitable:
            ids |= asset_ids(body.multitable)
            targets = {
                id
                for t in body.multitable.tables
                for f in t.fields
                if f.type == "note"
                for r in body.multitable.records[t.id]
                for id in r.values.get(f.id, []) or []
            }
            await validate_targets(
                self.session,
                self.owner_user_id,
                {
                    "type": "doc",
                    "content": [
                        {"type": "documentCard", "attrs": {"noteId": id}} for id in targets
                    ],
                },
            )
        assets = await resolve_assets(self.session, self.owner_user_id, ids)
        if any(assets[id].media_kind != "image" for id in image_ids(body.document)):
            raise ThoughtError("画板与图片必须引用图片素材")
        for node in attachment_nodes(body.document):
            row = assets[node["attrs"]["assetId"]]
            if Path(row.original_filename).suffix.lower() not in ATTACHMENT_EXTENSIONS:
                raise ThoughtError("不支持此附件类型")
            node["attrs"] = {
                "assetId": row.id,
                "filename": row.original_filename,
                "mimeType": row.mime_type,
                "byteSize": row.byte_size,
            }
        body.schema_version = 3
        return ids

    async def template_refs(self, id, ids):
        await self.session.execute(
            delete(ThoughtTemplateAsset).where(ThoughtTemplateAsset.template_id == id)
        )
        self.session.add_all(ThoughtTemplateAsset(template_id=id, asset_id=asset) for asset in ids)

    async def create_template(self, body):
        ids = await self.validate_template(body)
        row = ThoughtTemplate(owner_user_id=self.owner_user_id, **body.model_dump())
        self.session.add(row)
        await self.session.flush()
        await self.template_refs(row.id, ids)
        await self.session.commit()
        return TemplateOut.model_validate(row)

    async def template_conflict(self, id, expected):
        await self.session.rollback()
        current = TemplateOut.model_validate(await self.template(id))
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def update_template(self, id, body, *, commit=True):
        row = await self.template(id)
        ids = await self.validate_template(body, row.document)
        result = await self.session.execute(
            update(ThoughtTemplate)
            .where(
                ThoughtTemplate.id == id,
                ThoughtTemplate.owner_user_id == self.owner_user_id,
                ThoughtTemplate.revision == body.expected_revision,
            )
            .values(
                **body.model_dump(exclude={"expected_revision"}),
                revision=body.expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.template_conflict(id, body.expected_revision)
        await self.template_refs(id, ids)
        if commit:
            await self.session.commit()
        return TemplateOut.model_validate(await self.template(id))

    async def delete_template(self, id, expected, *, commit=True):
        await self.template(id)
        result = await self.session.execute(
            delete(ThoughtTemplate).where(
                ThoughtTemplate.id == id,
                ThoughtTemplate.owner_user_id == self.owner_user_id,
                ThoughtTemplate.revision == expected,
            )
        )
        if result.rowcount != 1:
            await self.template_conflict(id, expected)
        if commit:
            await self.session.commit()

    async def apply_template(self, id, body):
        template = await self.template(id)
        ids = file_ids(template.document)
        if template.multitable:
            ids |= asset_ids(Snapshot.model_validate(template.multitable))
        await resolve_assets(self.session, self.owner_user_id, ids)
        guarded = await self.session.execute(
            update(ThoughtTemplate)
            .where(
                ThoughtTemplate.id == id,
                ThoughtTemplate.owner_user_id == self.owner_user_id,
                ThoughtTemplate.revision == body.expected_revision,
            )
            .values(revision=ThoughtTemplate.revision)
        )
        if guarded.rowcount != 1:
            await self.template_conflict(id, body.expected_revision)
        directory = Directory(self.session, self.owner_user_id, self.author_id)
        await directory.reserve(body.knowledge_base_id, body.expected_knowledge_revision)
        await directory.parent(body.knowledge_base_id, body.parent_id)
        row = await Notes(self.session, self.owner_user_id, self.author_id).create(
            ThoughtNoteIn(
                knowledge_base_id=body.knowledge_base_id,
                parent_id=body.parent_id,
                title=body.title,
                kind=template.kind,
                document=deepcopy(template.document),
                tags=template.tags,
                schema_version=3,
            ),
            commit=False,
            importing=True,
        )
        if template.multitable:
            old = await snapshot(self.session, row.id)
            data = {"template": {"state": template.multitable}}
            mapping = entity_mapping(data)
            refs = {
                id: id
                for t in template.multitable["tables"]
                for f in t["fields"]
                if f["type"] == "note"
                for r in template.multitable["records"][t["id"]]
                for id in r["values"].get(f["id"], []) or []
            }
            assets = {id: id for id in asset_ids(Snapshot.model_validate(template.multitable))}
            state = remap_state(template.multitable, mapping, refs, assets)
            await persist(self.session, row.id, old, state)
            # The template is a new document: replace the initial empty checkpoint.
            from_empty = Snapshot(tables=[], records={})
            await self.session.execute(delete(DataChange).where(DataChange.note_id == row.id))
            await journal(self.session, row, from_empty, state, self.author_id, True)
        row.position = (
            max(
                (
                    n.position
                    for n in await directory.siblings(body.knowledge_base_id, body.parent_id)
                ),
                default=-1,
            )
            + 1
        )
        await History(self.session).append(row, self.author_id, "create")
        await self.session.commit()
        return note_out(row)

    async def copy_source(self, id, subtree):
        notes = Notes(self.session, self.owner_user_id, self.author_id)
        root = await notes.get(id)
        if root.deleted_at or root.is_home:
            raise ThoughtError("首页或回收站文档不能复制")
        all_rows = list(
            await self.session.scalars(
                select(ThoughtNote)
                .where(
                    ThoughtNote.owner_user_id == self.owner_user_id,
                    ThoughtNote.knowledge_base_id == root.knowledge_base_id,
                    ThoughtNote.deleted_at.is_(None),
                    ThoughtNote.is_home.is_(False),
                )
                .order_by(ThoughtNote.position, ThoughtNote.id)
            )
        )
        found, rows = {id}, [root]
        if subtree:
            for parent in rows:
                children = [n for n in all_rows if n.parent_id == parent.id and n.id not in found]
                found.update(n.id for n in children)
                rows.extend(children)
        project = await KnowledgeBases(self.session, self.owner_user_id).get(root.knowledge_base_id)
        return project, rows

    async def copy_snapshot(self, id, subtree):
        project, rows = await self.copy_source(id, subtree)
        return DuplicateSnapshot(
            knowledge_revision=project.revision, revisions={row.id: row.revision for row in rows}
        )

    async def duplicate(self, id, body):
        project, source = await self.copy_source(id, body.subtree)
        current = {row.id: row.revision for row in source}
        if current != body.expected_revisions or project.revision != body.source_knowledge_revision:
            raise RevisionConflictError(
                body.source_knowledge_revision,
                project.revision,
                DuplicateSnapshot(
                    knowledge_revision=project.revision, revisions=current
                ).model_dump(),
            )
        table_data = await export_tables(self.session, source)
        ids = archive_assets(table_data)
        ids.update(asset for row in source for asset in file_ids(row.document))
        await resolve_assets(self.session, self.owner_user_id, ids)
        guard = await self.session.execute(
            update(ThoughtKnowledgeBase)
            .where(
                ThoughtKnowledgeBase.id == project.id,
                ThoughtKnowledgeBase.owner_user_id == self.owner_user_id,
                ThoughtKnowledgeBase.revision == body.source_knowledge_revision,
            )
            .values(revision=ThoughtKnowledgeBase.revision)
        )
        if guard.rowcount != 1:
            await self.session.rollback()
            latest = await self.copy_snapshot(id, body.subtree)
            raise RevisionConflictError(
                body.source_knowledge_revision, latest.knowledge_revision, latest.model_dump()
            )
        for row in source:
            guarded = await self.session.execute(
                update(ThoughtNote)
                .where(
                    ThoughtNote.id == row.id,
                    ThoughtNote.owner_user_id == self.owner_user_id,
                    ThoughtNote.revision == current[row.id],
                )
                .values(revision=ThoughtNote.revision)
            )
            if guarded.rowcount != 1:
                await Notes(self.session, self.owner_user_id).conflict(row.id, current[row.id])
        directory = Directory(self.session, self.owner_user_id, self.author_id)
        await directory.reserve(body.knowledge_base_id, body.expected_knowledge_revision)
        await directory.parent(body.knowledge_base_id, body.parent_id)
        mapping = {row.id: new_id() for row in source}
        siblings = await directory.siblings(body.knowledge_base_id, body.parent_id)
        position = max((n.position for n in siblings), default=-1) + 1
        table_mapping = entity_mapping(table_data)
        created = []
        for row in source:
            document = remap_references(row.document, mapping)
            remap_embeds(document, table_mapping)
            new = await Notes(self.session, self.owner_user_id, self.author_id).create(
                ThoughtNoteIn(
                    knowledge_base_id=body.knowledge_base_id,
                    parent_id=body.parent_id if row.id == id else mapping[row.parent_id],
                    title=row.title[:230] + "（副本）" if row.id == id else row.title,
                    kind=row.kind,
                    document=document,
                    tags=list(row.tags),
                    schema_version=3,
                ),
                commit=False,
                importing=True,
                note_id=mapping[row.id],
            )
            new.position = position if row.id == id else row.position
            await History(self.session).append(new, self.author_id, "create")
            created.append(new.id)
        asset_mapping = {id: id for id in archive_assets(table_data)}
        # Retain references to documents outside the copied subtree in this account.
        refs = dict(mapping)
        for value in table_data.values():
            for t in value["state"]["tables"]:
                for f in t["fields"]:
                    if f["type"] == "note":
                        for r in value["state"]["records"][t["id"]]:
                            for target in r["values"].get(f["id"], []) or []:
                                refs.setdefault(target, target)
        await import_tables(self.session, table_data, refs, asset_mapping, table_mapping)
        await self.session.commit()
        return DuplicateOut(
            root_id=mapping[id], note_ids=created, knowledge_base_id=body.knowledge_base_id
        )
