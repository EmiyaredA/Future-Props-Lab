"""Import completed Models task outputs and reuse an exact original in Assets."""

import asyncio
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx

from studio.apps.audio_annotation.sources import AudioAnnotationError, TranscriptionSource
from studio.contracts.audio_annotation.task_sources import (
    MAX_BYTES,
    READ,
    TASKS,
    UPLOADS,
    WRITE,
    AnnotationTaskOriginal,
    TranscriptionTask,
)
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

EXTENSIONS = {".wav", ".mp3", ".ogg", ".m4a"}


def unavailable():
    return AudioAnnotationError(
        "识别任务源文件暂不可用", code="transcription_unavailable", status=503
    )


class TaskSources:
    def __init__(self, inputs):
        self.inputs = inputs

    async def token(self, target, *, method, path, purpose):
        connection, capabilities = self.inputs.connection, self.inputs.capabilities
        grant = RequestGrant(
            "annotation", purpose, connection.method, connection.url.path, target, method, path
        )
        try:
            return await capabilities.authorize_request(connection.state.service_assertion, grant)
        except CapabilityDenied as exc:
            raise AudioAnnotationError(
                "当前账号无权导入识别任务", code="transcription_forbidden", status=exc.status
            ) from exc
        except CapabilityUnavailable as exc:
            raise unavailable() from exc

    async def metadata(self, task_id):
        path = f"{TASKS}/{task_id}"
        token = await self.token("models", method="GET", path=path, purpose=READ)
        try:
            response = await self.inputs.capabilities.client.get(
                "http://models:8080" + path, headers={"X-Fpl-Context": token}
            )
            if response.status_code == 404:
                raise AudioAnnotationError("识别任务不存在", code="not_found", status=404)
            response.raise_for_status()
            task = TranscriptionTask.model_validate_json(response.content)
            if task.id != task_id:
                raise ValueError("task id mismatch")
        except (httpx.HTTPError, ValueError) as exc:
            raise unavailable() from exc
        if task.status != "completed":
            raise AudioAnnotationError(
                "只有已完成的识别任务可以导入标注", code="transcription_not_completed", status=409
            )
        return task

    @asynccontextmanager
    async def original(self, task):
        source = task.source
        suffix = Path(source.filename).suffix.lower()
        if not source.available:
            raise AudioAnnotationError(
                "识别任务的源音频已不存在", code="source_not_found", status=404
            )
        if suffix not in EXTENSIONS:
            raise AudioAnnotationError("源音频格式不支持导入", code="invalid_audio")
        path = f"{TASKS}/{task.id}/input-content"
        token = await self.token("models", method="GET", path=path, purpose=READ)
        with tempfile.TemporaryDirectory(prefix="task-source-", dir=self.inputs.staging) as folder:
            target = Path(folder) / ("original" + suffix)
            try:
                async with self.inputs.capabilities.client.stream(
                    "GET",
                    "http://models:8080" + path,
                    headers={"X-Fpl-Context": token, "Accept-Encoding": "identity"},
                    timeout=httpx.Timeout(120, connect=5),
                ) as response:
                    if response.status_code == 404:
                        raise AudioAnnotationError(
                            "识别任务的源音频已不存在", code="source_not_found", status=404
                        )
                    response.raise_for_status()
                    if (
                        response.headers.get("Content-Encoding", "identity") != "identity"
                        or response.headers.get("Content-Type") != source.mime_type
                        or int(response.headers["Content-Length"]) != source.byte_size
                    ):
                        raise ValueError("source metadata mismatch")
                    length = 0
                    with target.open("xb") as handle:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                            length += len(chunk)
                            if length > source.byte_size:
                                raise ValueError("source length mismatch")
                            await asyncio.to_thread(handle.write, chunk)
                    if length != source.byte_size:
                        raise ValueError("source length mismatch")
            except (httpx.HTTPError, KeyError, ValueError, OSError) as exc:
                raise unavailable() from exc
            yield target

    @asynccontextmanager
    async def load(self, task_id):
        task = await self.metadata(task_id)
        audio = (
            await self.inputs.describe(task.source.source_asset_id)
            if task.source.source_asset_id
            else None
        )
        text = task.result_text or ""
        if (
            audio is not None
            and audio.description.media_kind == "audio"
            and audio.byte_size <= MAX_BYTES
        ):
            yield TranscriptionSource(audio, task.source.filename, text, task.result_segments)
            return
        async with self.original(task) as path:
            yield TranscriptionSource(
                None,
                task.source.filename,
                text,
                task.result_segments,
                original=path,
                mime_type=task.source.mime_type,
                task_id=task.id,
            )

    async def publish(self, source):
        try:
            description = await asyncio.to_thread(
                AnnotationTaskOriginal.from_file, source.original, source.filename, source.mime_type
            )
        except (OSError, ValueError) as exc:
            raise AudioAnnotationError("源音频描述无效", code="invalid_audio") from exc
        path = f"{UPLOADS}/{source.task_id}/{description.fingerprint}"
        token = await self.token("assets", method="POST", path=path, purpose=WRITE)

        async def content():
            with source.original.open("rb") as handle:
                while chunk := await asyncio.to_thread(handle.read, 1024 * 1024):
                    yield chunk

        try:
            result = await self.inputs.capabilities.client.post(
                "http://assets:8080" + path,
                headers={
                    "X-Fpl-Context": token,
                    "X-Fpl-Output-Descriptor": description.header(),
                    "Content-Length": str(description.byte_size),
                    "Content-Type": "application/octet-stream",
                },
                content=content(),
                timeout=httpx.Timeout(180, connect=5),
            )
            if result.status_code in {409, 413, 422}:
                problem = result.json()
                raise AudioAnnotationError(
                    str(problem.get("detail") or "无法保存识别原件")[:1000],
                    code=problem.get("code") or "transcription_original_invalid",
                    status=result.status_code,
                )
            result.raise_for_status()
            asset_id = result.json()["id"]
            audio = await self.inputs.describe(asset_id)
            if (
                audio is None
                or audio.description.media_kind != "audio"
                or audio.byte_size != description.byte_size
            ):
                raise ValueError("asset receipt mismatch")
            return audio
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise unavailable() from exc
