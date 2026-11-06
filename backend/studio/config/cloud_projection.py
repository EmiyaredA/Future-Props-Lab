"""Read the committed cloud settings generation visible to a single owner."""

import hashlib
import os
import re
import stat
import tomllib
from dataclasses import dataclass
from pathlib import Path

from . import ConfigurationError, flatten

FILES = {
    "identity": frozenset(
        {"enabled", "public_enabled", "public_desktop_vnc_only", "admin_user_ids"}
    ),
    "remote": frozenset({"host_label", "apps_enabled", "apps_allowed"}),
}
COMMIT = "cloud-settings.toml"
MAX_BYTES = 64 * 1024
SHA256 = re.compile(r"[0-9a-f]{64}")


def checked_read(path: Path, maximum: int = MAX_BYTES) -> bytes:
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            raise ConfigurationError("云控配置投影类型或长度无效")
        contents = file.read(maximum + 1)
    if len(contents) != info.st_size:
        raise ConfigurationError("云控配置投影读取期间发生变化")
    return contents


@dataclass(frozen=True)
class CloudProjection:
    owner: str
    directory: Path
    commit_directory: Path

    def __post_init__(self):
        if self.owner not in FILES or self.directory == self.commit_directory:
            raise ConfigurationError("云控配置投影归属无效")

    def read(self):
        try:
            generation = tomllib.loads(checked_read(self.commit_directory / COMMIT).decode())
            if generation.keys() != FILES.keys() or any(
                not isinstance(digest, str) or SHA256.fullmatch(digest) is None
                for digest in generation.values()
            ):
                raise ConfigurationError("云控配置提交记录无效")
            digest = generation[self.owner]
            data = checked_read(self.directory / (digest + ".toml"))
            if hashlib.sha256(data).hexdigest() != digest:
                raise ConfigurationError("云控配置投影摘要不匹配")
            document = tomllib.loads(data.decode())
            cloud = document.get("cloud_control")
            if document.keys() != {"cloud_control"} or not isinstance(cloud, dict):
                raise ConfigurationError("云控配置投影包含未授权字段")
            # The previous Remote projection carries just the host label.
            # Treat missing app policy as disabled until the Mac publishes it.
            if self.owner == "remote" and cloud.keys() == {"host_label"}:
                cloud.update(apps_enabled=False, apps_allowed=[])
            if cloud.keys() != FILES[self.owner]:
                raise ConfigurationError("云控配置投影包含未授权字段")
            return flatten(document)
        except (OSError, UnicodeError, tomllib.TOMLDecodeError):
            raise ConfigurationError("已提交的云控配置投影暂不可读") from None
