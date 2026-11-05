"""One process owns a service data directory, including maintenance commands."""

import fcntl
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def service_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / ".service.lock"
    if path.is_symlink():
        raise ValueError("服务锁不能是符号链接")
    with path.open("a+b") as stream:
        path.chmod(0o600)
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("服务数据目录已由另一个实例使用") from None
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
