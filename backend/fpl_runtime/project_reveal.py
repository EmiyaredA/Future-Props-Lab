"""Delegate a local browser request to its exact owned project directory."""

import re
from types import MappingProxyType

PROJECT_REVEAL = "tools.project.reveal"
REVEAL_APPLICATIONS = MappingProxyType(
    {
        PROJECT_REVEAL: "video-editor",
        "tools.visual-project.reveal": "visual-workshop",
        "tools.galgame-project.reveal": "galgame-workshop",
    }
)
APPLICATION_SERVICES = MappingProxyType(
    {"video-editor": "video", "visual-workshop": "visual", "galgame-workshop": "galgame"}
)
APPLICATION_OPERATIONS = MappingProxyType(
    {application: operation for operation, application in REVEAL_APPLICATIONS.items()}
)
TOOLS_PREFIX = "/_internal/v1/project-reveal"
ASSETS_PREFIX = "/_internal/v1/project-reveal-layout"
PROJECT_ID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
_APPLICATION = "|".join(APPLICATION_SERVICES)


def reveal_target(method, path, service):
    if method != "POST" or service not in {"assets", "tools"}:
        return None
    prefix = TOOLS_PREFIX if service == "tools" else ASSETS_PREFIX
    return re.fullmatch(
        rf"{prefix}/(?P<application>{_APPLICATION})/(?P<project>{PROJECT_ID})", path
    )


def reveal_grant(grant):
    target = reveal_target(grant.target_method, grant.target_path, grant.target_service)
    if target is None:
        return False
    application, project_id = target["application"], target["project"]
    owner = APPLICATION_SERVICES[application]
    return (
        grant.caller == owner
        and grant.purpose == f"{owner}.project.reveal"
        and grant.source_method == "POST"
        and grant.source_path == f"/v1/{application}/projects/{project_id}/open-folder"
    )


def reveal_payload(value):
    identity = value.get("project_id")
    if (
        set(value) != {"project_id"}
        or not isinstance(identity, str)
        or not re.fullmatch(PROJECT_ID, identity)
    ):
        raise ValueError("项目目录执行范围无效")
    return {"project_id": identity}
