"""Freeze the selected source range and its hashes before dispatching a merge."""

from studio.apps.video_editor.clip_merging.document import render_snapshot
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.storage.service_models import VideoRenderDispatch
from studio.contracts.video_editor.video_exports import (
    MAX_EXPORT_REQUEST_BYTES,
    ExportInput,
    VideoExportRequest,
)
from studio.runtime.ids import new_id


def dispatch_clip_merge(session, task):
    task.id = new_id()
    detail = task.result_detail
    source = detail["source"]
    document = render_snapshot(task.snapshot_document, source)
    stem = "".join(
        char if char not in "/\\" and ord(char) >= 32 else "_" for char in detail["name"]
    )
    stem = stem.encode()[:200].decode(errors="ignore")
    try:
        frozen = VideoExportRequest(
            document=document,
            preset=f"1080p{source['settings']['fps']}",
            start_us=source["startUs"],
            end_us=source["startUs"] + source["durationUs"],
            filename=f"{stem}-{task.id[:8]}.mov",
            files=tuple(
                ExportInput(id=identity, sha256=digest)
                for identity, digest, _revision in detail["sourceAssets"]
            ),
            transparent=True,
        )
        if len(frozen.model_dump_json().encode()) > MAX_EXPORT_REQUEST_BYTES:
            raise ValueError("merge snapshot too large")
    except ValueError:
        raise VideoEditorValidationError(
            "合并源范围或文件摘要无效", code="asset_not_ready"
        ) from None
    session.add(
        VideoRenderDispatch(
            task_id=task.id,
            owner_user_id=task.owner_user_id,
            project_id=task.project_id,
            frozen=frozen.model_dump(mode="json"),
        )
    )
