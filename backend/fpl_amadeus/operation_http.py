"""Published operation discovery and read-only calls to registered owners."""

import json
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from app.console.amadeus.fpl_operations import (
    RESPONSE_LIMIT,
    catalog_from_schema,
    operation_request,
    operation_result,
)
from app.runtime.operation_receipts import OperationError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.http_dependencies import StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])
READ_PATH = "/v1/amadeus/operations/read"


@lru_cache(maxsize=1)
def published_catalog():
    root = Path(__file__).resolve().parents[2]
    installed = root / "deploy/contracts/openapi.json"
    schema = installed if installed.is_file() else root / "web/src/generated/openapi.json"
    return json.loads(schema.read_text())


@router.get("/operations")
async def list_registered_operations(
    principal: StudioAuth, resource: str = Query(default="", max_length=40)
) -> dict[str, list[dict]]:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    return {"items": catalog_from_schema(published_catalog(), resource)}


@router.post("/operations/read")
async def read_registered_operation(request: Request, principal: StudioAuth, body: dict) -> dict:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    method, template, encoded_path, query, _ = operation_request(
        str(body.get("operation", "")), body.get("arguments", {}), allow_write=False
    )
    capabilities = request.app.state.capabilities
    try:
        path = httpx.URL(encoded_path).path
        destination = capabilities.catalog.match(method, path)
        if destination is None or destination.path != template:
            raise OperationError("路径参数无效", "invalid_arguments", 422)
        target = httpx.URL(f"http://{destination.service}:8080{encoded_path}", params=query)
    except (TypeError, ValueError, httpx.InvalidURL) as exc:
        raise OperationError("路径或查询参数无效", "invalid_arguments", 422) from exc
    grant = RequestGrant(
        "amadeus", "amadeus.operation.read", "POST", READ_PATH, destination.service, method, path
    )
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        async with capabilities.client.stream(
            method,
            target,
            headers={
                "X-Fpl-Context": token,
                "Accept": "application/json",
                "Accept-Encoding": "identity",
            },
            timeout=httpx.Timeout(120, connect=5),
        ) as response:
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise OperationError("业务结果编码不受支持", "unsupported_result", 422)
            result = bytearray()
            async for chunk in response.aiter_raw():
                if len(result) + len(chunk) > RESPONSE_LIMIT:
                    raise OperationError("操作结果超过 1 MiB", "result_too_large", 422)
                result.extend(chunk)
            return operation_result(
                httpx.Response(
                    response.status_code, headers=response.headers, content=bytes(result)
                )
            )
    except CapabilityDenied as exc:
        raise OperationError(
            f"业务操作返回 HTTP {exc.status}", exc.code or "operation_failed", exc.status
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise OperationError("业务操作暂不可用", "operation_unavailable", 503) from exc
