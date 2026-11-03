"""Destination- and purpose-bound request delegation. No arbitrary account impersonation."""

import re
from dataclasses import dataclass

from .resource_routes import RESOURCE_ROUTES


@dataclass(frozen=True)
class RequestGrant:
    caller: str
    purpose: str
    source_method: str
    source_path: str
    target_service: str
    target_method: str
    target_path: str


def _automation_lookup(grant):
    if (
        grant.caller != "gateway"
        or grant.purpose != "automation.resource.read"
        or grant.source_method != "POST"
        or grant.source_path != "/v1/automation/open"
        or grant.target_method != "GET"
    ):
        return False
    for route in RESOURCE_ROUTES.values():
        pattern = re.escape(route.api).replace(r"\{id\}", r"[A-Za-z0-9_-]{1,128}")
        if route.service == grant.target_service and re.fullmatch(pattern, grant.target_path):
            return True
    return False


ASSET_PROJECT_READS = frozenset(
    {
        ("GET", "/v1/files"),
        ("POST", "/v1/files"),
        ("GET", "/v1/file-folders"),
        ("POST", "/v1/file-folders"),
        ("POST", "/v1/file-library/asset-imports"),
        ("POST", "/v1/visual-workshop/projects/{project_id}/asset-imports"),
        ("POST", "/v1/visual-workshop/projects/{project_id}/asset-references"),
        ("PATCH", "/v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}"),
        ("DELETE", "/v1/visual-workshop/projects/{project_id}/asset-references/{reference_id}"),
    }
)


MODEL_LIBRARY_INPUT_READS = frozenset(
    {
        "/v1/model-inference/assets/import",
        "/v1/model-test/transcription-tasks",
    }
)


def model_library_input(grant):
    if (
        grant.caller == "models"
        and grant.purpose == "models.library-input.read"
        and grant.source_method == "POST"
        and grant.source_path in MODEL_LIBRARY_INPUT_READS
        and grant.target_service == "assets"
        and grant.target_method == "GET"
    ):
        match = re.fullmatch(
            r"/_internal/v1/model-library-inputs/([A-Za-z0-9_-]{1,128})", grant.target_path
        )
        return match[1] if match else None
    return None


def target_permission_path(grant):
    asset_id = model_library_input(grant)
    return "/v1/files/" + asset_id + "/content" if asset_id else grant.target_path


def permitted(grant, catalog):
    original = catalog.match(grant.source_method, grant.source_path)
    if original is None or original.service != grant.caller:
        return False
    if model_library_input(grant):
        return True
    destination = catalog.match(grant.target_method, grant.target_path)
    if destination is None or destination.service != grant.target_service:
        return False
    if _automation_lookup(grant):
        return True
    if grant.purpose == "deployment.status.read":
        return (
            grant.caller == "gateway"
            and grant.source_method == "GET"
            and grant.source_path == "/v1/automation/services"
            and grant.target_service == "management"
            and grant.target_method == "GET"
            and grant.target_path == "/v1/management/service-status"
        )
    if grant.caller == "rendering" and grant.purpose == "rendering.source.read":
        source = re.fullmatch(
            r"/v1/files/([A-Za-z0-9_-]{1,128})/(crop|frames|media-info|preview|thumbnail)",
            grant.source_path,
        )
        return bool(
            source
            and grant.source_method == ("POST" if source[2] in {"crop", "frames"} else "GET")
            and grant.target_service == "assets"
            and grant.target_method == "GET"
            and grant.target_path == "/v1/files/" + source[1] + "/content"
        )

    return bool(
        grant.caller == "assets"
        and grant.purpose == "assets.visual-project.read"
        and (grant.source_method, original.path) in ASSET_PROJECT_READS
        and grant.target_service == "visual"
        and grant.target_method == "GET"
        and re.fullmatch(r"/v1/visual-workshop/projects/[A-Za-z0-9_-]{1,128}", grant.target_path)
    )
