from __future__ import annotations

import asyncio
import re
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_STORED, ZipFile

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.library import AssetError
from app.files.storage import AssetStorage
from app.models import VisualAsset
from app.video_editor.errors import VideoEditorNotFoundError
from app.video_editor.segment_exports import VideoEditorSegmentExports


def segment_filename(name: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", name).strip(" .")
    # Leave room for the extension and ZIP sequence prefix on UTF-8 filesystems.
    safe = safe.encode("utf-8")[:200].decode("utf-8", errors="ignore") or "片段"
    return f"{safe}.mp4"


def _archive(entries: list[tuple[Path, str]]) -> Path:
    with NamedTemporaryFile(prefix="video-segments-", suffix=".zip", delete=False) as file:
        path = Path(file.name)
    try:
        with ZipFile(path, "w", compression=ZIP_STORED) as archive:
            for source, name in entries:
                archive.write(source, name)
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


async def download_segments(
    session: AsyncSession,
    settings: Settings,
    workspace_id: str,
    project_id: str,
    task_id: str,
) -> Path:
    task = await VideoEditorSegmentExports(session, workspace_id).get(project_id, task_id)
    if task.status != "completed":
        raise AssetError("分段导出尚未完成", code="export_not_ready", status=409)
    segments = task.result_detail.get("segments", [])
    if not segments or any(item.get("status") != "completed" for item in segments):
        raise VideoEditorNotFoundError("分段导出文件不存在")
    ids = {item.get("assetId") for item in segments}
    assets = list(
        (
            await session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids), VisualAsset.workspace_id == workspace_id
                )
            )
        ).all()
    )
    by_id = {asset.id: asset for asset in assets}
    if set(by_id) != ids:
        raise VideoEditorNotFoundError("部分分段导出文件不存在")
    storage = AssetStorage(settings)
    entries = [
        (
            storage.path_for(by_id[item["assetId"]]),
            f"{index:03d}_{segment_filename(str(item.get('name') or '片段'))}",
        )
        for index, item in enumerate(segments, 1)
    ]
    if any(not path.is_file() for path, _ in entries):
        raise VideoEditorNotFoundError("部分分段导出文件不存在")
    # The response owns cleanup after this worker has finished, even on cancellation.
    worker = asyncio.create_task(asyncio.to_thread(_archive, entries))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        path = await worker
        path.unlink(missing_ok=True)
        raise
    except FileNotFoundError:
        raise VideoEditorNotFoundError("部分分段导出文件不存在") from None
