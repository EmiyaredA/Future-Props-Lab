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
APP_SHELL_SELECTOR_PATTERN = re.compile(
    r"\.(?:studio-(?:shell|sidebar|main|lock)|sidebar-footer|nav-(?:group|primary|sub)|auth-)"
)
FEATURE_SELECTOR_PATTERN = re.compile(
    r"\.(?:model|provider|playground|generation-test|log-|conversation|chat-message)"
)


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


def test_public_files_have_independent_ownership() -> None:
    required = (
        BACKEND_APP / "files" / "assets.py",
        BACKEND_APP / "models" / "files.py",
        BACKEND_APP / "schemas" / "files.py",
    )
    assert all(path.is_file() for path in required), "公共文件能力必须由 app/files 拥有"
    assert not (BACKEND_APP / "visual_workshop" / "assets.py").exists()
    for route_name in ("file_management.py", "visual_workshop.py"):
        imports = _python_imports(BACKEND_APP / "routes" / route_name)
        assert "app.visual_workshop.assets" not in imports


def test_visual_assistant_has_no_function_local_app_imports() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP / "visual_workshop" / "assistant"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for function in (
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ):
            for node in ast.walk(function):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    violations.append(f"{_relative(path)}:{node.lineno}")
    assert not violations, "视觉助手不得在函数内动态导入：\n" + "\n".join(violations)


def test_backend_business_packages_have_no_function_local_app_imports() -> None:
    allowed_roots = {"routes", "schemas", "models", "core", "concurrency", "files"}
    violations: list[str] = []
    for path in _python_files(BACKEND_APP):
        relative = path.relative_to(BACKEND_APP)
        if relative.parts[0] in allowed_roots:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for function in (
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ):
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.ImportFrom)
                    and node.module
                    and node.module.startswith("app.")
                ):
                    violations.append(f"{_relative(path)}:{node.lineno} imports {node.module}")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.startswith("app."):
                            violations.append(
                                f"{_relative(path)}:{node.lineno} imports {alias.name}"
                            )
    assert not violations, "业务包不得使用函数内 app.* 导入：\n" + "\n".join(violations)


def test_legacy_asset_root_is_only_resolved_by_storage_boundary() -> None:
    allowed = {
        BACKEND_APP / "core" / "config.py",
        BACKEND_APP / "files" / "storage.py",
        BACKEND_APP / "files" / "layout_migration.py",
    }
    violations = [
        _relative(path)
        for path in _python_files(BACKEND_APP)
        if path not in allowed and "visual_asset_path" in path.read_text(encoding="utf-8")
    ]
    assert not violations, "旧素材根目录只能由存储/迁移边界解析：\n" + "\n".join(violations)


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


def test_cross_feature_imports_use_public_entry() -> None:
    violations: list[str] = []
    features_root = WEB_SRC / "features"
    for path in sorted(features_root.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        source_feature = path.relative_to(features_root).parts[0]
        for specifier in _web_imports(path):
            if not specifier.startswith("@features/"):
                continue
            segments = specifier.split("/")
            if len(segments) < 2 or segments[1] == source_feature:
                continue
            if len(segments) > 2:
                violations.append(f"{_relative(path)} imports {specifier}")
    assert not violations, "跨 feature 只能导入目标 feature 公共入口：\n" + "\n".join(violations)


def test_feature_styles_do_not_reenter_the_app_shell() -> None:
    app_styles = (WEB_SRC / "app" / "styles.css").read_text(encoding="utf-8")
    assert not FEATURE_SELECTOR_PATTERN.search(app_styles), "业务样式不得重新堆入 app/styles.css"
    violations: list[str] = []
    for path in sorted((WEB_SRC / "features").rglob("*.css")):
        if APP_SHELL_SELECTOR_PATTERN.search(path.read_text(encoding="utf-8")):
            violations.append(_relative(path))
    assert not violations, "feature 样式不得覆盖应用壳选择器：\n" + "\n".join(violations)


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
        "backend/app/files",
        "backend/app/llm",
        "backend/app/models",
        "backend/app/routes",
        "backend/app/schemas",
        "backend/app/galgame_workshop",
        "backend/app/tool_navigation",
        "backend/app/visual_workshop",
        "db/migrations/versions",
        "docs/architecture",
        "docs/operations",
        ".github/workflows",
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


def test_galgame_protocol_and_schema_modules_stay_split() -> None:
    route_root = BACKEND_APP / "routes" / "galgame_workshop"
    schema_root = BACKEND_APP / "schemas" / "galgame_workshop"
    assert {"projects.py", "story.py", "assets.py", "asr.py", "maintenance.py"}.issubset(
        {path.name for path in route_root.glob("*.py")}
    )
    assert not (BACKEND_APP / "routes" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop.py").exists()
    oversized = [
        f"{_relative(path)}: {len(path.read_text(encoding='utf-8').splitlines())}"
        for path in schema_root.glob("*.py")
        if len(path.read_text(encoding="utf-8").splitlines()) > 800
    ]
    assert not oversized, "Galgame schema 单文件不得超过 800 行：\n" + "\n".join(oversized)


def test_project_applications_have_modules_routes_and_storage_roots() -> None:
    registry = (WEB_SRC / "app" / "applicationRegistry.ts").read_text(encoding="utf-8")
    settings = (BACKEND_APP / "core" / "config.py").read_text(encoding="utf-8")
    for application in ("visual-workshop", "galgame-workshop"):
        feature = WEB_SRC / "features" / application
        module = feature / "module.ts"
        assert module.is_file(), f"{application} 缺少 feature module"
        source = module.read_text(encoding="utf-8")
        assert "supportsProjects: true" in source
        assert f"/apps/{application}/projects/" in source
        assert f'"{application}"' in settings
        assert module.stem in registry or application.replace("-", "_").upper() in registry


def test_source_modules_are_split_into_reviewable_files() -> None:
    generated_root = WEB_SRC / "generated"
    limits = {
        ".ts": 1_500,
        ".tsx": 1_500,
        ".css": 1_500,
    }
    oversized: list[str] = []
    for path in sorted(WEB_SRC.rglob("*")):
        if not path.is_file() or path.suffix not in limits or _is_within(path, generated_root):
            continue
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        if line_count > limits[path.suffix]:
            oversized.append(f"{_relative(path)}: {line_count} > {limits[path.suffix]}")
    assert not oversized, "生产源码单文件超过评审上限：\n" + "\n".join(oversized)


def test_test_modules_are_split_into_reviewable_files() -> None:
    roots = (REPO_ROOT / "tests", REPO_ROOT / "web" / "tests", REPO_ROOT / "web" / "e2e")
    oversized: list[str] = []
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".py", ".ts", ".tsx"}:
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            if line_count > 2_000:
                oversized.append(f"{_relative(path)}: {line_count} > 2000")
    assert not oversized, "测试文件超过评审上限：\n" + "\n".join(oversized)
