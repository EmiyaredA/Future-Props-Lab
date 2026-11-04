from dataclasses import dataclass

from sqlalchemy import select

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge_tools.models import ThoughtDocumentReference
from app.apps.thought_workshop.knowledge_tools.references import reference_ids, reference_nodes
from app.apps.thought_workshop.multitable.content import project as project_content
from app.apps.thought_workshop.notes import Notes, note_out
from app.apps.thought_workshop.schemas.document import file_ids
from app.apps.thought_workshop.schemas.workshop import ThoughtNotePut
from app.runtime.revisions import RevisionConflictError

from .access import article, bind_source, capabilities, missing, publication
from .catalog import directory as catalog_directory
from .catalog import output, visible
from .models import CommunityUpload
from .mutations import begin_write
from .references import resolve
from .schemas import CommunityNote
from .tables import TableAccess


async def get_note(session, principal, pub_id, note_id):
    pub = await publication(session, pub_id)
    c, n, role = await article(session, principal, pub, note_id)
    rows, _ = await visible(session, principal, pub)
    ids = {row.id for row, _, _ in rows}
    projected = note_out(n).model_copy(
        update={"parent_id": n.parent_id if n.parent_id in ids else None}
    )
    return CommunityNote(note=projected, **capabilities(role), permission_revision=c.revision)


@dataclass(frozen=True)
class NoteEdit:
    owner: str
    publication_revision: int
    article_revision: int
    role: str
    visible_note_ids: frozenset[str]
    body: ThoughtNotePut

    def project(self, value):
        return value.model_copy(
            update={
                "parent_id": value.parent_id if value.parent_id in self.visible_note_ids else None
            }
        )


async def authorize_note_edit(session, principal, pub_id, note_id, body):
    pub = await publication(session, pub_id)
    config, current, role = await article(session, principal, pub, note_id, level="edit")
    validated = body.validated(current)
    # Retaining existing references is allowed; introducing a hidden file or note is not.
    allowed = file_ids(current.document) | set(
        await session.scalars(
            select(CommunityUpload.asset_id).where(
                CommunityUpload.note_id == note_id, CommunityUpload.user_id == principal.user_id
            )
        )
    )
    if not file_ids(validated.document) <= allowed:
        raise missing()
    rows, _ = await visible(session, principal, pub)
    edit = NoteEdit(
        pub.owner_user_id,
        pub.revision,
        config.revision,
        role,
        frozenset(note.id for note, _, _ in rows),
        ThoughtNotePut(**validated.model_dump(), expected_revision=body.expected_revision),
    )
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            current.revision,
            edit.project(note_out(current)).model_dump(mode="json"),
        )
    introduced = reference_ids(validated.document) - reference_ids(current.document)
    if introduced:
        targets = await resolve(session, principal, pub_id, list(introduced))
        if any(not target.available for target in targets):
            raise missing()
    return edit


async def write_note_edit(session, principal, pub_id, note_id, edit):
    bind_source(session, await publication(session, pub_id))
    value = await Notes(session, edit.owner, principal.user_id).put(
        note_id, edit.body, commit=False
    )
    return CommunityNote(
        note=edit.project(value),
        **capabilities(edit.role),
        permission_revision=edit.article_revision,
    )


async def save_note(session, principal, pub_id, note_id, body):
    await begin_write(session)
    edit = await authorize_note_edit(session, principal, pub_id, note_id, body)
    result = await write_note_edit(session, principal, pub_id, note_id, edit)
    await session.commit()
    return result


async def snapshot(session, principal, pub_id):
    pub = await publication(session, pub_id)
    rows, manager = await visible(session, principal, pub, include_content=True)
    if not rows and not manager:
        raise missing()
    ids = {n.id for n, _, _ in rows}
    readable = set(ids)
    for parent, _, _ in rows:
        targets = {
            node["attrs"].get("noteId")
            for node in reference_nodes(parent.document)
            if node["type"] == "multitableView" and node["attrs"].get("noteId")
        }
        for target in targets:
            try:
                _, target_pub, _ = await TableAccess(session, principal).access(
                    pub_id, target, parent.id
                )
            except ThoughtError as error:
                if error.status != 404:
                    raise
                continue
            target_rows, _ = await visible(session, principal, target_pub)
            readable.update(n.id for n, _, _ in target_rows)
    bind_source(session, pub)
    documents = [
        note_out(n)
        .model_copy(
            update={
                "parent_id": n.parent_id if n.parent_id in ids else None,
                "kind": "note",
                "document": await project_content(session, pub.owner_user_id, n, readable=readable),
            }
        )
        .model_dump(mode="json")
        for n, _, _ in rows
    ]
    return {
        "knowledge_base": (await output(session, principal, pub, rows, manager)).model_dump(
            mode="json"
        ),
        "documents": documents,
        "asset_ids": sorted({a for n, _, _ in rows for a in file_ids(n.document)}),
    }


async def backlinks(session, principal, pub_id, note_id, offset, limit):
    pub = await publication(session, pub_id)
    await article(session, principal, pub, note_id)
    d = await catalog_directory(session, principal, pub_id)
    ids = set(
        await session.scalars(
            select(ThoughtDocumentReference.note_id).where(
                ThoughtDocumentReference.target_id == note_id,
                ThoughtDocumentReference.note_id.in_([n.id for n in d.documents]),
            )
        )
    )
    return [n for n in d.documents if n.id in ids][offset : offset + limit]
