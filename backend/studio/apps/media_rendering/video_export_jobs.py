"""Render Video movies and recover the publication of each sealed output once."""

import asyncio
from dataclasses import asdict
from functools import partial
from pathlib import Path
from shutil import rmtree
from tempfile import TemporaryDirectory
from threading import Event
from uuid import UUID

import httpx
from anyio.to_thread import run_sync
from sqlalchemy import select, text, update

from app.capabilities.media_rendering.chroma_key import bake_image
from app.capabilities.media_rendering.render_engine import RenderCancelled, render_document
from app.capabilities.media_rendering.timeline_document import (
    VideoEditorChromaKey,
    parse_timeline_document,
)
from app.capabilities.media_rendering.video_derivatives import probe_media
from app.capabilities.media_rendering.video_output import (
    verify_clip_merge_output,
    verify_video_output,
)
from studio.apps.media_rendering.storage.file_paths import sync_directory, sync_files
from studio.apps.media_rendering.storage.service_models import VideoExportJob, VideoMediaJob
from studio.contracts.video_editor.video_assets import VideoAsset
from studio.contracts.video_editor.video_exports import (
    MAX_EXPORT_INPUT_BYTES,
    VIDEO_WORK,
    VideoExportReceipt,
    VideoImageBakeRequest,
    VideoSegmentRequest,
)
from studio.contracts.video_editor.video_segment_handoff import SegmentHandoff
from studio.contracts.video_editor.video_segments import SegmentBatchManifest
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner

from .video_export_variants import install_variants, seal_variants
from .video_originals import download_original
from .video_outputs import VideoOutputs
from .video_segment_work import SegmentOutputs, encode_group


