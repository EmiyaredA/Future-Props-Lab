"""Check selected service schemas and required credentials before changing container state."""

import json
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


def check_creative_gateway_credentials(environment, root):
    def read(name):
        value = environment.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Creative 部署缺少凭据文件 {name}")
        try:
            return (root / value).read_text().strip()
        except (OSError, UnicodeError):
            raise ValueError(f"Creative 部署无法读取凭据文件 {name}") from None

    registry = read("FPL_IDENTITY_SERVICE_CREDENTIALS")
    try:
        registered = json.loads(registry)
    except ValueError:
        raise ValueError("Creative 部署的 Identity 服务凭据清单无效") from None
    credential = read("FPL_GATEWAY_IDENTITY_TOKEN")
    if (
        not isinstance(registered, dict)
        or len(credential) < 32
        or not credential.isascii()
        or registered.get("gateway") != credential
    ):
        raise ValueError("Gateway 服务凭据必须与 Identity 登记一致")
    other_credentials = [value for name, value in registered.items() if name != "gateway"]
    other_credentials.append(read("FPL_GATEWAY_TOKEN"))
    if environment.get("FPL_MANAGEMENT_GATEWAY_TOKEN"):
        other_credentials.append(read("FPL_MANAGEMENT_GATEWAY_TOKEN"))
    if credential in other_credentials:
        raise ValueError("Creative 要求 Gateway 服务凭据独立于入口凭据和其他服务凭据")


def check_selected_databases(
    environment, business_services, root, *, only_management=False, credential_root=None
):
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
    if "creative" in selected:
        check_creative_gateway_credentials(environment, credential_root or root)
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
