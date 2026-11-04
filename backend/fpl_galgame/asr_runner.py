"""Recover Galgame ASR jobs from the original Models attempt before any resend."""

from collections import Counter
from tempfile import TemporaryFile

import httpx
from sqlalchemy import select, text

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
)
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.galgame_asr_execution import AsrInput, AsrOutcome, source_path
from fpl_runtime.project_errors import ProjectResourceError

from .asr_dispatch import fetch_audio, model_outcome
from .models import GalgameAsrDispatch

MAX_ACTIVE = 4


class AsrRunner(PollingTaskRunner):
    runner_name = "galgame-voice-transcriptions"
    poll_interval_seconds = 2

    def __init__(self, state, root):
        super().__init__()
        self.state = state
        self.sessions = state.database.sessions
        self.staging = root.resolve() / ".asr-work"

    async def recover(self):
        if self.staging.is_symlink():
            raise ValueError("Galgame 语音识别暂存目录不能是符号链接")
        self.staging.mkdir(parents=True, exist_ok=True, mode=0o700)

    async def process_once(self):
        task, dispatch, settings = (
            GalgameAssetTranscriptionTask,
            GalgameAsrDispatch,
            GalgameAssetSettings,
        )
        async with self.sessions(info={"allow_system_reads": True}) as db:
            rows = list(
                await db.execute(
                    select(task.id, task.owner_user_id, task.project_id, settings.concurrency)
                    .join(dispatch, dispatch.task_id == task.id)
                    .outerjoin(settings, settings.project_id == task.project_id)
                    .where(
                        task.status.in_(("queued", "running")),
                        task.owner_user_id == dispatch.owner_user_id,
                    )
                    .order_by(dispatch.checked_at, task.created_at, task.id)
                    .limit(100)
                )
            )
        selected = []
        per_project = Counter()
        for identity, owner, project, limit in rows:
            if per_project[project] >= (limit or 2):
                continue
            selected.append((owner, identity))
            per_project[project] += 1
            if len(selected) == MAX_ACTIVE:
                break
        await self.run_concurrently(selected, self.run_task)

    async def claim(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            task = await db.get(GalgameAssetTranscriptionTask, identity)
            dispatch = await db.get(GalgameAsrDispatch, identity)
            if task is None or dispatch is None or task.status not in {"queued", "running"}:
                return None
            dispatch.checked_at = utc_now()
            if task.status == "queued":
                task.status, task.started_at = "running", utc_now()
                task.revision += 1
                metadata = await db.get(GalgameAssetMetadata, task.asset_id)
                if metadata and metadata.transcript_revision == dispatch.transcript_revision:
                    metadata.transcript_status = "running"
            await db.commit()
            return task, dispatch

    async def remember(self, owner, identity, body):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(GalgameAsrDispatch, identity)
            if dispatch is None:
                raise ProjectResourceError("语音识别任务已结束", "asr_task_ended", 409)
            values = body.model_dump(mode="json")
            if dispatch.input is not None and dispatch.input != values:
                raise ProjectResourceError("语音识别原件已变化", "asr_input_changed", 409)
            dispatch.input = values
            await db.commit()

    async def execute(self, task, dispatch):
        capabilities = self.state.capabilities
        assertion = dispatch.assertion
        saved = AsrInput.model_validate(dispatch.input) if dispatch.input is not None else None
        if saved:
            result = await model_outcome(capabilities, assertion, saved)
            if result is not None:
                return result
        with TemporaryFile(dir=self.staging) as audio:
            description = await fetch_audio(
                capabilities,
                assertion,
                task.project_id,
                task.asset_id,
                dispatch.asset_revision,
                dispatch.byte_limit,
                audio,
            )
            body = AsrInput(
                project_id=task.project_id,
                task_id=task.id,
                asset_id=task.asset_id,
                provider_id=task.provider_id,
                model_id=task.model_id,
                model_slug=task.model_slug,
                language=task.language,
                filename=description.filename,
                mime_type=description.mime_type,
                byte_size=description.byte_size,
                content_sha256=description.content_sha256,
            )
            await self.remember(task.owner_user_id, task.id, body)
            return await model_outcome(capabilities, assertion, body, audio=audio)

    async def run_task(self, selection):
        owner, identity = selection
        claimed = await self.claim(owner, identity)
        if claimed is None:
            return
        task, dispatch = claimed
        try:
            result = await self.execute(task, dispatch)
            if result is None or result.status == "running":
                return
            if result.status == "completed":
                active = await self.state.live_authorization.status(
                    assertion=dispatch.assertion, method="POST", path=source_path(task.project_id)
                )
                if active is None:
                    return
                if active is False:
                    result = AsrOutcome(status="failed", error="语音识别授权已结束")
        except ProjectResourceError as exc:
            if exc.status in {502, 503, 504}:
                return
            result = AsrOutcome(status="failed", error=str(exc))
        except (httpx.HTTPError, CapabilityUnavailable):
            return
        except (OSError, ValueError):
            result = AsrOutcome(status="failed", error="语音识别原件或结果无效")
        await self.settle(owner, identity, result)

    async def settle(self, owner, identity, result):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            task = await db.get(GalgameAssetTranscriptionTask, identity)
            dispatch = await db.get(GalgameAsrDispatch, identity)
            if task is None or dispatch is None or task.status != "running":
                return
            finished = result.status == "completed"
            task.status = "completed" if finished else "failed"
            task.result_text = result.text if finished else None
            task.result_segments = [segment.model_dump() for segment in result.segments]
            task.error = result.error if not finished else None
            task.finished_at = utc_now()
            task.revision += 1
            metadata = await db.get(GalgameAssetMetadata, task.asset_id)
            if (
                metadata is not None
                and metadata.project_id == task.project_id
                and metadata.transcript_revision == dispatch.transcript_revision
            ):
                if finished and (task.force or metadata.transcript_source != "manual"):
                    metadata.transcript = (result.text or "").strip()
                    metadata.transcript_language = task.language
                    metadata.transcript_source = "asr"
                    metadata.transcript_revision += 1
                    metadata.transcript_segments = task.result_segments
                metadata.transcript_status = "ready" if finished else "failed"
            await db.delete(dispatch)
            await db.commit()
