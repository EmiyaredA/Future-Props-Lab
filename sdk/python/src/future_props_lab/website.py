"""Website client profiles; no native process discovery, IPC or backend imports."""

import json
import os
import re
import stat
import tempfile
from pathlib import Path

from .client import AsyncClient, Client


class WebsiteConnectionError(ValueError):
    pass


def profile_path(*, profile="default", profile_dir=None):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", profile):
        raise WebsiteConnectionError("profile 只能包含字母、数字、下划线和短横线")
    root = Path(
        profile_dir or os.environ.get("FPL_PROFILE_DIR", Path.home() / ".config/future-props-lab")
    )
    return root / f"{profile}.json"


def _private(path, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise WebsiteConnectionError("接入配置权限不安全，目录须为 0700，文件须为 0600")


def connect_website(*, url, api_key, profile="default", profile_dir=None):
    if not api_key or not api_key.startswith("fpm_"):
        raise WebsiteConnectionError("请使用网站账号设置中创建的 Management API Key")
    # Validate authority and URL before persisting a secret. The key is never returned.
    with Client(base_url=url, api_key=api_key) as client:
        authority = client._call("GET", "/v1/automation/capabilities")
    file = profile_path(profile=profile, profile_dir=profile_dir)
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    _private(file.parent, directory=True)
    if file.exists() or file.is_symlink():
        _private(file)
    fd, temporary = tempfile.mkstemp(prefix=".profile-", dir=file.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump({"url": url.rstrip("/"), "api_key": api_key}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"connected": True, "url": url.rstrip("/"), "user_id": authority["user_id"]}


def disconnect_website(**options):
    file = profile_path(**options)
    if file.exists():
        _private(file.parent, directory=True)
        _private(file)
        file.unlink()


def _connection(*, url=None, api_key=None, profile="default", profile_dir=None, **options):
    url = url or os.environ.get("FPL_URL")
    api_key = api_key or os.environ.get("FPL_API_KEY")
    if not url or not api_key:
        file = profile_path(profile=profile, profile_dir=profile_dir)
        try:
            _private(file.parent, directory=True)
            _private(file)
            value = json.loads(file.read_text())
            url = url or value["url"]
            api_key = api_key or value["api_key"]
        except (OSError, KeyError, ValueError):
            raise WebsiteConnectionError(
                "请运行 fpl connect 或设置 FPL_URL 与 FPL_API_KEY"
            ) from None
    return dict(base_url=url, api_key=api_key, **options)


def website_client(**options):
    return Client(**_connection(**options))


def async_website_client(**options):
    return AsyncClient(**_connection(**options))
