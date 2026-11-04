"""Delegate only the two credential-free Visual catalog lookups to Models."""

import re

GENERATION_SOURCE = "/v1/visual-workshop/generation-options"
GENERATION_TARGET = "/_internal/v1/visual-catalog/generation-options"
ACCEPTANCE_TARGET = "/_internal/v1/visual-catalog/acceptance-models"
ACCEPTANCE_SOURCE = re.compile(
    r"/v1/visual-workshop/projects/[A-Za-z0-9_-]{1,128}/acceptance/models"
)
PURPOSE = "visual.model-catalog.read"


def catalog_target(method, path):
    return method == "GET" and path in {GENERATION_TARGET, ACCEPTANCE_TARGET}


def visual_catalog_grant(grant):
    if (
        grant.caller != "visual"
        or grant.purpose != PURPOSE
        or grant.source_method != "GET"
        or grant.target_service != "models"
        or not catalog_target(grant.target_method, grant.target_path)
    ):
        return False
    if grant.target_path == GENERATION_TARGET:
        return grant.source_path == GENERATION_SOURCE
    return bool(ACCEPTANCE_SOURCE.fullmatch(grant.source_path))
