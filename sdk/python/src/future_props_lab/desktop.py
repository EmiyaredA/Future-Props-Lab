"""Local App discovery and one-time pairing, independent of the backend runtime."""

import asyncio
import json
import os
import re
import stat
import tempfile
import time
from pathlib import Path

import httpx

from .client import AsyncClient, Client, _error

BASE_URL = "http://fpl.local"


class DesktopConnectionError(Exception):
    pass


def agent_directory(data_dir=None, *, development=False):
    root = (
        Path(data_dir)
        if data_dir
        else Path.home()
        / "Library/Application Support"
        / ("Future Props Lab Development" if development else "Future Props Lab")
    )
    return root / "agent"


def _private(path, *, directory=False, socket=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISSOCK if socket else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise DesktopConnectionError("接入文件权限不安全，请在 App 中关闭并重新开启接入")


def discover(data_dir=None, *, development=False):
    directory = agent_directory(data_dir, development=development)
    try:
        _private(directory, directory=True)
        descriptor = directory / "connection.json"
        _private(descriptor)
        data = json.loads(descriptor.read_text())
        if data.get("version") != 1:
            raise DesktopConnectionError("不支持的 App 接入版本，请更新 CLI/SDK")
        socket = Path(data["socket_path"])
        if not socket.is_absolute():
            raise DesktopConnectionError("无效的本地连接描述")
        _private(socket.parent, directory=True)
        _private(socket, socket=True)
        return str(socket)
    except (OSError, ValueError, KeyError) as exc:
        raise DesktopConnectionError(
            "App 未启动或未开启接入，请在账号设置的 API 密钥页开启"
        ) from exc


def credential_path(data_dir=None, *, development=False, profile="default"):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", profile):
        raise DesktopConnectionError("profile 只能包含字母、数字、下划线和短横线")
    return agent_directory(data_dir, development=development) / f"credentials-{profile}.json"


def _read_credentials(**options):
    file = credential_path(**options)
    try:
        _private(file.parent, directory=True)
        _private(file)
        return json.loads(file.read_text())["api_key"]
    except (OSError, ValueError, KeyError) as exc:
        raise DesktopConnectionError("尚未授权，请运行 fpl connect") from exc


def _save_credentials(data, **options):
    file = credential_path(**options)
    _private(file.parent, directory=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".credentials-", dir=file.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(data, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def desktop_client(*, data_dir=None, development=False, profile="default", timeout=120):
    socket = discover(data_dir, development=development)
    key = _read_credentials(data_dir=data_dir, development=development, profile=profile)
    return Client(
        base_url=BASE_URL,
        api_key=key,
        timeout=timeout,
        transport=httpx.HTTPTransport(uds=socket, retries=0),
    )


def async_desktop_client(*, data_dir=None, development=False, profile="default", timeout=120):
    socket = discover(data_dir, development=development)
    key = _read_credentials(data_dir=data_dir, development=development, profile=profile)
    return AsyncClient(
        base_url=BASE_URL,
        api_key=key,
        timeout=timeout,
        transport=httpx.AsyncHTTPTransport(uds=socket, retries=0),
    )


def _json(response):
    if response.is_error:
        raise _error(response)
    return response.json()


def pair_desktop(
    *,
    name,
    write=False,
    data_dir=None,
    development=False,
    profile="default",
    timeout=300,
    on_pending=None,
):
    options = dict(data_dir=data_dir, development=development, profile=profile)
    socket = discover(data_dir, development=development)
    if credential_path(**options).exists():
        raise DesktopConnectionError("此 profile 已保存授权；请使用其他 profile 或先 disconnect")
    with httpx.Client(
        base_url=BASE_URL, transport=httpx.HTTPTransport(uds=socket), timeout=15
    ) as http:
        request = _json(
            http.post(
                "/v1/desktop/agent/pairings",
                json={
                    "name": name,
                    "scope": "studio:write" if write else "studio:read",
                },
            )
        )
        if on_pending:
            on_pending({key: request[key] for key in ("id", "code", "name", "scope")})
        deadline = time.monotonic() + min(timeout, 300)
        while time.monotonic() < deadline:
            result = _json(
                http.post(
                    f"/v1/desktop/agent/pairings/{request['id']}/claim",
                    json={"claim_token": request["claim_token"]},
                )
            )
            if result["status"] == "approved":
                _save_credentials(result, **options)
                return {key: value for key, value in result.items() if key != "api_key"}
            if result["status"] != "pending":
                raise DesktopConnectionError("App 已拒绝此次授权")
            time.sleep(1)
    raise DesktopConnectionError("等待授权超时，请重新连接；不会自动重发申请")


async def pair_desktop_async(**options):
    return await asyncio.to_thread(pair_desktop, **options)


def disconnect_desktop(**options):
    file = credential_path(**options)
    if file.exists():
        _private(file.parent, directory=True)
        _private(file)
        file.unlink()
