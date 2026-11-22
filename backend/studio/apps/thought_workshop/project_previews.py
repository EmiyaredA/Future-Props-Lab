"""Project cards derive from the latest live document, without editing its content."""

from sqlalchemy import func, select

from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.runtime.project_preview import ProjectPreview, preview_version, thumbnail_url


def note_preview(title, document, text, revision):
    pending = [document]
    images = []
    while pending and len(images) < 4:
        node = pending.pop()
        if not isinstance(node, dict):
            continue
        if node.get("type") == "image" and node.get("attrs", {}).get("assetId"):
            images.append(thumbnail_url(node["attrs"]["assetId"]))
        pending.extend(reversed(node.get("content", [])))
    return ProjectPreview(
        kind="image" if images else "text",
        version=preview_version(revision, title, images, text[:400]),
        urls=images,
        label=title[:160],
        text=text[:400],
    )


async def project_previews(session, owner, identities):
    if not identities:
        return {}
    latest = (
        select(
            ThoughtNote.id,
            func.row_number()
            .over(
                partition_by=ThoughtNote.knowledge_base_id,
                order_by=(ThoughtNote.updated_at.desc(), ThoughtNote.id),
            )
            .label("rank"),
        )
        .where(
            ThoughtNote.owner_user_id == owner,
            ThoughtNote.knowledge_base_id.in_(identities),
            ThoughtNote.deleted_at.is_(None),
        )
        .subquery()
    )
    rows = (
        await session.scalars(
            select(ThoughtNote)
            .join(latest, ThoughtNote.id == latest.c.id)
            .where(latest.c.rank == 1)
        )
    ).all()
    return {
        row.knowledge_base_id: note_preview(row.title, row.document, row.search_text, row.revision)
        for row in rows
    }
