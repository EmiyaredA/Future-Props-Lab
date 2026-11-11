"""Visual project paths and the source recorded by retired approvals."""

import re

from studio.contracts.asset_library.descriptions import ID

SOURCE = "/v1/visual-workshop/projects"


def retired_approval_source(method, path):
    """Recognize persisted generation provenance for publication of existing tasks."""
    return method == "POST" and re.fullmatch(
        rf"{SOURCE}/({ID})/conversations/({ID})/runs/({ID})/approvals/({ID})", path
    )
