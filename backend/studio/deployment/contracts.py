"""Derive reviewable ownership from the checked-in public contract, never the live app."""

import ast
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from studio.config import FIELDS
from studio.contracts.gateway.catalog import SERVICES, service_by_id
from studio.contracts.gateway.routing import SOCKET_OPERATIONS, Operation, RouteCatalog
from studio.contracts.management.setting_owners import KEY_OWNERS, PREFIX_OWNERS

APP_OWNERS = {
    "agent_workbench": "agents",
    "audio_annotation": "annotation",
    "director_desk": "director",
    "galgame_workshop": "galgame",
    "interview_assistant": "interview",
    "motion_compositor": "motion",
    "presentation_workshop": "presentation",
    "thought_workshop": "thought",
    "video_editor": "video",
    "visual_workshop": "visual",
}
API_OWNERS = {
    "management": "management",
    "account": "identity",
    "auth": "identity",
    "agent-workbench": "agents",
    "amadeus": "amadeus",
    "audio-annotation": "annotation",
    "automation": "gateway",
    "code-agents": "agent-runtime",
    "cloud-control": "remote",
    "creative-workshop": "creative",
    "demo-services": "models",
    "director-desk": "director",
    "file-folders": "assets",
    "file-library": "assets",
    "file-storage": "assets",
    "files": "assets",
    "galgame-workshop": "galgame",
    "integrations": "integrations",
    "interview-assistant": "interview",
    "llm-call-logs": "models",
    "local-models": "models",
    "model-catalog": "models",
    "model-categories": "models",
    "model-entries": "models",
    "model-inference": "models",
    "model-providers": "models",
    "model-suppliers": "models",
    "model-test": "models",
    "motion-compositor": "motion",
    "presentation-workshop": "presentation",
    "thought-workshop": "thought",
    "tool-navigation": "tools",
    "video-editor": "video",
    "visual-workshop": "visual",
}
PLATFORM_IDENTITY = {"accounts", "registration-invite-codes", "security-events"}
PLATFORM_MODELS = {"demo-services", "local-models", "model-service-templates", "runtime-quotas"}


def operation_owner(path):
    parts = path.strip("/").split("/")
    if len(parts) < 2 or parts[0] != "v1":
        raise ValueError("不是业务 API")
    if path.startswith("/v1/cloud-control/totp/"):
        return "identity"
    if path == "/v1/file-storage/open-folder":
        return "tools"
    if path in {
        "/v1/files/{asset_id}/crop",
        "/v1/files/{asset_id}/frames",
        "/v1/files/{asset_id}/media-info",
        "/v1/files/{asset_id}/preview",
        "/v1/files/{asset_id}/thumbnail",
    }:
        return "rendering"
    if path.startswith("/v1/visual-workshop/projects/{project_id}/asset-"):
        return "assets"
    if path.startswith("/v1/account/demo-services/"):
        return "models"
    if path == "/v1/account/developer-documents":
        return "portal"
    if path.startswith("/v1/account/project-certification/"):
        return "creative"
    if parts[1] == "platform":
        if parts[2] in PLATFORM_IDENTITY:
            return "identity"
        if parts[2] in PLATFORM_MODELS:
            return "models"
        raise ValueError(f"平台操作尚未登记服务归属：{path}")
    if path.startswith("/v1/tool-navigation/codex-source"):
        return "agent-runtime"
    try:
        return API_OWNERS[parts[1]]
    except KeyError:
        raise ValueError(f"API 尚未登记服务归属：{path}") from None


def table_owner(module, table):
    # This compatibility projection physically lives beside Visual's old model,
    # but its independent data owner is the asset library. A package move must
    # not reassign persisted data or widen the Visual service's database.
    if table == "visual_project_asset_references":
        return "assets"
    if module.startswith("studio.apps.media_rendering."):
        return "rendering"
    if module.startswith("studio.apps.video_editor."):
        return "video"
    if module.startswith("studio.apps.motion_compositor."):
        return "motion"
    if module.startswith("studio.apps.presentation_workshop."):
        return "presentation"
    if module.startswith("studio.apps.audio_annotation."):
        return "annotation"
    if module.startswith("studio.apps.interview_assistant."):
        return "interview"
    if module.startswith("studio.apps.director_desk."):
        return "director"
    if module.startswith("studio.apps.remote_desktop."):
        return "remote"
    if module.startswith("studio.apps.agent_runtime."):
        return "agent-runtime"
    if module.startswith("studio.apps.tools."):
        return "tools"
    if module.startswith("studio.apps.visual_workshop."):
        return "visual"
    if module.startswith("studio.apps.galgame_workshop."):
        return "galgame"
    if module.startswith("studio.apps.creative_workshop."):
        return "creative"
    if module.startswith("studio.apps.integrations."):
        return "integrations"
    if module.startswith("studio.apps.thought_workshop."):
        return "thought"
    if module.startswith("studio.apps.model_service."):
        return "models"
    if module.startswith("studio.apps.management."):
        return "management"
    if module.startswith("studio.apps.asset_library."):
        return "assets"
    if module.startswith("studio.apps.identity."):
        return "identity"
    if module.startswith("studio.apps.gateway."):
        return "gateway"
    if module.startswith("studio.apps.agent_workbench."):
        return "agents"
    parts = module.split(".")
    if module.startswith("app.apps."):
        return APP_OWNERS[parts[2]]
    if module.startswith("studio.apps.asset_library"):
        return "assets"
    if module.startswith("studio.apps.model_service."):
        return "models"
    if module.startswith("studio.apps.integrations."):
        return "integrations"
    if module.startswith("studio.apps.tools."):
        return "tools"
    if module.startswith("studio.apps.remote_desktop."):
        return "remote"
    if module.startswith("studio.apps.amadeus."):
        return "amadeus"
    if module.startswith("studio.apps.creative_workshop."):
        return "creative"
    if module in {
        "studio.apps.identity.storage.models.accounts",
        "studio.runtime.database.settings_models",
    }:
        # Platform settings are explicitly partitioned by key during transfer.
        return "identity"
    if table == "project_operation_receipts":
        return "local-receipts"
    raise ValueError(f"数据表尚未登记服务归属：{module}:{table}")


