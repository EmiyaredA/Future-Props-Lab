from dataclasses import dataclass

from sqlalchemy import select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.models import ThoughtDocumentReference
from studio.apps.thought_workshop.knowledge_tools.references import reference_ids, reference_nodes
from studio.apps.thought_workshop.multitable.content import project as project_content
from studio.apps.thought_workshop.notes import Notes, note_out
from studio.apps.thought_workshop.publication.access import (
    article,
    bind_source,
    capabilities,
    missing,
    publication,
)
from studio.apps.thought_workshop.publication.catalog import directory as catalog_directory
from studio.apps.thought_workshop.publication.catalog import output, visible
from studio.apps.thought_workshop.publication.models import CommunityUpload
from studio.apps.thought_workshop.publication.mutations import begin_write
from studio.apps.thought_workshop.publication.references import resolve
from studio.apps.thought_workshop.publication.schemas import CommunityNote
from studio.apps.thought_workshop.publication.tables import TableAccess
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.schemas.workshop import ThoughtNotePut
from studio.runtime.revisions import RevisionConflictError


async def get_note(session, principal, pub_id, note_id, *, accounts):
    pub = await publication(session, pub_id)
    c, n, role = await article(session, principal, pub, note_id, accounts=accounts)
    rows, _ = await visible(session, principal, pub, accounts=accounts)
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


async def authorize_note_edit(session, principal, pub_id, note_id, body, *, accounts):
    pub = await publication(session, pub_id)
    config, current, role = await article(
        session, principal, pub, note_id, level="edit", accounts=accounts
    )
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
    rows, _ = await visible(session, principal, pub, accounts=accounts)
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
        targets = await resolve(session, principal, pub_id, list(introduced), accounts=accounts)
        if any(not target.available for target in targets):
            raise missing()
    return edit


async def write_note_edit(session, principal, pub_id, note_id, edit, *, assets=None):
    bind_source(session, await publication(session, pub_id))
    value = await Notes(session, edit.owner, principal.user_id, assets=assets).put(
        note_id, edit.body, commit=False
    )
    return CommunityNote(
        note=edit.project(value),
        **capabilities(edit.role),
        permission_revision=edit.article_revision,
    )


async def save_note(session, principal, pub_id, note_id, body, *, accounts, source_assets):
    await begin_write(session)
    edit = await authorize_note_edit(session, principal, pub_id, note_id, body, accounts=accounts)
    result = await write_note_edit(
        session, principal, pub_id, note_id, edit, assets=source_assets(session, edit.owner)
    )
    await session.commit()
    return result


async def snapshot(session, principal, pub_id, *, accounts):
    pub = await publication(session, pub_id)
    rows, manager = await visible(session, principal, pub, include_content=True, accounts=accounts)
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
                _, target_pub, _, _ = await TableAccess(
                    session, principal, accounts=accounts
                ).access(pub_id, target, parent.id)
            except ThoughtError as error:
                if error.status != 404:
                    raise
                continue
            target_rows, _ = await visible(session, principal, target_pub, accounts=accounts)
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
        "knowledge_base": (
            await output(session, principal, pub, rows, manager, accounts=accounts)
        ).model_dump(mode="json"),
        "documents": documents,
        "asset_ids": sorted({a for n, _, _ in rows for a in file_ids(n.document)}),
    }


async def backlinks(session, principal, pub_id, note_id, offset, limit, *, accounts):
    pub = await publication(session, pub_id)
    await article(session, principal, pub, note_id, accounts=accounts)
    d = await catalog_directory(session, principal, pub_id, accounts=accounts)
    ids = set(
        await session.scalars(
            select(ThoughtDocumentReference.note_id).where(
                ThoughtDocumentReference.target_id == note_id,
                ThoughtDocumentReference.note_id.in_([n.id for n in d.documents]),
            )
        )
    )
    return [n for n in d.documents if n.id in ids][offset : offset + limit]
