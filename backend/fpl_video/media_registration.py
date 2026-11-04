"""Register a new project original and its processing task in one Video transaction."""

from app.apps.video_editor.models import VideoEditorAssetMetadata, VideoEditorTask
from app.runtime.ids import new_id

from .models import VideoMediaDispatch


def register_media(session, owner, project, asset):
    task_id = new_id()
    metadata = VideoEditorAssetMetadata(asset_id=asset, project_id=project)
    session.add_all(
        (
            metadata,
            VideoMediaDispatch(
                task_id=task_id, owner_user_id=owner, project_id=project, asset_id=asset
            ),
            VideoEditorTask(
                id=task_id,
                owner_user_id=owner,
                project_id=project,
                kind="media",
                request_id=f"media-{asset}",
                request_payload={"assetId": asset},
            ),
        )
    )
    return metadata
