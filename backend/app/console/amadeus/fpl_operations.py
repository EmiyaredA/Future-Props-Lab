"""Bounded calls to the existing business API operation allowlist."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

import httpx
from fastapi.middleware.asyncexitstack import AsyncExitStackMiddleware
from starlette.middleware.exceptions import ExceptionMiddleware

from app.runtime.operation_receipts import OperationError
from studio.contracts.gateway.automation_manifest import automation_manifest

PARAMETER = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
RESPONSE_LIMIT = 1024 * 1024


def _resolve_schema(
    schema: dict[str, Any],
    document: dict[str, Any],
    seen: frozenset[str] = frozenset(),
):
    reference = schema.get("$ref")
    if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
        if reference in seen:
            return {"type": "object"}
        name = reference.rsplit("/", 1)[-1]
        target = document.get("components", {}).get("schemas", {}).get(name, {})
        return _resolve_schema(target, document, seen | {reference})
    result = {}
    for key, value in schema.items():
        if isinstance(value, dict):
            result[key] = _resolve_schema(value, document, seen)
        elif isinstance(value, list):
            result[key] = [
                _resolve_schema(item, document, seen) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            result[key] = value
    return result


def _registered(identity: str) -> tuple[str, str]:
    for key, value in automation_manifest()["operations"].items():
        if f"{value['resource']}.{value['method']}" == identity:
            return key.split(" ", 1)
    raise OperationError("业务操作未登记", "unsupported_tool", 422)


def operation_catalog(app: Any, resource: str = "") -> list[dict[str, Any]]:
    return catalog_from_schema(app.openapi(), resource)


def catalog_from_schema(schema, resource):
    result = []
    for key, value in automation_manifest()["operations"].items():
        if resource and value["resource"] != resource:
            continue
        method, path = key.split(" ", 1)
        operation = schema["paths"].get(path, {}).get(method.lower(), {})
        result.append(
            {
                "id": f"{value['resource']}.{value['method']}",
                "resource": value["resource"],
                "method": method,
                "path": path,
                "summary": operation.get("summary", ""),
                "parameters": [
                    {
                        "name": parameter.get("name"),
                        "in": parameter.get("in"),
                        "required": parameter.get("required", False),
                    }
                    for parameter in operation.get("parameters", [])
                ],
                "request_schema": _resolve_schema(
                    operation.get("requestBody", {})
                    .get("content", {})
                    .get("application/json", {})
                    .get("schema", {}),
                    schema,
                ),
            }
        )
    return result


def operation_request(
    identity: str,
    arguments: dict[str, Any],
    *,
    allow_write: bool,
):
    method, template = _registered(identity)
    if method != "GET" and not allow_write:
        raise OperationError("读取接口不能执行修改操作", "unsupported_tool", 422)
    if not isinstance(arguments, dict):
        raise OperationError("操作参数无效", "invalid_arguments", 422)
    path_params = arguments.get("path_params", {})
    query = arguments.get("query", {})
    if not isinstance(path_params, dict) or not isinstance(query, dict):
        raise OperationError("路径或查询参数无效", "invalid_arguments", 422)
    expected = set(PARAMETER.findall(template))
    if set(path_params) != expected:
        raise OperationError("路径参数不匹配", "invalid_arguments", 422)
    path = template
    for name in expected:
        value = path_params[name]
        if (
            not isinstance(value, str)
            or not value
            or value in {".", ".."}
            or "/" in value
            or "\\" in value
        ):
            raise OperationError("路径参数无效", "invalid_arguments", 422)
        path = path.replace("{" + name + "}", quote(value, safe=""))
    body = arguments.get("body")
    if method == "GET" and body is not None:
        raise OperationError("读取操作不能带请求正文", "invalid_arguments", 422)
    return method, template, path, query, body


async def call_operation(
    app: Any,
    request_headers: Any,
    identity: str,
    arguments: dict[str, Any],
    *,
    allow_write: bool,
) -> dict[str, Any]:
    method, _, path, query, body = operation_request(identity, arguments, allow_write=allow_write)
    headers = {"accept": "application/json", "origin": "http://fpl-internal"}
    for header in ("cookie", "x-csrf-token"):
        if request_headers.get(header):
            headers[header] = request_headers[header]
    # Re-enter the registered routes with the authenticated browser credentials.
    # This in-process adapter is never exposed as a network listener and does not
    # acquire host-management privileges from either public or local ingress.
    routes = AsyncExitStackMiddleware(
        ExceptionMiddleware(app.router, handlers=app.exception_handlers)
    )

    async def internal(scope, receive, send):
        scope["app"] = app
        await routes(scope, receive, send)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=internal),
        base_url="http://fpl-internal",
        follow_redirects=False,
        timeout=120.0,
    ) as client:
        response = await client.request(method, path, params=query, json=body, headers=headers)
    return operation_result(response)


class RegisteredRevisionConflict(OperationError):
    def __init__(self, message, current):
        super().__init__(message, "revision_conflict", 409)
        self.current = current


def operation_result(response):
    if len(response.content) > RESPONSE_LIMIT:
        raise OperationError("操作结果超过 1 MiB", "result_too_large", 422)
    if response.status_code >= 400:
        code = "operation_failed"
        message = f"业务操作返回 HTTP {response.status_code}"
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            if isinstance(payload.get("code"), str):
                code = payload["code"]
            if isinstance(payload.get("detail"), str):
                message += f"：{payload['detail'][:300]}"
            errors = payload.get("errors")
            if isinstance(errors, list) and errors:
                first = errors[0]
                if isinstance(first, dict):
                    location = first.get("loc")
                    field = (
                        ".".join(str(part) for part in location)
                        if isinstance(location, list)
                        else "body"
                    )
                    explanation = first.get("msg")
                    if isinstance(explanation, str):
                        message += f"（{field}: {explanation[:300]}）"
        if (
            response.status_code == 409
            and code == "revision_conflict"
            and isinstance(payload, dict)
        ):
            raise RegisteredRevisionConflict(message, payload.get("current"))
        raise OperationError(message, code, response.status_code)
    if not response.headers.get("content-type", "").startswith("application/json"):
        raise OperationError("此操作的二进制响应暂不支持", "unsupported_result", 422)
    return {"status_code": response.status_code, "result": response.json()}
