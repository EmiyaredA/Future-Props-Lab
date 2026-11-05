"""Check every selected service database before the host changes container state."""

from importlib import import_module
from pathlib import Path

from studio.runtime.database.migrations import check

MIGRATION_MODULES = {
    "agent-runtime": "studio.apps.agent_runtime.storage.migrations.registry",
    "agents": "studio.apps.agent_workbench.storage.migrations.registry",
    "amadeus": "studio.apps.amadeus.storage.migrations.registry",
    "annotation": "studio.apps.audio_annotation.storage.migrations.registry",
    "assets": "studio.apps.asset_library.storage.migrations.registry",
    "creative": "studio.apps.creative_workshop.storage.migrations.registry",
    "director": "studio.apps.director_desk.storage.migrations.registry",
    "galgame": "studio.apps.galgame_workshop.storage.migrations.registry",
    "gateway": "studio.apps.gateway.storage.migrations.registry",
    "identity": "studio.apps.identity.storage.migrations.registry",
    "integrations": "studio.apps.integrations.storage.migrations.registry",
    "interview": "studio.apps.interview_assistant.storage.migrations.registry",
    "management": "studio.apps.management.storage.migrations.registry",
    "models": "studio.apps.model_service.storage.migrations.registry",
    "motion": "studio.apps.motion_compositor.storage.migrations.registry",
    "portal": "studio.apps.portal.storage.migrations.registry",
    "presentation": "studio.apps.presentation_workshop.storage.migrations.registry",
    "remote": "studio.apps.remote_desktop.storage.migrations.registry",
    "rendering": "studio.apps.media_rendering.storage.migrations.registry",
    "thought": "studio.apps.thought_workshop.storage.migrations.registry",
    "tools": "studio.apps.tools.storage.migrations.registry",
    "video": "studio.apps.video_editor.storage.migrations.registry",
    "visual": "studio.apps.visual_workshop.storage.migrations.registry",
}


def service_env(service, field):
    name = service.upper().replace("-", "_")
    return f"FPL_{name}_{field}"


def check_selected_databases(environment, business_services, root, *, only_management=False):
    """Read only configured service databases; never initialize or migrate them."""
    selected = {"identity", "management"}
    if environment.get("FPL_MODELS_IMAGE"):
        selected.add("models")
    if not only_management:
        for service in business_services:
            if service not in MIGRATION_MODULES:
                raise ValueError(f"所选服务尚未提供独立迁移检查：{service}")
            if not environment.get(service_env(service, "IMAGE")):
                raise ValueError(f"所选服务缺少发布镜像：{service}")
            selected.add(service)
    for service in sorted(selected):
        module = MIGRATION_MODULES.get(service)
        if module is None:
            raise ValueError(f"所选服务尚未提供独立迁移检查：{service}")
        state = environment.get(service_env(service, "STATE"))
        if not isinstance(state, str) or not state.strip():
            raise ValueError(f"所选服务缺少状态目录：{service}")
        directory = Path(state)
        if not directory.is_absolute():
            directory = root / directory
        check(directory / "service.db", service, import_module(module).MIGRATIONS)
