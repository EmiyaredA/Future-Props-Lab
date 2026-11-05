"""Cut and upload deterministic, reusable voice lines in bounded batches."""

from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path

from anyio import open_file

from app.capabilities.media_rendering.voice_clips import cut_verified_voice_clip
from fpl_runtime.project_errors import ProjectResourceError

from .upload_intakes import UploadSignature

BATCH_SIZE = 64


@dataclass(frozen=True)
class Clip:
    path: Path
    signature: UploadSignature
    audit: dict


async def cut_batch(source, directory, segments, requirements, prefix, offset):
    result = []
    for index, segment in enumerate(segments, offset + 1):
        path = directory / f"{prefix}-{index:04d}.m4a"
        duration, difference, correlation, checksum = await cut_verified_voice_clip(
            source,
            path,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            max_duration_difference_ms=requirements.max_duration_difference_ms,
            min_content_correlation=requirements.min_content_correlation,
        )
        result.append(
            Clip(
                path=path,
                signature=UploadSignature(path.name, "audio/mp4", path.stat().st_size, checksum),
                audit={
                    "index": index,
                    "segmentId": segment.segment_id,
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "expectedDurationMs": segment.end_ms - segment.start_ms,
                    "encodedDurationMs": duration,
                    "durationDifferenceMs": difference,
                    "contentCorrelation": correlation,
                    "checksumSha256": checksum,
                    "filename": path.name,
                },
            )
        )
    return result


async def save_clips(files, uploads, project_id, clips):
    records = await files.asset_records(project_id, (), newest_first=False)
    by_path = {
        metadata.virtual_path.casefold(): (asset, metadata)
        for asset, metadata in records
        if metadata is not None
    }
    retained, missing = {}, []
    for clip in clips:
        path = f"voice/{clip.path.name}"
        previous = by_path.get(path.casefold())
        if previous is None:
            missing.append(clip)
            continue
        asset, metadata = previous
        if (
            not asset.exists
            or asset.media_kind != "audio"
            or asset.byte_size != clip.signature.byte_size
            or metadata.checksum_sha256 != clip.signature.sha256
        ):
            raise ProjectResourceError(
                f"{path} 已存在但内容不同", "annotation_clip_path_conflict", 409
            )
        retained[clip.path.name] = asset.id
    await files.session.rollback()
    if missing:
        pending, manifest = await uploads.reserve(
            files.projects.owner,
            project_id,
            "voice",
            [clip.signature for clip in missing],
            "annotation",
            assertion=files.assertion,
            source_path=files.source_path,
        )
        async with AsyncExitStack() as stack:
            streams = [
                await stack.enter_async_context(await open_file(clip.path, "rb"))
                for clip in missing
            ]
            items, _ = await uploads.upload(pending, manifest, streams)
        retained.update(
            (clip.path.name, item.id) for clip, item in zip(missing, items, strict=True)
        )
    for clip in clips:
        yield {**clip.audit, "assetId": retained[clip.path.name]}
