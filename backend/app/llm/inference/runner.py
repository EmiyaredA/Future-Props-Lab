import asyncio
import json
import os
from contextlib import nullcontext
from dataclasses import asdict
from uuid import uuid4

from sqlalchemy import select

from app.llm.call_logs.record_attribution import snapshot_from_row
from app.llm.generation_runtime import (
    GenerationTaskDriver,
    GenerationTaskStore,
    download_generated_media,
    poll_generation_task,
    read_data_uri,
    safe_generation_error,
    submit_generation_task,
    upload_temporary_reference,
)
from app.llm.inference.storage import InferenceStorage
from app.llm.inference.tasks import ACTIVE
from app.llm.models import LlmCallLog
from app.llm.models.model_inference import ModelInferenceAsset, ModelInferenceTask
from app.llm.providers.local_qwen import synthesize
from app.llm.providers.transcription import transcribe_model_audio
from app.llm.task_outcomes import NativeSubmissionUncertain
from studio.config.settings import get_settings
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


def add_log(session, row):
    if row.log_id:
        return
    row.log_id = str(uuid4())
    credential = snapshot_from_row(row)
    session.add(
        LlmCallLog(
            id=row.log_id,
            owner_user_id=row.owner_user_id,
            call_source="model_inference",
            provider_kind=row.provider_kind,
            model=row.model_slug,
            trace_id=row.id,
            request_payload=row.request_payload,
            response_payload={"task_id": row.id, "status": row.status, "result": row.result},
            latency_ms=max(0, int((utc_now() - row.created_at).total_seconds() * 1000)),
            status="success" if row.status == "completed" else "error",
            error_message=row.error_message,
            **credential.as_kwargs(),
        )
    )


