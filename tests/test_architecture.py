from __future__ import annotations

import ast
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"
WEB_SRC = REPO_ROOT / "web" / "src"

FORBIDDEN_BACKEND_DIRECTORIES = {"domain", "platform", "product", "services"}
ROUTE_FORBIDDEN_IMPORTS = ("app.models", "db", "sqlalchemy")
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace", "websocket"}
ROOT_PROBE_PATHS = {"/health", "/ready"}

FROM_IMPORT_PATTERN = re.compile(r"\bfrom\s+[\"']([^\"']+)[\"']")
SIDE_EFFECT_IMPORT_PATTERN = re.compile(r"^\s*import\s+[\"']([^\"']+)[\"']", re.MULTILINE)
DYNAMIC_IMPORT_PATTERN = re.compile(r"\bimport\(\s*[\"']([^\"']+)[\"']\s*\)")


def _python_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def _python_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module)
    return imports


def _matches_module(module: str, prefix: str) -> bool:
    return module == prefix or module.startswith(f"{prefix}.")


def _relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True


def _web_imports(path: Path) -> set[str]:
    source = path.read_text(encoding="utf-8")
    imports: set[str] = set()
    for pattern in (FROM_IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN):
        imports.update(pattern.findall(source))
    return imports


def _resolve_web_import(source: Path, specifier: str) -> Path | None:
    aliases = {
        "@app": WEB_SRC / "app",
        "@features": WEB_SRC / "features",
        "@generated": WEB_SRC / "generated",
        "@platform": WEB_SRC / "platform",
        "@shared": WEB_SRC / "shared",
    }
    for alias, directory in aliases.items():
        if specifier == alias or specifier.startswith(f"{alias}/"):
            suffix = specifier.removeprefix(alias).lstrip("/")
            return (directory / suffix).resolve()
    if specifier.startswith("."):
        return (source.parent / specifier).resolve()
    return None


def test_backend_routes_do_not_own_persistence() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP / "routes"):
        for module in _python_imports(path):
            if any(_matches_module(module, prefix) for prefix in ROUTE_FORBIDDEN_IMPORTS):
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "路由层不得直接依赖持久化实现：\n" + "\n".join(violations)


def test_migrations_are_runtime_independent() -> None:
    violations: list[str] = []
    for path in _python_files(REPO_ROOT / "db" / "migrations"):
        for module in _python_imports(path):
            if _matches_module(module, "app"):
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "迁移层不得反向导入运行时 app：\n" + "\n".join(violations)


def test_backend_avoids_generic_abstract_layer_directories() -> None:
    violations = sorted(
        _relative(path)
        for path in BACKEND_APP.rglob("*")
        if path.is_dir() and path.name in FORBIDDEN_BACKEND_DIRECTORIES
    )
    assert not violations, "请按具体能力命名后端目录：\n" + "\n".join(violations)


def test_web_dependency_direction() -> None:
    layer_rules = {
        "platform": (WEB_SRC / "app", WEB_SRC / "features"),
        "shared": (WEB_SRC / "app", WEB_SRC / "features"),
        "features": (WEB_SRC / "app",),
    }
    violations: list[str] = []
    for layer, forbidden_targets in layer_rules.items():
        for path in sorted((WEB_SRC / layer).rglob("*")):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            for specifier in _web_imports(path):
                target = _resolve_web_import(path, specifier)
                if target is not None and any(
                    _is_within(target, directory) for directory in forbidden_targets
                ):
                    violations.append(f"{_relative(path)} imports {specifier}")
    assert not violations, "Web 依赖方向违规：\n" + "\n".join(violations)


def test_business_routes_are_mounted_under_v1() -> None:
    routes_init = BACKEND_APP / "routes" / "__init__.py"
    routes_tree = ast.parse(routes_init.read_text(encoding="utf-8"), filename=str(routes_init))
    prefixes: list[str] = []
    for node in ast.walk(routes_tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(
            isinstance(target, ast.Name) and target.id == "api_router" for target in targets
        ):
            continue
        value = node.value
        if not isinstance(value, ast.Call):
            continue
        for keyword in value.keywords:
            if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant):
                prefixes.append(keyword.value.value)
    assert prefixes == ["/v1"], "api_router 必须且只能使用 /v1 前缀"

    main_path = BACKEND_APP / "main.py"
    main_tree = ast.parse(main_path.read_text(encoding="utf-8"), filename=str(main_path))
    root_paths: set[str] = set()
    for node in ast.walk(main_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            owner = decorator.func.value
            if (
                isinstance(owner, ast.Name)
                and owner.id == "app"
                and decorator.func.attr in HTTP_METHODS
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                root_paths.add(decorator.args[0].value)
    assert root_paths == ROOT_PROBE_PATHS, "根级路由只能包含 /health 与 /ready"


def test_documented_core_directories_exist() -> None:
    required = (
        "backend/app/agents",
        "backend/app/concurrency",
        "backend/app/core",
        "backend/app/llm",
        "backend/app/models",
        "backend/app/routes",
        "backend/app/schemas",
        "backend/app/tool_navigation",
        "backend/app/visual_workshop",
        "db/migrations/versions",
        "docs/architecture",
        "scripts",
        "tests",
        "web/e2e",
        "web/src/app",
        "web/src/docs",
        "web/src/features",
        "web/src/generated",
        "web/src/platform",
        "web/src/shared",
        "web/tests",
    )
    missing = [path for path in required if not (REPO_ROOT / path).is_dir()]
    assert not missing, "项目结构文档声明的核心目录缺失：\n" + "\n".join(missing)
