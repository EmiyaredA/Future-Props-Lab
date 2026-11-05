"""Persistent execution outcomes shared by recovery and capacity accounting."""

SUBMISSION_INTERRUPTED_MESSAGE = "应用在提交供应商任务期间中断；为避免重复计费，请重新生成"
TERMINAL_STATUSES = ("completed", "succeeded", "failed", "cancelled", "canceled")


class TaskClaimRejected(ValueError):
    """A queued task may be rejected only inside its serialized claim transaction."""


class NativeSubmissionUncertain(RuntimeError):
    """The original native execution has no confirmed outcome and must never be reissued."""


def confirmed_terminal(task):
    return task.status in TERMINAL_STATUSES and task.error_message != SUBMISSION_INTERRUPTED_MESSAGE
