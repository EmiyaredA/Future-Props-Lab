"""Call the registered business owner using bounded, destination-specific authority."""

import json

import httpx

from app.console.amadeus.fpl_operations import RESPONSE_LIMIT, operation_request, operation_result
from app.runtime.operation_receipts import OperationError
from studio.contracts.amadeus.amadeus_native import RUN_SOURCE
from studio.contracts.identity.approved_operations import MAX_BODY, PURPOSE, request_digest
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


async def call_registered(capabilities, assertion, source_path, operation, arguments, *, approved):
    method, template, encoded, query, body = operation_request(
        operation, arguments, allow_write=approved
    )
    try:
        path = httpx.URL(encoded).path
        owner = capabilities.catalog.match(method, path)
        if owner is None or owner.path != template:
            raise OperationError("路径参数无效", "invalid_arguments", 422)
        target = httpx.URL(f"http://{owner.service}:8080{encoded}", params=query)
        content = (
            b""
            if body is None
            else json.dumps(
                body, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            ).encode()
        )
    except (TypeError, ValueError, httpx.InvalidURL) as exc:
        raise OperationError("操作参数无效", "invalid_arguments", 422) from exc
    if len(content) > MAX_BODY:
        raise OperationError("操作正文过大", "request_too_large", 413)
    read_purpose = (
        "amadeus.dialogue.read" if RUN_SOURCE.fullmatch(source_path) else "amadeus.operation.read"
    )
    grant = RequestGrant(
        "amadeus",
        PURPOSE if approved else read_purpose,
        "POST",
        source_path,
        owner.service,
        method,
        path,
        request_digest(target.query, content) if approved else None,
    )
    try:
        token = await capabilities.authorize_request(assertion, grant)
    except CapabilityDenied as exc:
        raise OperationError(
            f"业务操作返回 HTTP {exc.status}", exc.code or "operation_failed", exc.status
        ) from exc
    except CapabilityUnavailable as exc:
        raise OperationError("业务操作授权暂不可用", "operation_unavailable", 503) from exc

    headers = {HEADER: token, "Accept": "application/json", "Accept-Encoding": "identity"}
    if content:
        headers["Content-Type"] = "application/json"
    try:
        async with capabilities.client.stream(
            method, target, headers=headers, content=content, timeout=httpx.Timeout(120, connect=5)
        ) as response:
            if approved and response.status_code >= 500:
                raise OperationError("业务操作结果待核实", "operation_unconfirmed", 503)
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
    except (httpx.HTTPError, ValueError) as exc:
        if approved:
            raise OperationError("业务操作结果待核实", "operation_unconfirmed", 503) from exc
        raise OperationError("业务操作暂不可用", "operation_unavailable", 503) from exc
