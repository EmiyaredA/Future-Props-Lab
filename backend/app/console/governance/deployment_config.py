"""Revision-checked updates to the shared deployment TOML."""

import fcntl
import hashlib
import os
import tempfile
import tomllib
from pathlib import Path

import tomlkit
from fastapi import HTTPException

from studio.config import ConfigurationError, flatten
from studio.config.settings import Settings


def config_bytes(path):
    try:
        if path.is_symlink():
            raise OSError
        return path.read_bytes()
    except OSError:
        raise HTTPException(409, "本机部署配置文件不可用") from None


def revision(raw):
    return hashlib.sha256(raw).hexdigest()


def replace_config(path, expected, edit):
    lock_path = path.with_name(".cloud-config.lock")
    try:
        lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock, "w") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            raw = config_bytes(path)
            if expected != revision(raw):
                raise HTTPException(409, "配置已变更，请刷新后再保存")
            document = tomlkit.parse(raw.decode("utf-8"))
            edit(document)
            rendered = tomlkit.dumps(document).encode()
            Settings.validate_file_values(flatten(tomllib.loads(rendered.decode())))
            if rendered == raw:
                return
            descriptor, name = tempfile.mkstemp(prefix=".cloud-config-", dir=path.parent)
            temporary = Path(name)
            try:
                with os.fdopen(descriptor, "wb") as file:
                    file.write(rendered)
                    file.flush()
                    os.fsync(file.fileno())
                if config_bytes(path) != raw:
                    raise HTTPException(409, "配置已变更，请刷新后再保存")
                os.replace(temporary, path)
                directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            finally:
                temporary.unlink(missing_ok=True)
    except (OSError, UnicodeError, ConfigurationError, tomlkit.exceptions.ParseError):
        raise HTTPException(409, "无法保存本机部署配置") from None
