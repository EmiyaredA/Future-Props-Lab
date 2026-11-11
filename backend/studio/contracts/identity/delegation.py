"""Destination- and purpose-bound request delegation. No arbitrary account impersonation."""

import re
from dataclasses import dataclass

from studio.contracts.amadeus.amadeus_native import RUN_SOURCE
from studio.contracts.amadeus.amadeus_skills import skill_pin_grant
from studio.contracts.amadeus.message_forks import FORK_SOURCE, is_fork_read
from studio.contracts.asset_library.annotation import audio_asset_grant
from studio.contracts.asset_library.reveal import reveal_grant
from studio.contracts.audio_annotation.task_sources import task_read_grant, task_upload_grant
from studio.contracts.galgame_workshop.galgame_annotation_source import (
    source_grant as galgame_annotation_grant,
)
from studio.contracts.galgame_workshop.galgame_asr import asr_model_grant
from studio.contracts.galgame_workshop.galgame_asr_execution import asr_job_grant
from studio.contracts.galgame_workshop.galgame_assets import (
    export_download_grant,
    galgame_asset_grant,
)
from studio.contracts.galgame_workshop.galgame_exports import export_grant as galgame_export_grant
from studio.contracts.galgame_workshop.galgame_frames import frame_grant as galgame_frame_grant
from studio.contracts.galgame_workshop.galgame_handoff import (
    video_handoff_grant as galgame_handoff_grant,
)
from studio.contracts.galgame_workshop.galgame_render import capacity_grant
from studio.contracts.galgame_workshop.galgame_snapshot import (
    archive_grant as galgame_archive_grant,
)
from studio.contracts.galgame_workshop.galgame_snapshot import (
    snapshot_files_grant,
    snapshot_model_grant,
)
from studio.contracts.galgame_workshop.galgame_upload import upload_grant as galgame_upload_grant
from studio.contracts.gateway.automation_manifest import automation_manifest
from studio.contracts.gateway.resource_routes import RESOURCE_ROUTES
from studio.contracts.identity.approved_operations import PURPOSE as APPROVED_OPERATION
from studio.contracts.identity.approved_operations import approved_source
from studio.contracts.model_service.annotation import segment_grant
from studio.contracts.motion_compositor.motion_assets import (
    motion_asset_grant,
    motion_asset_write_grant,
)
from studio.contracts.motion_compositor.motion_exports import render_grant as motion_export_grant
from studio.contracts.motion_compositor.motion_preview import motion_preview_grant
from studio.contracts.motion_compositor.motion_snapshot import (
    motion_archive_grant,
    motion_snapshot_grant,
)
from studio.contracts.presentation_workshop.presentation_archives import presentation_archive_grant
from studio.contracts.presentation_workshop.presentation_assets import project_asset_grant
from studio.contracts.video_editor.video_assets import video_asset_grant, video_write_grant
from studio.contracts.video_editor.video_audio import audio_grant
from studio.contracts.video_editor.video_frames import frame_grant as video_frame_grant
from studio.contracts.video_editor.video_handoff import handoff_grant
from studio.contracts.video_editor.video_segment_handoff import target_grant as segment_target_grant
from studio.contracts.video_editor.video_segments import bundle_grant as segment_bundle_grant
from studio.contracts.video_editor.video_snapshot import archive_grant as video_archive_grant
from studio.contracts.video_editor.video_snapshot import snapshot_grant as video_snapshot_grant
from studio.contracts.visual_workshop.visual_acceptance_assets import acceptance_asset_grant
from studio.contracts.visual_workshop.visual_agent_review import agent_review_grant
from studio.contracts.visual_workshop.visual_catalog import (
    acceptance_agent_grant,
    visual_catalog_grant,
)
from studio.contracts.visual_workshop.visual_composition import composition_grant
from studio.contracts.visual_workshop.visual_generation import (
    visual_generation_asset_grant,
    visual_generation_model_grant,
    visual_generation_plan_grant,
)
from studio.contracts.visual_workshop.visual_review import review_model_grant
from studio.contracts.visual_workshop.visual_samples import sample_grant
from studio.contracts.visual_workshop.visual_snapshot import archive_grant as visual_archive_grant
from studio.contracts.visual_workshop.visual_snapshot import snapshot_grant as visual_snapshot_grant