def model_tables(root):
    result = []
    backend = root / "backend"
    packages = [backend / "app", backend / "studio", *backend.glob("fpl_*")]
    for path in sorted(path for package in packages for path in package.rglob("*.py")):
        tree = ast.parse(path.read_text())
        module = ".".join(path.relative_to(root / "backend").with_suffix("").parts)
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            table = None
            for assignment in node.body:
                if isinstance(assignment, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id == "__tablename__" for t in assignment.targets
                ):
                    table = ast.literal_eval(assignment.value)
            if table:
                result.append(
                    {
                        "table": table,
                        "service": table_owner(module, table),
                        "module": module,
                        "model": node.name,
                    }
                )
    return result


# Projection owners for the known TOML format. Storage and secret configuration
# are instantiated per service from the recovery source under deployment control.
CONFIG_GROUP_OWNERS = {
    "agent_workbench": "agents",
    "code_agents": "agent-runtime",
    "interview_codex": "interview",
    "management": "management",
    "deployment": "management",
    "management_host": "management",
    "management_remote": "management",
    "website": "gateway",
    "storage": "per-service",
    "security": "per-service",
    "remote_web": "gateway",
    "integrations": "integrations",
}
CONFIG_FIELD_OWNERS = {
    "visual_acceptance": {
        "model_owner_user_id": "models",
        "model_id": "models",
        "codex_executable": "agent-runtime",
        "codex_user_ids": "agent-runtime",
        "claude_executable": "agent-runtime",
        "claude_user_ids": "agent-runtime",
    },
    "cloud_control": {
        "enabled": "identity",
        "public_enabled": "identity",
        "public_desktop_vnc_only": "identity",
        "admin_user_ids": "identity",
        "host_label": "remote",
        "guacd_port": "remote",
        "vnc_host": "remote",
        "vnc_port": "remote",
        "vnc_password": "remote",
        "projects": "agents",
    },
    "http": {"cors_origins": "gateway", "auth_cookie_secure": "identity"},
    "limits": {
        "visual_asset_max_bytes": "assets",
        "galgame_export_max_bytes": "assets",
        "project_snapshot_max_bytes": "assets",
        "project_snapshot_max_files": "assets",
        "skill_archive_max_bytes": "integrations",
        "skill_expanded_max_bytes": "integrations",
        "skill_max_files": "integrations",
    },
}


def configuration_owners():
    if set(FIELDS) != CONFIG_GROUP_OWNERS.keys() | CONFIG_FIELD_OWNERS.keys():
        raise ValueError("配置分组缺少服务归属")
    result = {}
    for group, fields in FIELDS.items():
        owners = CONFIG_FIELD_OWNERS.get(group)
        if owners is None:
            owners = dict.fromkeys(fields, CONFIG_GROUP_OWNERS[group])
        if set(owners) != fields.keys():
            raise ValueError(f"配置分组字段缺少服务归属：{group}")
        for service in owners.values():
            if service != "per-service":
                service_by_id(service)
        result[group] = owners
    return result


def document(root):
    schema = json.loads((root / "web/src/generated/openapi.json").read_text())
    operations = []
    for path, methods in schema["paths"].items():
        if path in {"/health", "/ready"}:
            continue
        for method, value in methods.items():
            if isinstance(value, dict) and "operationId" in value:
                operations.append(
                    {
                        "service": operation_owner(path),
                        "method": method.upper(),
                        "path": path,
                        "operation_id": value["operationId"],
                    }
                )
    catalog = RouteCatalog(
        (Operation(**operation) for operation in operations), websockets=SOCKET_OPERATIONS
    )
    catalog.check_openapi(
        {**schema, "paths": {k: v for k, v in schema["paths"].items() if k.startswith("/v1/")}}
    )
    tables = model_tables(root)
    for operation in operations:
        service_by_id(operation["service"])
    return {
        "version": 1,
        "openapi_sha256": hashlib.sha256(
            json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "operations": operations,
        "websockets": [asdict(operation) for operation in SOCKET_OPERATIONS],
        "tables": tables,
        "pages": [
            {"path": root, "service": service.id}
            for service in SERVICES
            for root in service.page_roots
        ],
        "configuration": configuration_owners(),
        "partitions": {
            "platform_settings": {
                "keys": dict(KEY_OWNERS),
                "prefixes": dict(PREFIX_OWNERS),
                "unassigned": "reject",
            },
            "project_operation_receipts": "resource_kind",
        },
        "derived_tables": {"agent_workbench_search": "agents"},
    }


def generate(root: Path, *, check=False):
    content = json.dumps(document(root), ensure_ascii=False, indent=2) + "\n"
    target = root / "deploy/contracts/ownership.json"
    if check:
        if not target.is_file() or target.read_text() != content:
            raise ValueError("服务归属清单已过期，请重新生成")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    return target
