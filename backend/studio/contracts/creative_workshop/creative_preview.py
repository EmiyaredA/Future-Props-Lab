"""A read-only Creative installation preview bound to one exact batch."""

import re

from studio.contracts.integrations.integration_intents import digest

PUBLIC_PREVIEW = "/v1/creative-workshop/installations/preview"
PRIVATE_PREVIEW = "/_internal/v1/creative-integrations/preview/"


def preview_target(method, path):
    return method == "POST" and re.fullmatch(PRIVATE_PREVIEW + r"[a-f0-9]{64}", path)


def preview_path(batch):
    return PRIVATE_PREVIEW + digest(batch.model_dump(mode="json"))


def preview_grant(grant):
    return (
        grant.caller == "creative"
        and grant.purpose == "creative.install-preview.read"
        and grant.source_method == "POST"
        and grant.source_path == PUBLIC_PREVIEW
        and grant.target_service == "integrations"
        and preview_target(grant.target_method, grant.target_path)
    )
