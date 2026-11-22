"""Read-only timeline frame selection for project cards."""

from sqlalchemy import select

from studio.apps.video_editor.storage.models import VideoEditorProject, VideoEditorTimeline
from studio.runtime.project_preview import ProjectPreview, preview_version


def timeline_preview(project_id, document, revision):
    clips = [
        clip
        for track in document.get("tracks", [])
        if not track.get("hidden") and track.get("kind") != "audio"
        for clip in track.get("clips", [])
        if clip.get("kind") != "audio" and clip.get("durationUs", 0) > 0
    ]
    if not clips:
        return None
    clip = min(clips, key=lambda c: (c.get("timelineStartUs", 0), c.get("id", "")))
    time = clip.get("timelineStartUs", 0) + min(1_000_000, clip["durationUs"] // 2)
    url = (
        f"/v1/video-editor/projects/{project_id}/preview/frame"
        f"?revision={revision}&timeUs={time}&width=640&renderVersion=6"
    )
    return ProjectPreview(kind="image", version=preview_version(revision, document), urls=[url])


async def project_previews(session, owner, identities):
    if not identities:
        return {}
    rows = (
        (
            await session.execute(
                select(VideoEditorTimeline)
                .join(VideoEditorProject)
                .where(
                    VideoEditorProject.owner_user_id == owner,
                    VideoEditorTimeline.project_id.in_(identities),
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        row.project_id: timeline_preview(row.project_id, row.document, row.revision) for row in rows
    }
