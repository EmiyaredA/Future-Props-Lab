"""Exhaustive API ownership; an unknown operation never falls back to Portal."""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .amadeus_skills import SKILL_FILE_ROUTE
from .catalog import service_by_id
from .cloud_authority import DESKTOP_SOCKET


def operation_pattern(path):
    template = re.escape(path)
    if path == SKILL_FILE_ROUTE:
        template = template.replace(re.escape("{relative_path}"), ".+")
    return re.compile("^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", template) + "$")


@dataclass(frozen=True)
class Operation:
    service: str
    method: str
    path: str
    operation_id: str

    def pattern(self):
        return operation_pattern(self.path)


@dataclass(frozen=True)
class SocketOperation:
    service: str
    path: str
    permission: str


SOCKET_OPERATIONS = (
    SocketOperation("models", "/v1/model-test/realtime", "models.use"),
    SocketOperation("remote", DESKTOP_SOCKET, "cloud-control.access"),
)


class RouteCatalog:
    def __init__(self, operations, *, websockets=()):
        self.operations = tuple(operations)
        self.exact = {}
        self.parameterized = []
        ids = set()
        shapes = set()
        for operation in self.operations:
            service_by_id(operation.service)
            key = operation.method, operation.path
            shape = operation.method, operation.pattern().pattern
            if key in self.exact or operation.operation_id in ids or shape in shapes:
                raise ValueError("API 路径或 operationId 重复")
            if not operation.path.startswith("/v1/"):
                raise ValueError("公共业务操作必须使用 /v1")
            self.exact[key] = operation
            ids.add(operation.operation_id)
            shapes.add(shape)
            if "{" in operation.path:
                self.parameterized.append((operation, operation.pattern()))

        self.websockets = tuple(websockets)
        self.socket_paths = {}
        for operation in self.websockets:
            service_by_id(operation.service)
            if (
                not operation.path.startswith("/v1/")
                or any(char in operation.path for char in "{}?#")
                or not operation.permission
                or operation.path in self.socket_paths
                or self.match("GET", operation.path) is not None
            ):
                raise ValueError("WebSocket 归属路径无效、重复或与 HTTP 操作冲突")
            self.socket_paths[operation.path] = operation

    @classmethod
    def read(cls, path: Path):
        document = json.loads(path.read_text())
        if document.get("version") != 1:
            raise ValueError("路由清单版本不兼容")
        return cls(
            (Operation(**item) for item in document["operations"]),
            websockets=(SocketOperation(**item) for item in document.get("websockets", [])),
        )

    def match_socket(self, path):
        return self.socket_paths.get(path)

    def match(self, method, path):
        if exact := self.exact.get((method.upper(), path)):
            return exact
        for operation, pattern in self.parameterized:
            if operation.method == method.upper() and pattern.fullmatch(path):
                return operation
        return None

    def check_openapi(self, schema):
        expected = {
            (method.upper(), path): operation["operationId"]
            for path, methods in schema["paths"].items()
            for method, operation in methods.items()
            if method.lower() in {"get", "post", "put", "patch", "delete", "head", "options"}
        }
        actual = {(item.method, item.path): item.operation_id for item in self.operations}
        if actual != expected:
            missing, extra = expected.keys() - actual.keys(), actual.keys() - expected.keys()
            raise ValueError(f"API 归属不完整：缺失 {len(missing)}，多余 {len(extra)}")
