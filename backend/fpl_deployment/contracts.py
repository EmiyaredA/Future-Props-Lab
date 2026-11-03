"""Derive reviewable ownership from the checked-in public contract, never the live app."""

import ast
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from fpl_runtime.catalog import service_by_id
from fpl_runtime.routing import SOCKET_OPERATIONS, Operation, RouteCatalog

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
    if module.startswith("fpl_integrations."):
        return "integrations"
    if module.startswith("fpl_thought."):
        return "thought"
    if module.startswith("fpl_models."):
        return "models"
    if module.startswith("fpl_management."):
        return "management"
    if module.startswith("fpl_assets."):
        return "assets"
    if module.startswith("fpl_identity."):
        return "identity"
    if module.startswith("fpl_gateway."):
        return "gateway"
    if module.startswith("fpl_agents."):
        return "agents"
    parts = module.split(".")
    if module.startswith("app.apps."):
        return APP_OWNERS[parts[2]]
    if module.startswith("app.capabilities.asset_store"):
        return "visual" if table == "visual_project_asset_references" else "assets"
    if module.startswith("app.llm."):
        return "models"
    if module.startswith("app.integrations."):
        return "integrations"
    if module.startswith("app.tool_navigation."):
        return "tools"
    if module.startswith("app.console.amadeus."):
        return "amadeus"
    if module.startswith("app.console.creative_workshop."):
        return "creative"
    if module in {"app.console.models.accounts", "app.console.models.platform_governance"}:
        # Platform settings are explicitly partitioned by key during transfer.
        return "identity"
    if table == "project_operation_receipts":
        return "local-receipts"
    raise ValueError(f"数据表尚未登记服务归属：{module}:{table}")


def model_tables(root):
    result = []
    for path in sorted(
        list((root / "backend/app").rglob("*.py"))
        + list((root / "backend/fpl_identity").rglob("*.py"))
        + list((root / "backend/fpl_management").rglob("*.py"))
        + list((root / "backend/fpl_agents").rglob("*.py"))
        + list((root / "backend/fpl_gateway").rglob("*.py"))
        + list((root / "backend/fpl_assets").rglob("*.py"))
        + list((root / "backend/fpl_models").rglob("*.py"))
        + list((root / "backend/fpl_integrations").rglob("*.py"))
        + list((root / "backend/fpl_thought").rglob("*.py"))
    ):
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
    catalog = RouteCatalog(Operation(**operation) for operation in operations)
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
        "partitions": {
            "platform_settings": {
                "keys": {"runtime_quotas": "models", "code_agents": "agent-runtime"},
                "prefixes": {
                    "role_template:": "models",
                    "demo_service:": "models",
                    "account_defaults:": "models",
                },
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
