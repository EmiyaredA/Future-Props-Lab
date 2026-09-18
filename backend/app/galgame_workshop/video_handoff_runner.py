from __future__ import annotations

import asyncio
import threading
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.policy import VIDEO_EDITABLE_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from app.galgame_workshop.video_compiler import (
    COMPILER_VERSION,
    compile_galgame_render_plan,
    remap_render_plan_assets,
)
from app.galgame_workshop.video_lip_sync import prepare_audio_envelopes
from app.models import (
    GalgameAssetMetadata,
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameWorkshopProject,
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
    VisualAsset,
)
from app.orm import bind_workspace, require_workspace_id
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now


class GalgameVideoEditorHandoffRunner(PollingTaskRunner):
    runner_name = "galgame-video-editor-handoff-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(GalgameVideoEditorHandoffTask).where(
                            GalgameVideoEditorHandoffTask.status == "running"
                        )
                    )
                ).scalars()
            )
            for row in rows:
                row.status = "queued"
                row.cancel_requested = False
                row.error = None
                row.progress = 0
                row.revision += 1
                row.updated_at = utc_now()
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(GalgameVideoEditorHandoffTask.id)
                .where(GalgameVideoEditorHandoffTask.status == "queued")
                .order_by(GalgameVideoEditorHandoffTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        error: str | None = None,
        output_project_id: str | None = None,
        detail: dict | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(GalgameVideoEditorHandoffTask, task_id)
            if row is None:
                return
            bind_workspace(
                session,
                require_workspace_id(row.workspace_id, subject="video handoff task"),
            )
            if status is not None:
                row.status = status
            if progress is not None:
                row.progress = max(0, min(100, progress))
            if output_project_id is not None:
                row.output_project_id = output_project_id
            if detail:
                row.result_detail = {**(row.result_detail or {}), **detail}
            row.error = error
            row.revision += 1
            row.updated_at = utc_now()
            if finished:
                row.finished_at = utc_now()
            await session.commit()

    async def _cancelled(self, task_id: str) -> bool:
        async with self.session_factory() as session:
            row = await session.get(GalgameVideoEditorHandoffTask, task_id)
            return row is None or row.cancel_requested

    async def _discard_project(self, project_id: str, workspace_id: str) -> None:
        staged = self.storage.stage_project_root(
            "video-editor", project_id, workspace_id=workspace_id
        )
        try:
            async with self.session_factory() as session:
                bind_workspace(session, workspace_id)
                await session.execute(
                    delete(VideoEditorProject).where(VideoEditorProject.id == project_id)
                )
                await session.commit()
        except Exception:
            self.storage.restore_staged_root(staged)
            raise
        self.storage.purge_staged_root(staged)

    async def _process(self, task_id: str) -> None:
        created_project_id: str | None = None
        try:
            async with self.session_factory() as session:
                task = await session.get(GalgameVideoEditorHandoffTask, task_id)
                if task is None or task.status != "queued":
                    return
                workspace_id = require_workspace_id(task.workspace_id, subject="video handoff task")
                bind_workspace(session, workspace_id)
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.progress = 2
                task.revision += 1
                await session.commit()
                snapshot = await session.get(GalgameStorySnapshot, task.snapshot_id)
                source_project = await session.get(GalgameWorkshopProject, task.project_id)
                if snapshot is None or source_project is None:
                    raise RuntimeError("Story 快照或源项目不存在")
                document = dict(snapshot.document)
                payload = dict(task.request_payload)
                detail = dict(task.result_detail or {})
                total_ms = int(detail.get("totalMs", 0))
                fragment_durations = list(detail.get("fragmentDurationsMs", []))
                file_ids = {
                    str(item.get("fileId"))
                    for item in document.get("assets", [])
                    if item.get("fileId")
                }
                sources = list(
                    (
                        await session.execute(
                            select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                        )
                    ).scalars()
                )
                source_by_id = {item.id: item for item in sources}
                source_paths = {item.id: self.storage.path_for(item) for item in sources}
                asset_fingerprints = {
                    item.id: (f"{item.id}:{item.revision}:{item.storage_version}:{item.byte_size}")
                    for item in sources
                }
                metadata_rows = list(
                    (
                        await session.execute(
                            select(GalgameAssetMetadata).where(
                                GalgameAssetMetadata.asset_id.in_(file_ids)
                            )
                        )
                    ).scalars()
                )
                duration_by_file = {
                    item.asset_id: item.duration_ms
                    for item in metadata_rows
                    if item.duration_ms is not None
                }
                asset_duration_ms = {
                    str(item["id"]): duration_by_file[item["fileId"]]
                    for item in document.get("assets", [])
                    if item.get("fileId") in duration_by_file
                }
                title = str(payload.get("title") or "").strip() or (
                    f"{source_project.title} · Story r{task.story_revision}"
                )

            cancel_event = threading.Event()
            await self._set(task_id, progress=3, detail={"phase": "analyzing"})
            analysis = asyncio.create_task(
                asyncio.to_thread(
                    prepare_audio_envelopes,
                    document,
                    source_paths,
                    cache_dir=self.storage.project_root(
                        "galgame-workshop", task.project_id, workspace_id=workspace_id
                    )
                    / "derived"
                    / "audio-envelopes",
                    asset_fingerprints=asset_fingerprints,
                    selected_fragment_ids=set(payload.get("resolvedFragmentIds") or []),
                    cancel=cancel_event,
                )
            )
            while not analysis.done():
                if await self._cancelled(task_id):
                    cancel_event.set()
                await asyncio.sleep(0.25)
            envelopes = await analysis
            compiled = await asyncio.to_thread(
                compile_galgame_render_plan,
                document,
                payload,
                fragment_durations_ms=fragment_durations,
                total_ms=total_ms,
                asset_paths=source_paths,
                asset_duration_ms=asset_duration_ms,
                audio_envelopes=envelopes,
            )
            if await self._cancelled(task_id):
                raise InterruptedError("剪辑交接已取消")

            async with self.session_factory() as session:
                bind_workspace(session, workspace_id)
                project = VideoEditorProject(
                    title=title[:120],
                    status="draft",
                    source_application="galgame-workshop",
                    source_project_id=payload.get("projectId") or task.project_id,
                    source_revision=task.story_revision,
                    source_compiler_version=COMPILER_VERSION,
                )
                session.add(project)
                await session.flush()
                created_project_id = project.id
                self.storage.ensure_project_layout(
                    "video-editor", project.id, workspace_id=workspace_id
                )
                session.add(VideoEditorTimeline(project_id=project.id, document={}))
                await session.commit()

            mapping: dict[str, str] = {}
            copied_paths: dict[str, Path] = {}
            used = sorted(compiled.used_file_ids)
            for index, source_id in enumerate(used):
                if await self._cancelled(task_id):
                    raise InterruptedError("剪辑交接已取消")
                source = source_by_id.get(source_id)
                generated_path = compiled.plan.asset_paths.get(source_id)
                if source is None and (
                    not source_id.startswith("generated-dialogue-")
                    or generated_path is None
                    or not generated_path.is_file()
                ):
                    raise RuntimeError(f"素材 {source_id} 已不存在")
                source_path = source_paths[source_id] if source is not None else generated_path
                filename = (
                    source.original_filename
                    if source is not None
                    else f"dialogue-ui-{source_id.removeprefix('generated-dialogue-')}.png"
                )
                content_type = source.mime_type if source is not None else "image/png"
                async with self.session_factory() as session:
                    bind_workspace(session, workspace_id)
                    library = AssetLibrary(session, self.settings)
                    copied, staged = await library.stage_local_copy(
                        source_path,
                        workspace_id=workspace_id,
                        filename=filename,
                        content_type=content_type,
                        video_editor_project_id=created_project_id,
                        allowed_extensions=VIDEO_EDITABLE_EXTENSIONS,
                    )
                    try:
                        session.add(
                            VideoEditorAssetMetadata(
                                asset_id=copied.id,
                                project_id=created_project_id,
                            )
                        )
                        session.add(
                            VideoEditorTask(
                                project_id=created_project_id,
                                request_id=f"media-{copied.id}",
                                kind="media",
                                request_payload={"assetId": copied.id},
                            )
                        )
                        await session.commit()
                    except Exception:
                        await session.rollback()
                        staged.unlink(missing_ok=True)
                        raise
                    mapping[source_id] = copied.id
                    copied_paths[copied.id] = staged
                await self._set(
                    task_id,
                    progress=10 + round((index + 1) / max(1, len(used)) * 72),
                )

            materialized = remap_render_plan_assets(compiled.plan, mapping, copied_paths)
            if await self._cancelled(task_id):
                raise InterruptedError("剪辑交接已取消")
            timeline_document = materialized.document.model_dump(
                mode="json", by_alias=True, exclude_none=True
            )
            async with self.session_factory() as session:
                bind_workspace(session, workspace_id)
                timeline = await session.get(VideoEditorTimeline, created_project_id)
                if timeline is None:
                    raise RuntimeError("剪辑项目时间轴创建失败")
                timeline.document = timeline_document
                timeline.updated_at = utc_now()
                await session.commit()
            await self._set(
                task_id,
                status="completed",
                progress=100,
                output_project_id=created_project_id,
                detail={"trackCount": len(timeline_document["tracks"]), "assetCount": len(used)},
                finished=True,
            )
        except InterruptedError:
            if created_project_id is not None:
                await self._discard_project(created_project_id, workspace_id)
            await self._set(task_id, status="cancelled", progress=0, error=None, finished=True)
        except Exception as exc:
            if created_project_id is not None:
                try:
                    await self._discard_project(created_project_id, workspace_id)
                except Exception as cleanup_error:
                    exc = RuntimeError(f"{exc}; 清理半成品失败：{cleanup_error}")
            await self._set(
                task_id,
                status="failed",
                error=str(exc)[:4000],
                finished=True,
            )
