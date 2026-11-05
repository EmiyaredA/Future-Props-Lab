"""Verify a body-bound signed request before the business owner sees any bytes."""

import secrets

from starlette.responses import JSONResponse

from .approved_operations import MAX_BODY, request_digest


async def verified_receive(scope, receive, send, checksum):
    body = bytearray()
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return None
        chunk = message.get("body", b"")
        if len(chunk) + len(body) > MAX_BODY:
            await reject(scope, receive, send, 413, "request_too_large")
            return None
        body.extend(chunk)
        if not message.get("more_body"):
            break
    content_types = [value for key, value in scope["headers"] if key == b"content-type"]
    if (body and content_types != [b"application/json"]) or not secrets.compare_digest(
        request_digest(scope["query_string"], body), checksum
    ):
        await reject(scope, receive, send, 403, "request_digest_mismatch")
        return None
    delivered = False

    async def replay():
        nonlocal delivered
        if delivered:
            return await receive()
        delivered = True
        return {"type": "http.request", "body": bytes(body), "more_body": False}

    return replay


async def reject(scope, receive, send, status, code):
    await JSONResponse({"code": code}, status, headers={"Cache-Control": "no-store"})(
        scope, receive, send
    )
