"""Each HTTP composition supplies owned integration clients and storage explicitly."""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class IntegrationBindings:
    tool_apis: Callable
    mcp: Callable
    skills: Callable
    external: Callable | None = None


def binding(request, session, owner):
    if session.info.get("owner_user_id") != owner:
        raise HTTPException(403, {"code": "account_context_mismatch"})
    value = getattr(request.app.state, "integration_bindings", None)
    if not isinstance(value, IntegrationBindings):
        raise HTTPException(503, {"code": "integration_clients_unavailable"})
    return value


def tool_catalog(request, session, owner):
    return binding(request, session, owner).tool_apis(request, session, owner)


def mcp_catalog(request, session, owner):
    return binding(request, session, owner).mcp(request, session, owner)


def skill_catalog(request, session, owner):
    return binding(request, session, owner).skills(request, session, owner)


def external_catalog(request, session, owner):
    factory = binding(request, session, owner).external
    if factory is None:
        raise HTTPException(503, {"code": "external_connections_unavailable"})
    return factory(request, session, owner)
