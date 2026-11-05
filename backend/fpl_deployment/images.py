"""Build an allowlisted source closure, never a copy of the monolith tree."""

import ast
import hashlib
import json
import subprocess
from importlib.util import resolve_name
from pathlib import Path

PROJECT_OWNERS = frozenset({"visual", "galgame"})
OWNED_HTTP_IMAGES = PROJECT_OWNERS | {
    "tools",
    "director",
    "agent-runtime",
    "remote",
    "interview",
    "motion",
    "video",
}

ENTRY_POINTS = {
    "annotation": "fpl_annotation.__main__",
    "presentation": "fpl_presentation.__main__",
    "motion": "fpl_motion.__main__",
    "video": "fpl_video.__main__",
    "visual": "fpl_visual.__main__",
    "galgame": "fpl_galgame.__main__",
    "tools": "fpl_tools.__main__",
    "director": "fpl_director.__main__",
    "interview": "fpl_interview.__main__",
    "remote": "fpl_remote.__main__",
    "agent-runtime": "fpl_agent_runtime.__main__",
    "integrations": "fpl_integrations.__main__",
    "thought": "fpl_thought.__main__",
    "creative": "fpl_creative.__main__",
    "models": "fpl_models.__main__",
    "rendering": "fpl_rendering.__main__",
    "assets": "fpl_assets.__main__",
    "management": "fpl_management.__main__",
    "identity": "fpl_identity.__main__",
    "agents": "fpl_agents.__main__",
    "gateway": "fpl_gateway.__main__",
    "portal": "fpl_portal.__main__",
}
PROJECT_PACKAGES = (
    "app",
    "fpl_management",
    "fpl_identity",
    "fpl_agents",
    "fpl_gateway",
    "fpl_portal",
    "fpl_assets",
    "fpl_annotation",
    "fpl_presentation",
    "fpl_motion",
    "fpl_video",
    "fpl_rendering",
    "fpl_models",
    "fpl_thought",
    "fpl_visual",
    "fpl_galgame",
    "fpl_tools",
    "fpl_director",
    "fpl_interview",
    "fpl_remote",
    "fpl_agent_runtime",
    "fpl_integrations",
    "fpl_creative",
    "fpl_runtime",
    "fpl_config",
    "fpl_host",
)
FORBIDDEN_IDENTITY = (
    "app.runtime.db",
    "app.main",
    "app.api",
    "app.orm",
    "app.apps",
    "app.llm",
    "app.capabilities.asset_store",
    "app.capabilities.agents",
    "app.console.governance.provisioning",
)

