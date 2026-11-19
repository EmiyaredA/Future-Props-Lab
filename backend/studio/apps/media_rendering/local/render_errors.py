"""Safe render failure messages, keeping FFmpeg diagnostics on the server."""

import errno
import signal
from typing import BinaryIO


class RenderFailure(RuntimeError):
    def __init__(self, message: str, *, diagnostic: str = ""):
        super().__init__(message)
        self.diagnostic = diagnostic


def process_failure(stage: str, returncode: int, stderr: BinaryIO) -> RenderFailure:
    stderr.seek(0, 2)
    stderr.seek(max(0, stderr.tell() - 4000))
    diagnostic = stderr.read().decode(errors="replace")
    if returncode == -signal.SIGKILL:
        message = f"{stage}进程被系统终止，可能是内存不足；请降低导出规格后重试或联系管理员"
    else:
        message = f"{stage}失败；请联系管理员并提供任务编号"
    return RenderFailure(message, diagnostic=f"exit={returncode}\n{diagnostic}")


def render_failure_message(exc: Exception, job_id: str) -> str:
    if isinstance(exc, RenderFailure):
        message = str(exc)
    elif isinstance(exc, MemoryError) or (isinstance(exc, OSError) and exc.errno == errno.ENOMEM):
        message = "渲染内存不足；请降低导出规格后重试或联系管理员"
    elif isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
        message = "渲染磁盘空间不足；请联系管理员清理空间后重试"
    else:
        message = "剪辑成片渲染失败；请联系管理员并提供任务编号"
    return f"{message}（任务 {job_id[:8]}）"
