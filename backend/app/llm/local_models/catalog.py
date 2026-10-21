"""Read-only pinned model definitions. Importing this module never downloads anything."""

import json
import platform
from functools import lru_cache
from pathlib import Path

from app.llm.models.local_models import LocalModelInstallation
from app.runtime.operation_receipts import OperationError

HERE = Path(__file__).parent
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
    return json.loads((HERE / "manifest.json").read_text())


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


def local_root(settings):
    runtime = settings.runtime_path
    return (runtime.parent if runtime.name == "runtime" else runtime) / "local-models"


async def require_ready(session, model_id):
    definition(model_id)
    if not compatible():
        raise OperationError("本地语音需要受支持的 Apple Silicon Mac", "unsupported_platform", 409)
    row = await session.get(LocalModelInstallation, model_id, populate_existing=True)
    if not row or row.status != "installed" or not row.enabled:
        raise OperationError(
            "本地模型未安装或已停止，请在模型服务中管理", "local_model_unavailable", 409
        )
    return row


def credential_ready(provider):
    return provider.kind in {"local_qwen_tts", "zealman_video"} or bool(provider.api_key_ciphertext)
