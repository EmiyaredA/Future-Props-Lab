"""Only an authenticated administrator browser may manage shared host models."""

from dataclasses import dataclass

from studio.runtime.database.operation_receipts import OperationError


@dataclass(frozen=True)
class LocalModelActionAuthorization:
    owner_user_id: str
    assertion: str
    method: str
    path: str


def can_manage_local_models(principal):
    return principal.auth_kind == "session" and principal.platform_role == "admin"


async def manage_local_model(manager, principal, model_id, body, *, authorization=None):
    if not can_manage_local_models(principal):
        raise OperationError("需要平台管理员浏览器会话", "platform_admin_required", 403)
    if authorization is not None:
        if authorization.owner_user_id != principal.user_id:
            raise OperationError("原生模型操作账号不匹配", "account_context_mismatch", 403)
        return await manager.action(model_id, body, authorization=authorization)
    return await manager.action(model_id, body)
