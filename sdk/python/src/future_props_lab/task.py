"""Run-scoped SDK transport. No website credentials, profiles or direct HTTP calls."""

import asyncio
import json
import os
import re
import socket
from urllib.parse import unquote

import httpx

from .client import AsyncClient, Client
from .errors import ApiError

MAX_MESSAGE = 2 * 1024 * 1024


class WaitingApproval(ApiError):
    def __init__(self, action):
        self.action = action
        super().__init__(409, {"code": "waiting_approval", "message": "操作已提案，等待审批"})


class TaskConnection:
    def __init__(self, *, socket_path=None, token=None):
        self.socket_path = socket_path or os.environ.get("FPL_TASK_SOCKET")
        self.token = token or os.environ.get("FPL_TASK_TOKEN")
        if not self.socket_path or not self.token:
            raise ValueError("当前环境没有 Amadeus 运行授权")
        self._catalog = None

    def call(self, name, arguments):
        raw = json.dumps({"token": self.token, "name": name, "arguments": arguments}).encode()
        if len(raw) >= MAX_MESSAGE:
            raise ValueError("任务请求超过限制")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(120)
            connection.connect(self.socket_path)
            connection.sendall(raw + b"\n")
            with connection.makefile("rb") as stream:
                line = stream.readline(MAX_MESSAGE + 1)
        if len(line) > MAX_MESSAGE or not line.endswith(b"\n"):
            raise ValueError("任务响应超过限制或连接提前关闭")
        value = json.loads(line)
        if "error" in value:
            problem = value["error"]
            if not isinstance(problem, dict):
                problem = {"code": "task_tool_failed"}
            raise ApiError(int(problem.pop("status", 403)), problem)
        result = value["result"]
        if isinstance(result, dict) and "waiting_approval" in result:
            raise WaitingApproval(result["waiting_approval"])
        return result

    def catalog(self):
        if self._catalog is not None:
            return self._catalog
        # Full schemas are returned only for a named resource.
        summary = self.call("operations", {})["items"]
        result = []
        for resource in sorted({item["resource"] for item in summary}):
            result.extend(self.call("operations", {"resource": resource})["items"])
        self._catalog = result
        return result


class TaskTransport(httpx.BaseTransport):
    def __init__(self, connection):
        self.connection = connection

    def handle_request(self, request):
        if request.url.host != "fpl-task" or request.url.scheme != "http":
            raise ValueError("任务客户端只能调用当前运行的 FPL 工具")
        catalog = self.connection.catalog()
        if request.method == "GET" and request.url.path == "/v1/automation/capabilities":
            return httpx.Response(
                200,
                json={
                    "version": 1,
                    "user_id": "current-run",
                    "scopes": ["task"],
                    "operations": {item["id"]: item for item in catalog},
                    "schemas": {},
                },
            )
        for item in catalog:
            if item["method"] != request.method:
                continue
            names = re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", item["path"])
            pattern = re.escape(item["path"])
            for name in names:
                pattern = pattern.replace(re.escape("{" + name + "}"), "([^/]+)", 1)
            match = re.fullmatch(pattern, request.url.path)
            if match is None:
                continue
            parameters = {
                key: unquote(value) for key, value in zip(names, match.groups(), strict=True)
            }
            if any(
                value in {".", ".."} or "/" in value or "\\" in value
                for value in parameters.values()
            ):
                raise ValueError("项目路径参数无效")
            raw = request.read()
            if raw and "application/json" not in request.headers.get("content-type", ""):
                raise ValueError("任务 SDK 当前仅支持 JSON 操作；文件通过会话文件工具交付")
            arguments = {"path_params": parameters, "query": dict(request.url.params)}
            if raw:
                arguments["body"] = json.loads(raw)
            result = self.connection.call("call", {"operation": item["id"], "arguments": arguments})
            return httpx.Response(result.get("status_code", 200), json=result.get("result"))
        raise ApiError(403, {"code": "unsupported_tool"})


class AsyncTaskTransport(httpx.AsyncBaseTransport):
    def __init__(self, connection):
        self.transport = TaskTransport(connection)

    async def handle_async_request(self, request):
        await request.aread()
        return await asyncio.to_thread(self.transport.handle_request, request)


def task_client(**connection):
    return Client(base_url="http://fpl-task", transport=TaskTransport(TaskConnection(**connection)))


def async_task_client(**connection):
    return AsyncClient(
        base_url="http://fpl-task", transport=AsyncTaskTransport(TaskConnection(**connection))
    )
