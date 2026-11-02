"""Package ownership gates for vertical-slice migrations."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"


def test_presentation_workshop_lives_under_apps() -> None:
    assert (BACKEND_APP / "apps" / "presentation_workshop" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "presentation_workshop" / "routes" / "__init__.py").is_file()
    assert not (BACKEND_APP / "presentation_workshop").exists()
    assert not (BACKEND_APP / "models" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "presentation_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "presentation_operations.py").exists()


def test_audio_annotation_lives_under_apps() -> None:
    assert (BACKEND_APP / "apps" / "audio_annotation" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "audio_annotation" / "routes" / "__init__.py").is_file()
    assert not (BACKEND_APP / "audio_annotation").exists()
    assert not (BACKEND_APP / "models" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "routes" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "routes" / "annotation_exports.py").exists()
    assert not (BACKEND_APP / "schemas" / "audio_annotation.py").exists()
    assert not (BACKEND_APP / "schemas" / "annotation_operations.py").exists()


def test_thought_workshop_lives_under_apps() -> None:
    assert (BACKEND_APP / "apps" / "thought_workshop" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "thought_workshop" / "routes" / "__init__.py").is_file()
    assert (BACKEND_APP / "apps" / "thought_workshop" / "routes" / "conversion.py").is_file()
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
    assert (BACKEND_APP / "apps" / "video_editor" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "video_editor" / "routes" / "__init__.py").is_file()
    assert not (BACKEND_APP / "video_editor").exists()
    assert not (BACKEND_APP / "models" / "video_editor.py").exists()
    assert not (BACKEND_APP / "routes" / "video_editor.py").exists()
    assert not (BACKEND_APP / "schemas" / "video_editor").exists()


def test_visual_workshop_lives_under_apps() -> None:
    assert (BACKEND_APP / "apps" / "visual_workshop" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "visual_workshop" / "routes" / "__init__.py").is_file()
    assert (BACKEND_APP / "apps" / "visual_workshop" / "routes" / "assistant.py").is_file()
    assert (BACKEND_APP / "apps" / "visual_workshop" / "routes" / "generation.py").is_file()
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
    assert (BACKEND_APP / "apps" / "galgame_workshop" / "models.py").is_file()
    assert (BACKEND_APP / "apps" / "galgame_workshop" / "routes" / "__init__.py").is_file()
    assert (BACKEND_APP / "apps" / "galgame_workshop" / "story").is_dir()
    assert (BACKEND_APP / "apps" / "galgame_workshop" / "assets").is_dir()
    assert (BACKEND_APP / "apps" / "galgame_workshop" / "video").is_dir()
    assert not (BACKEND_APP / "galgame_workshop").exists()
    assert not (BACKEND_APP / "models" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "galgame_workshop").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_operations.py").exists()
    assert not (BACKEND_APP / "routes" / "workshop_operations.py").exists()


def test_llm_owns_models_schemas_and_routes() -> None:
    assert (BACKEND_APP / "llm" / "models" / "model_service.py").is_file()
    assert (BACKEND_APP / "llm" / "schemas" / "model_service.py").is_file()
    assert (BACKEND_APP / "llm" / "schemas" / "generation_tasks.py").is_file()
    assert (BACKEND_APP / "llm" / "schemas" / "realtime_voice.py").is_file()
    assert (BACKEND_APP / "llm" / "routes" / "models" / "catalog.py").is_file()
    assert (BACKEND_APP / "llm" / "routes" / "model_inference.py").is_file()
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
    assert (BACKEND_APP / "demo_runtime" / "schemas.py").is_file()
    assert (BACKEND_APP / "demo_runtime" / "routes.py").is_file()
    assert not (BACKEND_APP / "schemas" / "demo_runtime.py").exists()
    assert not (BACKEND_APP / "routes" / "demo_runtime.py").exists()


def test_console_owns_routes_and_schemas() -> None:
    console_routes = (
        "auth.py",
        "accounts.py",
        "account_management.py",
        "platform_governance.py",
        "automation.py",
        "file_management.py",
    )
    console_schemas = (
        "accounts.py",
        "automation.py",
        "platform_governance.py",
    )
    for name in console_routes:
        assert (BACKEND_APP / "console" / "routes" / name).is_file()
        if name != "auth.py":
            assert not (BACKEND_APP / "routes" / name).exists()
    for name in console_schemas:
        assert (BACKEND_APP / "console" / "schemas" / name).is_file()
        assert not (BACKEND_APP / "schemas" / name).exists()
    assert not (BACKEND_APP / "routes" / "image_crop.py").exists()
    assert not (BACKEND_APP / "routes" / "video_frames.py").exists()


def test_asset_store_owns_media_routes_and_schemas() -> None:
    assert (BACKEND_APP / "capabilities" / "asset_store" / "routes" / "image_crop.py").is_file()
    assert (BACKEND_APP / "capabilities" / "asset_store" / "routes" / "video_frames.py").is_file()
    assert (BACKEND_APP / "capabilities" / "asset_store" / "schemas" / "image_crop.py").is_file()
    assert (BACKEND_APP / "capabilities" / "asset_store" / "schemas" / "video_frames.py").is_file()
    assert not (BACKEND_APP / "schemas" / "image_crop.py").exists()
    assert not (BACKEND_APP / "schemas" / "video_frames.py").exists()


def test_console_owns_account_models_and_llm_owns_model_governance_records() -> None:
    for name in (
        "accounts.py",
        "platform_governance.py",
    ):
        assert (BACKEND_APP / "console" / "models" / name).is_file()
    for name in ("model_templates.py", "runtime_admission.py"):
        assert (BACKEND_APP / "llm" / "models" / name).is_file()
        assert not (BACKEND_APP / "console" / "models" / name).exists()
    assert not (BACKEND_APP / "models").exists()
    assert not (BACKEND_APP / "schemas").exists()


def test_asset_store_owns_files_models_and_schemas() -> None:
    assert (BACKEND_APP / "capabilities" / "asset_store" / "models.py").is_file()
    assert (BACKEND_APP / "capabilities" / "asset_store" / "schemas" / "files.py").is_file()
    assert (
        BACKEND_APP / "capabilities" / "asset_store" / "schemas" / "project_snapshots.py"
    ).is_file()


def test_transcription_owns_schemas() -> None:
    assert (BACKEND_APP / "capabilities" / "transcription" / "schemas.py").is_file()


def test_runtime_owns_project_operations_and_defaults() -> None:
    assert (BACKEND_APP / "runtime" / "project_operations.py").is_file()
    assert (BACKEND_APP / "runtime" / "operation_batches.py").is_file()
    assert (BACKEND_APP / "runtime" / "ids.py").is_file()
    assert (BACKEND_APP / "runtime" / "time.py").is_file()
    assert not (BACKEND_APP / "models").exists()
    assert not (BACKEND_APP / "schemas").exists()