@dataclass(frozen=True)
class RequestGrant:
    caller: str
    purpose: str
    source_method: str
    source_path: str
    target_service: str
    target_method: str
    target_path: str
    target_sha256: str | None = None


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
    if skill_pin_grant(grant):
        return "/v1/integrations/skills"
    if (
        handoff_grant(grant)
        or reveal_grant(grant)
        or segment_bundle_grant(grant)
        or asr_model_grant(grant)
    ):
        return grant.source_path
    from studio.contracts.creative_workshop.creative_preview import preview_grant
    from studio.contracts.creative_workshop.creative_source_evidence import source_transfer_grant
    from studio.contracts.creative_workshop.creative_stdio import stdio_grant
    from studio.contracts.identity.account_directory import directory_path
    from studio.contracts.integrations.external_sync import close_grant, read_grant
    from studio.contracts.thought_workshop.community_uploads import (
        upload_grant as community_upload_grant,
    )
    from studio.contracts.thought_workshop.thought_archives import archive_grant
    from studio.contracts.thought_workshop.thought_assets import asset_grant, upload_grant
    from studio.contracts.thought_workshop.writing import writing_grant, writing_target
    from studio.contracts.tools.tools_video_library import library_grant

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
        or video_archive_grant(grant)
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
    if grant.target_sha256 is not None or grant.purpose == APPROVED_OPERATION:
        if not approved_source(grant):
            return False
        source = catalog.match(grant.source_method, grant.source_path)
        destination = catalog.match(grant.target_method, grant.target_path)
        return (
            source is not None
            and source.service == "amadeus"
            and destination is not None
            and destination.service == grant.target_service
            and f"{grant.target_method} {destination.path}" in automation_manifest()["operations"]
        )
    if grant.caller == "agent-runtime" and agent_review_grant(grant):
        return True
    original = catalog.match(grant.source_method, grant.source_path)
    if original is None or original.service != grant.caller:
        return False
    from studio.contracts.creative_workshop.creative_preview import preview_grant
    from studio.contracts.creative_workshop.creative_source_evidence import source_transfer_grant
    from studio.contracts.creative_workshop.creative_stdio import stdio_grant
    from studio.contracts.identity.account_directory import directory_grant
    from studio.contracts.integrations.external_sync import close_grant, read_grant
    from studio.contracts.thought_workshop.community_uploads import (
        upload_grant as community_upload_grant,
    )
    from studio.contracts.thought_workshop.thought_archives import archive_grant
    from studio.contracts.thought_workshop.thought_assets import asset_grant, upload_grant
    from studio.contracts.thought_workshop.writing import writing_grant
    from studio.contracts.tools.tools_video_library import library_grant

    if (
        motion_preview_grant(grant)
        or motion_snapshot_grant(grant)
        or motion_export_grant(grant)
        or video_frame_grant(grant)
        or handoff_grant(grant)
        or reveal_grant(grant)
        or segment_bundle_grant(grant)
        or segment_target_grant(grant)
        or audio_grant(grant)
        or video_snapshot_grant(grant)
    ):
        return True
    if (
        galgame_asset_grant(grant)
        or snapshot_files_grant(grant)
        or snapshot_model_grant(grant)
        or export_download_grant(grant)
        or capacity_grant(grant)
        or galgame_frame_grant(grant)
        or galgame_export_grant(grant)
        or galgame_handoff_grant(grant)
        or galgame_annotation_grant(grant)
        or galgame_upload_grant(grant)
        or galgame_archive_grant(grant)
        or visual_archive_grant(grant)
        or visual_catalog_grant(grant)
        or acceptance_agent_grant(grant)
        or acceptance_asset_grant(grant)
        or visual_snapshot_grant(grant)
        or composition_grant(grant)
        or sample_grant(grant)
        or review_model_grant(grant)
        or agent_review_grant(grant)
        or visual_generation_model_grant(grant)
        or visual_generation_asset_grant(grant)
        or visual_generation_plan_grant(grant)
        or asr_model_grant(grant)
        or asr_job_grant(grant)
        or directory_grant(grant, catalog)
    ):
        return True
    if preview_grant(grant) or source_transfer_grant(grant) or stdio_grant(grant):
        return True
    if skill_pin_grant(grant) or task_read_grant(grant) or task_upload_grant(grant):
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
        or video_archive_grant(grant)
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
    if grant.purpose == "amadeus.fork.read":
        return (
            grant.caller == "amadeus"
            and grant.source_method == "POST"
            and FORK_SOURCE.fullmatch(grant.source_path) is not None
            and grant.target_method == "GET"
            and is_fork_read(automation_manifest()["operations"].get("GET " + destination.path))
        )
    if grant.purpose in {"amadeus.operation.read", "amadeus.dialogue.read"}:
        return (
            grant.caller == "amadeus"
            and grant.source_method == "POST"
            and (
                (
                    grant.purpose == "amadeus.operation.read"
                    and grant.source_path == "/v1/amadeus/operations/read"
                )
                or (
                    grant.purpose == "amadeus.dialogue.read"
                    and RUN_SOURCE.fullmatch(grant.source_path)
                )
            )
            and grant.target_method == "GET"
            and "GET " + destination.path in automation_manifest()["operations"]
        )
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
