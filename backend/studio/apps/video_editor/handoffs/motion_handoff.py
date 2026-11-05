"""Public entry for importing a finished motion composition into an editor timeline."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.video_editor.motion_operations import motion_operations
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import VideoEditorProjectCreateIn, VideoEditorTimelineBatchIn
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask
from studio.apps.video_editor.timeline import VideoEditorTimelines
from studio.config.settings import Settings


async def import_motion_export(
    session: AsyncSession,
    owner_user_id: str,
    source: Path,
    *,
    settings: Settings,
    filename: str,
    duration_us: int,
    target_project_id: str | None,
    new_project_title: str | None,
) -> tuple[str, str]:
    """Copy a validated video and append it on a new top visual track."""
    projects = VideoEditorProjects(session, owner_user_id)
    created = None
    if target_project_id:
        await projects.row(target_project_id)
        project_id = target_project_id
    else:
        created = await projects.create(
            VideoEditorProjectCreateIn(title=new_project_title or "特效镜头")
        )
        project_id = created.id
    staged: Path | None = None
    try:
        library = AssetLibrary(session, settings)
        asset, staged = await library.stage_local_copy(
            source,
            owner_user_id=owner_user_id,
            filename=filename,
            content_type="video/quicktime" if filename.endswith(".mov") else "video/mp4",
            video_editor_project_id=project_id,
            allowed_extensions={".mov", ".mp4"},
            max_bytes=2 * 1024 * 1024 * 1024,
        )
        session.add(VideoEditorAssetMetadata(asset_id=asset.id, project_id=project_id))
        session.add(
            VideoEditorTask(
                owner_user_id=owner_user_id,
                project_id=project_id,
                request_id=f"media-{asset.id}",
                kind="media",
                request_payload={"assetId": asset.id},
            )
        )
        await session.flush()
        timeline = await VideoEditorTimelines(session, owner_user_id).get(project_id)
        operations = motion_operations(
            timeline.document.model_dump(mode="json", by_alias=True),
            asset_id=asset.id,
            filename=filename,
            duration_us=duration_us,
            track_id=f"motion-{uuid4().hex[:12]}",
            clip_id=f"motion-clip-{uuid4().hex[:12]}",
        )
        await VideoEditorTimelines(session, owner_user_id).apply(
            project_id,
            VideoEditorTimelineBatchIn.model_validate(
                {
                    "expectedRevision": timeline.revision,
                    "requestId": f"motion-handoff-{uuid4().hex}",
                    "operations": operations,
                }
            ),
        )
        return project_id, asset.id
    except Exception:
        await session.rollback()
        if staged is not None:
            staged.unlink(missing_ok=True)
        if created is not None:
            await projects.delete(created.id, created.revision)
        raise
