"""Model definitions and explicit deployment readiness; no host probes in containers."""

from app.llm.models.local_models import LocalModelInstallation
from studio.config.local_models import HERE as HERE
from studio.config.local_models import LANGUAGES as LANGUAGES
from studio.config.local_models import compatible as compatible
from studio.config.local_models import definition as definition
from studio.config.local_models import local_root as local_root
from studio.config.local_models import manifest as manifest
from studio.runtime.database.operation_receipts import OperationError


async def host_compatible(session):
    adapter = session.info.get("native_model_readiness")
    if adapter is not None:
        return await adapter.host_compatible(session)
    return False if session.info.get("service_id") == "models" else compatible()


async def require_ready(session, model_id):
    definition(model_id)
    adapter = session.info.get("native_model_readiness")
    if adapter is not None:
        return await adapter.require_ready(session, model_id)
    if session.info.get("service_id") == "models":
        raise OperationError("原生模型状态尚未绑定", "native_model_worker_unavailable", 503)
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
