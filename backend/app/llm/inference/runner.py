import asyncio
import json
import os
from dataclasses import asdict
from uuid import uuid4

from sqlalchemy import select

from app.concurrency.polling_runner import PollingTaskRunner
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.time import utc_now
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
from app.llm.inference.assets import root
from app.llm.inference.tasks import ACTIVE
from app.llm.providers.transcription import transcribe_model_audio
from app.llm.call_logs.credentials import snapshot_from_row
from app.models import LlmCallLog, Workspace
from app.models.model_inference import ModelInferenceAsset, ModelInferenceTask


def add_log(session, row):
    if row.log_id:
        return
    row.log_id = str(uuid4())
    credential = snapshot_from_row(row)
    session.add(
        LlmCallLog(
            id=row.log_id,
            workspace_id=row.workspace_id,
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

    def __init__(self, session_factory=SessionLocal, transport=None):
        super().__init__()
        self.session_factory, self.transport = session_factory, transport
        self.store = GenerationTaskStore(
            session_factory=session_factory,
            task_type=ModelInferenceTask,
            active_statuses=ACTIVE,
            task_subject="independent model task",
            terminal_hook=add_log,
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
        async with self.session_factory() as session:
            workspaces = list(await session.scalars(select(Workspace.id)))
            outputs = set(
                (
                    await session.execute(
                        select(
                            ModelInferenceTask.workspace_id, ModelInferenceTask.result_storage_key
                        )
                    )
                ).all()
            )

            inputs = set(
                (
                    await session.execute(
                        select(ModelInferenceAsset.workspace_id, ModelInferenceAsset.storage_key)
                    )
                ).all()
            )

        def cleanup():
            for workspace_id in workspaces:
                for kind, references in (("outputs", outputs), ("inputs", inputs)):
                    directory = root(workspace_id) / kind
                    if directory.is_dir():
                        for path in directory.iterdir():
                            if path.is_file() and (workspace_id, path.name) not in references:
                                path.unlink(missing_ok=True)

        await asyncio.to_thread(cleanup)

    async def process_once(self):
        await self.run_concurrently(await self.store.active_task_ids(), self.process)

    async def process(self, task_id):
        async with self.session_factory() as session:
            row = await self.store.load(session, task_id)
            kind = row.kind if row else None
        if kind == "transcription":
            await self.transcribe(task_id)
        elif kind:
            await self.driver.process(task_id)

    async def inputs(self, task):
        async with self.session_factory() as session:
            assets = list(
                await session.scalars(
                    select(ModelInferenceAsset).where(
                        ModelInferenceAsset.task_id == task.task_id,
                        ModelInferenceAsset.workspace_id == task.workspace_id,
                    )
                )
            )
            return {
                row.id: (
                    root(task.workspace_id) / "inputs" / row.storage_key,
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
                upload_url=get_settings().fpl_temp_media_upload_url,
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
                content.append({"type": kind, f"{kind}_url": await media_url(identity)})
        return await submit_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            model_slug=task.model_slug,
            payload=payload,
            image_reference=image_reference,
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
            workspace_id, expected_kind = row.workspace_id, row.kind
        output = root(workspace_id) / "outputs"
        output.mkdir(parents=True, exist_ok=True)
        key = uuid4().hex
        temporary, final = output / (key + ".tmp"), output / key
        try:
            size, media_kind, mime, suffix = await download_generated_media(
                url=result_url,
                target=temporary,
                max_bytes=get_settings().fpl_visual_asset_max_bytes,
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
            path = root(task.workspace_id) / "outputs" / key
            path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(path.write_bytes, content)
            await self.finish(
                task_id, key, f"{task_id}.json", "application/json", len(content), payload
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.store.fail(task_id, safe_generation_error(exc))
