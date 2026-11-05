"""Run accepted Visual provider jobs once and retain a verified result for Visual."""

import asyncio
import os
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from anyio.to_thread import run_sync
from sqlalchemy import text

from studio.apps.model_service.admission.admission import settle
from studio.apps.model_service.generation.driver import GenerationTaskDriver, GenerationTaskStore
from studio.apps.model_service.generation.media import download_generated_media, read_data_uri
from studio.apps.model_service.generation.outcomes import TaskClaimRejected
from studio.apps.model_service.generation.provider_tasks import (
    poll_generation_task,
    safe_generation_error,
    upload_temporary_reference,
)
from studio.apps.model_service.generation.visual_submission import (
    VisualGenerationInputs,
    submit_visual_generation,
)
from studio.apps.model_service.providers.zealman_live import ZealmanLiveMonitor
from studio.apps.model_service.providers.zealman_video import get_task
from studio.apps.model_service.storage.visual_generation_records import (
    VisualProviderBatch,
    VisualProviderTask,
)
from studio.apps.model_service.visual.visual_generation_queue import claim
from studio.apps.model_service.visual.visual_generation_retention import ProviderRetention
from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.runtime.files.digests import sha256_file
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

ACTIVE = ("queued", "submitting", "pending", "processing")


class ProviderMedia:
    def __init__(self, paths, assets, upload_url):
        self.paths, self.assets, self.upload_url = paths, assets, upload_url

    def original(self, identity, kinds):
        asset = self.assets.get(identity)
        if asset is None or asset.media_kind not in kinds:
            raise ValueError("参考素材已不存在或类型不匹配")
        return self.paths[identity], asset

    async def local_reference(self, identity, kind, _owner):
        path, asset = self.original(identity, {kind})
        return path, asset.mime_type

    async def data_uri(self, identity, _owner, *, expected_kind=None):
        path, asset = self.original(
            identity, {expected_kind} if expected_kind else {"image", "audio"}
        )
        maximum = (45 if expected_kind == "video" else 30) * 1024**2
        return await read_data_uri(path=path, mime_type=asset.mime_type, max_bytes=maximum)

    async def temporary_url(self, identity, kind, _owner, filename=None):
        path, asset = self.original(identity, {kind})
        return await upload_temporary_reference(
            path=path,
            mime_type=asset.mime_type,
            upload_url=self.upload_url,
            filename=filename,
            file_extension=Path(asset.original_filename).suffix,
        )


class VisualGenerationRunner(PollingTaskRunner):
    runner_name = "visual-provider-generation"

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.sessions = state.database.sessions
        self.intake = state.visual_generation_intake
        self.retention = ProviderRetention(self.sessions, self.intake)
        self.zealman = ZealmanLiveMonitor()
        self.store = GenerationTaskStore(
            session_factory=self.sessions,
            task_type=VisualProviderTask,
            active_statuses=ACTIVE,
            task_subject="visual provider task",
            prepare_claim=self.prepare_claim,
            claim_admission=claim,
            terminal_settlement=settle,
        )
        self.driver = GenerationTaskDriver(
            store=self.store,
            submit=self.submit,
            poll=self.poll,
            materialize=self.materialize,
            map_error=safe_generation_error,
            provider_failure_message="SenseAudio 生成任务失败",
            missing_result_message="SenseAudio 已完成任务但未返回结果地址",
        )

    async def stop(self):
        await super().stop()
        await self.zealman.close()

    async def recover(self):
        await self.driver.recover()
        await self.retention.recover()

    async def process_once(self):
        await self.run_concurrently(await self.store.active_task_ids(), self.driver.process)
        await self.retention.retire_inputs()

    async def prepare_claim(self, task_id):
        async with self.sessions() as db:
            task = await self.store.load(db, task_id)
            if task is None:
                return None
            if task.status != "queued":

                async def settlement_only(_session, current):
                    return current.status != "queued"

                return settlement_only
            batch = await db.get(VisualProviderBatch, task.batch_id)
            if batch is None or batch.state != "active" or not batch.source_assertion:
                return None
            source = batch.source_assertion, batch.source_path
        active = await self.state.identity.status(
            assertion=source[0], method="POST", path=source[1]
        )
        if active is None:
            return None

        async def validate(session, current):
            plan = await session.get(VisualProviderBatch, current.batch_id, populate_existing=True)
            if (
                plan is None
                or plan.state != "active"
                or (plan.source_assertion, plan.source_path) != source
            ):
                return False
            if active is False:
                raise TaskClaimRejected("生成任务授权已撤销")
            return True

        return validate

    async def submit(self, task):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as session:
            row = await self.store.load(session, task.task_id)
            batch = await session.get(VisualProviderBatch, row.batch_id)
            assets = {
                data["id"]: LibraryAssetDescription.model_validate(data)
                for data in batch.input_assets
            }
            paths = {identity: self.intake.path_for(batch, identity) for identity in assets}
        media = ProviderMedia(paths, assets, self.state.settings.fpl_temp_media_upload_url)
        return await submit_visual_generation(
            VisualGenerationInputs(media.local_reference, media.data_uri, media.temporary_url),
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            model_slug=task.model_slug,
            payload=task.payload,
            owner_user_id=task.owner_user_id,
        )

    async def poll(self, task):
        if task.provider_kind == "zealman_video":
            async with self.sessions(info={"owner_user_id": task.owner_user_id}) as session:
                row = await self.store.load(session, task.task_id)
                if row is None or utc_now() - (row.submitted_at or row.created_at) > timedelta(
                    hours=1
                ):
                    raise ValueError("ZEALMAN 等待超过 60 分钟；请检查上游任务，系统不会自动重提")
            return await get_task(
                base_url=task.base_url,
                api_key=task.api_key,
                task_id=task.provider_task_id,
                monitor=self.zealman,
            )
        return await poll_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            provider_task_id=task.provider_task_id,
        )

    def output_root(self, owner):
        directory = self.intake.root / owner / "outputs"
        if directory.is_symlink() or not directory.resolve().is_relative_to(
            self.intake.root.resolve()
        ):
            raise ValueError("模型生成结果目录不可用")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        return directory

    async def materialize(self, task_id, result_url):
        async with self.sessions() as session:
            row = await self.store.load(session, task_id)
            if row is None or row.status != "processing":
                return
            owner, kind = row.owner_user_id, row.generation_kind
        directory = self.output_root(owner)
        key = uuid4().hex
        temporary, output = directory / (key + ".tmp"), directory / key
        try:
            size, media_kind, mime, suffix = await download_generated_media(
                url=result_url,
                target=temporary,
                max_bytes=self.state.settings.fpl_visual_asset_max_bytes,
            )
            if media_kind != kind:
                raise ValueError("生成结果与任务类型不匹配")
            digest = await run_sync(sha256_file, temporary)
            os.replace(temporary, output)
            if not await self.finish(task_id, owner, key, f"{task_id}{suffix}", mime, size, digest):
                output.unlink(missing_ok=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.store.fail(task_id, safe_generation_error(exc), result_url=result_url)
        finally:
            temporary.unlink(missing_ok=True)

    async def finish(self, task_id, owner, key, filename, mime, size, digest):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self.store.load(session, task_id)
            if row is None or row.status != "processing":
                return False
            row.result_metadata = {
                "key": key,
                "filename": filename,
                "mime_type": mime,
                "byte_size": size,
                "sha256": digest,
            }
            row.status, row.progress = "completed", 100
            row.revision += 1
            row.updated_at = utc_now()
            await settle(session)
            await session.commit()
            return True
