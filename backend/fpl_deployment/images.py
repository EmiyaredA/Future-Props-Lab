"""Build an allowlisted source closure, never a copy of the monolith tree."""

import ast
import hashlib
import json
import subprocess
from importlib.util import resolve_name
from pathlib import Path

ENTRY_POINTS = {
    "identity": "fpl_identity.__main__",
    "agents": "fpl_agents.__main__",
    "gateway": "fpl_gateway.__main__",
}
PROJECT_PACKAGES = (
    "app",
    "fpl_identity",
    "fpl_agents",
    "fpl_gateway",
    "fpl_runtime",
    "fpl_config",
    "fpl_host",
)
FORBIDDEN_IDENTITY = (
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
    result = {}
    while pending:
        name = pending.pop()
        if name in result:
            continue
        if service == "identity" and any(
            name == prefix or name.startswith(prefix + ".") for prefix in FORBIDDEN_IDENTITY
        ):
            raise ValueError(f"Identity 镜像包含越界依赖：{name}")
        if service == "agents" and any(
            name == prefix or name.startswith(prefix + ".") for prefix in FORBIDDEN_AGENTS
        ):
            raise ValueError(f"Agents 镜像包含越界依赖：{name}")
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
    generated = subprocess.run(
        [
            "uv",
            "export",
            "--project",
            str(root / "deploy/images" / service),
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
    payloads = {str(path.relative_to(root)): path.read_bytes() for path in sources.values()}
    payloads.update(
        {
            "requirements.txt": generated,
            "Dockerfile": (root / "deploy/images" / service / "Dockerfile").read_bytes(),
            "deploy/contracts/ownership.json": (
                root / "deploy/contracts/ownership.json"
            ).read_bytes(),
        }
    )
    if service in {"identity", "gateway"}:
        manifest = "backend/app/console/governance/automation_operations.json"
        payloads[manifest] = (root / manifest).read_bytes()
    if service == "gateway":
        payloads["deploy/contracts/openapi.json"] = (
            root / "web/src/generated/openapi.json"
        ).read_bytes()
    web_build = None
    if service == "agents":
        if web_release is None:
            payloads["web/.api-only"] = b"No browser program in this API acceptance image.\n"
        else:
            from fpl_runtime.web import load_release

            release = load_release(web_release, service)
            web_build = release.build_id
            payloads["web/build.json"] = (release.root / "build.json").read_bytes()
            for name in release.files:
                payloads["web/" + name] = (release.root / name).read_bytes()
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
