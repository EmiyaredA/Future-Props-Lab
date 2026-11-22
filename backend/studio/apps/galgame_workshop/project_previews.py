"""Locate the entry fragment's actual stage; never choose unrelated library uploads."""

from sqlalchemy import select

from studio.apps.galgame_workshop.storage.models import GalgameStoryDocument, GalgameWorkshopProject
from studio.runtime.project_preview import ProjectPreview, preview_version, thumbnail_url


def story_preview(document, revision):
    chapters = sorted(document.get("chapters", []), key=lambda item: item.get("order", 0))
    chapter = next(
        (c for c in chapters if c.get("id") == document.get("entryChapterId")),
        chapters[0] if chapters else {},
    )
    fragments = chapter.get("fragments", [])
    fragment = next(
        (f for f in fragments if f.get("id") == chapter.get("entryFragmentId")),
        fragments[0] if fragments else {},
    )
    if not fragment:
        return None
    blocks = fragment.get("blocks", [])
    scenes = {item["id"]: item for item in document.get("scenes", [])}
    urls = []
    time = 500
    for block in blocks:
        if block.get("type") == "scene":
            scene = scenes.get(block.get("sceneId"), {})
            urls = [
                thumbnail_url(layer["assetId"])
                for layer in scene.get("layers", [])
                if layer.get("assetId")
            ][:4]
            if urls:
                time = (
                    (block.get("atMs") or 0)
                    + (block.get("transition") or {}).get("durationMs", 0)
                    + 500
                )
                break
    if not blocks:
        return None
    return ProjectPreview(
        kind="scene",
        version=preview_version(revision, document),
        urls=urls,
        source_revision=revision,
        source_id=fragment["id"],
        source_time=min(time, max(0, fragment["timeline"]["durationMs"] - 1))
        if fragment.get("timeline")
        else time,
        text=document.get("synopsis", "")[:400],
    )


async def project_previews(session, owner, identities):
    if not identities:
        return {}
    rows = (
        await session.scalars(
            select(GalgameStoryDocument)
            .join(GalgameWorkshopProject)
            .where(
                GalgameWorkshopProject.owner_user_id == owner,
                GalgameStoryDocument.project_id.in_(identities),
            )
        )
    ).all()
    return {row.project_id: story_preview(row.document, row.revision) for row in rows}
