"""Send an approved external tool action without exposing connection credentials."""

from uuid import UUID

import httpx

from studio.apps.integrations.clients.authority import (
    IntegrationAuthorizationUnavailable,
    IntegrationIntentClient,
)
from studio.contracts.identity.claims import HEADER
from studio.contracts.integrations.integration_intents import (
    AmadeusToolGrant,
    AmadeusToolOutcome,
    IntegrationScope,
    digest,
)
from studio.runtime.database.operation_receipts import OperationError


class ToolCalls:
    def __init__(self, capabilities, credential, transport):
        self.capabilities = capabilities
        self.intents = IntegrationIntentClient(
            service="amadeus", credential=credential, transport=transport
        )

    async def close(self):
        await self.intents.close()

    async def run(self, conversation, approved, assertion, path):
        parts = approved.tool_name.split(":", 2)
        inputs = approved.arguments.get("input", {})
        revision = approved.arguments.get("revision")
        mcp = parts[0] == "mcp"
        if (
            len(parts) != (3 if mcp else 2)
            or not isinstance(inputs, dict)
            or type(revision) is not int
        ):
            raise OperationError("工具参数或修订无效", "invalid_arguments")
        try:
            action = UUID(approved.id)
            scope = IntegrationScope(
                kind="mcp.call" if mcp else "tool.call",
                task_id=action,
                source_resource_id=conversation,
                connection_id=parts[1],
                connection_revision=revision,
                input_sha256=digest(inputs),
                tool_name=parts[2] if mcp else "",
            )
        except (TypeError, ValueError) as exc:
            raise OperationError("工具参数或修订无效", "invalid_arguments") from exc
        try:
            intent = await self.intents.enroll(
                request_id=action, assertion=assertion, method="POST", path=path, scope=scope
            )
            token = await self.intents.amadeus_tool_grant(intent.id)
        except IntegrationAuthorizationUnavailable as exc:
            raise OperationError("外部工具授权暂不可用", "action_authorization_ended", 503) from exc
        target = AmadeusToolGrant(intent_id=intent.id).path
        try:
            async with self.capabilities.client.stream(
                "POST",
                "http://integrations:8080" + target,
                headers={HEADER: token, "Accept-Encoding": "identity"},
                json={"inputs": inputs},
                timeout=40,
            ) as reply:
                if reply.status_code in {401, 403, 413, 422}:
                    raise OperationError(
                        "外部工具授权或请求无效", "integration_call_denied", reply.status_code
                    )
                reply.raise_for_status()
                if reply.headers.get("Content-Encoding", "identity") != "identity":
                    raise ValueError("invalid result encoding")
                raw = bytearray()
                async for chunk in reply.aiter_raw():
                    if len(raw) + len(chunk) > 1024 * 1024 + 64 * 1024:
                        raise ValueError("oversized tool result")
                    raw.extend(chunk)
                return AmadeusToolOutcome.model_validate_json(raw)
        except (ValueError, httpx.HTTPError) as exc:
            raise OperationError("外部工具结果待核实", "operation_unconfirmed", 503) from exc
