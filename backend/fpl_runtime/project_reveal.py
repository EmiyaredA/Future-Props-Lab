"""Only a local Video project request can reveal its exact Assets directory."""

import re

from .video_assets import SOURCE

PROJECT_REVEAL = "tools.project.reveal"
PURPOSE = "video.project.reveal"
TOOLS_PREFIX = "/_internal/v1/project-reveal"
ASSETS_PREFIX = "/_internal/v1/project-reveal-layout"
PROJECT_ID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"


def reveal_target(method, path, service):
    if method != "POST" or service not in {"assets", "tools"}:
        return None
    prefix = TOOLS_PREFIX if service == "tools" else ASSETS_PREFIX
    return re.fullmatch(rf"{prefix}/video-editor/({PROJECT_ID})", path)


def reveal_grant(grant):
    if (grant.caller, grant.purpose, grant.source_method) != ("video", PURPOSE, "POST"):
        return False
    target = reveal_target(grant.target_method, grant.target_path, grant.target_service)
    return bool(target and grant.source_path == f"{SOURCE}/projects/{target[1]}/open-folder")


def reveal_payload(value):
    identity = value.get("project_id")
    if (
        set(value) != {"project_id"}
        or not isinstance(identity, str)
        or not re.fullmatch(PROJECT_ID, identity)
    ):
        raise ValueError("剪辑目录执行范围无效")
    return {"project_id": value["project_id"]}
