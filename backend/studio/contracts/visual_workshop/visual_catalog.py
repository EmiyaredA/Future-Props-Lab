"""Delegate only the two credential-free Visual catalog lookups to Models."""

import re

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.visual_workshop.visual_paths import SOURCE

GENERATION_SOURCE = "/v1/visual-workshop/generation-options"
GENERATION_TARGET = "/_internal/v1/visual-catalog/generation-options"
AGENT_ACCEPTANCE_TARGET = "/_internal/v1/visual-acceptance/agents"
AGENT_ACCEPTANCE_PURPOSE = "visual.acceptance-agents.read"
FIXED_ACCEPTANCE_TARGET = "/_internal/v1/visual-catalog/fixed-acceptance-model"
ACCEPTANCE_TARGET = "/_internal/v1/visual-catalog/acceptance-models"
ACCEPTANCE_SOURCE = re.compile(
    r"/v1/visual-workshop/projects/[A-Za-z0-9_-]{1,128}/acceptance/models"
)
PURPOSE = "visual.model-catalog.read"


def acceptance_scheme_source(method, path):
    if (method, path) == ("GET", "/v1/visual-workshop/acceptance/catalog"):
        return True
    node = rf"{SOURCE}/{ID}/nodes/{ID}/acceptance"
    if method in {"GET", "PUT"}:
        return bool(re.fullmatch(node, path))
    return method == "POST" and bool(re.fullmatch(node + "/runs", path))


def catalog_target(method, path):
    return method == "GET" and path in {
        GENERATION_TARGET,
        ACCEPTANCE_TARGET,
        FIXED_ACCEPTANCE_TARGET,
    }


def visual_catalog_grant(grant):
    if (
        grant.caller != "visual"
        or grant.purpose != PURPOSE
        or grant.target_service != "models"
        or grant.target_method != "GET"
    ):
        return False
    if grant.target_path == FIXED_ACCEPTANCE_TARGET:
        return acceptance_scheme_source(grant.source_method, grant.source_path)
    if grant.target_path == GENERATION_TARGET:
        return (grant.source_method, grant.source_path) == ("GET", GENERATION_SOURCE)
    return (
        grant.source_method == "GET"
        and grant.target_path == ACCEPTANCE_TARGET
        and bool(ACCEPTANCE_SOURCE.fullmatch(grant.source_path))
    )


def acceptance_agent_grant(grant):
    return (
        grant.caller,
        grant.purpose,
        grant.target_service,
        grant.target_method,
        grant.target_path,
    ) == (
        "visual",
        AGENT_ACCEPTANCE_PURPOSE,
        "agent-runtime",
        "GET",
        AGENT_ACCEPTANCE_TARGET,
    ) and acceptance_scheme_source(grant.source_method, grant.source_path)
