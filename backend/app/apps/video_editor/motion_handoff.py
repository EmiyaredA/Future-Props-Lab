"""Public entry for importing a finished motion composition into an editor timeline."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import VideoEditorProjectCreateIn, VideoEditorTimelineBatchIn
from app.apps.video_editor.timeline import VideoEditorTimelines
from app.capabilities.asset_store.library import AssetLibrary
from app.runtime.config import get_settings


async def import_motion_export(
    session: AsyncSession,
    workspace_id: str,
    source: Path,
    *,
    filename: str,
    duration_us: int,
    target_project_id: str | None,
    new_project_title: str | None,
) -> tuple[str, str]:
    """Copy a validated video and append it on a new top visual track."""
    projects = VideoEditorProjects(session, workspace_id)
    created = None
    if target_project_id:
        await projects.row(target_project_id)
        project_id = target_project_id
    else:
        created = await projects.create(
            VideoEditorProjectCreateIn(title=new_project_title or "动效镜头")
        )
        project_id = created.id
    staged: Path | None = None
    try:
        library = AssetLibrary(session, get_settings())
        asset, staged = await library.stage_local_copy(
            source,
            workspace_id=workspace_id,
            filename=filename,
            content_type="video/quicktime" if filename.endswith(".mov") else "video/mp4",
            video_editor_project_id=project_id,
            allowed_extensions={".mov", ".mp4"},
            max_bytes=2 * 1024 * 1024 * 1024,
        )
        session.add(VideoEditorAssetMetadata(asset_id=asset.id, project_id=project_id))
        session.add(
            VideoEditorTask(
                workspace_id=workspace_id,
                project_id=project_id,
                request_id=f"media-{asset.id}",
                kind="media",
                request_payload={"assetId": asset.id},
            )
        )
        await session.flush()
        timeline = await VideoEditorTimelines(session, workspace_id).get(project_id)
        tracks = timeline.document.model_dump(mode="json", by_alias=True)["tracks"]
        track_id = f"motion-{uuid4().hex[:12]}"
        operations = [
            {"type": "reorderTrack", "trackId": track["id"], "order": track["order"] + 1}
            for track in sorted(tracks, key=lambda track: track["order"], reverse=True)
        ]
        operations.extend(
            [
                {
                    "type": "addTrack",
                    "track": {
                        "id": track_id,
                        "kind": "visual",
                        "name": "动效合成",
                        "order": 0,
                        "clips": [],
                    },
                },
                {
                    "type": "addClip",
                    "clip": {
                        "id": f"motion-clip-{uuid4().hex[:12]}",
                        "trackId": track_id,
                        "kind": "video",
                        "name": Path(filename).stem,
                        "timelineStartUs": 0,
                        "durationUs": duration_us,
                        "sourceInUs": 0,
                        "assetId": asset.id,
                        "fitMode": "contain",
                        "transform": {
                            "x": 960,
                            "y": 540,
                            "scaleX": 1,
                            "scaleY": 1,
                            "rotation": 0,
                            "opacity": 1,
                        },
                    },
                },
            ]
        )
        await VideoEditorTimelines(session, workspace_id).apply(
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
