"""Encode and transmit one sealed, ordered Video segment group."""

import asyncio
from functools import partial
from threading import Event

import httpx
from anyio import open_file
from anyio.to_thread import run_sync

from app.capabilities.media_rendering.render_engine import RenderCancelled
from app.capabilities.media_rendering.video_derivatives import probe_media
from app.capabilities.media_rendering.video_segment_encode import (
    encode_segment,
    validate_segment_output,
)
from studio.contracts.video_editor.video_exports import RenderedSegment
from studio.contracts.video_editor.video_segments import (
    OUTPUTS,
    PublishedSegment,
    SegmentBatchManifest,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityUnavailable


def segment_path(folder, index):
    return folder / f"segment-{index + 1:03d}.mp4"


async def _encode(runner, job, work):
    cancel = Event()

    async def watch():
        while not cancel.is_set():
            await asyncio.sleep(0.25)
            try:
                if not await runner.authorized(job):
                    cancel.set()
            except CapabilityUnavailable:
                continue

    watcher = asyncio.create_task(watch())
    try:
        await run_sync(partial(work, cancel_event=cancel))
    finally:
        cancel.set()
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def encode_group(runner, job, request, sources, folder):
    probes = {identity: await run_sync(probe_media, path) for identity, path in sources.items()}
    descriptors, output_probes = [], []
    for index, item in enumerate(request.segments):
        if not await runner.authorized(job):
            raise RenderCancelled("分段导出已取消")
        output = segment_path(folder, index)
        source_probe = probes[item.asset_id]
        await _encode(
            runner,
            job,
            partial(
                encode_segment,
                sources[item.asset_id],
                output,
                source_in_us=item.source_in_us,
                duration_us=item.duration_us,
                playback_rate=item.playback_rate,
                resolution=item.resolution,
                fps=item.fps,
                quality=item.quality,
                audio_mode=item.audio_mode,
                probe=source_probe,
            ),
        )
        probe = await run_sync(probe_media, output)
        validate_segment_output(probe, source_probe, {"audioMode": item.audio_mode})
        output_probes.append(probe)
        descriptors.append(
            await run_sync(ModelOutputDescription.from_file, output, item.filename, "video/mp4")
        )
        await runner.set_state(
            job, "running", progress=max(1, round((index + 1) / len(request.segments) * 85))
        )
    return SegmentBatchManifest(
        files=tuple(descriptors),
        target=request.target,
        labels=tuple(item.label for item in request.segments) if request.target else None,
    ), output_probes


class SegmentOutputs:
    def __init__(self, client, peer):
        self.client, self.peer = client, peer

    @staticmethod
    def path(job, manifest):
        return f"{OUTPUTS}/{job.project_id}/{job.id}/{manifest.digest}"

    async def lookup(self, job, manifest):
        path = self.path(job, manifest)
        return await self.client.get(
            "http://assets:8080" + path,
            headers=self.peer.headers("GET", path, job.owner_user_id),
        )

    async def publish(self, job, manifest, folder):
        path = self.path(job, manifest)
        encoded = manifest.encoded

        async def stream():
            yield encoded
            for index in range(len(manifest.files)):
                async with await open_file(segment_path(folder, index), "rb") as handle:
                    while chunk := await handle.read(1024 * 1024):
                        yield chunk

        return await self.client.post(
            "http://assets:8080" + path,
            content=stream(),
            headers={
                **self.peer.headers("POST", path, job.owner_user_id),
                "Content-Length": str(len(encoded) + manifest.byte_size),
                "X-Fpl-Manifest-Length": str(len(encoded)),
            },
            timeout=httpx.Timeout(600, connect=5),
        )

    async def discard(self, job, manifest):
        path = self.path(job, manifest)
        result = await self.client.delete(
            "http://assets:8080" + path,
            headers=self.peer.headers("DELETE", path, job.owner_user_id),
        )
        result.raise_for_status()
        if result.json().get("state") != "discarded":
            raise ValueError("分段暂存清理尚未确认")

    @staticmethod
    def result(response, manifest, probes):
        files = [PublishedSegment.model_validate(value) for value in response.json()["items"]]
        results = []
        for file, descriptor, probe in zip(files, manifest.files, probes, strict=True):
            if (
                file.asset.byte_size != descriptor.byte_size
                or file.asset.original_filename != descriptor.filename
                or file.asset.media_kind != "video"
                or file.sha256 != descriptor.content_sha256
            ):
                raise ValueError("分段文件回执不符")
            results.append(RenderedSegment(asset=file.asset, sha256=file.sha256, probe=probe))
        return results
