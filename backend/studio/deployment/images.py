"""Build an allowlisted source closure, never a copy of the monolith tree."""

import ast
import hashlib
import json
import subprocess
from importlib.util import resolve_name
from pathlib import Path

PROJECT_OWNERS = frozenset({"visual", "galgame"})
STUDIO_OWNERS = {
    "audio_annotation": "annotation",
    "agent_workbench": "agents",
    "agent_runtime": "agent-runtime",
    "amadeus": "amadeus",
    "asset_library": "assets",
    "creative_workshop": "creative",
    "director_desk": "director",
    "galgame_workshop": "galgame",
    "gateway": "gateway",
    "identity": "identity",
    "integrations": "integrations",
    "interview_assistant": "interview",
    "management": "management",
    "model_service": "models",
    "motion_compositor": "motion",
    "portal": "portal",
    "presentation_workshop": "presentation",
    "remote_desktop": "remote",
    "media_rendering": "rendering",
    "thought_workshop": "thought",
    "tools": "tools",
    "video_editor": "video",
    "visual_workshop": "visual",
}
# Explicitly reviewed owner SDK adapters. Importing a parent cannot load storage.
# Their transitive dependencies still pass the same source-closure checks.
PUBLIC_CLIENT_MODULES = frozenset(
    [
        "studio.apps.asset_library.clients.archive_delivery",
        "studio.apps.asset_library.clients.archive_transfer",
        "studio.apps.asset_library.clients.project_reveal_http",
        "studio.apps.asset_library.clients.reference_mutations",
        "studio.apps.asset_library.clients.reference_records",
        "studio.apps.asset_library.clients.retention",
        "studio.apps.identity.clients.authorization",
        "studio.apps.identity.clients.certification",
        "studio.apps.identity.clients.certification_http",
        "studio.apps.identity.clients.certification_records",
        "studio.apps.integrations.clients.authority",
    ]
)
PUBLIC_CLIENT_PARENTS = frozenset(
    [
        "studio.apps.asset_library",
        "studio.apps.asset_library.clients",
        "studio.apps.identity",
        "studio.apps.identity.clients",
        "studio.apps.integrations",
        "studio.apps.integrations.clients",
    ]
)


def public_client_module(name):
    return name in PUBLIC_CLIENT_MODULES or name in PUBLIC_CLIENT_PARENTS


OWNED_HTTP_IMAGES = PROJECT_OWNERS | {
    "amadeus",
    "tools",
    "director",
    "agent-runtime",
    "remote",
    "interview",
    "motion",
    "video",
}

ENTRY_POINTS = {
    "amadeus": "studio.assembly.independent.amadeus.cli",
    "annotation": "studio.assembly.independent.audio_annotation.cli",
    "presentation": "studio.assembly.independent.presentation_workshop.cli",
    "motion": "studio.assembly.independent.motion_compositor.cli",
    "video": "studio.assembly.independent.video_editor.cli",
    "visual": "studio.assembly.independent.visual_workshop.cli",
    "galgame": "studio.assembly.independent.galgame_workshop.cli",
    "tools": "studio.assembly.independent.tools.cli",
    "director": "studio.assembly.independent.director_desk.cli",
    "interview": "studio.assembly.independent.interview_assistant.cli",
    "remote": "studio.assembly.independent.remote_desktop.cli",
    "agent-runtime": "studio.assembly.independent.agent_runtime.cli",
    "integrations": "studio.assembly.independent.integrations.cli",
    "thought": "studio.assembly.independent.thought_workshop.cli",
    "creative": "studio.assembly.independent.creative_workshop.cli",
    "models": "studio.assembly.independent.model_service.cli",
    "rendering": "studio.assembly.independent.media_rendering.cli",
    "assets": "studio.assembly.independent.asset_library.cli",
    "management": "studio.assembly.independent.management.cli",
    "identity": "studio.assembly.independent.identity.cli",
    "agents": "studio.assembly.independent.agent_workbench.cli",
    "gateway": "studio.assembly.independent.gateway.cli",
    "portal": "studio.assembly.independent.portal.cli",
}
PROJECT_PACKAGES = ("app", "studio")

