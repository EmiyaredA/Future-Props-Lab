"""Translate the provider-independent synthesis contract into a private MLX request."""

import asyncio
import json
import shutil
from pathlib import Path

from studio.apps.model_service.local_models.catalog import LANGUAGES, require_ready
from studio.runtime.database.operation_receipts import OperationError

MAX_REFERENCE_BYTES = 20 * 1024**2
MIN_REFERENCE_SECONDS, MAX_REFERENCE_SECONDS = 3, 30


def speech_parameters(provider_kind="local_qwen_tts"):
    return {
        "languages": ["Chinese", "English", "Japanese"]
        if provider_kind == "local_zonos_tts"
        else LANGUAGES,
        "reference_text_required": provider_kind != "local_zonos_tts",
        **(
            {
                "clone_modes": ["embedding", "reference"],
                "emotions": ["neutral", "happy", "angry", "sad", "serene", "scared", "confused"],
                "supports_seed": True,
            }
            if provider_kind == "local_zonos_tts"
            else {}
        ),
        "max_text_length": 2000,
        "max_reference_bytes": MAX_REFERENCE_BYTES,
        "min_reference_seconds": MIN_REFERENCE_SECONDS,
        "max_reference_seconds": MAX_REFERENCE_SECONDS,
        "reference_extensions": [".wav", ".mp3", ".m4a", ".ogg"],
    }


async def inspect_reference(path):
    process = await asyncio.create_subprocess_exec(
        shutil.which("ffprobe") or "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), 20)
        value = json.loads(stdout)
        duration = float(value["format"]["duration"])
        if process.returncode or not any(x.get("codec_type") == "audio" for x in value["streams"]):
            raise ValueError()
        if not MIN_REFERENCE_SECONDS <= duration <= MAX_REFERENCE_SECONDS:
            raise OperationError("参考录音需要 3–30 秒", "invalid_reference", 422)
    except (ValueError, KeyError):
        raise OperationError("无法解码参考录音", "invalid_reference", 422) from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def synthesize(runtime, sessions, task, source, output, *, readiness=None):
    async def validate():
        async with sessions() as session:
            await require_ready(session, task.model_slug, readiness=readiness)

    payload = {key: task.payload[key] for key in ("text", "language", "reference_text")}
    if task.provider_kind == "local_zonos_tts":
        payload.update(
            {
                key: task.payload[key]
                for key in ("clone_mode", "emotion", "emotion_strength", "seed")
            }
        )
    payload.update(
        task_id=task.task_id,
        reference_path=str(Path(source).resolve()),
        output_path=str(output.resolve()),
    )
    return await runtime.synthesize(task.model_slug, payload, validate)
