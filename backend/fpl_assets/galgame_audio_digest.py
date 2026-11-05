"""Hash the owned library original used by an Annotation import."""

from anyio.to_thread import run_sync

from app.capabilities.asset_store.asset_scope import is_library_asset
from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.galgame_annotation_source import AudioDigest


async def audio_original(session, settings, asset_id):
    asset = await session.get(VisualAsset, asset_id)
    if asset is None or not is_library_asset(asset) or asset.media_kind != "audio":
        raise AssetError("广播剧源音频不可用", code="source_audio_missing", status=404)
    path = AssetStorage(settings).path_for(asset)
    await session.rollback()
    if path.is_symlink() or not path.is_file():
        raise AssetError("广播剧源音频文件不存在", code="source_audio_missing", status=404)
    return path


async def digest_original(path):
    try:
        return AudioDigest(sha256=await run_sync(sha256_file, path))
    except FileNotFoundError as exc:
        raise AssetError("广播剧源音频文件不存在", code="source_audio_missing", status=404) from exc


async def read_digest(session, settings, asset_id):
    return await digest_original(await audio_original(session, settings, asset_id))
