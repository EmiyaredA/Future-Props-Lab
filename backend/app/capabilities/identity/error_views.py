"""Safe domain snapshots; ORM credentials never enter conflict responses."""

import json
from datetime import datetime

from app.capabilities.identity.errors import AccountError

MESSAGES = {
    "invalid_invite_name": "请输入邀请码名称",
    "demo_service_already_installed": "当前工作区已经接入此测试服务，请在模型或集成目录中查看",
    "runtime_quota_exceeded": "当前并发额度已用完，请等待已有任务完成后再提交",
    "developer_docs_required": "当前身份不能查看开发者文档",
    "registration_invite_unavailable": "邀请码无效、已过期或已用完",
    "invite_quota_below_usage": "名额不能少于已经兑换的数量",
    "reauthentication_required": "请重新验证密码",
    "cannot_disable_or_demote_self": "不能禁用或降级当前账号",
    "last_platform_admin": "必须保留至少一位启用的超级管理员",
    "role_assignment_forbidden": "不能修改该成员或授予此角色",
    "workspace_owner_required": "需要工作区管理员权限",
    "platform_admin_required": "需要超级管理员权限",
    "owner_not_found": "请选择一个启用账号作为拥有者",
    "invitee_not_found": "未找到可以邀请的启用账号",
    "invitation_already_pending": "该账号已有待处理邀请",
    "already_a_member": "该账号已是工作区成员",
    "username_conflict": "用户名已被使用",
    "account_conflict": "用户名或邮箱已被使用",
    "invalid_email": "请输入有效邮箱",
    "invalid_api_key_scopes": "当前工作区权限不允许使用这些密钥权限",
    "api_key_revoked": "已撤销的密钥不能续期",
}

SAFE_FIELDS = (
    "id",
    "name",
    "username",
    "display_name",
    "email",
    "status",
    "is_platform_admin",
    "platform_role",
    "visibility",
    "role",
    "revision",
    "user_id",
    "workspace_id",
    "expires_at",
)


def error_detail(exc: AccountError) -> tuple[int, dict]:
    code = exc.code
    status = (
        429
        if code == "runtime_quota_exceeded"
        else 404
        if code.endswith("not_found")
        else 409
        if code in {"revision_conflict", "workspace_access_changed"} or code.endswith("conflict")
        else 401
        if code == "studio_auth_required"
        else 403
        if code.endswith("required") or code == "role_assignment_forbidden"
        else 422
    )
    detail: dict = {
        "code": code,
        "message": MESSAGES.get(
            code, "未找到此记录" if status == 404 else "操作未完成，请刷新后重试"
        ),
    }
    if code == "revision_conflict" and exc.current is not None:
        current = (
            json.loads(json.dumps(exc.current, default=lambda value: value.isoformat()))
            if isinstance(exc.current, dict)
            else {}
        )
        for field in SAFE_FIELDS:
            if hasattr(exc.current, field):
                value = getattr(exc.current, field)
                current[field] = value.isoformat() if isinstance(value, datetime) else value
        detail.update(message="内容已被其他操作更新，请核对最新状态后重试", current=current)
    return status, detail
