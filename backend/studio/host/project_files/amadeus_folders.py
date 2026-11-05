"""Trusted local Finder operation for an explicitly configured conversation root."""

import subprocess
import sys
from pathlib import Path

from studio.apps.amadeus.storage.files import work_root
from studio.runtime.database.operation_receipts import OperationError


def open_work_folder(owner_user_id: str, conversation_id: str, *, files_root: Path) -> None:
    if sys.platform != "darwin":
        raise OperationError("只支持 macOS 桌面打开会话目录", "unsupported_platform", 409)
    root = work_root(owner_user_id, conversation_id, files_root=files_root)
    if root.is_symlink():
        raise OperationError("会话目录不安全")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    subprocess.Popen(
        ["/usr/bin/open", str(root)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