FORBIDDEN_IDENTITY = (
    "studio.runtime.database.website",
    "studio.assembly.website.application",
    "studio.assembly.website.routes",
    "studio.assembly.website.models",
    "app.apps",
    "app.llm",
    "app.capabilities.asset_store",
    "app.capabilities.agents",
    "app.console.governance.provisioning",
)

FORBIDDEN_AGENTS = (
    "studio.assembly.website.application",
    "studio.assembly.website.routes",
    "studio.assembly.website.models",
    "app.llm",
    "app.console.models",
    "studio.assembly.http_dependencies",
    "studio.host",
    "app.capabilities.agents.sessions.catalog",
    "app.capabilities.agents.sessions.parsers",
    "studio.apps.agent_workbench.sync.runner",
)


def module_file(root, name):
    path = root / "backend" / name.replace(".", "/")
    if path.with_suffix(".py").is_file():
        return path.with_suffix(".py")
    if (path / "__init__.py").is_file():
        return path / "__init__.py"
    return None


def source_closure(root: Path, service):
    if service not in ENTRY_POINTS:
        raise ValueError("此服务的独立构建尚未完成")
    pending = [ENTRY_POINTS[service]]
    if service == "rendering":
        pending.append("app.capabilities.media_rendering.pdf_preview_worker")
    result = {}
    while pending:
        name = pending.pop()
        if name in result:
            continue
        # Apply ownership to the new namespace as well as the legacy package guards.
        # Unknown owners fail closed so a rename cannot silently widen a service image.
        if name.startswith("studio.apps."):
            owner = name.split(".")[2]
            public_client = public_client_module(name)
            parent_package = name in PUBLIC_CLIENT_PARENTS
            if owner not in STUDIO_OWNERS or (
                STUDIO_OWNERS[owner] != service and not public_client and not parent_package
            ):
                raise ValueError(f"{service} 镜像包含越界依赖：{name}")
        if name.startswith("studio.assembly.independent."):
            owner = name.split(".")[3]
            if owner in STUDIO_OWNERS and STUDIO_OWNERS[owner] != service:
                raise ValueError(f"{service} 镜像包含其他应用装配：{name}")
        if name.startswith(("studio.host", "studio.assembly.website", "studio.deployment")):
            raise ValueError(f"{service} 镜像包含非服务运行依赖：{name}")
        if not public_client_module(name):
            if service == "management" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.assembly.http_dependencies",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "studio.apps.identity",
                    "studio.host",
                )
            ):
                raise ValueError(f"Management 镜像包含越界依赖：{name}")
            if service == "identity" and any(
                name == prefix or name.startswith(prefix + ".") for prefix in FORBIDDEN_IDENTITY
            ):
                raise ValueError(f"Identity 镜像包含越界依赖：{name}")
            if service == "agents" and any(
                name == prefix or name.startswith(prefix + ".") for prefix in FORBIDDEN_AGENTS
            ):
                raise ValueError(f"Agents 镜像包含越界依赖：{name}")
            if (
                service == "assets"
                and name
                not in {
                    "app.capabilities.media_rendering",
                    "app.capabilities.media_rendering.animated_image",
                    "app.capabilities.media_rendering.gif_upload",
                }
                and any(
                    name == prefix or name.startswith(prefix + ".")
                    for prefix in (
                        "studio.assembly.website.application",
                        "studio.assembly.website.routes",
                        "studio.assembly.website.models",
                        "studio.assembly.http_dependencies",
                        "app.apps",
                        "app.llm",
                        "app.console.models",
                        "studio.apps.identity",
                        "studio.host",
                        "app.capabilities.asset_store.assets",
                        "app.capabilities.asset_store.account_upgrade",
                        "app.capabilities.asset_store.layout_migration",
                        "app.capabilities.media_rendering",
                    )
                )
            ):
                raise ValueError(f"Assets 镜像包含越界依赖：{name}")
            if service == "rendering" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.assembly.http_dependencies",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.assets",
                    "app.capabilities.asset_store.library",
                    "studio.apps.asset_library",
                    "studio.apps.identity",
                    "studio.host",
                )
            ):
                raise ValueError(f"Rendering 镜像包含越界依赖：{name}")
            if service == "gateway" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.assembly.http_dependencies",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "app.capabilities.asset_store",
                    "studio.host",
                )
            ):
                raise ValueError(f"Gateway 镜像包含越界依赖：{name}")
            if service == "portal" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.models",
                    "studio.assembly.website.routes",
                    "studio.assembly.http_dependencies",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "studio.apps.identity",
                    "studio.apps.agent_workbench",
                    "studio.apps.asset_library",
                    "studio.host",
                )
            ):
                raise ValueError(f"Portal 镜像包含越界依赖：{name}")
            if service == "integrations" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    "app.apps",
                    "app.llm",
                    "app.console",
                    "app.console.governance.demo_configuration",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.assets",
                    "app.capabilities.asset_store.storage",
                    "app.capabilities.asset_store.library",
                    "studio.apps.model_service",
                    "studio.apps.asset_library",
                    "studio.apps.identity",
                    "studio.host",
                )
            ):
                raise ValueError(f"Integrations 镜像包含越界依赖：{name}")
            if service == "creative" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "app.integrations.models",
                    "studio.apps.identity",
                    "studio.apps.integrations",
                    "studio.apps.visual_workshop",
                    "studio.apps.galgame_workshop",
                    "studio.host",
                )
            ):
                raise ValueError(f"Creative 镜像包含越界依赖：{name}")
            if service == "thought" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    "app.console.models",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.library",
                    "app.capabilities.asset_store.storage",
                    "studio.apps.thought_workshop.portability",
                    "studio.apps.thought_workshop.publication.assets",
                    "studio.apps.asset_library",
                    "studio.apps.identity",
                    "studio.apps.model_service",
                    "studio.apps.integrations",
                    "studio.host",
                )
            ):
                raise ValueError(f"Thought 镜像包含越界依赖：{name}")
            if service == "models" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    "app.apps",
                    "app.console.governance",
                    "app.console.models",
                    "app.console.governance.demo_configuration",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.assets",
                    "app.capabilities.asset_store.storage",
                    "studio.apps.asset_library",
                    "studio.apps.identity",
                    "studio.host",
                )
            ):
                raise ValueError(f"Models 镜像包含越界依赖：{name}")
            if service == "tools" and any(
                name == prefix or name.startswith(prefix + ".")
                for prefix in (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    "app.apps",
                    "app.llm",
                    "app.console",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                    "studio.apps.asset_library",
                    "studio.apps.identity",
                    "studio.host",
                )
            ):
                raise ValueError(f"Tools 镜像包含越界依赖：{name}")
            if service == "agent-runtime" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.apps.",
                        "app.llm",
                        "app.console.governance",
                        "app.console.models",
                        "app.capabilities.agents.cli.catalog",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
            ):
                raise ValueError(f"Agent Runtime 镜像包含越界依赖：{name}")
            if service == "amadeus" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.assembly.http_dependencies",
                    "studio.runtime.database.website",
                }
                or name.startswith(("app.apps.", "app.integrations.", "app.llm."))
                or name.startswith("app.console.governance.")
            ):
                raise ValueError(f"Amadeus 镜像包含越界依赖：{name}")
            if service == "remote" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    ("app.apps.", "app.console.models", "app.llm", "studio.apps.identity")
                )
                or name in {"app.console.cloud_control.access", "app.console.cloud_control.desktop"}
            ):
                raise ValueError(f"Remote 镜像包含越界依赖：{name}")
            if service == "motion" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or (
                    name.startswith("app.apps.")
                    and not name.startswith("studio.apps.motion_compositor")
                )
                or name
                in {
                    "studio.apps.motion_compositor.legacy_project_resources",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                }
            ):
                raise ValueError(f"Motion 镜像包含越界依赖：{name}")
            if service == "video" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or (
                    name.startswith("app.apps.") and not name.startswith("studio.apps.video_editor")
                )
                or name
                in {
                    "studio.apps.video_editor.legacy_project_layouts",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                }
            ):
                raise ValueError(f"Video Editor 镜像包含越界依赖：{name}")
            if service == "presentation" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or (
                    name.startswith("app.apps.")
                    and not name.startswith("studio.apps.presentation_workshop")
                )
                or name
                in {
                    "studio.apps.presentation_workshop.legacy_project_assets",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                }
            ):
                raise ValueError(f"Presentation 镜像包含越界依赖：{name}")
            if service == "annotation" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or name.startswith("app.apps.")
                or name
                in {
                    "studio.apps.audio_annotation.legacy_sources",
                    "studio.apps.audio_annotation.transcription",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                }
            ):
                raise ValueError(f"Annotation 镜像包含越界依赖：{name}")
            if service == "interview" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or (
                    name.startswith("app.apps.")
                    and not name.startswith("studio.apps.interview_assistant")
                )
                or name
                in {
                    "studio.apps.interview_assistant.codex",
                    "studio.apps.interview_assistant.runner",
                }
            ):
                raise ValueError(f"Interview 镜像包含越界依赖：{name}")
            if service == "director" and (
                name
                in {
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                }
                or name.startswith(
                    (
                        "app.console",
                        "app.llm",
                        "studio.apps.asset_library",
                        "studio.apps.identity",
                        "studio.host",
                    )
                )
                or (
                    name.startswith("app.apps.")
                    and not name.startswith("studio.apps.director_desk")
                )
            ):
                raise ValueError(f"Director 镜像包含越界依赖：{name}")
            if service in PROJECT_OWNERS:
                other = "galgame" if service == "visual" else "visual"
                forbidden = (
                    "studio.assembly.website.application",
                    "studio.assembly.website.routes",
                    "studio.assembly.website.models",
                    "studio.runtime.database.website",
                    f"app.apps.{other}_workshop",
                    "app.capabilities.asset_store.models",
                    "app.capabilities.asset_store.storage",
                    "app.console",
                    "studio.apps.asset_library",
                    "studio.apps.creative_workshop",
                    "studio.apps.identity",
                    "studio.host",
                    f"studio.apps.{other}_workshop",
                )
                if service != "visual":
                    forbidden += ("studio.assembly.http_dependencies",)
                llm_contract = name in {
                    "app.llm",
                    "studio.contracts.model_service.schemas",
                    "studio.contracts.model_service.task_execution",
                } or name.startswith("studio.contracts.model_service.schemas.")
                llm_contract |= service == "visual" and name == "app.llm.generation_state"
                if (
                    name.startswith("app.llm.")
                    and not llm_contract
                    or any(name == prefix or name.startswith(prefix + ".") for prefix in forbidden)
                ):
                    raise ValueError(f"{service} 镜像包含越界依赖：{name}")
        path = module_file(root, name)
        if path is None:
            continue
        if path.is_symlink():
            raise ValueError("镜像源码不能是符号链接")
        result[name] = path
        segments = name.split(".")
        pending.extend(".".join(segments[:index]) for index in range(1, len(segments)))
        package = name if path.name == "__init__.py" else name.rpartition(".")[0]
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                imported = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if node.level:
                    module = resolve_name("." * node.level + module, package)
                imported = [module] + [module + "." + alias.name for alias in node.names]
            else:
                continue
            pending.extend(
                candidate
                for candidate in imported
                if candidate.split(".")[0] in PROJECT_PACKAGES
                and module_file(root, candidate) is not None
            )
    return result


