"""Accept only a live Identity intent for one exact owned tool call."""

from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from studio.apps.integrations.amadeus_tool_calls import ToolCall
from studio.apps.integrations.transport.bindings import mcp_catalog, tool_catalog
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.integrations.integration_intents import TOOL_CALL_PATH, digest

router = APIRouter(prefix=TOOL_CALL_PATH, include_in_schema=False)


class Inputs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inputs: dict


@router.post("/{intent_id}")
async def execute(request: Request, intent_id: UUID, body: Inputs):
    state = request.app.state
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "amadeus_tool_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="integrations",
            method="POST",
            path=request.url.path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "amadeus_tool_grant_required") from None
    decision = await state.integration_intents.check(intent_id)
    scope = decision.scope
    try:
        checksum = digest(body.inputs)
    except (TypeError, ValueError):
        raise HTTPException(422, "amadeus_tool_inputs_invalid") from None
    if (
        not decision.allowed
        or actor != decision.actor
        or actor.purpose != "studio"
        or scope.kind not in {"mcp.call", "tool.call"}
        or scope.input_sha256 != checksum
    ):
        raise HTTPException(403, "amadeus_tool_scope_mismatch")

    call = ToolCall(state.database, state.integration_intents, intent_id, decision)
    request.state.integration_validation = call

    async def invoke():
        async with state.database.sessions(info={"owner_user_id": call.owner}) as session:
            if scope.kind == "mcp.call":
                mcp = mcp_catalog(request, session, call.owner)
                return await mcp.execute(
                    scope.connection_id, scope.tool_name, body.inputs, scope.connection_revision
                )
            tool = tool_catalog(request, session, call.owner)
            return await tool.execute(scope.connection_id, body.inputs, scope.connection_revision)

    return await call.run(invoke)
