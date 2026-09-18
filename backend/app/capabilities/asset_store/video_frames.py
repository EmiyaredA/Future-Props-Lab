import asyncio
import shutil
import tempfile
import zipfile
from pathlib import Path

from sqlalchemy import select

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.image_grid import render_image_grid
from app.capabilities.media_rendering.video_frames import extract_frame
from app.models import VisualAsset
from app.runtime.config import get_settings


async def export_frames(session, workspace_id, asset_id, body):
    asset = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id,
            VisualAsset.workspace_id == workspace_id,
        )
    )
    if asset is None:
        raise AssetError("视频文件不存在", code="not_found", status=404)
    if asset.media_kind != "video":
        raise AssetError("逐帧提取只支持视频文件")
    source = AssetStorage(get_settings()).path_for(asset)
    await session.rollback()
    directory = Path(tempfile.mkdtemp(prefix="video-frames-"))
    paths = []
    try:
        for index, position in enumerate(body.positions_ms):
            path = directory / f"frame-{index + 1:02}-{position}ms.png"
            await extract_frame(source, path, position, body.max_width)
            paths.append(path)
        if body.output == "grid":
            result = directory / "frames.png"
            await asyncio.to_thread(
                render_image_grid,
                paths,
                [str(ms) + " ms" for ms in body.positions_ms],
                result,
                len(paths),
            )
        else:
            result = directory / "frames.zip"
            with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in paths:
                    archive.write(path, path.name)
        return result
    except (ValueError, FileNotFoundError, TimeoutError) as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise AssetError("视频帧提取失败：" + str(exc)) from exc
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