def prepare_image(root: Path, service: str, *, web_release=None):
    sources = source_closure(root, service)
    definition = (
        root
        / "deploy/images"
        / (
            "owned-http"
            if service in OWNED_HTTP_IMAGES and service not in {"remote", "amadeus"}
            else service
        )
    )
    generated = subprocess.run(
        [
            "uv",
            "export",
            "--project",
            str(definition),
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--no-header",
            "--format",
            "requirements-txt",
        ],
        check=True,
        capture_output=True,
    ).stdout
    dockerfile = definition / ("Dockerfile.galgame" if service == "galgame" else "Dockerfile")
    if service == "amadeus":
        dockerfile = root / "deploy/images/owned-http/Dockerfile"
    payloads = {str(path.relative_to(root)): path.read_bytes() for path in sources.values()}
    payloads.update(
        {
            "requirements.txt": generated,
            "Dockerfile": dockerfile.read_bytes(),
            "deploy/contracts/ownership.json": (
                root / "deploy/contracts/ownership.json"
            ).read_bytes(),
        }
    )
    if service in OWNED_HTTP_IMAGES:
        payloads["service-entry.py"] = (
            f"from {ENTRY_POINTS[service]} import main\n\nmain()\n"
        ).encode()
    if service in {"identity", "gateway", "amadeus"}:
        manifest = "backend/app/console/governance/automation_operations.json"
        payloads[manifest] = (root / manifest).read_bytes()
    if service in {
        "creative",
        "gateway",
        "thought",
        "tools",
        "director",
        "interview",
        "annotation",
        "presentation",
        "motion",
        "video",
        "visual",
        "galgame",
        "agent-runtime",
        "remote",
        "amadeus",
    }:
        payloads["deploy/contracts/openapi.json"] = (
            root / "web/src/generated/openapi.json"
        ).read_bytes()
    if service == "thought":
        seed = "backend/studio/apps/thought_workshop/publication/seed.json"
        payloads[seed] = (root / seed).read_bytes()
    if service == "models":
        manifest = "backend/studio/config/local_models.json"
        payloads[manifest] = (root / manifest).read_bytes()
    if service == "rendering":
        for name in ("NotoSansSC-Regular.ttf", "NotoSansSC-Medium.ttf", "OFL.txt"):
            asset = "backend/app/capabilities/media_rendering/assets/" + name
            body = (root / asset).read_bytes()
            if body.startswith(b"version https://git-lfs"):
                raise ValueError("Rendering 字体缺少 LFS 内容")
            payloads[asset] = body
    if service == "portal":
        documents = [root / "README.md", root / "CONTRIBUTING.md", root / "docs/assets/MANIFEST.md"]
        for directory in ("architecture", "operations", "reference"):
            documents.extend(sorted((root / "docs" / directory).glob("*.md")))
        for path in documents:
            if path.is_file() and path.name != "api.md":
                if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError("文档源码不能是符号链接或位于仓库之外")
                payloads[path.relative_to(root).as_posix()] = path.read_bytes()
    web_build = None
    if service in {
        "agents",
        "portal",
        "assets",
        "management",
        "models",
        "integrations",
        "thought",
        "creative",
        "tools",
        "director",
        "interview",
        "annotation",
        "presentation",
        "motion",
        "video",
        "visual",
        "galgame",
        "agent-runtime",
    }:
        if web_release is None:
            payloads["web/.api-only"] = b"No browser program in this API acceptance image.\n"
        else:
            from studio.runtime.http.web import load_release

            release = load_release(web_release, service)
            web_build = release.build_id
            payloads["web/build.json"] = (release.root / "build.json").read_bytes()
            for name in release.files:
                payloads["web/" + name] = (release.root / name).read_bytes()
    elif service in OWNED_HTTP_IMAGES:
        payloads["web/.api-only"] = b"No browser program in this API acceptance image.\n"
    hashes = {
        name: hashlib.sha256(content).hexdigest() for name, content in sorted(payloads.items())
    }
    release = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:20]
    context = root / ".local/service-releases" / service / release / "context"
    ignored = subprocess.run(
        ["git", "check-ignore", "--quiet", str(context)], cwd=root, check=False
    )
    if ignored.returncode:
        raise ValueError("构建目录必须被 Git 忽略")
    context.mkdir(parents=True, exist_ok=True)
    expected = set(payloads)
    present = {str(path.relative_to(context)) for path in context.rglob("*") if path.is_file()}
    if present - expected:
        raise ValueError("构建目录包含未登记文件")
    for name, content in payloads.items():
        target = context / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    metadata = {
        "service": service,
        "version": release,
        "web_build": web_build,
        "image": f"fpl/{service}:{release}",
        "files": hashes,
    }
    (context.parent / "release.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return context, metadata


def build_image(root: Path, service: str, *, web_release=None):
    context, metadata = prepare_image(root, service, web_release=web_release)
    subprocess.run(
        [
            "docker",
            "build",
            "--progress",
            "plain",
            "--tag",
            metadata["image"],
            "--build-arg",
            "FPL_SERVICE_VERSION=" + metadata["version"],
            str(context),
        ],
        check=True,
        cwd=root,
    )
    return metadata
