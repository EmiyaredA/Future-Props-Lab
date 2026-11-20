"""Read-only pinned model definitions. Importing this module never downloads anything."""

import json
import platform
from functools import lru_cache
from pathlib import Path

from studio.runtime.operation_errors import OperationError

HERE = Path(__file__).parent
RELAY_MODEL_ID = "relayvsr-x2-int8"
FFMPEG_MODEL_ID = "ffmpeg-video-sharpen"
ZONOS_MODEL_ID = "zonos3-mini"
LOCAL_SPEECH_PROVIDER_KINDS = frozenset({"local_qwen_tts", "local_zonos_tts"})
LOCAL_VIDEO_MODEL_IDS = {RELAY_MODEL_ID, FFMPEG_MODEL_ID}
LANGUAGES = [
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]


@lru_cache
def manifest():
    return json.loads((HERE / "local_models.json").read_text())


def definition(model_id):
    for item in manifest()["models"]:
        if item["id"] == model_id:
            return item
    raise OperationError("本地模型不存在", "not_found", 404)


def compatible():
    return (
        platform.system() == "Darwin"
        and platform.machine() == "arm64"
        and tuple(map(int, platform.mac_ver()[0].split(".")[:2])) >= (15, 0)
    )


def required_disk_bytes(model):
    """Peak installation budget: verified download, staged weights and environment."""
    if model["id"] == FFMPEG_MODEL_ID:
        return 0
    return sum(item["size"] for item in model["files"]) * 2 + model.get(
        "environment_disk_bytes", 2 * 1024**3
    )


def local_root(settings):
    runtime = settings.runtime_path
    return (runtime.parent if runtime.name == "runtime" else runtime) / "local-models"
