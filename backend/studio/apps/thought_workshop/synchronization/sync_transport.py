"""Read bounded Integrations responses through request or durable-task grants."""

import json

import httpx
from pydantic import TypeAdapter

from app.integrations.external.contracts import ExternalError
from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.contracts.integrations.external_sync import (
    ExternalIntentGrant,
    ExternalProgress,
    ExternalRead,
)

MAX_SNAPSHOT = 32 * 1024 * 1024
OBJECT = TypeAdapter(dict)


async def post_sync(client, path, token, body, output, *, maximum_bytes=32 * 1024, timeout=10):
    try:
        async with client.stream(
            "POST",
            "http://integrations:8080" + path,
            headers={"X-Fpl-Context": token, "Content-Type": "application/json"},
            content=body.model_dump_json().encode(),
            timeout=timeout,
        ) as response:
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > maximum_bytes:
                    raise ValueError("external target response too large")
            if response.status_code in {401, 403, 404, 409, 422, 502, 503}:
                error = json.loads(payload)
                raise ExternalError(
                    str(error.get("detail") or "同步连接请求失败"),
                    response.status_code,
                    str(error.get("code") or "external_connection_error"),
                )
            if response.status_code != 200:
                raise ValueError("external target response invalid")
            return (
                output.validate_json(payload)
                if output is OBJECT
                else output.model_validate_json(payload)
            )
    except (httpx.HTTPError, ValueError, AttributeError):
        raise ExternalError("同步连接暂不可用", 503, "external_connection_unavailable") from None


class TaskSyncTransport:
    def __init__(self, capabilities, intents):
        self.client = capabilities.client
        self.intents = intents

    async def call(self, intent_id, operation, body, output, *, step_id=None, **limits):
        grant = ExternalIntentGrant(
            intent_id=intent_id,
            operation=operation,
            request_sha256=body.fingerprint(),
            step_id=step_id,
        )
        try:
            token = await self.intents.external_grant(grant)
        except IntegrationAuthorizationUnavailable:
            raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable") from None
        return await post_sync(self.client, grant.path, token, body, output, **limits)

    async def progress(self, intent_id):
        return await self.call(
            intent_id,
            "read",
            ExternalRead(op="checkpoint"),
            ExternalProgress,
            maximum_bytes=MAX_SNAPSHOT,
        )

    async def step(self, intent_id, body):
        return await self.call(
            intent_id,
            "step",
            body,
            OBJECT,
            step_id=body.step_id,
            maximum_bytes=MAX_SNAPSHOT,
            timeout=120,
        )
