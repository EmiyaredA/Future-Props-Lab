"""Model definitions and explicit deployment readiness; no host probes in containers."""

from typing import Protocol

from studio.apps.model_service.storage.models.local_models import LocalModelInstallation
from studio.config.local_models import HERE as HERE
from studio.config.local_models import LANGUAGES as LANGUAGES
from studio.config.local_models import compatible as compatible
from studio.config.local_models import definition as definition
from studio.config.local_models import local_root as local_root
from studio.config.local_models import manifest as manifest
from studio.runtime.database.operation_receipts import OperationError


class ModelReadiness(Protocol):
    """Read current worker readiness using the caller's account-scoped store."""

    async def host_compatible(self, session) -> bool: ...
    async def require_ready(self, session, model_id: str): ...


async def host_compatible(session, *, readiness: ModelReadiness | None = None):
    if readiness is not None:
        return await readiness.host_compatible(session)
    return compatible()


async def require_ready(session, model_id, *, readiness: ModelReadiness | None = None):
    definition(model_id)
    if readiness is not None:
        return await readiness.require_ready(session, model_id)
    if not compatible():
        raise OperationError("本地语音需要受支持的 Apple Silicon Mac", "unsupported_platform", 409)
    row = await session.get(LocalModelInstallation, model_id, populate_existing=True)
    if not row or row.status != "installed" or not row.enabled:
        raise OperationError(
            "本地模型未安装或已停止，请在模型服务中管理", "local_model_unavailable", 409
        )
    return row


def credential_ready(provider):
    return provider.kind in {
        "local_qwen_tts",
        "local_relayvsr",
        "local_ffmpeg",
        "zealman_video",
    } or bool(provider.api_key_ciphertext)
