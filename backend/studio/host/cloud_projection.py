"""Publish the Mac cloud configuration to isolated owner views."""

import hashlib
import os
import stat
import tempfile
import tomllib
from pathlib import Path

import tomlkit

from studio.config import ConfigurationError, flatten
from studio.config.cloud_projection import COMMIT, FILES, checked_read

DEFAULTS = {
    "enabled": False,
    "public_enabled": False,
    "public_desktop_vnc_only": False,
    "admin_user_ids": [],
    "host_label": "Mac",
    "apps_enabled": False,
    "apps_allowed": [],
}


class CloudPublisher:
    def __init__(self, root: Path):
        self.root = root.resolve(strict=True)
        if root.is_symlink() or not self.root.is_dir():
            raise ValueError("云控投影根目录必须为已存在的真实目录")
        for name in (*FILES, "committed"):
            path = self.root / name
            path.mkdir(mode=0o700, exist_ok=True)
            if (
                path.is_symlink()
                or not path.is_dir()
                or path.stat().st_uid != os.getuid()
                or stat.S_IMODE(path.stat().st_mode) & 0o077
            ):
                raise ValueError("云控投影必须保存在本机用户专用目录")

    def prepare(self, raw):
        try:
            parsed = tomllib.loads(raw.decode())
        except (UnicodeError, tomllib.TOMLDecodeError):
            raise ConfigurationError("Mac 云控配置格式无效") from None
        flatten(parsed)
        cloud = parsed.get("cloud_control", {})
        releases = {}
        for owner, fields in FILES.items():
            values = {field: cloud.get(field, DEFAULTS[field]) for field in sorted(fields)}
            data = tomlkit.dumps({"cloud_control": values}).encode()
            digest = hashlib.sha256(data).hexdigest()
            path = self.root / owner / (digest + ".toml")
            try:
                existing = checked_read(path)
            except FileNotFoundError:
                publish(path, data)
            else:
                if existing != data:
                    raise ConfigurationError("云控配置投影与已有摘要冲突")
            releases[owner] = digest
        return tomlkit.dumps(releases).encode()

    def commit(self, generation):
        path = self.root / "committed" / COMMIT
        try:
            old = checked_read(path)
        except FileNotFoundError:
            old = None
        if old != generation:
            publish(path, generation)

    def synchronize(self, raw):
        self.commit(self.prepare(raw))


def publish(target, data):
    fd, name = tempfile.mkstemp(prefix=".cloud-settings-", dir=target.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(staged, target)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        staged.unlink(missing_ok=True)
