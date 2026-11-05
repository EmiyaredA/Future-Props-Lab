"""Package ownership gates for vertical-slice migrations."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"
STUDIO_APPS = REPO_ROOT / "backend/studio/apps"
CONTRACTS = REPO_ROOT / "backend/studio/contracts"


def test_presentation_workshop_lives_under_apps() -> None:
    assert (REPO_ROOT / "backend/studio/apps/presentation_workshop/storage/models.py").is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/presentation_workshop/transport/website/__init__.py"
    ).is_file()
    assert not (BACKEND_APP / "presentation_workshop").exists()
    assert not (BACKEND_APP / "models" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "presentation_operations.py").exists()


def test_audio_annotation_lives_under_apps() -> None:
    owner = REPO_ROOT / "backend/studio/apps/audio_annotation"
    assert (owner / "models.py").is_file()
    assert (owner / "routes" / "__init__.py").is_file()
    assert not (BACKEND_APP / "apps/audio_annotation/models.py").exists()
    assert not (BACKEND_APP / "audio_annotation").exists()
    assert not (BACKEND_APP / "models" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "routes" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "routes" / "annotation_exports.py").exists()
    assert not (BACKEND_APP / "schemas" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "schemas" / "annotation_operations.py").exists()


def test_thought_workshop_lives_under_apps() -> None:
    assert (REPO_ROOT / "backend/studio/apps/thought_workshop/storage/models.py").is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/thought_workshop/transport/website/__init__.py"
    ).is_file()
    assert (REPO_ROOT / "backend/studio/apps/thought_workshop/content_exports_http.py").is_file()
    assert not (BACKEND_APP / "thought_workshop").exists()
    assert not (BACKEND_APP / "models" / "thought_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "thought_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "thought_conversion.py").exists()
    for schema_name in (
        "thought_workshop.py",
        "thought_document.py",
        "thought_history.py",
        "thought_knowledge.py",
        "thought_link_preview.py",
        "thought_operations.py",
        "thought_conversion.py",
    ):
        assert not (BACKEND_APP / "schemas" / schema_name).exists()


def test_video_editor_lives_under_apps() -> None:
    assert (REPO_ROOT / "backend/studio/apps/video_editor/storage/models.py").is_file()
    assert (REPO_ROOT / "backend/studio/apps/video_editor/transport/website/__init__.py").is_file()
    assert not (BACKEND_APP / "video_editor").exists()
    assert not (BACKEND_APP / "models" / "video_editor.py").exists()
    assert not (BACKEND_APP / "routes" / "video_editor.py").exists()
    assert not (BACKEND_APP / "schemas" / "video_editor").exists()


def test_visual_workshop_lives_under_apps() -> None:
    assert (REPO_ROOT / "backend/studio/apps/visual_workshop/storage/models.py").is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/visual_workshop/transport/website/__init__.py"
    ).is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/visual_workshop/transport/website/assistant.py"
    ).is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/visual_workshop/transport/website/generation.py"
    ).is_file()
    assert not (BACKEND_APP / "visual_workshop").exists()
    assert not (BACKEND_APP / "models" / "visual_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "visual_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "visual_assistant.py").exists()
    assert not (BACKEND_APP / "routes" / "visual_generation.py").exists()
    for schema_name in (
        "visual_workshop.py",
        "visual_operations.py",
        "visual_generation.py",
        "visual_assistant.py",
    ):
        assert not (BACKEND_APP / "schemas" / schema_name).exists()


def test_galgame_workshop_lives_under_apps() -> None:
    assert (REPO_ROOT / "backend/studio/apps/galgame_workshop/storage/models.py").is_file()
    assert (
        REPO_ROOT / "backend/studio/apps/galgame_workshop/transport/website/__init__.py"
    ).is_file()
    assert (REPO_ROOT / "backend/studio/apps/galgame_workshop/story").is_dir()
    assert (REPO_ROOT / "backend/studio/apps/galgame_workshop/assets").is_dir()
    assert (REPO_ROOT / "backend/studio/apps/galgame_workshop/video").is_dir()
    assert not (BACKEND_APP / "galgame_workshop").exists()
    assert not (BACKEND_APP / "models" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "galgame_workshop").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_operations.py").exists()
    assert not (BACKEND_APP / "routes" / "workshop_operations.py").exists()


def test_llm_owns_models_schemas_and_routes() -> None:
    assert (STUDIO_APPS / "model_service/storage/models" / "model_service.py").is_file()
    assert (CONTRACTS / "model_service/schemas" / "model_service.py").is_file()
    assert (REPO_ROOT / "backend/studio/contracts/model_service/generation_tasks.py").is_file()
    assert (CONTRACTS / "model_service/schemas" / "realtime_voice.py").is_file()
    assert (STUDIO_APPS / "model_service/transport/website" / "models" / "catalog.py").is_file()
    assert (STUDIO_APPS / "model_service/transport/website" / "model_inference.py").is_file()
    for name in (
        "model_service.py",
        "model_supplier.py",
        "model_test.py",
        "model_test_tools.py",
        "model_inference.py",
        "call_log.py",
    ):
        assert not (BACKEND_APP / "models" / name).exists()
    for name in (
        "model_service.py",
        "model_supplier.py",
        "model_test.py",
        "model_test_tools.py",
        "model_inference.py",
        "model_templates.py",
        "call_log.py",
        "generation_tasks.py",
    ):
        assert not (BACKEND_APP / "schemas" / name).exists()
    assert not (BACKEND_APP / "schemas" / "realtime_voice.py").exists()
    assert not (BACKEND_APP / "routes" / "models").exists()
    assert not (BACKEND_APP / "routes" / "model_inference.py").exists()
    assert not (BACKEND_APP / "routes" / "model_templates.py").exists()
    assert not (BACKEND_APP / "routes" / "model_capacity.py").exists()


def test_integrations_owns_models_schemas_and_routes() -> None:
    assert (BACKEND_APP / "integrations" / "models.py").is_file()
    assert (BACKEND_APP / "integrations" / "schemas.py").is_file()
    assert (BACKEND_APP / "integrations" / "routes.py").is_file()
    assert not (BACKEND_APP / "models" / "integrations.py").exists()
    assert not (BACKEND_APP / "schemas" / "integrations.py").exists()
    assert not (BACKEND_APP / "routes" / "integrations.py").exists()


def test_tool_navigation_owns_models_schemas_and_routes() -> None:
    assert (BACKEND_APP / "tool_navigation" / "models.py").is_file()
    assert (BACKEND_APP / "tool_navigation" / "schemas.py").is_file()
    assert (BACKEND_APP / "tool_navigation" / "routes.py").is_file()
    assert not (BACKEND_APP / "models" / "tool_navigation.py").exists()
    assert not (BACKEND_APP / "schemas" / "tool_navigation.py").exists()
    assert not (BACKEND_APP / "routes" / "tool_navigation.py").exists()


def test_demo_runtime_owns_schemas_and_routes() -> None:
    assert (CONTRACTS / "model_service/demo.py").is_file()
    assert (STUDIO_APPS / "model_service/transport/website/demo.py").is_file()
    assert not (BACKEND_APP / "schemas" / "demo_runtime.py").exists()
    assert not (BACKEND_APP / "routes" / "demo_runtime.py").exists()


def test_identity_owns_account_routes_and_contracts() -> None:
    for name in ("auth", "accounts", "account_management", "registration"):
        assert (STUDIO_APPS / "identity/transport/website" / (name + ".py")).is_file()
        assert not (BACKEND_APP / "console/routes" / (name + ".py")).exists()
    for name in ("accounts", "registration", "project_markers"):
        assert (CONTRACTS / "identity" / (name + ".py")).is_file()
    for name in ("file_management.py",):
        assert (BACKEND_APP / "console/routes" / name).is_file()
    assert (CONTRACTS / "gateway/automation.py").is_file()
    assert (STUDIO_APPS / "gateway/transport/website/automation.py").is_file()
    assert (STUDIO_APPS / "portal/transport/website.py").is_file()
    assert (STUDIO_APPS / "model_service/transport/website/quotas.py").is_file()
    assert not (BACKEND_APP / "console/schemas/platform_governance.py").exists()


def test_media_contracts_are_separate_from_website_file_adapters() -> None:
    for name in ("image_crop.py", "media_info.py", "video_frames.py", "previews.py"):
        assert (STUDIO_APPS / "media_rendering/transport/website" / name).is_file()
        assert not (BACKEND_APP / "capabilities/asset_store" / name).exists()
    for name in ("image_crop.py", "video_frames.py", "media_info.py"):
        assert (CONTRACTS / "media_rendering" / name).is_file()
        assert not (BACKEND_APP / "capabilities/asset_store/schemas" / name).exists()
    assert not (BACKEND_APP / "schemas" / "image_crop.py").exists()
    assert not (BACKEND_APP / "schemas" / "video_frames.py").exists()


def test_identity_and_models_own_their_records() -> None:
    for name in ("accounts.py", "registration.py"):
        assert (STUDIO_APPS / "identity/storage/models" / name).is_file()
    assert not (BACKEND_APP / "console/models/accounts.py").exists()
    # The compatibility website retains one partitioned settings table.
    assert (BACKEND_APP / "console/models/platform_governance.py").is_file()
    for name in ("model_templates.py", "runtime_admission.py"):
        assert (STUDIO_APPS / "model_service/storage/models" / name).is_file()
        assert not (BACKEND_APP / "console/models" / name).exists()
    assert not (BACKEND_APP / "models").exists()
    assert not (BACKEND_APP / "schemas").exists()


def test_asset_store_owns_files_models_and_schemas() -> None:
    assert (BACKEND_APP / "capabilities" / "asset_store" / "models.py").is_file()
    assert (CONTRACTS / "asset_library/files.py").is_file()
    assert not (BACKEND_APP / "capabilities/asset_store/schemas/files.py").exists()
    assert (REPO_ROOT / "backend/studio/contracts/asset_library/project_snapshots.py").is_file()


def test_transcription_owns_schemas() -> None:
    assert (CONTRACTS / "model_service/transcription.py").is_file()


def test_runtime_owns_project_operations_and_defaults() -> None:
    assert (REPO_ROOT / "backend/studio/runtime/database/project_operations.py").is_file()
    assert (REPO_ROOT / "backend/studio/runtime/operation_batches.py").is_file()
    assert (REPO_ROOT / "backend/studio/runtime/ids.py").is_file()
    assert (REPO_ROOT / "backend/studio/runtime/time.py").is_file()
    assert not (BACKEND_APP / "models").exists()
    assert not (BACKEND_APP / "schemas").exists()