FORBIDDEN_AGENTS = (
    "app.main",
    "app.api",
    "app.orm",
    "app.llm",
    "app.console.models",
    "app.deps",
    "fpl_host",
    "app.capabilities.agents.sessions.catalog",
    "app.capabilities.agents.sessions.parsers",
    "app.apps.agent_workbench.sync.runner",
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
        if service == "management" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.deps",
                "app.apps",
                "app.llm",
                "app.console.models",
                "fpl_identity",
                "fpl_host",
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
                    "app.main",
                    "app.api",
                    "app.orm",
                    "app.deps",
                    "app.apps",
                    "app.llm",
                    "app.console.models",
                    "fpl_identity",
                    "fpl_host",
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
                "app.main",
                "app.api",
                "app.orm",
                "app.deps",
                "app.apps",
                "app.llm",
                "app.console.models",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.assets",
                "app.capabilities.asset_store.library",
                "fpl_assets",
                "fpl_identity",
                "fpl_host",
            )
        ):
            raise ValueError(f"Rendering 镜像包含越界依赖：{name}")
        if service == "gateway" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.deps",
                "app.apps",
                "app.llm",
                "app.console.models",
                "app.capabilities.asset_store",
                "fpl_host",
            )
        ):
            raise ValueError(f"Gateway 镜像包含越界依赖：{name}")
        if service == "portal" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.orm",
                "app.api",
                "app.deps",
                "app.apps",
                "app.llm",
                "app.console.models",
                "fpl_identity",
                "fpl_agents",
                "fpl_assets",
                "fpl_host",
            )
        ):
            raise ValueError(f"Portal 镜像包含越界依赖：{name}")
        if service == "integrations" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                "app.apps",
                "app.llm",
                "app.console",
                "app.demo_runtime.runtime",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.assets",
                "app.capabilities.asset_store.storage",
                "app.capabilities.asset_store.library",
                "fpl_models",
                "fpl_assets",
                "fpl_identity",
                "fpl_host",
            )
        ):
            raise ValueError(f"Integrations 镜像包含越界依赖：{name}")
        if service == "creative" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                "app.apps",
                "app.llm",
                "app.console.models",
                "app.integrations.models",
                "fpl_identity",
                "fpl_integrations",
                "fpl_visual",
                "fpl_galgame",
                "fpl_host",
            )
        ):
            raise ValueError(f"Creative 镜像包含越界依赖：{name}")
        if service == "thought" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                "app.console.models",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.library",
                "app.capabilities.asset_store.storage",
                "app.apps.thought_workshop.portability",
                "app.apps.thought_workshop.publication.assets",
                "fpl_assets",
                "fpl_identity",
                "fpl_models",
                "fpl_integrations",
                "fpl_host",
            )
        ):
            raise ValueError(f"Thought 镜像包含越界依赖：{name}")
        if service == "models" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                "app.apps",
                "app.console.governance",
                "app.console.models",
                "app.demo_runtime.runtime",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.assets",
                "app.capabilities.asset_store.storage",
                "fpl_assets",
                "fpl_identity",
                "fpl_host",
            )
        ):
            raise ValueError(f"Models 镜像包含越界依赖：{name}")
        if service == "tools" and any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                "app.apps",
                "app.llm",
                "app.console",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
                "fpl_assets",
                "fpl_identity",
                "fpl_host",
            )
        ):
            raise ValueError(f"Tools 镜像包含越界依赖：{name}")
        if service == "agent-runtime" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(
                (
                    "app.apps.",
                    "app.llm",
                    "app.console.governance",
                    "app.console.models",
                    "app.capabilities.agents.cli.catalog",
                    "fpl_identity",
                    "fpl_host",
                )
            )
        ):
            raise ValueError(f"Agent Runtime 镜像包含越界依赖：{name}")
        if service == "remote" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.apps.", "app.console.models", "app.llm", "fpl_identity"))
            or name in {"app.console.cloud_control.access", "app.console.cloud_control.desktop"}
        ):
            raise ValueError(f"Remote 镜像包含越界依赖：{name}")
        if service == "motion" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (name.startswith("app.apps.") and not name.startswith("app.apps.motion_compositor"))
            or name
            in {
                "app.apps.motion_compositor.legacy_project_resources",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
            }
        ):
            raise ValueError(f"Motion 镜像包含越界依赖：{name}")
        if service == "video" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (name.startswith("app.apps.") and not name.startswith("app.apps.video_editor"))
            or name
            in {
                "app.apps.video_editor.legacy_project_layouts",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
            }
        ):
            raise ValueError(f"Video Editor 镜像包含越界依赖：{name}")
        if service == "presentation" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (
                name.startswith("app.apps.")
                and not name.startswith("app.apps.presentation_workshop")
            )
            or name
            in {
                "app.apps.presentation_workshop.legacy_project_assets",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
            }
        ):
            raise ValueError(f"Presentation 镜像包含越界依赖：{name}")
        if service == "annotation" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (name.startswith("app.apps.") and not name.startswith("app.apps.audio_annotation"))
            or name
            in {
                "app.apps.audio_annotation.legacy_sources",
                "app.apps.audio_annotation.transcription",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
            }
        ):
            raise ValueError(f"Annotation 镜像包含越界依赖：{name}")
        if service == "interview" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (
                name.startswith("app.apps.") and not name.startswith("app.apps.interview_assistant")
            )
            or name
            in {
                "app.apps.interview_assistant.codex",
                "app.apps.interview_assistant.runner",
            }
        ):
            raise ValueError(f"Interview 镜像包含越界依赖：{name}")
        if service == "director" and (
            name in {"app.main", "app.api", "app.orm", "app.runtime.db"}
            or name.startswith(("app.console", "app.llm", "fpl_assets", "fpl_identity", "fpl_host"))
            or (name.startswith("app.apps.") and not name.startswith("app.apps.director_desk"))
        ):
            raise ValueError(f"Director 镜像包含越界依赖：{name}")
        if service in PROJECT_OWNERS:
            other = "galgame" if service == "visual" else "visual"
            forbidden = (
                "app.main",
                "app.api",
                "app.orm",
                "app.runtime.db",
                f"app.apps.{other}_workshop",
                "app.capabilities.asset_store.models",
                "app.capabilities.asset_store.storage",
                "app.console",
                "fpl_assets",
                "fpl_creative",
                "fpl_identity",
                "fpl_host",
                f"fpl_{other}",
            )
            if service != "visual":
                forbidden += ("app.deps",)
            llm_contract = name in {
                "app.llm",
                "app.llm.schemas",
                "app.llm.task_execution",
            } or name.startswith("app.llm.schemas.")
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
        / ("owned-http" if service in OWNED_HTTP_IMAGES and service != "remote" else service)
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
    if service in {"identity", "gateway"}:
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
    }:
        payloads["deploy/contracts/openapi.json"] = (
            root / "web/src/generated/openapi.json"
        ).read_bytes()
    if service == "thought":
        seed = "backend/app/apps/thought_workshop/publication/seed.json"
        payloads[seed] = (root / seed).read_bytes()
    if service == "models":
        manifest = "backend/app/llm/local_models/manifest.json"
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
            from fpl_runtime.web import load_release

            release = load_release(web_release, service)
            web_build = release.build_id
            payloads["web/build.json"] = (release.root / "build.json").read_bytes()
            for name in release.files:
                payloads["web/" + name] = (release.root / name).read_bytes()
    elif service in PROJECT_OWNERS or service == "remote":
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
