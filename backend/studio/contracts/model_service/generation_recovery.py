"""Shared recovery meaning for provider results; never resubmits an unknown action."""

POLL_RETRY_PREFIX = "供应商状态查询暂时失败"
LEGACY_POLL_ERRORS = frozenset(
    f"任务处理失败（{name}）"
    for name in (
        "ConnectError",
        "ConnectTimeout",
        "ReadError",
        "ReadTimeout",
        "WriteError",
        "WriteTimeout",
        "PoolTimeout",
        "RemoteProtocolError",
        "ProxyError",
    )
)


def can_recover_generation_result(task) -> bool:
    if task.status != "failed":
        return False
    if task.result_url:
        return True
    message = task.error_message or ""
    return bool(task.provider_task_id) and (
        message in LEGACY_POLL_ERRORS or message.startswith(POLL_RETRY_PREFIX)
    )
