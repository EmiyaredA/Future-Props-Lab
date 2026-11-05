"""Seal merge proxies before publication and attach them to the existing media reader."""

from shutil import rmtree

from anyio.to_thread import run_sync

from app.capabilities.media_rendering.video_derivatives import prepare_media

from .storage import sync_directory, sync_files
from .video_media_jobs import media_folder


async def seal_variants(job, folder, staging, original, probe):
    variant_stage = staging / "variants"
    variant_stage.mkdir(mode=0o700)
    _, proxy, thumbnail, waveform, _ = await run_sync(
        prepare_media, original, job.id, "video", variant_stage, probe
    )
    await run_sync(sync_files, variant_stage)
    target = folder / "sealed-variants"
    if target.exists():
        await run_sync(rmtree, target)
    variant_stage.rename(target)
    return {"proxy": proxy, "thumbnail": thumbnail, "waveform": waveform}


async def install_variants(settings, job, folder, outputs):
    source = folder / "sealed-variants"
    root = media_folder(settings, job.owner_user_id, job.id)
    target = root / "outputs"
    if source.is_dir():
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        source.rename(target)
        for parent in (root, root.parent, root.parent.parent, folder):
            await run_sync(sync_directory, parent)
    if target.is_symlink() or any(
        not (target / filename).is_file() or (target / filename).is_symlink()
        for filename in outputs.values()
        if filename
    ):
        raise ValueError("合并视频的派生回执与文件不匹配")