class InferenceRunner(PollingTaskRunner):
    runner_name = "model-inference"

    def __init__(
        self,
        session_factory,
        transport=None,
        local_runtime=None,
        *,
        settings=None,
        prepare_claim=None,
        terminal_settlement=None,
        synthesis_scope=None,
    ):
        super().__init__()
        self.session_factory, self.transport = session_factory, transport
        self.local_runtime = local_runtime
        self.synthesis_scope = synthesis_scope or nullcontext
        self.terminal_settlement = terminal_settlement
        self.settings = settings or get_settings()
        self.storage = InferenceStorage(self.settings)
        self.store = GenerationTaskStore(
            session_factory=session_factory,
            task_type=ModelInferenceTask,
            active_statuses=ACTIVE,
            task_subject="independent model task",
            terminal_hook=add_log,
            prepare_claim=prepare_claim,
            terminal_settlement=terminal_settlement,
        )
        self.driver = GenerationTaskDriver(
            store=self.store,
            submit=self.submit,
            poll=self.poll,
            materialize=self.materialize,
            map_error=safe_generation_error,
        )

    async def recover(self):
        await self.driver.recover()
        # Startup recovery runs before workers; remove files never committed to an output record.
        async with self.session_factory(info={"allow_system_reads": True}) as session:
            outputs = set(
                (
                    await session.execute(
                        select(
                            ModelInferenceTask.owner_user_id, ModelInferenceTask.result_storage_key
                        )
                    )
                ).all()
            )

            inputs = set(
                (
                    await session.execute(
                        select(ModelInferenceAsset.owner_user_id, ModelInferenceAsset.storage_key)
                    )
                ).all()
            )

        await asyncio.to_thread(self.storage.cleanup_uncommitted, inputs, outputs)

    async def process_once(self):
        await self.run_concurrently(await self.store.active_task_ids(), self.process)

    async def process(self, task_id):
        async with self.session_factory() as session:
            row = await self.store.load(session, task_id)
            kind = row.kind if row else None
        if kind == "speech_synthesis":
            await self.synthesize(task_id)
        elif kind == "transcription":
            await self.transcribe(task_id)
        elif kind:
            await self.driver.process(task_id)

    async def inputs(self, task):
        async with self.session_factory(info={"owner_user_id": task.owner_user_id}) as session:
            assets = list(
                await session.scalars(
                    select(ModelInferenceAsset).where(
                        ModelInferenceAsset.task_id == task.task_id,
                        ModelInferenceAsset.owner_user_id == task.owner_user_id,
                    )
                )
            )
            return {
                row.id: (
                    self.storage.root(task.owner_user_id) / "inputs" / row.storage_key,
                    row.mime_type,
                    row.filename,
                    row.byte_size,
                )
                for row in assets
            }

    async def submit(self, task):
        assets = await self.inputs(task)

        async def image_url(identity):
            path, mime, _, _ = assets[identity]
            return await read_data_uri(path=path, mime_type=mime)

        async def media_url(identity):
            path, mime, _, _ = assets[identity]
            return await upload_temporary_reference(
                path=path,
                mime_type=mime,
                upload_url=self.settings.fpl_temp_media_upload_url,
                transport=self.transport,
            )

        payload = task.payload
        image_reference = None
        if payload.get("reference_asset_id"):
            image_reference = await image_url(payload["reference_asset_id"])
        content = [{"type": "text", "text": payload.get("prompt", "")}]
        for field, role in (
            ("first_frame_asset_id", "first_frame"),
            ("last_frame_asset_id", "last_frame"),
        ):
            if payload.get(field):
                content.append(
                    {"type": "image", "url": await image_url(payload[field]), "role": role}
                )
        audio_urls = []
        for identity in payload.get("reference_asset_ids", []):
            if task.provider_kind == "senseaudio_music":
                audio_urls.append(await media_url(identity))
            else:
                content.append(
                    {"type": "image", "url": await image_url(identity), "role": "reference"}
                )
        for field, kind in (("audio_asset_ids", "audio"), ("video_asset_ids", "video")):
            for identity in payload.get(field, []):
                content.append(
                    {
                        "type": kind,
                        f"{kind}_url": await image_url(identity)
                        if task.provider_kind == "autodl_video"
                        or (kind == "audio" and task.provider_kind == "volcengine_video")
                        else await media_url(identity),
                    }
                )
        return await submit_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            model_slug=task.model_slug,
            payload=payload,
            image_reference=image_reference,
            image_references=[
                await image_url(identity)
                for identity in dict.fromkeys(
                    [
                        *payload.get("reference_asset_ids", []),
                        *(
                            [payload["reference_asset_id"]]
                            if payload.get("reference_asset_id")
                            else []
                        ),
                    ]
                )
            ],
            video_content=content,
            audio_reference_urls=audio_urls,
        )

    async def poll(self, task):
        return await poll_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            provider_task_id=task.provider_task_id,
        )

    async def materialize(self, task_id, result_url):
        async with self.session_factory() as session:
            row = await self.store.load(session, task_id)
            if not row or row.status != "processing":
                return
            owner_user_id, expected_kind = row.owner_user_id, row.kind
        output = self.storage.root(owner_user_id) / "outputs"
        output.mkdir(parents=True, exist_ok=True)
        key = uuid4().hex
        temporary, final = output / (key + ".tmp"), output / key
        try:
            size, media_kind, mime, suffix = await download_generated_media(
                url=result_url,
                target=temporary,
                max_bytes=self.settings.fpl_visual_asset_max_bytes,
                transport=self.transport,
            )
            expected_media = (
                "audio" if expected_kind in {"music", "sound_effect"} else expected_kind
            )
            if media_kind != expected_media:
                raise ValueError("模型输出媒体类型与任务不一致")
            os.replace(temporary, final)
            if not await self.finish(task_id, key, f"{task_id}{suffix}", mime, size, {}):
                final.unlink(missing_ok=True)
        except asyncio.CancelledError:
            temporary.unlink(missing_ok=True)
            # A cancelled commit may already have referenced the final file; recovery checks it.
            raise
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            await self.store.fail(task_id, safe_generation_error(exc), result_url=result_url)

    async def finish(self, task_id, key, filename, mime, size, result):
        async with self.session_factory() as session:
            row = await self.store.load(session, task_id)
            if row is None or row.status not in ACTIVE:
                return False
            row.result_storage_key, row.result_filename = key, filename
            row.result_mime_type, row.result_byte_size = mime, size
            row.result, row.status, row.progress = result, "completed", 100
            row.revision += 1
            row.updated_at = utc_now()
            log = await session.get(LlmCallLog, row.log_id) if row.log_id else None
            if log:
                log.status = "success"
                log.error_message = None
                log.response_payload = {"task_id": row.id, "status": "completed", "result": result}
            else:
                row.log_id = None
                add_log(session, row)
            if self.terminal_settlement:
                await self.terminal_settlement(session)
            await session.commit()
            return True

    async def transcribe(self, task_id):
        try:
            task = await self.store.claim(task_id)
            if task is None or task.status != "queued":
                return
            assets = await self.inputs(task)
            path, mime, filename, size = next(iter(assets.values()))
            with path.open("rb") as source:
                result = await transcribe_model_audio(
                    provider_kind=task.provider_kind,
                    base_url=task.base_url,
                    api_key=task.api_key,
                    model=task.model_slug,
                    filename=filename,
                    source=source,
                    mime_type=mime,
                    byte_size=size,
                    language=task.payload.get("language", "auto"),
                    parameters=task.payload,
                    transport=self.transport,
                )
            payload = asdict(result)
            content = json.dumps(payload, ensure_ascii=False).encode()
            key = uuid4().hex
            path = self.storage.root(task.owner_user_id) / "outputs" / key
            path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(path.write_bytes, content)
            await self.finish(
                task_id, key, f"{task_id}.json", "application/json", len(content), payload
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.store.fail(task_id, safe_generation_error(exc))

    async def synthesize(self, task_id):
        # The owning native broker must retain foreground settlement authority
        # until finish (including an uncertain commit) has completely returned.
        with self.synthesis_scope(task_id):
            return await self._synthesize(task_id)

    async def _synthesize(self, task_id):
        output = None
        settling = False
        try:
            task = await self.store.claim(task_id)
            if task is None or task.status != "queued":
                return
            if self.local_runtime is None:
                raise ValueError("本地语音运行环境不可用")
            inputs = await self.inputs(task)
            source = inputs[task.payload["reference_asset_id"]][0]
            key = uuid4().hex
            output = self.storage.root(task.owner_user_id) / "outputs" / key
            output.parent.mkdir(parents=True, exist_ok=True)
            result = await synthesize(
                self.local_runtime, self.session_factory, task, source, output
            )
            if (
                not output.is_file()
                or output.stat().st_size > self.settings.fpl_visual_asset_max_bytes
            ):
                raise ValueError("本地语音输出无效或超过大小限制")
            settling = True
            if not await self.finish(
                task_id, key, f"{task_id}.wav", "audio/wav", output.stat().st_size, result
            ):
                output.unlink(missing_ok=True)
        except asyncio.CancelledError:
            raise
        except NativeSubmissionUncertain:
            # The broker owns the immutable job and receipt. Keep the original
            # submitting task and reservation until reconciliation confirms it.
            return
        except Exception as exc:
            if settling:
                # Commit may have completed. Preserve these bytes and let the
                # original native receipt reconcile the outcome, never resubmit.
                return
            if output:
                output.unlink(missing_ok=True)
            await self.store.fail(task_id, safe_generation_error(exc))