class VideoExports(PollingTaskRunner):
    runner_name = "rendering-video-exports"
    poll_interval_seconds = 1

    def __init__(self, *, database, settings, identity, client, originals, outputs):
        super().__init__()
        self.database, self.settings, self.identity = database, settings, identity
        self.client, self.originals = client, originals
        self.outputs = VideoOutputs(client, outputs)
        self.segment_outputs = SegmentOutputs(client, outputs)

    def session(self, owner):
        return self.database.sessions(info={"owner_user_id": owner})

    def folder(self, owner, job_id):
        account = self.settings.account_path(owner)
        folder = account / "video-exports" / job_id
        if folder.is_symlink() or not folder.resolve().is_relative_to(account):
            raise ValueError("剪辑成片暂存目录无效")
        return folder

    async def load(self, owner, job_id):
        async with self.session(owner) as session:
            return await session.get(VideoExportJob, (owner, job_id))

    @staticmethod
    def receipt(job):
        published = job.status == "completed"
        group = published and "segments" in job.sealed_output
        single = published and not group
        return VideoExportReceipt(
            status="running" if job.status == "publishing" else job.status,
            progress=job.progress,
            probe=job.probe,
            fingerprint=job.sealed_output["content_sha256"] if single else None,
            output=job.result if single else None,
            segments=job.result["segments"] if group else [],
            handoff=job.result.get("handoff") if group else None,
            variants=job.sealed_output.get("variants", {}) if single else {},
            error=job.error,
        )

    async def enqueue(self, owner, job_id, project, digest, payload):
        async with self.session(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VideoExportJob, (owner, job_id))
            if row is None:
                row = VideoExportJob(
                    owner_user_id=owner,
                    id=job_id,
                    project_id=project,
                    request_sha256=digest,
                    payload=payload.model_dump(mode="json"),
                )
                session.add(row)
                await session.commit()
            elif (row.project_id, row.request_sha256) != (project, digest):
                raise ValueError("剪辑成片任务请求已变化")
            return self.receipt(row)

    async def set_state(self, job, expected, **changes):
        query = update(VideoExportJob).where(
            VideoExportJob.id == job.id, VideoExportJob.status == expected
        )
        if changes.get("status") == "publishing":
            query = query.where(VideoExportJob.cancel_requested.is_(False))
        async with self.session(job.owner_user_id) as session:
            result = await session.execute(query.values(**changes))
            await session.commit()
            return result.rowcount == 1

    async def cancel(self, job):
        if job.status == "queued":
            return await self.set_state(job, "queued", status="cancelled", progress=0)
        if job.status in {"running", "publishing"}:
            return await self.set_state(job, job.status, cancel_requested=True)
        return True

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            interrupted = (
                await session.scalars(
                    select(VideoExportJob).where(VideoExportJob.status == "running")
                )
            ).all()
        for job in interrupted:
            await self.set_state(job, "running", status="queued", progress=0)

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            job = await session.scalar(
                select(VideoExportJob)
                .where(VideoExportJob.status.in_(("queued", "publishing")))
                .order_by(VideoExportJob.created_at, VideoExportJob.id)
                .limit(1)
            )
        if job is None:
            return
        if job.status == "queued":
            await self.render(job)
        else:
            await self.publish(job)

    async def authorized(self, job):
        current = await self.load(job.owner_user_id, job.id)
        if current is None or current.cancel_requested:
            return False
        authority = await self.identity.owner_permission(
            owner=job.owner_user_id, permission="content.write"
        )
        if not authority["available"]:
            raise CapabilityUnavailable("剪辑成片授权暂不可用")
        return authority["allowed"]

    async def inputs(self, job, request, staging):
        paths, total = {}, 0
        for entry in request.files:
            if not await self.authorized(job):
                raise RenderCancelled("剪辑成片已取消")
            file = staging / entry.id
            original = await download_original(
                self.client,
                self.originals,
                owner=job.owner_user_id,
                project=job.project_id,
                asset=entry.id,
                target=file,
                max_bytes=MAX_EXPORT_INPUT_BYTES - total,
            )
            total += original.byte_size
            descriptor = await run_sync(
                ModelOutputDescription.from_file, file, "source.bin", "application/octet-stream"
            )
            if descriptor.content_sha256 != entry.sha256:
                raise ValueError("剪辑原件内容已变化")
            paths[entry.id] = file
        return paths

    async def encode(self, job, request, document, sources, output):
        stop = Event()
        loop = asyncio.get_running_loop()
        progress = 1

        def report(value):
            nonlocal progress
            progress = max(progress, min(int(value), 97))

        async def watch():
            while not stop.is_set():
                await asyncio.sleep(0.5)
                try:
                    if not await self.authorized(job):
                        stop.set()
                    else:
                        await self.set_state(job, "running", progress=progress)
                except CapabilityUnavailable:
                    # The final authority check fails closed. Transient Identity
                    # failures do not discard an in-progress deterministic encode.
                    continue

        watcher = asyncio.create_task(watch())
        try:
            await run_sync(
                partial(
                    render_document,
                    document,
                    sources,
                    output,
                    preset=request.preset,
                    start_us=request.start_us,
                    end_us=request.end_us,
                    cancel=stop,
                    progress=lambda value: loop.call_soon_threadsafe(report, value),
                    transparent=request.transparent,
                )
            )
        finally:
            stop.set()
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

    async def render(self, job):
        if not await self.set_state(job, "queued", status="running", progress=1):
            return
        folder = self.folder(job.owner_user_id, job.id)
        try:
            if not await self.authorized(job):
                raise RenderCancelled("剪辑成片已取消")
            request = VIDEO_WORK.validate_python(job.payload)
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            with TemporaryDirectory(dir=folder, prefix="encode-") as temporary:
                staging = Path(temporary)
                originals = staging / "inputs"
                originals.mkdir()
                sources = await self.inputs(job, request, originals)
                target = folder / "sealed"
                if target.exists():
                    await run_sync(rmtree, target)
                target.mkdir()
                if isinstance(request, VideoSegmentRequest):
                    manifest, probes = await encode_group(self, job, request, sources, target)
                    probe = {"segments": probes}
                    sealed = {"segments": manifest.model_dump(mode="json")}
                else:
                    output, mime, probe, variants = await self.prepare_output(
                        job, request, folder, staging, sources
                    )
                    descriptor = await run_sync(
                        ModelOutputDescription.from_file, output, request.filename, mime
                    )
                    output.rename(target / output.name)
                    sealed = {**asdict(descriptor), "variants": variants}
                if not await self.authorized(job):
                    raise RenderCancelled("剪辑成片已取消")
                await run_sync(sync_files, target)
                for parent in (folder, folder.parent, folder.parent.parent):
                    await run_sync(sync_directory, parent)
                if not await self.set_state(
                    job,
                    "running",
                    status="publishing",
                    progress=98,
                    probe=probe,
                    sealed_output=sealed,
                ):
                    raise RenderCancelled("剪辑成片已取消")
        except RenderCancelled:
            await self.set_state(job, "running", status="cancelled", progress=0)
            await run_sync(lambda: rmtree(folder, ignore_errors=True))
        except CapabilityUnavailable:
            await self.set_state(job, "running", status="queued", progress=0)
            raise
        except Exception:
            await self.set_state(job, "running", status="failed", error="剪辑成片渲染失败")
            await run_sync(lambda: rmtree(folder, ignore_errors=True))

    async def prepare_output(self, job, request, folder, staging, sources):
        if isinstance(request, VideoImageBakeRequest):
            output = staging / "movie.png"
            chroma = VideoEditorChromaKey.model_validate(request.image_bake)
            probe = await run_sync(bake_image, sources[request.files[0].id], output, chroma)
            return output, "image/png", probe, {}
        document = parse_timeline_document(request.document)
        suffix, mime = (".mov", "video/quicktime") if request.transparent else (".mp4", "video/mp4")
        output = staging / ("movie" + suffix)
        await self.encode(job, request, document, sources, output)
        verify = verify_clip_merge_output if request.transparent else verify_video_output
        if request.video_bake:
            probe = await run_sync(probe_media, output)
        else:
            probe = await run_sync(
                verify, output, request.preset, request.end_us - request.start_us
            )
        variants = (
            await seal_variants(job, folder, staging, output, probe) if request.transparent else {}
        )
        return output, mime, probe, variants

    async def deliver_artifact(self, job, lookup, send, discard=None):
        response = await lookup()
        if response.status_code == 404:
            if not await self.authorized(job):
                if discard is not None:
                    await discard()
                await self.set_state(job, "publishing", status="cancelled", progress=0)
                return None
            response = await send()
        if response.status_code == 401:
            if discard is not None:
                await discard()
            await self.set_state(job, "publishing", status="cancelled", progress=0)
            return None
        if response.status_code in {403, 404, 409, 413, 422}:
            if discard is not None:
                await discard()
            await self.set_state(job, "publishing", status="failed", error="成片原件发布被拒绝")
            return None
        response.raise_for_status()
        return response

    async def publish(self, job):
        folder = self.folder(job.owner_user_id, job.id)
        sealed = dict(job.sealed_output)
        try:
            if "segments" in sealed:
                await self.publish_group(job, folder, sealed)
            else:
                await self.publish_single(job, folder, sealed)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise CapabilityUnavailable("剪辑成片发布回执尚未确认") from exc
        await run_sync(lambda: rmtree(folder, ignore_errors=True))

    async def publish_single(self, job, folder, sealed):
        variants = sealed.pop("variants", {})
        descriptor = ModelOutputDescription(**sealed)
        suffix = Path(descriptor.filename).suffix
        request_id = UUID(job.id).hex
        scope = (job.owner_user_id, job.project_id, request_id, descriptor)
        response = await self.deliver_artifact(
            job,
            lambda: self.outputs.lookup(*scope),
            lambda: self.outputs.publish(*scope, folder / "sealed" / ("movie" + suffix)),
        )
        if response is None:
            return
        result = VideoAsset.model_validate(response.json())
        if (
            result.byte_size != descriptor.byte_size
            or result.original_filename != descriptor.filename
            or result.media_kind != descriptor.mime_type.split("/", 1)[0]
        ):
            raise ValueError("剪辑成片回执不符")
        if variants:
            await install_variants(self.settings, job, folder, variants)
        await self.complete(job, result, variants, descriptor.content_sha256)

    async def publish_group(self, job, folder, sealed):
        manifest = SegmentBatchManifest.model_validate(sealed["segments"])
        response = await self.deliver_artifact(
            job,
            lambda: self.segment_outputs.lookup(job, manifest),
            lambda: self.segment_outputs.publish(job, manifest, folder / "sealed"),
            discard=(lambda: self.segment_outputs.discard(job, manifest))
            if manifest.target
            else None,
        )
        if response is None:
            return
        results = self.segment_outputs.result(response, manifest, job.probe["segments"])
        result = {"segments": [value.model_dump(mode="json") for value in results]}
        if manifest.target is not None:
            result["handoff"] = SegmentHandoff(
                source_project_id=job.project_id,
                task_id=job.id,
                manifest_sha256=manifest.digest,
                target=manifest.target,
            ).model_dump(mode="json")
        await self.set_state(
            job,
            "publishing",
            status="completed",
            progress=100,
            result=result,
        )

    async def complete(self, job, result, variants, fingerprint):
        async with self.session(job.owner_user_id) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(VideoExportJob, (job.owner_user_id, job.id))
            if current is None or current.status != "publishing":
                return
            if variants:
                session.add(
                    VideoMediaJob(
                        id=job.id,
                        owner_user_id=job.owner_user_id,
                        project_id=job.project_id,
                        asset_id=result.id,
                        status="completed",
                        probe=job.probe,
                        fingerprint=fingerprint,
                        outputs=variants,
                    )
                )
            current.status = "completed"
            current.progress = 100
            current.result = result.model_dump(mode="json")
            await session.commit()
