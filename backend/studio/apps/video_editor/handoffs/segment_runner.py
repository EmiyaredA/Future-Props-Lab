from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.render_engine import RenderCancelled
from app.capabilities.media_rendering.video_derivatives import probe_media
from app.capabilities.media_rendering.video_segment_encode import (
    encode_segment,
    validate_segment_output,
)
from studio.apps.video_editor.handoffs.segment_names import segment_filename
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask
from studio.apps.visual_workshop.outputs import register_imported_output
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualWorkshopProject
from studio.config.settings import Settings
from studio.runtime.time import utc_now


class VideoEditorSegmentTaskRunner:
    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        storage: AssetStorage,
        get_task: Callable[[AsyncSession, str], Awaitable[VideoEditorTask | None]],
        set_task: Callable[..., Awaitable[None]],
        raise_if_cancelled: Callable[[str], Awaitable[None]],
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings
        self.storage = storage
        self.get_task = get_task
        self.set_task = set_task
        self.raise_if_cancelled = raise_if_cancelled

    async def process(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self.get_task(session, task_id)
            if task is None:
                return
            payload = dict(task.request_payload or {})
            detail = dict(task.result_detail or {})
            segment_details = [dict(item) for item in detail.get("segments", [])]
            asset_ids = {str(item["assetId"]) for item in segment_details}
            rows = list(
                (
                    await session.execute(
                        select(VisualAsset, VideoEditorAssetMetadata)
                        .join(
                            VideoEditorAssetMetadata,
                            VideoEditorAssetMetadata.asset_id == VisualAsset.id,
                        )
                        .where(
                            VisualAsset.id.in_(asset_ids),
                            VisualAsset.video_editor_project_id == task.project_id,
                        )
                    )
                ).all()
            )
            source_assets = {
                asset.id: (self.storage.path_for(asset), dict(metadata.probe or {}))
                for asset, metadata in rows
            }
            if set(source_assets) != asset_ids:
                raise RuntimeError("分段源素材不存在")
            owner_user_id = task.owner_user_id
            target_payload = dict(payload.get("target") or {})
            segment_payloads = {
                str(item["clipId"]): dict(item) for item in payload.get("segments", [])
            }

        with TemporaryDirectory(prefix=f"video-segments-{task_id}-") as temporary:
            outputs = await self._encode_all(
                task_id,
                Path(temporary),
                segment_details,
                segment_payloads,
                source_assets,
                detail,
            )
            await self.raise_if_cancelled(task_id)
            await self._import_all(
                task_id,
                owner_user_id,
                target_payload,
                segment_details,
                outputs,
                detail,
            )

    async def _encode_all(
        self,
        task_id: str,
        temporary_root: Path,
        segment_details: list[dict],
        segment_payloads: dict[str, dict],
        source_assets: dict[str, tuple[Path, dict]],
        detail: dict,
    ) -> list[tuple[Path, dict, dict]]:
        outputs: list[tuple[Path, dict, dict]] = []
        total = len(segment_details)
        for index, item in enumerate(segment_details):
            await self.raise_if_cancelled(task_id)
            config = segment_payloads[str(item["clipId"])]
            source, source_probe = source_assets[str(item["assetId"])]
            output = temporary_root / f"segment-{index + 1:03d}.mp4"
            await self._encode_with_cancellation(
                task_id,
                source,
                output,
                config,
                item,
                source_probe,
            )
            output_probe = await asyncio.to_thread(probe_media, output)
            validate_segment_output(output_probe, source_probe, config)
            item.update({"status": "encoded", "progress": 100, "outputProbe": output_probe})
            outputs.append((output, config, item))
            detail["segments"] = segment_details
            await self.set_task(
                task_id,
                progress=max(1, round((index + 1) / total * 85)),
                result=detail,
            )
        return outputs

    async def _encode_with_cancellation(
        self,
        task_id: str,
        source: Path,
        output: Path,
        config: dict,
        item: dict,
        source_probe: dict,
    ) -> None:
        cancel_event = Event()
        worker = asyncio.create_task(
            asyncio.to_thread(
                encode_segment,
                source,
                output,
                source_in_us=int(item["sourceInUs"]),
                duration_us=int(item["durationUs"]),
                playback_rate=float(item.get("playbackRate") or 1),
                resolution=str(config["resolution"]),
                fps=config["fps"],
                quality=str(config["quality"]),
                audio_mode=str(config["audioMode"]),
                probe=source_probe,
                cancel_event=cancel_event,
            )
        )
        while not worker.done():
            try:
                await asyncio.wait_for(asyncio.shield(worker), timeout=0.25)
            except TimeoutError:
                try:
                    await self.raise_if_cancelled(task_id)
                except RenderCancelled:
                    cancel_event.set()
                    try:
                        await worker
                    except RenderCancelled:
                        pass
                    raise
        await worker

    async def _import_all(
        self,
        task_id: str,
        owner_user_id: str,
        target_payload: dict,
        segment_details: list[dict],
        outputs: list[tuple[Path, dict, dict]],
        detail: dict,
    ) -> None:
        staged_paths: list[Path] = []
        created_project_root = False
        target_project_id: str | None = target_payload.get("projectId")
        try:
            async with self.session_factory() as session:
                task = await self.get_task(session, task_id)
                if task is None or task.cancel_requested:
                    raise RenderCancelled()
                source_project_id = task.project_id
            # Stage every file before opening the short persistence transaction.
            staged_assets = []
            async with self.session_factory() as staging_session:
                library = AssetLibrary(staging_session, self.settings)
                for output, config, item in outputs:
                    await self.raise_if_cancelled(task_id)
                    asset, staged = await library.stage_local_copy(
                        output,
                        owner_user_id=owner_user_id,
                        filename=segment_filename(str(config["name"])),
                        content_type="video/mp4",
                        video_editor_project_id=source_project_id if not target_payload else None,
                        allowed_extensions={".mp4"},
                        max_bytes=self.settings.fpl_visual_asset_max_bytes,
                        defer_persistence=True,
                    )
                    staged_paths.append(staged)
                    fingerprint = await asyncio.to_thread(sha256_file, output)
                    staged_assets.append((asset, config, item, fingerprint))
            await self.raise_if_cancelled(task_id)
            async with self.session_factory() as session:
                task = await self.get_task(session, task_id)
                if task is None or task.cancel_requested:
                    raise RenderCancelled()
                canvas = None
                if target_payload:
                    canvas, target_project_id, created_project_root = await self._target_canvas(
                        session, target_payload, target_project_id, owner_user_id, detail
                    )
                nodes = [dict(node) for node in (canvas.nodes or [])] if canvas else []
                if canvas:
                    expected_revision = canvas.revision
                    result = await session.execute(
                        update(VisualCanvasDocument)
                        .where(
                            VisualCanvasDocument.project_id == target_project_id,
                            VisualCanvasDocument.revision == expected_revision,
                        )
                        .values(revision=expected_revision + 1, updated_at=utc_now())
                    )
                    if result.rowcount != 1:
                        raise RuntimeError("目标工作坊画布已变化，请重新提交")
                results = []
                session.add_all([asset for asset, *_ in staged_assets])
                await session.flush()
                for index, (asset, config, item, fingerprint) in enumerate(staged_assets):
                    filename = asset.original_filename
                    node_id = None
                    if canvas:
                        session.add(
                            VisualProjectAssetReference(
                                owner_user_id=owner_user_id,
                                project_id=target_project_id,
                                asset_id=asset.id,
                                folder_id=None,
                                display_name=str(config["name"]),
                            )
                        )
                        node_id = f"segment-{task_id[:8]}-{index + 1}"
                        node = {
                            "id": node_id,
                            "kind": "video",
                            "title": str(config["name"]),
                            "position": {"x": index * 540, "y": 0},
                            "asset_id": asset.id,
                            "generation_task_id": None,
                        }
                        await register_imported_output(
                            session,
                            target_project_id,
                            node,
                            asset_id=asset.id,
                            source_key=f"segment:{task_id}:{node_id}",
                        )
                        nodes.append(node)
                    else:
                        session.add(
                            VideoEditorAssetMetadata(
                                asset_id=asset.id,
                                project_id=source_project_id,
                                processing_status="ready",
                                probe=item["outputProbe"],
                                fingerprint=fingerprint,
                            )
                        )
                    spec = {
                        "resolution": config["resolution"],
                        "fps": config["fps"],
                        "quality": config["quality"],
                        "audioMode": config["audioMode"],
                    }
                    item.update(
                        {
                            "status": "completed",
                            "assetId": asset.id,
                            "nodeId": node_id,
                            "outputFilename": filename,
                            "spec": spec,
                        }
                    )
                    results.append(
                        {
                            "name": config["name"],
                            "assetId": asset.id,
                            "nodeId": node_id,
                            "spec": spec,
                        }
                    )
                if canvas:
                    await session.execute(
                        update(VisualCanvasDocument)
                        .where(VisualCanvasDocument.project_id == target_project_id)
                        .values(nodes=nodes)
                    )
                detail.update(
                    {
                        "targetProjectId": target_project_id,
                        "importRequested": bool(target_payload),
                        "segments": segment_details,
                        "results": results,
                    }
                )
                task.status = "completed"
                task.progress = 100
                task.result_detail = detail
                task.error = None
                task.finished_at = utc_now()
                task.updated_at = utc_now()
                task.revision += 1
                await session.commit()
        except BaseException:
            for path in staged_paths:
                path.unlink(missing_ok=True)
            if created_project_root and target_project_id:
                self.storage.remove_project_root(
                    "visual-workshop",
                    target_project_id,
                    owner_user_id=owner_user_id,
                )
            raise

    async def _target_canvas(
        self,
        session: AsyncSession,
        target_payload: dict,
        target_project_id: str | None,
        owner_user_id: str,
        detail: dict,
    ) -> tuple[VisualCanvasDocument, str, bool]:
        if target_project_id:
            project = await session.get(VisualWorkshopProject, target_project_id)
            canvas = await session.get(VisualCanvasDocument, target_project_id)
            if project is None or project.owner_user_id != owner_user_id or canvas is None:
                raise RuntimeError("目标工作坊项目不存在")
            if canvas.revision != detail.get("targetCanvasRevision"):
                raise RuntimeError("目标工作坊画布已变化，请重新提交")
            return canvas, target_project_id, False
        project = VisualWorkshopProject(
            owner_user_id=owner_user_id,
            title=str(target_payload["newProjectTitle"]),
            kind="canvas",
            status="draft",
        )
        session.add(project)
        await session.flush()
        created = self.storage.ensure_project_layout(
            "visual-workshop", project.id, owner_user_id=owner_user_id
        )
        canvas = VisualCanvasDocument(project_id=project.id, nodes=[], edges=[])
        session.add(canvas)
        await session.flush()
        return canvas, project.id, created
