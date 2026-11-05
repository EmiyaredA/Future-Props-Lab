"""Build an owned ZIP from the batch receipt and verify the archived bytes."""

import asyncio
import hashlib
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_STORED, ZipFile

from sqlalchemy import select

from app.capabilities.asset_store.asset_scope import is_library_asset
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.storage.service_models import VideoFileWriteReceipt
from studio.apps.asset_library.video.video_segment_handoffs import SegmentHandoffFiles
from studio.contracts.video_editor.video_segments import PublishedSegment, segment_receipt_id


def missing():
    return AssetError("部分分段导出文件不存在", code="not_found", status=404)


def bundle_root(settings):
    root = settings.runtime_path.resolve() / ".video-segment-bundles"
    if root.is_symlink():
        raise ValueError("分段归档暂存目录无效")
    root.mkdir(mode=0o700, exist_ok=True)
    return root


def cleanup_bundles(settings):
    for path in bundle_root(settings).glob("video-segments-*.zip"):
        path.unlink(missing_ok=True)


def _archive(directory, entries):
    with NamedTemporaryFile(
        dir=directory, prefix="video-segments-", suffix=".zip", delete=False
    ) as handle:
        target = Path(handle.name)
    try:
        with ZipFile(target, "w", compression=ZIP_STORED) as bundle:
            for path, filename, expected, size in entries:
                digest, actual = hashlib.sha256(), 0
                with (
                    path.open("rb") as source,
                    bundle.open(filename, "w", force_zip64=True) as member,
                ):
                    while chunk := source.read(1024 * 1024):
                        actual += len(chunk)
                        if actual > size:
                            raise missing()
                        digest.update(chunk)
                        member.write(chunk)
                if actual != size or digest.hexdigest() != expected:
                    raise missing()
        return target
    except BaseException:
        target.unlink(missing_ok=True)
        raise


async def build_bundle(database, settings, owner, project, task):
    try:
        receipt_id = segment_receipt_id(task)
    except ValueError:
        raise missing() from None
    storage = AssetStorage(settings)
    async with database.sessions(info={"owner_user_id": owner}) as session:
        receipt = await session.get(VideoFileWriteReceipt, (owner, receipt_id))
        if receipt is None:
            handoff = SegmentHandoffFiles(database, settings)
            result = await handoff.archived(session, owner, receipt_id, project)
        elif receipt.project_id == project:
            result = receipt.result
        else:
            result = None
        if not result:
            raise missing()
        items = [PublishedSegment.model_validate(item) for item in result]
        ids = {item.asset.id for item in items}
        library = {item.asset.id for item in items if receipt is None or item.library}
        rows = await session.scalars(select(VisualAsset).where(VisualAsset.id.in_(ids)))
        paths = {
            row.id: storage.path_for(row)
            for row in rows
            if (
                is_library_asset(row)
                if row.id in library
                else row.video_editor_project_id == project
            )
        }
    if paths.keys() != ids:
        raise missing()
    entries = []
    for index, item in enumerate(items, 1):
        asset = item.asset
        path = paths[asset.id]
        if path.is_symlink() or not path.resolve().is_relative_to(settings.runtime_path.resolve()):
            raise missing()
        entries.append(
            (path, f"{index:03d}_{asset.original_filename}", item.sha256, asset.byte_size)
        )
    worker = asyncio.create_task(asyncio.to_thread(_archive, bundle_root(settings), entries))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        path = await worker
        path.unlink(missing_ok=True)
        raise
    except FileNotFoundError:
        raise missing() from None
    except OSError as exc:
        raise AssetError(
            "分段归档暂不可用", code="segment_archive_unavailable", status=503
        ) from exc
