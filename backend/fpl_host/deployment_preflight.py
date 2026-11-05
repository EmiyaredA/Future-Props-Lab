"""Check every selected service database before the host changes container state."""

from importlib import import_module
from pathlib import Path

from fpl_runtime.migrations import check

MIGRATION_MODULES = {
    "agent-runtime": "fpl_agent_runtime.migrations.registry",
    "agents": "fpl_agents.migrations.registry",
    "amadeus": "fpl_amadeus.migrations.registry",
    "annotation": "fpl_annotation.migrations.registry",
    "assets": "fpl_assets.migrations.registry",
    "creative": "fpl_creative.migrations.registry",
    "director": "fpl_director.migrations.registry",
    "galgame": "fpl_galgame.migrations.registry",
    "gateway": "fpl_gateway.migrations.registry",
    "identity": "fpl_identity.migrations.registry",
    "integrations": "fpl_integrations.migrations.registry",
    "interview": "fpl_interview.migrations.registry",
    "management": "fpl_management.migrations.registry",
    "models": "fpl_models.migrations.registry",
    "motion": "fpl_motion.migrations.registry",
    "portal": "fpl_portal.migrations.registry",
    "presentation": "fpl_presentation.migrations.registry",
    "remote": "fpl_remote.migrations.registry",
    "rendering": "fpl_rendering.migrations.registry",
    "thought": "fpl_thought.migrations.registry",
    "tools": "fpl_tools.migrations.registry",
    "video": "fpl_video.migrations.registry",
    "visual": "fpl_visual.migrations.registry",
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
        selected.update(
            service
            for service in business_services
            if environment.get(service_env(service, "IMAGE"))
        )
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
