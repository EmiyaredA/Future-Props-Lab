"""Owned job kinds and immutable execution input, independent of authorization storage."""

import hashlib
import json

from app.llm.models import ModelInferenceTask, ModelTestGenerationTask, ModelTestTranscriptionTask

from .visual_generation_records import VisualProviderTask

TASK_MODELS = {
    "visual": VisualProviderTask,
    "inference": ModelInferenceTask,
    "model": ModelTestGenerationTask,
    "transcription": ModelTestTranscriptionTask,
}


def task_fingerprint(kind, task):
    if kind not in TASK_MODELS or not isinstance(task, TASK_MODELS[kind]):
        raise ValueError("任务不属于 Models 服务")
    fields = ["id", "owner_user_id", "provider_id", "model_id", "provider_kind", "model_slug"]
    if kind == "transcription":
        fields += [
            "source_kind",
            "source_asset_id",
            "input_storage_key",
            "input_filename",
            "input_mime_type",
            "input_byte_size",
            "language",
            "request_options",
        ]
    else:
        fields += ["request_payload", "kind" if kind == "inference" else "generation_kind"]
    if kind == "inference":
        fields += ["request_id", "fingerprint"]
    encoded = json.dumps(
        {"kind": kind, "input": {name: getattr(task, name) for name in fields}},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()
