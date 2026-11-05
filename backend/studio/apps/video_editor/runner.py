from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.media_rendering.chroma_key import bake_image
from app.capabilities.media_rendering.render_engine import RenderCancelled, render_document
from app.capabilities.media_rendering.video_bake_document import bake_video_document
from app.capabilities.media_rendering.video_derivatives import prepare_media, probe_media
from app.capabilities.media_rendering.video_output import verify_video_output
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.video_editor.baking.bake_organization import insert_baked_asset_in_organization
from studio.apps.video_editor.clip_merging.runner import process_clip_merge
from studio.apps.video_editor.handoffs.segment_runner import VideoEditorSegmentTaskRunner
from studio.apps.video_editor.schemas import parse_timeline_document
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
)
from studio.config.settings import Settings
from studio.contracts.video_editor.timeline_document import VideoEditorChromaKey
from studio.runtime.database.ownership import bind_owner, require_owner_id
from studio.runtime.files.digests import sha256_file
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class VideoEditorRunner(PollingTaskRunner):
    runner_name = "video-editor-runner"
    poll_interval_seconds = 0.75

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        lane: Literal["media", "export"] = "export",
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings
        self.storage = AssetStorage(self.settings)
        self.lane = lane
        self.runner_name = f"video-editor-{lane}-runner"

    def _lane_filter(self):
        return (
            VideoEditorTask.kind == "media"
            if self.lane == "media"
            else VideoEditorTask.kind != "media"
        )

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(VideoEditorTask).where(
                            VideoEditorTask.status == "running", self._lane_filter()
                        )
                    )
                ).scalars()
            )
            for row in rows:
                row.status = (
                    "cancelled" if row.kind == "clip_merge" and row.cancel_requested else "queued"
                )
                row.cancel_requested = False
                row.error = None
                row.revision += 1
                row.updated_at = utc_now()
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(VideoEditorTask.id)
                .where(VideoEditorTask.status == "queued", self._lane_filter())
                .order_by(VideoEditorTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _get(self, session: AsyncSession, task_id: str) -> VideoEditorTask | None:
        task = await session.get(VideoEditorTask, task_id)
        if task:
            bind_owner(
                session,
                require_owner_id(task.owner_user_id, subject="video editor task"),
            )
        return task

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        error: str | None = None,
        result: dict | None = None,
        output_asset_id: str | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            if status is not None:
                task.status = status
            if progress is not None:
                task.progress = max(0, min(100, progress))
            if result is not None:
                task.result_detail = result
            if output_asset_id is not None:
                task.output_asset_id = output_asset_id
            task.error = error
            task.revision += 1
            task.updated_at = utc_now()
            if finished:
                task.finished_at = utc_now()
            await session.commit()

    async def _process(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is None or task.status != "queued":
                    return
                if task.cancel_requested:
                    task.status = "cancelled"
                    await session.commit()
                    return
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.progress = 1
                task.revision += 1
                await session.commit()
                kind = task.kind
            if kind == "media":
                await self._process_media(task_id)
            elif kind == "segment_export":
                await self._process_segment_export(task_id)
            elif kind == "clip_merge":
                await process_clip_merge(
                    task_id,
                    session_factory=self.session_factory,
                    settings=self.settings,
                    storage=self.storage,
                    get_task=self._get,
                    set_task=self._set,
                    cancel_watch=self._cancel_watch,
                    raise_if_cancelled=self._raise_if_cancelled,
                    prepare_media=prepare_media,
                )
            elif kind == "asset_bake":
                await self._process_asset_bake(task_id)
            else:
                await self._process_render(task_id)
        except RenderCancelled:
            await self._set(task_id, status="cancelled", finished=True)
        except Exception as exc:
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is not None and task.kind == "media":
                    asset_id = str((task.request_payload or {}).get("assetId", ""))
                    metadata = await session.get(VideoEditorAssetMetadata, asset_id)
                    if metadata is not None:
                        metadata.processing_status = "failed"
                        metadata.error = str(exc)
                        metadata.revision += 1
                        metadata.updated_at = utc_now()
                        await session.commit()
            await self._set(task_id, status="failed", error=str(exc), finished=True)

    async def _process_media(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            asset_id = str(task.request_payload["assetId"])
            asset = await session.get(VisualAsset, asset_id)
            metadata = await session.get(VideoEditorAssetMetadata, asset_id)
            if asset is None or metadata is None:
                raise RuntimeError("待处理素材不存在")
            metadata.processing_status = "processing"
            metadata.error = None
            metadata.revision += 1
            await session.commit()
            source = self.storage.path_for(asset)
            # Publish source metadata before the potentially long proxy encode.
            # Timeline edits can then use the real duration while preview media
            # continues preparing, without holding a write transaction open.
            probe = (
                {"mediaKind": "font"}
                if asset.media_kind == "font"
                else await asyncio.to_thread(probe_media, source)
            )
            metadata.probe = probe
            metadata.revision += 1
            await session.commit()
            derived = (
                self.storage.project_root(
                    "video-editor", task.project_id, owner_user_id=task.owner_user_id
                )
                / "derived"
            )
            derived.mkdir(parents=True, exist_ok=True)
            probe, proxy, thumbnail, waveform, fingerprint = await asyncio.to_thread(
                prepare_media, source, asset.id, asset.media_kind, derived, probe
            )
            metadata = await session.get(VideoEditorAssetMetadata, asset_id)
            assert metadata is not None
            metadata.processing_status = "ready"
            metadata.probe = probe
            metadata.proxy_filename = proxy
            metadata.thumbnail_filename = thumbnail
            metadata.waveform_filename = waveform
            metadata.fingerprint = fingerprint
            metadata.error = None
            metadata.revision += 1
            await session.commit()
        await self._set(task_id, status="completed", progress=100, finished=True)

    async def _cancel_watch(self, task_id: str, event: threading.Event) -> None:
        while not event.is_set():
            await asyncio.sleep(0.4)
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is None or task.cancel_requested:
                    event.set()
                    return

    async def _raise_if_cancelled(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None or task.cancel_requested:
                raise RenderCancelled()

    async def _process_segment_export(self, task_id: str) -> None:
        await VideoEditorSegmentTaskRunner(
            session_factory=self.session_factory,
            settings=self.settings,
            storage=self.storage,
            get_task=self._get,
            set_task=self._set,
            raise_if_cancelled=self._raise_if_cancelled,
        ).process(task_id)

    async def _process_render(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            document = parse_timeline_document(task.snapshot_document)
            payload = dict(task.request_payload)
            asset_ids = {
                value
                for track in document.tracks
                for clip in track.clips
                for value in (clip.asset_id, clip.font_asset_id)
                if value
            }
            assets = (
                list(
                    (
                        await session.execute(
                            select(VisualAsset).where(
                                VisualAsset.id.in_(asset_ids),
                                VisualAsset.video_editor_project_id == task.project_id,
                            )
                        )
                    ).scalars()
                )
                if asset_ids
                else []
            )
            paths = {asset.id: self.storage.path_for(asset) for asset in assets}
            project_id = task.project_id
            owner_user_id = task.owner_user_id
            detail = dict(task.result_detail)
        cancel = threading.Event()
        watch = asyncio.create_task(self._cancel_watch(task_id, cancel))
        with TemporaryDirectory(prefix=f"video-editor-{task_id}-") as temporary:
            output = Path(temporary) / "render.mp4"
            loop = asyncio.get_running_loop()

            def progress(value: int) -> None:
                asyncio.run_coroutine_threadsafe(self._set(task_id, progress=value), loop)

            try:
                await asyncio.to_thread(
                    render_document,
                    document,
                    paths,
                    output,
                    preset=str(payload["preset"]),
                    start_us=int(payload.get("startUs", 0)),
                    end_us=int(
                        payload.get("endUs")
                        or int(payload.get("startUs", 0)) + int(detail["durationUs"])
                    ),
                    cancel=cancel,
                    progress=progress,
                )
            finally:
                watch.cancel()
            probe = await asyncio.to_thread(
                verify_video_output, output, str(payload["preset"]), int(detail["durationUs"])
            )
            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                project = await session.get(VideoEditorProject, project_id)
                title = project.title if project else "video-editor"
                asset, staged = await AssetLibrary(session, self.settings).stage_local_copy(
                    output,
                    owner_user_id=owner_user_id,
                    filename=f"{title}-{task_id[:8]}.mp4",
                    content_type="video/mp4",
                    video_editor_project_id=project_id,
                    allowed_extensions={".mp4"},
                    max_bytes=self.settings.fpl_galgame_export_max_bytes,
                )
                try:
                    session.add(
                        VideoEditorAssetMetadata(
                            asset_id=asset.id,
                            project_id=project_id,
                            processing_status="ready",
                            probe=probe,
                            fingerprint=sha256_file(output),
                        )
                    )
                    await session.commit()
                except Exception:
                    staged.unlink(missing_ok=True)
                    raise
                output_asset_id = asset.id
            detail.update({"probe": probe, "outputFilename": f"{title}-{task_id[:8]}.mp4"})
        await self._set(
            task_id,
            status="completed",
            progress=100,
            result=detail,
            output_asset_id=output_asset_id,
            finished=True,
        )

    async def _process_asset_bake(self, task_id: str) -> None:
        from uuid import uuid4

        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            payload = dict(task.request_payload or {})
            source_asset_id = str(payload["assetId"])
            effects = dict(payload.get("effects") or {})
            chroma_payload = effects.get("chromaKey") or effects.get("chroma_key")
            if not chroma_payload:
                raise RuntimeError("烘焙缺少抠像参数")
            chroma = VideoEditorChromaKey.model_validate(chroma_payload)
            asset = await session.get(VisualAsset, source_asset_id)
            metadata = await session.get(VideoEditorAssetMetadata, source_asset_id)
            if (
                asset is None
                or metadata is None
                or asset.video_editor_project_id != task.project_id
            ):
                raise RuntimeError("待烘焙素材不存在")
            source = self.storage.path_for(asset)
            project_id = task.project_id
            owner_user_id = task.owner_user_id
            media_kind = asset.media_kind
            display_name = asset.display_name
            duration_us = int((metadata.probe or {}).get("durationUs") or 5_000_000)

        cancel = threading.Event()
        watch = asyncio.create_task(self._cancel_watch(task_id, cancel))
        with TemporaryDirectory(prefix=f"video-editor-bake-{task_id}-") as temporary:
            temp_root = Path(temporary)
            try:
                if media_kind == "image":
                    output = temp_root / "baked.png"
                    await self._set(task_id, progress=20)

                    probe = await asyncio.to_thread(bake_image, source, output, chroma)
                    await self._raise_if_cancelled(task_id)
                    content_type = "image/png"
                    filename = f"{display_name}-baked-{task_id[:8]}.png"
                    extensions = {".png"}
                else:
                    output = temp_root / "baked.mp4"
                    document = bake_video_document(
                        source_asset_id, display_name, duration_us, str(uuid4()), chroma
                    )
                    loop = asyncio.get_running_loop()

                    def progress(value: int) -> None:
                        asyncio.run_coroutine_threadsafe(self._set(task_id, progress=value), loop)

                    await asyncio.to_thread(
                        render_document,
                        document,
                        {source_asset_id: source},
                        output,
                        preset="1080p30",
                        start_us=0,
                        end_us=max(1, duration_us),
                        cancel=cancel,
                        progress=progress,
                    )
                    await self._raise_if_cancelled(task_id)
                    probe = await asyncio.to_thread(probe_media, output)
                    content_type = "video/mp4"
                    filename = f"{display_name}-baked-{task_id[:8]}.mp4"
                    extensions = {".mp4"}
            finally:
                watch.cancel()

            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                asset_out, staged = await AssetLibrary(session, self.settings).stage_local_copy(
                    output,
                    owner_user_id=owner_user_id,
                    filename=filename,
                    content_type=content_type,
                    video_editor_project_id=project_id,
                    allowed_extensions=extensions,
                    max_bytes=self.settings.fpl_galgame_export_max_bytes,
                )
                try:
                    session.add(
                        VideoEditorAssetMetadata(
                            asset_id=asset_out.id,
                            project_id=project_id,
                            processing_status="ready",
                            probe=probe,
                            fingerprint=sha256_file(output),
                            default_effects={},
                        )
                    )
                    await insert_baked_asset_in_organization(
                        session,
                        project_id=project_id,
                        source_asset_id=source_asset_id,
                        output_asset_id=asset_out.id,
                    )
                    await session.commit()
                except Exception:
                    staged.unlink(missing_ok=True)
                    raise
                output_asset_id = asset_out.id

        await self._set(
            task_id,
            status="completed",
            progress=100,
            result={
                "sourceAssetId": source_asset_id,
                "outputFilename": filename,
                "probe": probe,
                "effects": effects,
            },
            output_asset_id=output_asset_id,
            finished=True,
        )
