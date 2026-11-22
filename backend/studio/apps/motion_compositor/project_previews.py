"""Use the same precise composite frame as the editor, without creating an export."""

from sqlalchemy import select

from studio.apps.motion_compositor.storage.models import MotionDocument, MotionProject
from studio.runtime.project_preview import ProjectPreview, preview_version


def composition_preview(project_id, document, revision):
    layers = [
        layer
        for layer in document.get("layers", [])
        if layer.get("visible", True) and layer.get("endFrame", 0) > layer.get("startFrame", 0)
    ]
    if not layers:
        return None
    layer = min(layers, key=lambda item: item.get("startFrame", 0))
    settings = document.get("settings", {})
    frame = layer.get("startFrame", 0) + min(
        settings.get("fps", 30), (layer["endFrame"] - layer.get("startFrame", 0)) // 2
    )
    return ProjectPreview(
        kind="image",
        version=preview_version(revision, document),
        urls=[
            f"/v1/motion-compositor/projects/{project_id}/preview/frame?frame={frame}&revision={revision}"
        ],
    )


async def project_previews(session, owner, identities):
    if not identities:
        return {}
    rows = (
        (
            await session.execute(
                select(MotionDocument)
                .join(MotionProject)
                .where(
                    MotionProject.owner_user_id == owner, MotionDocument.project_id.in_(identities)
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        row.project_id: composition_preview(row.project_id, row.document, row.revision)
        for row in rows
    }
