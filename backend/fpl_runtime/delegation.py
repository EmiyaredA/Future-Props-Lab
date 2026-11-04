"""Destination- and purpose-bound request delegation. No arbitrary account impersonation."""

import re
from dataclasses import dataclass

from .annotation_assets import audio_asset_grant
from .annotation_task_sources import task_read_grant, task_upload_grant
from .annotation_transcription import segment_grant
from .motion_assets import motion_asset_grant, motion_asset_write_grant
from .motion_exports import render_grant as motion_export_grant
from .motion_preview import motion_preview_grant
from .motion_snapshot import motion_archive_grant, motion_snapshot_grant
from .presentation_archives import presentation_archive_grant
from .presentation_assets import project_asset_grant
from .resource_routes import RESOURCE_ROUTES
from .video_assets import video_asset_grant, video_write_grant


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


def model_library_output(grant):
    if (
        grant.caller == "models"
        and grant.purpose == "models.library-output.write"
        and grant.source_method == "POST"
        and grant.target_service == "assets"
        and grant.target_method == "POST"
    ):
        source = re.fullmatch(
            r"/v1/model-inference/tasks/([A-Za-z0-9_-]{1,128})/save-to-library",
            grant.source_path,
        )
        target = re.fullmatch(
            r"/_internal/v1/model-library-outputs/([A-Za-z0-9_-]{1,128})/[0-9a-f]{64}",
            grant.target_path,
        )
        return bool(source and target and source[1] == target[1])
    return False


def target_permission_path(grant):
    from .account_directory import directory_path
    from .community_uploads import upload_grant as community_upload_grant
    from .creative_preview import preview_grant
    from .creative_source_evidence import source_transfer_grant
    from .creative_stdio import stdio_grant
    from .external_sync import close_grant, read_grant
    from .thought_archives import archive_grant
    from .thought_assets import asset_grant, upload_grant
    from .tools_video_library import library_grant
    from .writing import writing_grant, writing_target

    if (
        grant.caller == "thought"
        and grant.purpose == "thought.accounts.read"
        and directory_path(grant.target_method, grant.target_path)
    ):
        return "/v1/thought-workshop/notes"
    if read_grant(grant) or close_grant(grant):
        return "/v1/integrations/external-connections"
    if preview_grant(grant) or source_transfer_grant(grant):
        return "/v1/integrations/tool-apis"
    if stdio_grant(grant):
        return "/v1/integrations/mcp"
    if segment_grant(grant):
        return "/v1/model-inference/tasks"
    if writing_grant(grant):
        return writing_target(grant.target_method, grant.target_path)
    if community_upload_grant(grant):
        return grant.source_path
    if (
        asset_grant(grant)
        or upload_grant(grant)
        or archive_grant(grant)
        or audio_asset_grant(grant)
        or project_asset_grant(grant)
        or motion_asset_grant(grant)
        or video_asset_grant(grant)
        or video_write_grant(grant)
        or motion_asset_write_grant(grant)
        or motion_archive_grant(grant)
        or presentation_archive_grant(grant)
    ):
        return "/v1/files"
    if model_library_output(grant) or library_grant(grant) or task_upload_grant(grant):
        return "/v1/files"
    asset_id = model_library_input(grant)
    return "/v1/files/" + asset_id + "/content" if asset_id else grant.target_path


def permitted(grant, catalog):
    original = catalog.match(grant.source_method, grant.source_path)
    if original is None or original.service != grant.caller:
        return False
    from .account_directory import directory_grant
    from .community_uploads import upload_grant as community_upload_grant
    from .creative_preview import preview_grant
    from .creative_source_evidence import source_transfer_grant
    from .creative_stdio import stdio_grant
    from .external_sync import close_grant, read_grant
    from .thought_archives import archive_grant
    from .thought_assets import asset_grant, upload_grant
    from .tools_video_library import library_grant
    from .writing import writing_grant

    if motion_preview_grant(grant) or motion_snapshot_grant(grant) or motion_export_grant(grant):
        return True
    if directory_grant(grant, catalog):
        return True
    if preview_grant(grant) or source_transfer_grant(grant) or stdio_grant(grant):
        return True
    if task_read_grant(grant) or task_upload_grant(grant):
        return True
    if segment_grant(grant) or writing_grant(grant) or read_grant(grant) or close_grant(grant):
        return True
    if (
        asset_grant(grant)
        or upload_grant(grant)
        or archive_grant(grant)
        or community_upload_grant(grant)
        or audio_asset_grant(grant)
        or project_asset_grant(grant)
        or motion_asset_grant(grant)
        or video_asset_grant(grant)
        or video_write_grant(grant)
        or motion_asset_write_grant(grant)
        or motion_archive_grant(grant)
        or presentation_archive_grant(grant)
    ):
        return True
    if model_library_input(grant) or model_library_output(grant) or library_grant(grant):
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
