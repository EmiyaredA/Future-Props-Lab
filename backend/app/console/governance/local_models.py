"""Only browser-authenticated platform administrators manage shared host resources."""

from app.runtime.operation_receipts import OperationError


def can_manage_local_models(principal):
    return principal.auth_kind == "session" and principal.platform_role in {"admin"}


async def manage_local_model(manager, principal, model_id, body):
    if not can_manage_local_models(principal):
        raise OperationError("需要平台管理员浏览器会话", "platform_admin_required", 403)
    return await manager.action(model_id, body)
